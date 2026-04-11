DROP TABLE IF EXISTS global_settings CASCADE;
DROP TABLE IF EXISTS targets CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS history CASCADE;
DROP TABLE IF EXISTS allowances CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

-- 2. Create the root client table
CREATE TABLE clients (
    id VARCHAR(50) PRIMARY KEY, -- e.g., 'samsung', 'samsung_1'
    unique_key VARCHAR(255) UNIQUE NOT NULL, -- The MAC address or unique hardware ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create Allowances (with client_id)
CREATE TABLE allowances (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id),
    sites TEXT[] NOT NULL,
    duration_minutes INT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_allowances_client ON allowances(client_id);

-- 4. Create History (with client_id)
CREATE TABLE history (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id),
    allowance_id INT,
    sites TEXT[],
    duration_minutes INT,
    action VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_history_client ON history(client_id);

-- 5. Create Settings (with composite unique constraint)
CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(50) REFERENCES clients(id),
    key VARCHAR(50) NOT NULL,
    value TEXT,
    -- This ensures one 'admin_password' globally OR one 'schedule' per client
    CONSTRAINT unique_settings_identity UNIQUE NULLS NOT DISTINCT (client_id, key)
);

-- 6. Create Targets (with client_id)
CREATE TABLE targets (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Create Global Settings (one row per client)
CREATE TABLE global_settings (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL UNIQUE REFERENCES clients(id),
    min_start_time TIME NOT NULL DEFAULT '07:00:00',
    max_start_time TIME NOT NULL DEFAULT '21:30:00',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Seed Initial Data
INSERT INTO clients (id, unique_key) VALUES ('samsung', '00:1A:2B:3C:4D:5E');
INSERT INTO clients (id, unique_key) VALUES ('acer', '00:1A:2B:3C:4D:5F');

INSERT INTO targets (name, address) VALUES 
('Youtube', 'youtube.com'),
('ChatGPT', 'chatgpt.com'),
('WhatsApp', 'web.whatsapp.com');


INSERT INTO global_settings (client_id, min_start_time, max_start_time) 
VALUES ('samsung', '09:00:00', '18:30:00');
INSERT INTO global_settings (client_id, min_start_time, max_start_time) 
VALUES ('acer', '07:03:00', '23:34:00');

