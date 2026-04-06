-- 1. Drop existing tables in correct order to handle foreign keys
DROP TABLE IF EXISTS global_settings;
DROP TABLE IF EXISTS targets;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS history;
DROP TABLE IF EXISTS allowances;
DROP TABLE IF EXISTS clients;


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
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id),
    key VARCHAR(50) NOT NULL,
    value TEXT,
    CONSTRAINT unique_client_key UNIQUE (client_id, key)
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
INSERT INTO clients (id) VALUES ('samsung');
INSERT INTO clients (id) VALUES ('acer');

INSERT INTO targets (name, address) VALUES 
('Youtube', 'youtube.com'),
('ChatGPT', 'chatgpt.com'),
('WhatsApp', 'web.whatsapp.com');


INSERT INTO global_settings (client_id, min_start_time, max_start_time) 
VALUES ('samsung', '07:00:00', '21:30:00');
INSERT INTO global_settings (client_id, min_start_time, max_start_time) 
VALUES ('acer', '07:00:00', '21:30:00');



-- CREATE TABLE IF NOT EXISTS clients (
--     id VARCHAR(50) PRIMARY KEY, -- This will be the 'unique name' (e.g., 'kpit-diakonie-1')
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );


-- -- Table for pending allowances waiting to be picked up
-- CREATE TABLE IF NOT EXISTS allowances (
--     id SERIAL PRIMARY KEY,
--     sites TEXT[] NOT NULL, -- Array of strings e.g., ['youtube', 'chatgpt']
--     duration_minutes INT NOT NULL,
--     status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, ACTIVE, STOPPED
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- -- Table for historical data
-- CREATE TABLE IF NOT EXISTS history (
--     id SERIAL PRIMARY KEY,
--     allowance_id INT,
--     sites TEXT[],
--     duration_minutes INT,
--     action VARCHAR(50), -- 'CREATED', 'FETCHED_BY_CHILD', 'STOPPED_MANUALLY'
--     timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );


-- CREATE TABLE IF NOT EXISTS settings (
--     id SERIAL PRIMARY KEY,
--     key VARCHAR(50) UNIQUE,
--     value TEXT -- This will store the hashed password
-- );

-- CREATE TABLE targets (
--     id SERIAL PRIMARY KEY,
--     name TEXT NOT NULL,
--     address TEXT NOT NULL,
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- -- Optional: Seed with your original targets
-- INSERT INTO targets (name, address) VALUES 
-- ('Youtube', 'youtube.com'),
-- ('ChatGPT', 'chatgpt.com'),
-- ('WhatsApp', 'web.whatsapp.com');

-- CREATE TABLE IF NOT EXISTS global_settings (
--     id SERIAL PRIMARY KEY,
--     min_start_time TIME NOT NULL DEFAULT '07:00:00',
--     max_start_time TIME NOT NULL DEFAULT '21:30:00',
--     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- -- Seed the initial row
-- INSERT INTO global_settings (id, min_start_time, max_start_time, updated_at) 
-- VALUES (1, '07:00:00', '21:30:00', CURRENT_TIMESTAMP)
-- ON CONFLICT (id) DO NOTHING;

-- -- Updates to support multi tenancy
-- -- Add client_id to allowances
-- ALTER TABLE allowances ADD COLUMN client_id VARCHAR(50) REFERENCES clients(id);
-- CREATE INDEX idx_allowances_client ON allowances(client_id);

-- -- Add client_id to history
-- ALTER TABLE history ADD COLUMN client_id VARCHAR(50) REFERENCES clients(id);
-- CREATE INDEX idx_history_client ON history(client_id);

-- -- Add client_id to settings
-- -- Note: We remove the UNIQUE constraint on 'key' because multiple clients 
-- -- will now have an 'admin_password' key.
-- ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
-- ALTER TABLE settings ADD COLUMN client_id VARCHAR(50) REFERENCES clients(id);
-- ALTER TABLE settings ADD CONSTRAINT unique_client_key UNIQUE (client_id, key);

-- -- Add client_id to targets
-- ALTER TABLE targets ADD COLUMN client_id VARCHAR(50) REFERENCES clients(id);
-- CREATE INDEX idx_targets_client ON targets(client_id);

-- -- Add client_id to global_settings
-- -- Since each client needs their own time windows
-- ALTER TABLE global_settings ADD COLUMN client_id VARCHAR(50) REFERENCES clients(id);
-- ALTER TABLE global_settings ADD CONSTRAINT unique_client_global UNIQUE (client_id);

-- -- DB migration (To be run only one time!)
-- -- Create the initial client
-- INSERT INTO clients (id) VALUES ('2blackcoffees');

-- -- Update all existing rows to belong to this client
-- UPDATE allowances SET client_id = '2blackcoffees';
-- UPDATE history SET client_id = '2blackcoffees';
-- UPDATE settings SET client_id = '2blackcoffees';
-- UPDATE targets SET client_id = '2blackcoffees';
-- UPDATE global_settings SET client_id = '2blackcoffees';

-- -- Now make the columns NOT NULL to ensure data integrity
-- ALTER TABLE allowances ALTER COLUMN client_id SET NOT NULL;
-- ALTER TABLE history ALTER COLUMN client_id SET NOT NULL;
-- ALTER TABLE settings ALTER COLUMN client_id SET NOT NULL;
-- ALTER TABLE targets ALTER COLUMN client_id SET NOT NULL;
-- ALTER TABLE global_settings ALTER COLUMN client_id SET NOT NULL;