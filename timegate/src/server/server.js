import express, { json } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { compare, hash } from 'bcrypt';
import { Redis } from '@upstash/redis';
import 'dotenv/config'; 

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SALT_ROUNDS = 10;
const DEFAULT_TTL = 45; // Default TTL in seconds if not set in DB or Redis
const TTL_PER_CLIENT = 10; // TTL per client to ensure we don't exceed quota considering 1 client 24 hours = 86400 seconds, so 10s TTL allows for ~8640 requests/day which is under our 10k quota with some buffer.

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

app.use(cors());
app.use(json());

const getRedisStatusKey = (clientId) => `heartbeat:${clientId}`;
const getRedisTTLKey = async (clientId) => `config:ttl:${clientId}`;

// Global Admin Auth (One password for all)
const checkAuth = async (req, res, next) => {
    const password = req.headers['authorization'];
    const result = await pool.query('SELECT value FROM settings WHERE key = $1 AND client_id IS NULL', ['admin_password']);
    if (result.rows.length === 0) return res.status(403).json({ error: 'Not initialized' });
    
    const match = await compare(password || '', result.rows[0].value);
    if (match) next();
    else res.status(401).json({ error: 'Unauthorized password' });
};


// client context (For client requests)
const getClient = (req, res, next) => {
    const clientId = req.headers['x-client-id'];
    if (!clientId) return res.status(400).json({ error: 'Missing x-client-id' });
    req.clientId = clientId;
    next();
};
// Record a heartbeat for a client
// A simple helper to get TTL from Redis (or DB fallback)
const getClientTTL = async (clientId) => {
    const redisKey = await getRedisTTLKey(clientId);
    
    // 1. Try to get from Redis
    const cachedTTL = await redis.get(redisKey);
    if (cachedTTL) return parseInt(cachedTTL);

    // 2. Cache miss: Fetch from Postgres
    const result = await pool.query('SELECT heartbeat_ttl FROM clients WHERE id = $1', [clientId]);
    const dbTTL = result.rows.length > 0 ? result.rows[0].heartbeat_ttl : DEFAULT_TTL;

    // 3. Populate Redis for next time
    await redis.set(redisKey, dbTTL);
    
    return dbTTL;
};


// Updated recordHeartbeat using Redis as the config source
const recordHeartbeat = async (clientId) => {
    if (!clientId) return;
    try {
        const ttl = await getClientTTL(clientId);
        // Use the TTL from Redis config to set the heartbeat expiry
        await redis.set(getRedisStatusKey(clientId), "1", { ex: ttl });
        console.log("Updated heartbeat for", clientId, "with TTL:", ttl);
    } catch (err) {
        console.error("Redis Heartbeat Error:", err);
    }
};

async function debugInfo() {
    try {
        const checkId = await pool.query('SELECT * FROM clients');
        console.log('Clients in database:', checkId.rows);

        const select = await pool.query('SELECT min_start_time, max_start_time FROM global_settings');
        console.log('Global settings:', select.rows);
        
    } catch (err) {
        console.error({ err }, 'Failed to run debug info');
    }
}

app.post('/api/clients/update-ttl', checkAuth, getClient, async (req, res) => {
    // req.clientId comes from the getClient middleware (header)
    // newTTL comes from the query string (e.g., /api/clients/update-ttl?ttl=60)
    const newTTL = parseInt(req.query.ttl);

    if (isNaN(newTTL) || newTTL < 5) {
        return res.status(400).json({ error: "Invalid TTL value. Minimum 5s required." });
    }

    try {
        // 1. Update the Source of Truth (Postgres)
        await pool.query(
            'UPDATE clients SET heartbeat_ttl = $1 WHERE id = $2', 
            [newTTL, req.clientId]
        );

        // 2. Update the Hot Cache (Redis)
        // This ensures the next /api/poll immediately uses the new duration
        await redis.set(await getRedisTTLKey(req.clientId), newTTL);

        res.json({ 
            success: true, 
            clientId: req.clientId, 
            applied_ttl: newTTL 
        });
    } catch (err) {
        console.error("Failed to update TTL:", err);
        res.status(500).json({ error: "Database/Cache sync failed" });
    }
});

