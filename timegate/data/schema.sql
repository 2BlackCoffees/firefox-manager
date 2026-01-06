-- Table for pending allowances waiting to be picked up
CREATE TABLE IF NOT EXISTS allowances (
    id SERIAL PRIMARY KEY,
    sites TEXT[] NOT NULL, -- Array of strings e.g., ['youtube', 'chatgpt']
    duration_minutes INT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, ACTIVE, STOPPED
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for historical data
CREATE TABLE IF NOT EXISTS history (
    id SERIAL PRIMARY KEY,
    allowance_id INT,
    sites TEXT[],
    duration_minutes INT,
    action VARCHAR(50), -- 'CREATED', 'FETCHED_BY_CHILD', 'STOPPED_MANUALLY'
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE,
    value TEXT -- This will store the hashed password
);

CREATE TABLE targets (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Seed with your original targets
INSERT INTO targets (name, address) VALUES 
('Youtube', 'youtube.com'),
('ChatGPT', 'chatgpt.com'),
('WhatsApp', 'web.whatsapp.com');