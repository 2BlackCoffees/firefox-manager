

# 📜 TimeGate Ninja Stealth: Installation Guide

TimeGate Ninja Stealth suite, covering frontend, backend, and serverless database integration is described here in detail.

## 🛠 Prerequisites

Before starting, ensure you have the following installed and configured:

* **Node.js**: v16 or higher
* **Package Manager**: npm (bundled with Node)
* **Database**: A [Neon.tech](https://neon.tech) account for serverless PostgreSQL.
* **CLI Tools**: `psql` client (for manual DB management).

```bash
# Install psql client (Ubuntu/Debian)
sudo apt update && sudo apt install postgresql-client

```

---

## 🏗 Setup & Configuration

### 1. Database Setup (Neon.tech)

1. Log in to [Neon.tech](https://neon.tech) and create a new project.
2. From the **Dashboard**, click on connect and copy your **Connection String** with your password.


### 2. Project Customization

Before building, update the project metadata:

1. Open `package.json`.
2. Change the value timegate in the `"name": "timegate"` field to something hard to guess.

---

## 🚀 Deployment (Vercel)

Deploy your application to the cloud using the Vercel CLI.

1. **Install Vercel CLI & Login:**
```bash
npm i -g vercel
vercel login

```


2. **Link & Configure Secrets:**
In the project root, run:
```bash
vercel link  # Accept defaults
vercel env add DATABASE_URL
# When prompted for the value, paste your Neon Connection String

```


3. **Deploy:**
```bash
npx vercel@latest deploy --prod --force

```
4. **Security (Bypass Secret):**
To secure your deployments, navigate to your Vercel Project Settings > **Deployment Protection**. Ensure Vercel Authentication is enabled and create your `TIMEGATE_BYPASS_SECRET`.

5. **Next steps:**


---

## 🛠 Local Development & Debugging

If you need to run the application locally for testing, follow these steps:

### Clean Start (Optional)

If you encounter build issues, reset your environment:

```bash
rm -rf node_modules package-lock.json .parcel-cache dist
npm install

```
Create a `.env` file in firefox-manager/timegate/src/server directory and add your credentials:

```env
DATABASE_URL=Your connection string
PORT=3000

```
### Running the App

You will need two terminal windows:

| Task | Terminal Command |
| --- | --- |
| **Backend Server** | `node src/server/server.js` |
| **Frontend (Parcel)** | `npx parcel public/index.html` |

Once started, access the app at: **[http://localhost:1234](http://localhost:1234)**










# 📜 TimeGate Ninja Stealth: Installation Guide

Follow these steps to deploy the frontend, the backend server, and the database connection.

### 1. Prerequisites

Ensure you have the following installed:

* **Node.js** (v16 or higher)
* **npm** (comes with Node.js)
* A **Neon.tech** account (for the free serverless PostgreSQL database)

---


### 3. Database Configuration

## Prerequisites
1. Install psql client
sudo apt update
sudo apt install postgresql-client-common
sudo apt install postgresql-client

2. Log in to [Neon.tech](https://neon.tech).
3. Create a new project.
4. Go to **Dashboard** and copy your **Connection String**.
5. start psql with the connection string

6. Create a file named `.env` in  folder with your connection string:

```env
DATABASE_URL=postgres://user:password@<endpoint.neon.tech>/neondb?sslmode=require
PORT=3000

```

# Build 
1. Rename the name of the project in [package.json](package.json):
Replace:
  "name": "timegate",
With:
  "name": "<my-project-name>",

2. In case of rebuild
rm -rf node_modules package-lock.json .parcel-cache dist
3. Build
npm install
npm run build

4. Create an account on [Vercel](https://vercel.com/pricing)
5. Deploy to vercel
In timegate directory:
vercel login
`vercel link` (Accept all default)
`vercel env add DATABASE_URL`
To the question 
`What's the value of DATABASE_URL?`
write your db connection string
`npx vercel@latest deploy --prod --force`

After successful deployment, vercel will provide your endpoint: use the aliased endpoint. 

6. You will need a TIMEGATE_BYPASS_SECRET that can be created as follows:
* Go to your Vercel Project Settings > Deployment Protection (https://vercel.com/<your-vercel-project-name>-projects/timegate/settings/deployment-protection).
* Check if "Vercel Authentication" is enabled for Preview deployments.
*

---







---

### 5. Running the Application locally for debug

You will need two terminal windows open:
In timegate directory
**Terminal 1: Start the Backend Server**

```bash
node src/server/server.js

```

**Terminal 2: Start the Frontend (Parcel)**

```bash
npx parcel public/index.html

```

Open your browser with **`http://localhost:1234`**.