app.get('/api/clients/get-status', getClient, async (req, res) => {
    try {
        // We use a pipeline to hit Redis once for multiple data points
        const pipeline = redis.pipeline();
        
        // 1. Check if heartbeat exists (is it online?)
        pipeline.exists(getRedisStatusKey(req.clientId));
        
        // 2. Get the remaining seconds before it turns Red
        pipeline.ttl(getRedisStatusKey(req.clientId));
        
        // 3. Get the configured TTL for this device
        pipeline.get(getRedisTTLKey(req.clientId));

        const [exists, remaining, configTtl] = await pipeline.exec();

        // Fallback to DB if Redis config is empty (Cache miss)
        let finalConfigTtl = configTtl;
        if (!finalConfigTtl) {
            const result = await pool.query('SELECT heartbeat_ttl FROM clients WHERE id = $1', [req.clientId]);
            finalConfigTtl = result.rows.length > 0 ? result.rows[0].heartbeat_ttl : DEFAULT_TTL;
            // Repopulate Redis cache
            await redis.set(getRedisTTLKey(req.clientId), finalConfigTtl);
        }
        // console.log(`Status check for ${req.clientId}: Online=${exists === 1}, Remaining TTL=${remaining}s, Configured TTL=${finalConfigTtl}s`);

        res.json({
            online: exists === 1,
            ttl: parseInt(finalConfigTtl)
        });

    } catch (err) {
        console.error("Status fetch failure:", err);
        res.status(500).json({ error: "Failed to retrieve device status" });
    }
});


export async function isAuthorized(req) {
  // 1. Get the key from the incoming request header
  const authHeader = req.headers['Authorization'];
  const providedKey = authHeader?.replace('Bearer ', '');

  // 2. Get your secret key from your Vercel Environment Variables
  const validKey = process.env.TIMEGATE_API_SECRET;

  // 3. Compare them
  if (!providedKey || providedKey !== validKey) {
    return false;
  }
  return true;
}

// Call it as an async function
debugInfo();

// --- MIDDLEWARE ---

app.get('/api/auth-status', async (req, res) => {
    const result = await pool.query('SELECT 1 FROM settings WHERE key = $1', ['admin_password']);
    res.json({ initialized: result.rows.length > 0 });
});



// --- REGISTRATION LOGIC ---

