import express, { json } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import { compare, hash } from 'bcrypt';
import logger from 'logger';
require('dotenv').config();

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SALT_ROUNDS = 10;

app.use(cors());
app.use(json());

// --- MIDDLEWARE ---

// Global Admin Auth (One password for all)
const checkAuth = async (req, res, next) => {
    const password = req.headers['authorization'];
    const result = await pool.query('SELECT value FROM settings WHERE key = $1 AND client_id IS NULL', ['admin_password']);
    if (result.rows.length === 0) return res.status(403).json({ error: 'Not initialized' });

    logger.info({ 
        message: `Verification password attempt: ${password} vs ${result.rows[0].value}`, 
        path: req.url,
        method: req.method 
    });
    
    const match = await compare(password || '', result.rows[0].value);
    if (match) next();
    else res.status(401).json({ error: 'Unauthorized' });
};

app.get('/api/auth-status', async (req, res) => {
    const result = await pool.query('SELECT 1 FROM settings WHERE key = $1', ['admin_password']);
    res.json({ initialized: result.rows.length > 0 });
});


// client context (For client requests)
const getClient = (req, res, next) => {
    const clientId = req.headers['x-client-id'];
    if (!clientId) return res.status(400).json({ error: 'Missing x-client-id' });
    req.clientId = clientId;
    next();
};

// --- REGISTRATION LOGIC ---

app.post('/api/register', async (req, res) => {
    const { suggested_client_id, unique_key } = req.body; // unique_key = MAC address
    if (!suggested_client_id || !unique_key) return res.status(400).json({ error: "Missing suggested ID or Unique Key" });

    try {
        // 1. Check if this specific device is already registered
        const existingDevice = await pool.query('SELECT id FROM clients WHERE unique_key = $1', [unique_key]);
        if (existingDevice.rows.length > 0) {
            return res.status(300).json({ id: existingDevice.rows[0].id, message: "Already registered" });
        }

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

        // 3. Register the new client
        await pool.query('INSERT INTO clients (id, unique_key) VALUES ($1, $2)', [finalId, unique_key]);
        
        // 4. Initialize default settings for this new client if needed
        await pool.query(
            'INSERT INTO global_settings (client_id) VALUES ($1) ON CONFLICT DO NOTHING', 
            [finalId]
        );

        res.status(200).json({ id: finalId, message: "Newly registered" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Registration failed" });
    }
});

// --- ADMIN ENDPOINTS (Global) ---

app.post('/api/setup-password', async (req, res) => {
    const { password } = req.body;
    const check = await pool.query('SELECT 1 FROM settings WHERE key = $1', ['admin_password']);
    if (check.rows.length > 0) return res.status(300).send("Already set");
    const hashed = await hash(password, SALT_ROUNDS);
    logger.info({ 
        message: `Setup password attempt: ${password} vs ${hashed}`, 
        path: req.url,
        method: req.method 
    });
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['admin_password', hashed]);
    res.json({ success: true });
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

app.get('/api/clients', checkAuth, async (req, res) => {
    const result = await pool.query('SELECT id, created_at FROM clients ORDER BY created_at DESC');
    res.json(result.rows);
});

// --- CLIENT ENDPOINTS (client specific) ---
// --- MANAGEMENT ENDPOINTS (Admin must specify WHICH client they are controlling) ---

app.post('/api/allow', getClient, checkAuth, async (req, res) => {
    const { sites, duration } = req.body;
    const targetClientId = req.clientId
    const client = await pool.connect(); // Get a client for the transaction

    try {
        await client.query('BEGIN');

        // 1. Delete all existing rows in allowances 
        // (Ensuring only one row can ever exist)
        await client.query('DELETE FROM allowances where client_id = $1', [targetClientId]);

                // 2. Insert the new row WITH the client_id
        const insertResult = await client.query(
            'INSERT INTO allowances (client_id, sites, duration_minutes, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [targetClientId, sites, duration, 'active']
        );

        const newRow = insertResult.rows[0];

        // 3. Log in history WITH the client_id
        await client.query(
            'INSERT INTO history (client_id, allowance_id, sites, duration_minutes, action) VALUES ($1, $2, $3, $4, $5)',
            [targetClientId, newRow.id, sites, duration, 'CREATED']
        );

        await client.query('COMMIT');
        res.json(newRow);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in /api/admin/allow:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

app.post('/api/stop', getClient, checkAuth, async (req, res) => {
    await pool.query('INSERT INTO allowances (client_id, sites, duration_minutes, status) VALUES ($1, $2, $3, $4)', [req.clientId, [], 0, 'stop']);
    await pool.query('INSERT INTO history (client_id, action) VALUES ($1)', [req.clientId, 'STOPPED_MANUALLY']);
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




app.get('/api/poll', getClient, checkAuth, async (req, res) => {
    const result = await pool.query('DELETE FROM allowances WHERE id = (SELECT id FROM allowances WHERE client_id = $1 ORDER BY created_at ASC LIMIT 1) RETURNING *',
                                    [req.clientId]
    );
    if (result.rows.length > 0) {
        const status = result.rows[0].status;
        new_status = 'none'
        if (status != 'none') {
            new_status = status + '_fetched_by_child';
        }
        await pool.query('INSERT INTO history (client_id, allowance_id, sites, duration_minutes, action) VALUES ($1, $2, $3, $4, $5)', [req.clientId, result.rows[0].id, result.rows[0].sites, result.rows[0].duration_minutes, new_status.toUpperCase()]);
        return res.json({ status: status, client: req.clientId, sites: result.rows[0].sites, duration: result.rows[0].duration_minutes});
    }
    res.json({ status: 'none' });

});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.SERVER_PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Local server running on http://localhost:${PORT}`);
  });
}



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
        const result = await pool.query('SELECT value FROM settings WHERE key = $1 AND client_id = $2', ['power_on_schedule', req.clientId]);
        if (result.rows.length > 0) {
            // Parse the JSON string back into an object
            res.json({ schedule: JSON.parse(result.rows[0].value) });
        } else {
            // Return default empty structure if not set
            res.json({ schedule: {0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []} });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update the power-on schedule (Protected)
app.post('/api/settings/poweronschedule', getClient, checkAuth, async (req, res) => {
    const { schedule } = req.body;
    
    if (!schedule) {
        return res.status(400).json({ error: "Schedule data is required" });
    }

    try {

        await pool.query(
                `INSERT INTO settings (client_id, key, value) 
                VALUES ($1, $2, $3) 
                ON CONFLICT (client_id, key) 
                DO UPDATE SET value = EXCLUDED.value`,
                [req.clientId, 'power_on_schedule', JSON.stringify(schedule)]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving schedule:', err);
        res.status(500).json({ error: err.message });
    }
});


export default app;
