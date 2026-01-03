const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SALT_ROUNDS = 10;

app.use(cors());
app.use(express.json());

// Auth Middleware
const checkAuth = async (req, res, next) => {
    const password = req.headers['authorization'];
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['admin_password']);
    if (result.rows.length === 0) return res.status(403).json({ error: 'Not initialized' });
    
    const match = await bcrypt.compare(password || '', result.rows[0].value);
    if (match) next();
    else res.status(401).json({ error: 'Unauthorized' });
};

app.get('/api/auth-status', async (req, res) => {
    const result = await pool.query('SELECT 1 FROM settings WHERE key = $1', ['admin_password']);
    res.json({ initialized: result.rows.length > 0 });
});

app.post('/api/setup-password', async (req, res) => {
    const { password } = req.body;
    const check = await pool.query('SELECT 1 FROM settings WHERE key = $1', ['admin_password']);
    if (check.rows.length > 0) return res.status(403).send("Already set");
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['admin_password', hashed]);
    res.json({ success: true });
});

app.post('/api/change-password', checkAuth, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['admin_password']);
    const match = await bcrypt.compare(oldPassword, result.rows[0].value);
    
    if (!match) return res.status(401).json({ error: "Old password incorrect" });
    
    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE settings SET value = $1 WHERE key = $2', [hashed, 'admin_password']);
    res.json({ success: true });
});

app.post('/api/allow', checkAuth, async (req, res) => {
    const { sites, duration } = req.body;
    const client = await pool.connect(); // Get a client for the transaction

    try {
        await client.query('BEGIN');

        // 1. Delete all existing rows in allowances 
        // (Ensuring only one row can ever exist)
        await client.query('DELETE FROM allowances');

        // 2. Insert the new row
        const insertResult = await client.query(
            'INSERT INTO allowances (sites, duration_minutes, status) VALUES ($1, $2, $3) RETURNING *',
            [sites, duration, 'active']
        );

        const newRow = insertResult.rows[0];

        // 3. Log the action in history
        await client.query(
            'INSERT INTO history (allowance_id, sites, duration_minutes, action) VALUES ($1, $2, $3, $4)',
            [newRow.id, sites, duration, 'CREATED']
        );

        await client.query('COMMIT');
        res.json(newRow);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in /api/allow:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

app.post('/api/stop', async (req, res) => {
    await pool.query('INSERT INTO allowances (sites, duration_minutes, status) VALUES ($1, $2, $3)', [[], 0, 'stop']);
    await pool.query('INSERT INTO history (action) VALUES ($1)', ['STOPPED_MANUALLY']);
    res.json({ success: true });
});

// server.js - Update this specific route
app.get('/api/history', async (req, res) => {
    try {
        const result = await pool.query(
            //"SELECT id, sites, duration_minutes, status FROM allowances"
            "SELECT id, sites, duration_minutes, timestamp, action FROM history WHERE timestamp > NOW() - INTERVAL '15 days' ORDER BY timestamp DESC"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/poll', async (req, res) => {
    const allowance = await pool.query('SELECT * FROM allowances ORDER BY created_at ASC LIMIT 1');
    
    const result = await pool.query('DELETE FROM allowances WHERE id = (SELECT id FROM allowances ORDER BY created_at ASC LIMIT 1) RETURNING *');
    if (result.rows.length > 0) {
        const status = result.rows[0].status;
        new_status = 'none'
        if (status != 'none') {
            new_status = status + '_fetched_by_child';
        }
        await pool.query('INSERT INTO history (allowance_id, sites, duration_minutes, action) VALUES ($1, $2, $3, $4)', [result.rows[0].id, result.rows[0].sites, result.rows[0].duration_minutes, new_status.toUpperCase()]);
        return res.json({ status: status, sites: result.rows[0].sites, duration: result.rows[0].duration_minutes});
    }
    res.json({ status: 'none' });
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.SERVER_PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Local server running on http://localhost:${PORT}`);
  });
}

// Crucial: Export the app for Vercel's serverless handler
module.exports = app;