function calculateActiveMinutes(schedule) {
    let totalActiveMinutesAcrossAllDevices = 0;

    console.log("Calculating active minutes for the week from schedule:", schedule);
    Object.values(schedule).forEach(dayWindows => {
        if (!dayWindows || dayWindows.length === 0) {
            return;
        }

        // 1. Convert all strings to [start, end] minute pairs
        const intervals = dayWindows
            .filter(w => w && typeof w === 'string') // Ignore nulls/empty commas
            .map(windowStr => {
                const parts = windowStr.split(/[- ,]/);
                if (parts.length !== 2) return null;
                
                const start = parts[0].split(':').map(Number);
                const end = parts[1].split(':').map(Number);
                
                return {
                    start: (start[0] * 60) + (start[1] || 0),
                    end: (end[0] * 60) + (end[1] || 0)
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.start - b.start); // Sort by start time

       
        if (intervals.length === 0) {
            console.log("No valid intervals for this day, skipping.", intervals);
            return;
        }

        // 2. Merge overlapping intervals
        const merged = [];
        let current = intervals[0];

        for (let i = 1; i < intervals.length; i++) {
            const next = intervals[i];
            
            if (next.start <= current.end) {
                // There is an overlap, extend the current end time
                current.end = Math.max(current.end, next.end);
            } else {
                // No overlap, push the finished block and move to next
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);
        console.log("Merged intervals for the day:", merged);

        // 3. Sum the unique duration of merged blocks
        merged.forEach(interval => {
            totalActiveMinutesAcrossAllDevices += (interval.end - interval.start);
        });
    });

    console.log("Total active minutes across all devices for the week:", totalActiveMinutesAcrossAllDevices);
    return totalActiveMinutesAcrossAllDevices;
}

async function calculateDynamicTTL() {
    const QUOTA = 10000;
    const UI_OVERHEAD = 200; // 1 poll/min for ~3 hours of dashboard use
    const MAX_AVAILABLE_SECS_FOR_DEVICE = QUOTA - UI_OVERHEAD;

    // 1. Fetch all power_on_schedules
    const result = await pool.query("SELECT value FROM settings WHERE key = 'power_on_schedule'");
    
    const combinedSchedules = result.rows.reduce((acc, row) => {
        const schedule = JSON.parse(row.value);
        
        Object.entries(schedule).forEach(([day, windows]) => {
            if (!acc[day]) acc[day] = [];
            // Use concat to keep ALL windows from ALL clients for that day
            acc[day] = acc[day].concat(windows);
        });
        
        return acc;
    }, {});
    console.log('Combined Schedules from all clients:', combinedSchedules);
    let totalActiveMinutesAcrossAllDevices = calculateActiveMinutes(combinedSchedules);
    console.log('Total Active Minutes Across All Devices Per Week:', totalActiveMinutesAcrossAllDevices);
    
    // Convert total active minutes per week to average daily requests
    const avgDailyActiveSeconds = (totalActiveMinutesAcrossAllDevices / 7) * 60;

    // 2. Solve: (avgDailyActiveSeconds / TTL) = availableForDevices
    // TTL = avgDailyActiveSeconds / availableForDevices
    let safeTTL = Math.ceil(avgDailyActiveSeconds / MAX_AVAILABLE_SECS_FOR_DEVICE);
    console.log(`Calculated dynamic TTL: ${safeTTL}s based on average daily active seconds (${avgDailyActiveSeconds}s) and available quota (${MAX_AVAILABLE_SECS_FOR_DEVICE} requests/day).`);

    return Math.max(TTL_PER_CLIENT, safeTTL); // Never go below TTL_PER_CLIENT for stability
}

async function syncGlobalQuota() {
    const newTTL = await calculateDynamicTTL();

    // 1. Update Database so devices know their new heartbeat rate
    await pool.query('UPDATE clients SET heartbeat_ttl = $1', [newTTL]);

    // 2. Update Redis Config Cache for all clients
    const clients = await pool.query('SELECT id FROM clients');
    const pipeline = redis.pipeline();
    clients.rows.forEach(c => {
        pipeline.set(getRedisTTLKey(c.id), newTTL);
    });
    await pipeline.exec();
    
    console.log(`[QUOTA] Global TTL adjusted to ${newTTL}s based on schedules.`);
}

app.post('/api/register', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized API Key' });
    }
    if (!('id' in req.body) || !('unique_key' in req.body) ) {
        console.log('Invalid registration request (expecting id and unique_key):', req.body);
        return res.status(400).json({ error: "Missing required fields" });
    }
    const suggested_client_id = req.body.id;
    const unique_key = req.body.unique_key;
    console.log(req.body, 'Received registration request with suggested ID and unique key:', suggested_client_id, unique_key);
    if (!suggested_client_id || !unique_key) return res.status(400).json({ error: "Missing suggested ID or Unique Key" });

    const client = await pool.connect();
    try {
        // 1. Check if this specific device is already registered
        const existingDevice = await pool.query('SELECT id FROM clients WHERE unique_key = $1', [unique_key]);
        console.log('Existing device check:', existingDevice.rows);
        if (existingDevice.rows.length > 0) {
            return res.status(300).json({ id: existingDevice.rows[0].id, message: "Already registered" });
        }
        console.log('Requested device not found, proceeding with registration for suggested name:', suggested_client_id);

        // 2. Handle ID conflict and generate a new one if necessary
        let finalId = suggested_client_id;
        let isAvailable = false;
        let attempt = 0;

        while (!isAvailable) {
            const checkId = await pool.query('SELECT 1 FROM clients WHERE id = $1', [finalId]);
            if (checkId.rows.length === 0) {
                isAvailable = true;
            } else {
                attempt++;
                finalId = `${suggested_client_id}_${attempt}`;
            }
        }
        console.log('Suggested name changed to', finalId, 'after checking for conflicts. Proceeding with registration.');

        await client.query('BEGIN');

            // 1. Register the new client
            await client.query(
                'INSERT INTO clients (id, unique_key, heartbeat_ttl) VALUES ($1, $2, $3)',
                [finalId, unique_key, calculateDynamicTTL()]
            );

            // 2. Initialize default settings for this new client if needed
            await client.query(
                'INSERT INTO global_settings (client_id) VALUES ($1) ON CONFLICT DO NOTHING', 
                [finalId]
            );
        
        await client.query('COMMIT');

        syncGlobalQuota(); // Recalculate global TTL based on the new device addition

        console.log('Client registered successfully with ID:', finalId);

        res.status(200).json({ id: finalId, message: "Newly registered" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Registration failed" });
    } finally {
        client.release();
    }
});

app.post('/api/unregister', async (req, res) => {
    // 1. Authorization Check
    if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized API Key' });
    }

    // 2. Validate Request Body
    if (!('id' in req.body) || !('unique_key' in req.body)) {
        console.log('Invalid unregistration request (expecting id AND unique_key):', req.body);
        return res.status(400).json({ error: "Missing id or unique_id, both are required identification fields" });
    }

    const client_id = req.body.id;
    const unique_key = req.body.unique_key;
    console.log('Received unregistration request:', req.body);

    const client = await pool.connect();
    try {
        // 3. Verify if the client actually exists before attempting deletion
        let existingDevice;
        if (client_id && unique_key) {
            existingDevice = await pool.query('SELECT id FROM clients WHERE id = $1 AND unique_key = $2', [client_id, unique_key]);

        }

        if (existingDevice.rows.length === 0) {
            return res.status(404).json({ error: "Client device not found" });
        }

        // Capture the definitive final ID for internal logs and setting deletions
        const savedId = existingDevice.rows[0].id; 
        console.log(`Proceeding with unregistration for client ID: ${savedId}`);

        // 4. Execute deletion inside a transaction block
        try {
            await client.query('BEGIN');

            // Delete associated client settings first if foreign keys aren't set to CASCADE
            await client.query(
                'DELETE FROM global_settings WHERE client_id = $1',
                [savedId]
            );

            // Delete the client entry
            await client.query(
                'DELETE FROM clients WHERE id = $1',
                [savedId]
            );
            
            await client.query('COMMIT');
        } catch (transactionErr) {
            await client.query('ROLLBACK');
            throw transactionErr; // Bubble up to outer catch block
        } finally {
            client.release(); // Always release the client back to the pool
        }

        // 5. Post-deletion cleanup/sync
        syncGlobalQuota(); // Recalculate global TTL allocation now that a device is removed

        console.log('Client unregistered successfully. ID removed:', savedId);
        res.status(200).json({ id: savedId, message: "Successfully unregistered" });

    } catch (err) {
        console.error('Unregistration error:', err);
        res.status(500).json({ error: "Unregistration failed" });
    } finally {
        client.release(); // Always release the client back to the pool
    }
});
// --- ADMIN ENDPOINTS (Global) ---

app.post('/api/setup-password', async (req, res) => {
    const { password } = req.body;
    const check = await pool.query('SELECT 1 FROM settings WHERE key = $1', ['admin_password']);
    if (check.rows.length > 0) return res.status(300).send("Already set");
    const hashed = await hash(password, SALT_ROUNDS);

    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['admin_password', hashed]);
    res.json({ success: true });
    console.log('Admin password set up successfully');
});

app.post('/api/change-password', checkAuth, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['admin_password']);
    const match = await compare(oldPassword, result.rows[0].value);
    
    if (!match) return res.status(401).json({ error: "Old password incorrect" });
    
    const hashed = await hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE settings SET value = $1 WHERE key = $2', [hashed, 'admin_password']);
    res.json({ success: true });
});

