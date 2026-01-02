# **Master Project Prompt: TimeGate Ninja Stealth**

### **1. Project Vision**

Develop a screen-time management system ("TimeGate") using a "Ninja Stealth" aesthetic. A parent uses a web dashboard to grant time-limited web access to a child's computer. The child's computer polls a central API to receive instructions.

### **2. Tech Stack**

* **Database:** Neon (Serverless PostgreSQL).
* **Backend:** Node.js + Express.
* **Frontend:** HTML5, CSS3 (Flexbox/Grid), and Vanilla JavaScript (Bundled with Parcel).
* **Security:** `bcrypt` for password hashing; custom secure modal for masked password entry.

### **3. Database Schema (SQL)**

```sql
CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE,
    value TEXT -- Stores Bcrypt hashed password
);

CREATE TABLE allowances (
    id SERIAL PRIMARY KEY,
    sites TEXT[] NOT NULL,
    duration_minutes INT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE history (
    id SERIAL PRIMARY KEY,
    sites TEXT[],
    duration_minutes INT,
    action VARCHAR(50), -- 'CREATED', 'FETCHED', 'STOPPED'
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

```

### **4. Security & Authentication Logic**

* **Initial Setup:** On first launch, if no password exists in the DB, force a password setup via the secure modal.
* **Public Visibility:** The Mission Logs and Current Presets are publicly visible (Read-Only).
* **Protected Actions:** A secure password modal must trigger for:
1. **Grant Passage** (Writing a new allowance).
2. **Emergency Stop** (Clearing all allowances).
3. **Password Update** (Rotating the secret key).


* **Masked Entry:** No password entry can be readable. Use a dedicated popup/modal with an `<input type="password">` and a horizontal **[Confirm] [Cancel]** button row below it.
* **Password Rotation:** To update the password, the user must provide the **Old Password** (verified against the DB) before being allowed to save a new one.

### **5. UI/UX Requirements (Ninja Stealth Style)**

* **Aesthetic:** Dark mode, calm but high-tech. Use a background image of a cyber-ninja in a dark, calm city. Use glassmorphism (`backdrop-filter: blur`) and neon cyan (`#00f2ff`) for primary accents and neon red (`#ff003c`) for emergency actions.
* **Layout (Vertical Stack):**
1. **Block 1 (Mission Targets):** Combines preset checkboxes (YouTube, ChatGPT, Discord) and a manual URL input. The URL input and "Pin to Scroll" button must each occupy the full horizontal width.
2. **Block 2 (Time Allotment):** A large duration input and the "Grant Passage" button. The number input and the "MINUTES" label must use the **Orbitron** font. The "Grant Passage" button must be **Cyan**, full-width, and match the style of the stop button.
3. **Block 3 (System Administration):** Positioned before the logs. Contains the **Emergency Stop** (Red) and **Password Update** (Ghost/Grey) buttons, both full-width.
4. **Block 4 (Mission Logs):** A scrollable history list of the last 15 days.



### **6. Functional Requirements**

* **Pinning:** Custom URLs entered in the manual spec can be "Pinned," which saves them to `localStorage` and renders them as persistent buttons on the dashboard.
* **Emergency Stop:** Immediately deletes all entries in the `allowances` table and logs a "STOPPED" event in history.
* **Polling API:** A `GET /api/poll` endpoint that:
1. Finds the oldest pending allowance.
2. Moves it to the history table.
3. Deletes it from the allowances table.
4. Returns the site list and duration to the child's agent.

