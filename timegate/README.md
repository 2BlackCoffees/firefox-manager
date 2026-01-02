Here is the comprehensive **README.md** file. It contains the exact installation steps, environment configuration, and deployment commands required to get the **TimeGate Ninja Stealth** system running from a blank folder.

---

# 📜 TimeGate Ninja Stealth: Installation Guide

Follow these steps to deploy the dashboard, the backend server, and the database connection.

### 1. Prerequisites

Ensure you have the following installed:

* **Node.js** (v16 or higher)
* **npm** (comes with Node.js)
* A **Neon.tech** account (for the free serverless PostgreSQL database)

---

### 2. Project Setup

Open your terminal and run:

```bash
# Create and enter folder
mkdir timegate-stealth && cd timegate-stealth

# Initialize project
npm init -y

# Install Backend Dependencies
npm install express pg cors dotenv bcrypt

# Install Frontend Build Tool (Dev Dependency)
npm install --save-dev parcel

```

---

### 3. Database Configuration

1. Log in to [Neon.tech](https://neon.tech).
2. Create a new project named **TimeGate**.
3. Go to the **SQL Editor** tab and paste/run the schema provided in the master prompt.
4. Go to **Dashboard** and copy your **Connection String**.

Create a file named `.env` in your root folder:

```env
DATABASE_URL=postgres://user:password@endpoint.neon.tech/neondb?sslmode=require
PORT=3000

```

---

### 4. File Structure

Ensure your files are placed as follows:

* `/timegate-stealth`
* `.env`
* `server.js` (The Node/Express code)
* `index.html` (The Ninja UI)
* `style.css` (The Glassmorphism styles)
* `app.js` (The Frontend logic)
* `ninja-bg.jpg` (Place your background image here)



---

### 5. Running the Application

You will need two terminal windows open:

**Terminal 1: Start the Backend Server**

```bash
node server.js

```

**Terminal 2: Start the Frontend (Parcel)**

```bash
npx parcel index.html

```

The system will now be available at **`http://localhost:1234`**.

---

### 6. Deployment Workflow

To move from local development to a live server:

1. **Frontend:** Run `npx parcel build index.html`. This creates a `/dist` folder with optimized files.
2. **Backend:** Host the `server.js` on a platform like Render, Railway, or Heroku.
3. **URL Update:** Ensure the `API_URL` in your `app.js` is changed from `localhost:3000` to your live backend URL.

---

### 7. Troubleshooting

* **Module not found:** If you see `Error: Cannot find module 'bcrypt'`, run `npm install bcrypt`.
* **CORS Error:** Ensure the `server.js` has `app.use(cors())` enabled.
* **Database Connection:** If the server fails to start, verify that your IP address is allowed in the Neon.tech "IP Allowlist" settings (usually set to `0.0.0.0/0` for testing).

**Would you like me to generate the optimized `package.json` file so you can use simple commands like `npm start` and `npm run dev`?**