app.get('/api/clients', async (req, res) => {
    const result = await pool.query('SELECT id, created_at FROM clients ORDER BY created_at DESC');
    res.json(result.rows);
});

// --- CLIENT ENDPOINTS (client specific) ---
// --- MANAGEMENT ENDPOINTS (Admin must specify WHICH client they are controlling) ---

const redisAllowanceKey = (clientId) => `allowance:${clientId}`;

const setCacheAllowance = async (clientId, data) => {
    // Store as JSON string, set a reasonable expiry (e.g., 24h) 
    // to prevent orphaned data
    await redis.set(redisAllowanceKey(clientId), JSON.stringify(data), { ex: 86400 });
};

const invalidateAllowance = async (clientId) => {
    await redis.del(redisAllowanceKey(clientId));
};

const getCachedAllowance = async (clientId) => {
    const data = await redis.get(redisAllowanceKey(clientId));
    const parsedData = (typeof data === 'string') ? JSON.parse(data) : data;

    console.log(`Cache lookup for client ${clientId}: ${parsedData}`, parsedData ? "HIT" : "MISS");
    return parsedData ? parsedData : null;
};

app.get('/api/poll', getClient, async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized API Key' });
    }

    recordHeartbeat(req.clientId);
    const currentTTL = await getClientTTL(req.clientId);

    // 1. Check Redis ONLY
    const cachedAllowance = await getCachedAllowance(req.clientId);

    // 2. If nothing is in Redis, EXIT IMMEDIATELY. 
    // No DB query for 'allowances' table.
    if (!cachedAllowance) {
        return res.json({ status: 'none', next_poll_interval: currentTTL });
    }

    // 3. If we are here, we HAVE an allowance. 
    // Now we clean up the DB and Redis.
    const [dbResult] = await Promise.all([
        pool.query('DELETE FROM allowances WHERE client_id = $1 RETURNING *', [req.clientId]),
        redis.del(redisAllowanceKey(req.clientId))
    ]);

    const allowance = dbResult.rows[0] || cachedAllowance; // Fallback to cache if DB delete was weird
    const new_status = allowance.status !== 'none' ? `${allowance.status}_fetched_by_child` : 'NONE';

    // Log to history (Keep this in DB for auditing)
    await pool.query(
        'INSERT INTO history (client_id, allowance_id, sites, duration_minutes, action) VALUES ($1, $2, $3, $4, $5)', 
        [req.clientId, allowance.id, allowance.sites, allowance.duration_minutes, new_status.toUpperCase()]
    );

    return_json = {
        status: allowance.status,
        client: req.clientId, 
    }

    if (allowance.sites)                   return_json["sites"]                    = allowance.sites;
    if (allowance.duration_minutes)        return_json["duration"]                 = allowance.duration_minutes;
    if (allowance.next_poll_interval)      return_json["next_poll_interval"]       = currentTTL;
    if (allowance.timegate_api_url)        return_json["timegate_api_url"]         = allowance.timegate_api_url;
    if (allowance.timegate_bypass_secret)  return_json["timegate_bypass_secret"]   = allowance.timegate_bypass_secret;
    if (allowance.branch_label_name)       return_json["branch_label_name"]        = allowance.branch_label_name;

    res.json(return_json);
});

