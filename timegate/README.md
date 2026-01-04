

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
1. Log in to [Neon.tech](https://neon.tech) and create a new project.
2. From the **Dashboard**, click on connect and copy your **Connection String** with the password.

5. Start psql with the connection string and create the schemas as stored in `firefox-manager/timegate/data/schema.sql`


---
## 🛠 Optional but strongly recommended Local Startup

Go to directory `firefox-manager/timegate`

6. Create a file named `firefox-manager/timegate/.env` as follows:

```env
DATABASE_URL=<your connection string>>
SERVER_PORT=3000
```

### Running the App Locally

You will need two terminal windows:

| Task | Terminal Command |
| --- | --- |
| **Backend Server** | `node src/server/server.js` |
| **Frontend (Parcel)** | `npx parcel public/index.html` |

Once started, access the app at: **[http://localhost:1234](http://localhost:1234)**

Test the app and ensure you can create a new entry that is reflected in the history tab.

### Clean Start 

If you encounter build issues, reset your environment and try again:

```bash
rm -rf node_modules package-lock.json .parcel-cache dist
npm install

```

## 🏗 Setup & Configuration for deployment


Before building, update the project metadata:

1. Open `package.json`.
2. Change the value timegate in the `"name": "timegate"` field to something with a high enthropy.

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
vercel env add DATABASE_URL production
# Mark it sensitive and When prompted for the value, paste your Neon Connection String

```
If you need to modify the variable, you will first have to remove it:
```bash
vercel env remove DATABASE_URL production
```

3. **Deploy:**
```bash
npx vercel@latest deploy --prod --force 
```

Once deployment is over, `Vercel` will provide the alias to the dns addres address of the endpoint. 
Copy this alias that will be needed as explained in the main `README.md` file.
4. **Security (Bypass Secret):**
To secure your deployments, navigate to your Vercel Project Settings > **Deployment Protection**. Ensure Vercel Authentication is enabled and create your `TIMEGATE_BYPASS_SECRET`.

In the main README.md file, this value will be require to properly bind the backend with the local linux computer.
