

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

3. Start psql '<your connection string>' (Single quotes are important) and create the schemas as stored in `firefox-manager/timegate/data/schema.sql`

4. Go to [Upstash](https://upstash.com/) and create a free Redis database.
Remember the REST URL and REST TOKEN. 
---
## 🛠 Optional but strongly recommended Local Startup

Go to directory `firefox-manager/timegate`

6. Create a file named `firefox-manager/timegate/.env` as follows:

```env
UPSTASH_REDIS_REST_URL=<https://xxxxx.upstash.io>
UPSTASH_REDIS_REST_TOKEN=<your token xxxxxxxxx>
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
npx vercel@latest login
```


2. **Link & Configure Secrets:**
In the project root, run:
```bash
npx vercel@latest link  # Accept defaults
npx vercel@latest env add DATABASE_URL production
# Mark it sensitive and When prompted for the value, paste your Neon Connection String
npx vercel@latest env add TIMEGATE_API_SECRET production
# Mark it sensitive and When prompted for the value, paste your API restricted access string, ensure to provide a high entropy string
npx vercel@latest env add UPSTASH_REDIS_REST_URL production
# Mark it sensitive and When prompted for the value, paste your Upstash URL
npx vercel@latest env add UPSTASH_REDIS_REST_TOKEN production
# Mark it sensitive and When prompted for the value, paste your Upstash token
```
If you need to modify the variable, you will first have to remove it:
```bash
npx vercel@latest env remove DATABASE_URL production
```

3. **Deploy:**
```bash
npx vercel@latest deploy --prod --force 
```

Once deployment is over, `Vercel` will provide the alias to the dns addres address of the endpoint. 
Copy this alias that will be needed as explained in the main `README.md` file.
4. **Security (Bypass Secret):**
To secure your deployments, you wi.

In the main README.md file, this value will be require to properly bind the backend with the local linux computer.

5. **Password forgotten:**
Currently there is no way to reset your password with a built in functionality. The only way is to connect to the DB and then type the following:
```sql
DELETE FROM settings WHERE key = 'admin_password';
```

After this reload your pages (On a browser or on your phone). A new password will be requested.

## Unregister a device

Currently a device can only be unregistered deleting its entry in the DB. However becareful that this will not deactivate the latest configuration on the device and the device will not automatically re-register.
To ensure that the device re-registers, the line `REGISTERED_ID=xxxx` must be removed from the file `/var/lib/ff-limiter/state.cfg`.

# Create a launch icon on your mobile
## iPhone (iOS Safari)
* Open Safari and navigate to your web app's URL.
* Tap the three vertical dots (⋮) in the bottom right corner.
* Tap the Share button (the square with an arrow pointing up) at the bottom center.
* Scroll down and tap "Add to Home Screen."
* Give it a name (e.g., "TimeGate") and tap Add.
* The icon will now appear on your home screen.

## Android (Chrome)
* Open Chrome and navigate to your web app's URL.
* Tap the three vertical dots (⋮) in the top right corner.
* Tap "Install app" or "Add to Home screen."
* Confirm by tapping Add.

# Anti theft 
The application provides an anti theft feature ensuring that upon starting a computer the geo corrdinate of the computer and a photo of the user are immidiately sent to the registerd mail address to help police office when reseraching for lost or stolen devices.

# Advanced topics
The solution uses a Fair Share algorithm ensure that the application stays free no matter what the number of connected devices.

The algorithm is based on the following:

1.  **Quota Cap:** We limit total activity to 10,000 Redis requests per day to keep the service free.
2.  **UI Slice:** The dashboard uses a fixed budget by polling for all devices in a single batch every 60 seconds.
3.  **Active Minutes:** Upon new registration, the server parses all `power_on_schedule` JSONs to calculate total fleet uptime.
4.  **The Formula:** ensures for the safest and always free poll rate $$TTL = \frac{\text{Average Daily Active Seconds (Fleet)}}{\text{Available Device Quota (9,500 requests)}}$$ 
5.  **Auto-Throttling:** If you add more devices or longer hours, the TTL increases to slow down consumption.
6.  **Database Sync:** Postgres stores the calculated TTL as the master record for every registered client.
7.  **Redis Config:** A "Hot Cache" in Redis stores the TTL so servers can check it instantly without SQL hits.
8.  **Heartbeat Logic:** Devices set a Redis "Presence" key with an expiration exactly equal to the calculated TTL.
9.  **Real-Time Status:** If a device misses its poll window, Redis auto-deletes the key, turning the LED red.
10. **Global Integrity:** Using a shared Redis "brain" ensures all server instances see the same status and quota.

To stay 100% free while using **Upstash Redis** (10k request limit) and **Neon Postgres** (190 compute hour limit), the architecture follows these rules:

1.  **Dual-Constraint Strategy:** We balance Redis's "Per-Request" cap against Neon's "Active-Time" cap to ensure neither exceeds free tier boundaries.
2.  **Redis as the "Shield":** High-frequency device polls (every few seconds) hit Redis only, preventing Neon from "waking up" and consuming its limited compute hours.
3.  **Neon as the "Archive":** Postgres is reserved for infrequent, critical operations like registrations, schedule changes, and persistent history logging.
4.  **Auto-Sleep Optimization:** By using Redis to handle the "chatter," we allow Neon to auto-suspend (scale to zero), preserving its 190-hour monthly budget.
7.  **Write-Through Caching:** Configuration changes (like a new schedule) are written to Neon once and cached in Redis for fast, cost-free retrieval.

# Next steps
1. Implement an OTA of the deivce part based on github
2. Implement some monitoring / Alerting
3. Refatcor to hexagonal pattern