app.post('/api/otarequest', getClient, checkAuth, async (req, res) => {

    console.log('Received OTA request with body:', req);
    const { branch_label_name, timegate_api_url, timegate_bypass_secret, clients } = req.body;

    if (!Array.isArray(clients) || clients.length === 0) {
        return res.status(400).json({ error: 'Invalid or empty clients list provided' });
    }

    try {
        // Fetch all authentic client IDs from database for cross-referencing
        const dbClientsRes = await pool.query('SELECT id FROM clients');
        const validClientIds = new Set(dbClientsRes.rows.map(c => c.id));

        // Filter incoming list down to only valid registered nodes
        const verifiedClients = clients.filter(clientId => validClientIds.has(clientId));

        if (verifiedClients.length === 0) {
            return res.status(404).json({ error: 'No provided clients matched valid fleet records' });
        }

        // 3. Prepare values for database insertion
        const branchLabelName = branch_label_name || "main";
        const timeGateAPIUrl = timegate_api_url || "none";
        const bypassSecret = timegate_bypass_secret || "none";

        // Batch update each verified client inside a single promise operation
        // This can create a high load on DB and might need some refactoring for larger fleets (e.g., bulk insert or queuing), 
        // but for now we assume this is manageable.
        await Promise.all(verifiedClients.map(async (clientId) => {
            const insertQuery = `
                INSERT INTO allowances (client_id, status, branch_label_name, timegate_api_url, timegate_bypass_secret) 
                VALUES ($1, 'ota', $2, $3, $4) 
                RETURNING *`;
            
            const dbInsert = await pool.query(insertQuery, [clientId, branchLabelName, timeGateAPIUrl, bypassSecret]);
            const savedAllowance = dbInsert.rows[0];

            await setCacheAllowance(clientId, savedAllowance); 
        }));

        res.json({ 
            success: true, 
            message: `OTA target allowance set for clients ${verifiedClients.join(', ')}.` 
        });

    } catch (error) {
        console.error("Error setting up server-side OTA requirements:", error);
        res.status(500).json({ error: 'Internal Server Error processing request' });
    }
});

app.post('/api/allow', getClient, checkAuth, async (req, res) => {
    const { sites, duration } = req.body;
    const targetClientId = req.clientId;
    const dbClient = await pool.connect();

    try {
        await dbClient.query('BEGIN');
        await dbClient.query('DELETE FROM allowances WHERE client_id = $1', [targetClientId]);

        const insertResult = await dbClient.query(
            'INSERT INTO allowances (client_id, sites, duration_minutes, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [targetClientId, sites, duration, 'active']
        );
        const newRow = insertResult.rows[0];

        await dbClient.query(
            'INSERT INTO history (client_id, allowance_id, sites, duration_minutes, action) VALUES ($1, $2, $3, $4, $5)',
            [targetClientId, newRow.id, sites, duration, 'CREATED']
        );

        await dbClient.query('COMMIT');

        // Update Cache after successful DB commit
        console.log("Updating cache for client", targetClientId, "with new allowance:", newRow);
        await setCacheAllowance(targetClientId, newRow);
        
        res.json(newRow);
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Error in /api/admin/allow:', error);
        res.status(500).json({ error: error.message });
    } finally {
        dbClient.release();
    }
});

app.post('/api/stop', getClient, checkAuth, async (req, res) => {
    const insertResult = await pool.query('INSERT INTO allowances (client_id, sites, duration_minutes, status) VALUES ($1, $2, $3, $4)  RETURNING *', [req.clientId, [], 0, 'stop']);
    await pool.query('INSERT INTO history (client_id, action) VALUES ($1, $2)', [req.clientId, 'STOPPED_MANUALLY']);

    const newRow = insertResult.rows[0];

    // Update Cache
    await setCacheAllowance(req.clientId, newRow);
    res.json({ success: true });
});

// server.js - Update this specific route
app.get('/api/history', async (req, res) => {
    try {
        const result = await pool.query(
            //"SELECT id, sites, duration_minutes, status FROM allowances"
            "SELECT id, client_id, sites, duration_minutes, timestamp, action FROM history WHERE timestamp > NOW() - INTERVAL '15 days' ORDER BY timestamp DESC"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current global time settings
app.get('/api/settings/time', getClient, async (req, res) => {
    try {
        const result = await pool.query('SELECT min_start_time, max_start_time FROM global_settings WHERE client_id = $1',
            [req.clientId]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({ min_start_time: '08:00', max_start_time: '21:00' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Update global time settings (Protected)
app.post('/api/settings/time', getClient, checkAuth, async (req, res) => {
    const { min_start_time, max_start_time } = req.body;
    try {
        await pool.query(
            'UPDATE global_settings SET min_start_time = $1, max_start_time = $2, updated_at = NOW() WHERE client_id = $3', 
            [min_start_time, max_start_time, req.clientId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clients/status_client', getClient, async (req, res) => {
    try {
        // req.clientId is populated by the getClient middleware
        const isOnline = await redis.exists(getRedisStatusKey(req.clientId));
        
        // Return simple boolean status
        res.json({ 
            id: req.clientId, 
            online: isOnline === 1 
        });
    } catch (err) {
        console.error("Redis Status Error:", err);
        res.status(500).json({ error: "Failed to fetch status" });
    }
});


if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.SERVER_PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Local server running on http://localhost:${PORT}`);
  });
}

app.get('/api/clients/status-all', async (req, res) => {
    try {
        // 1. Get all IDs from Neon (Fast, and doesn't happen often)
        const result = await pool.query('SELECT id, heartbeat_ttl FROM clients');
        const clients = result.rows;

        if (clients.length === 0) return res.json({});

        // 2. Open a Pipeline to Redis
        // This is 1 request to the Redis server, no matter how many clients you have
        const pipeline = redis.pipeline();
        clients.forEach(c => {
            pipeline.exists(getRedisStatusKey(c.id));
        });

        const redisResults = await pipeline.exec();
        
        // 3. Map results back to client IDs
        const fleetStatus = {};
        clients.forEach((c, index) => {
            fleetStatus[c.id] = {
                online: redisResults[index] === 1,
                configured_ttl: c.heartbeat_ttl
            };
        });

        res.json(fleetStatus);
    } catch (err) {
        console.error("Fleet status error:", err);
        res.status(500).json({ error: "Failed to fetch fleet status" });
    }
});

// Get all saved site targets
app.get('/api/targets', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM targets ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a new site target
app.post('/api/targets', checkAuth, async (req, res) => {
    const { name, address } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO targets (name, address) VALUES ($1, $2) RETURNING *',
            [name, address]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.delete('/api/targets/:id', checkAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM targets WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get the power-on schedule
app.get('/api/settings/poweronschedule', getClient, async (req, res) => {
    try {
        const query = 'SELECT value FROM settings WHERE key = $1 AND client_id = $2';
        const result = await pool.query(query, ['power_on_schedule', req.clientId]);

        if (result.rows.length > 0) {
            // Directly return the stored JSON object
            const settings = JSON.parse(result.rows[0].value);
            res.json(settings);
        } else {
            // Return a clean default structure
            res.json({
                send_photo: false,
                days: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
            });
        }

        syncGlobalQuota(); 
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings/poweronschedule', getClient, checkAuth, async (req, res) => {
    // Expecting { schedule: {...}, send_photo: boolean } in the request body
    const { schedule, send_photo } = req.body;
    
    if (!schedule) {
        return res.status(400).json({ error: "Schedule data is required" });
    }

    try {
        // Construct the unified object for the DB
        // We use the same structure the GET route expects: { send_photo, days }
        const settingsValue = {
            send_photo: send_photo ?? false, // Default to false if not provided
            days: schedule
        };

        await pool.query(
            `INSERT INTO settings (client_id, key, value) VALUES ($1, $2, $3) 
             ON CONFLICT (client_id, key) DO UPDATE SET value = EXCLUDED.value`,
            [req.clientId, 'power_on_schedule', JSON.stringify(settingsValue)]
        );

        res.json({ 
            success: true, 
            message: "Schedule and photo settings updated successfully" 
        });
    } catch (err) {
        console.error('Error saving schedule:', err);
        res.status(500).json({ error: err.message });
    }
});


export default app;
