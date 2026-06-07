
# Firefox Managed Session Controller (2025)

Disclaimer: This tool is a **technical** aid. **No software can replace active parental involvement** and open communication regarding internet safety.

This project provides a robust **system-wide lockdown and timer service** for Firefox on Ubuntu/Xubuntu. It is specifically designed to create a "Safe-by-Default" environment for children by maintaining a strict whitelist of educational sites while providing controlled, timed access to the broader internet via a command-line interface.

## 🛡️ Child Safety & Protection Features

Modern technology is a double-edged sword: while access to AI and the open web is essential for digital literacy in 2026, it introduces significant risks to younger users. This tool implements a **"Whitelist-Only" architecture**, recognized by safety experts as the gold standard for protecting children from unvetted content.

### The Challenge

While mobile devices often have robust parental controls, desktop environments (especially Linux) can be harder to secure. Research from 2024 and 2025 highlights growing concerns regarding generative AI and child safety:

However at the same time these technologies revealed to be extremely dangerous for the safety of children:
* https://learning.nspcc.org.uk/research-resources/2025/generative-ai-childrens-safety
* https://www.unicef.org/innocenti/stories/beyond-algorithms-three-signals-changing-ai-child-interaction
* https://www.tandfonline.com/doi/full/10.1080/19452829.2025.2518313
* https://www.eurekalert.org/news-releases/1091598
* https://www.theguardian.com/media/2024/feb/01/parents-tech-ceos-us-senate-hearing
* ...

### Core Protection Layers

This tool bridges the gap between digital freedom and safety through three primary pillars:

| Feature | Description |
| --- | --- |
| **Strict Whitelisting** | Only approved domains are accessible; all other traffic is blocked at the system level. |
| **Time Allotments** | Define "Earliest" and "Latest" usage windows to prevent late-night browsing and screen addiction. |
| **Parental Audit Logs** | Comprehensive logging of all sessions and site requests for transparent review. |

### 💻 System Compatibility

To ensure deep integration with system permissions and networking, this tool is designed for:

* **OS:** Linux (Debian-based preferred)
* **Desktop Environment:** Optimized for **XUbuntu** (XFCE) for maximum operability.

### Other features

#### Anti theft 
The application provides an anti theft feature ensuring that upon starting a computer the geo corrdinate of the computer and potentially a photo of the user are immidiately sent to the registered mail address to help police when reseraching for lost or stolen devices.
Please note that per default no photo is taken and the feature has to be explicitly enabled by the user taking all responsibility for data privacy issues and legal compliance. 

#### Fair Share Algorithm

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

#### OTA (Over the Air updates)
The application allows OTA update following GitOps best practices (Based on a specified git branch or git tag) together with configuration where the server controlling a device can be remotely updated. 
In addition to increasing felxibility, this allows the creation of a "rolling release" based on different git branches (dev, test, stable) that are pushed to the devices based on the group/type configuration in the cloud dashboard.


---

## 🚀 Installation & Configuration

This project allows for remote management of Firefox instances via a cloud-based application. The installer automates system services, permission handling, and XFCE power settings to ensure the lock screen cannot be bypassed.

### 📋 Prerequisites

Before running the installation script, ensure you have your environment variables ready if you plan on using the **Web Remote Control** features.

---

#### Initial applications
Install:
`sudo apt install firefox -y`
`sudo apt-get install git-all -y`
`git clone https://github.com/2BlackCoffees/firefox-manager.git`

#### Configure Web Remote Control (Optional)

If you intend to control Firefox remotely via the cloud application, you must configure your environment variables first.

Create or modify the `firefox-manager/bin/.env` file with your specific API credentials:

```bash
# Sensitive API Info
TIMEGATE_API_URL="Your project-name.vercel.app alias" # WITHOUT A TRAILING SLASH!!!!
TIMEGATE_API_SECRET="Your personnally defined TIMEGATE_API_SECRET with high enthropy"

```


---
#### Gmail Account with App Password enabled

* Go to: https://myaccount.google.com/apppasswords
* Generate a new App Password for "Mail"
* Save this password for configuration

Use the generated password to update the file `misc/config-mail.ini`: Can be created automatically when installing the application.


#### Run the Installer

The installation script will configure system dependencies and lock down XFCE power settings.

**Execute the following commands in your terminal:**
Before running the script, note that if you want to open the port 22 to be able to access your machine remotely, you need to explicitely set the environment variable `OPEN_SSH` as follows:
`export OPEN_SSH=1`.

```bash
sudo ./scripts/install.sh run <user_name>
```

### Set the Alias
Add the alias.sh to your shell configuration to enable the command-line interface:
Append the function from alias.sh to your ~/.bashrc
```bash
cp scripts/alias.sh $HOME/.alias.sh
echo "source $HOME/.alias.sh" >> $HOME/.bashrc
source ~/.bashrc
```

# 🎮 Usage
The controller is managed via the `ff` command:
## Session Control
Default (30m + YouTube): `ff start`
Custom Session: `ff start 20 youtube.com khanacademy.org` Only these sites (plus the permanent whitelist) work for 20 minutes.
Immediate Lockdown: `ff stop` Kills all browser windows and locks the web immediately.

## Whitelisting
Permanent Unlock (**Use this with care, only manual deletion in the file can undo!**): `ff unlock-perm bbc.co.uk`
Adds a site to the "Always Allowed" list (no timer required, page and sub pages will be accessible for ever).

## Check Status: ff status
Shows the remaining time for the current active session.

## View History: ff logs
Displays the last 60+ sessions with start times and durations.

# 📚 References & Resources (2025)
* NSPCC: Keeping Children Safe Online
* Internet Matters: Parental Controls Guide
* Google Safety Center: Family Safety Tools
* Common Sense Media: App & Site Reviews

# ⚙️ Troubleshooting
The central limiter generates logs in `/var/log/ff-limiter.log`
```bash
tail -f /var/log/ff-limiter.log
```
Check starter in  `$HOME/ff-starter.log`
```bash
tail -f $HOME/ff-starter.log
```
**When using the Web Interface**, check:
```bash
tail -f /var/log/ff-poller-gate.log
```
And
```bash
sudo journalctl -u ff-poller-gate -f
```
And
```bash
firefox-manager/bin/ff-poller-gate-local.sh
```
And
```bash
sudo systemctl status time-checker.service
sudo journalctl -u time_checker.service --since "1 hour ago"
```
## Additional troubleshooting
```bash
    systemctl list-units --all "ff-*"
    sudo systemctl status ff-killer.service
    sudo systemctl status ff-poller-gate.service
    systemctl --user status ff-starter.service
    systemctl --user status ff-bell.service
```


# Next steps

## 1. Implement "Active Time" Tracking
The current system unlocks the browser for a flat duration (e.g., 30 minutes). To provide more flexibility, the script should track the actual time Firefox is actively open, allowing the child to close the browser, do homework, and reopen it later using their remaining allocated time.
* **Mechanism**: Use a dedicated log file or database to track elapsed seconds. The timer script would pause its countdown when Firefox closes and resume when it reopens. A central daemon (`ff-killer`) could manage this persistent countdown across sessions.
* **User Impact**: A user can run `ff start` and have a total of 60 minutes of browser time spread across the day, stopping and starting as needed.
  
## 2. Segregate Accessibility Based on Danger Level
Not all sites are equally dangerous. A simple allow/deny list is limiting. The system should allow us to categorize sites and provide different time allocations for different categories.
* **Mechanism**: Create a configuration file (e.g., `ff-categories.conf`) with sections like [Videos], [SocialMedia], and [Entertainment].
* **User Impact**: A user could have 2 hours of Educational time per day, but only 30 minutes of Entertainment time. The `ff start` command would accept the category name: `ff start educational` would use time from the educational pool. This would require monitoring not only time when Firefox is open but as well open tabs containing restricted content.
* 
# 3. Implement Live In-Browser Notifications
The current system uses a system sound on the final minute. A more user-friendly approach in 2026 is to use desktop notifications or even inject a notification bar directly into the top of Firefox itself.
* **Mechanism**: Use notify-send for basic desktop alerts (e.g., "5 minutes remaining!"). For advanced in-browser notifications, a dedicated, custom Firefox extension could be force-installed via the policies, providing a visual countdown timer directly in the toolbar.
  
# 4. Add Remote Reporting and Logging
While we can SSH in and check logs, it's cumbersome. The system should offer an automated way to notify us of usage.
* **Mechanism**: Integrate a simple email or instant messaging notification using a command-line tool like sendmail or curl. When the `ff stop` session function is triggered, it emails the parent: "Firefox closed after 19:45 minutes of a 30-minute session."
  
# 5. Add a "Panic Button" Feature
While the `ff stop` command serves partially the purpose, the system should allow immediate lockdown for all users with a single command or physical trigger.
* **Mechanism**: Create a dedicated alias `ff panic` that stops all `ff-limit@*` instances and switches the policy to lockdown mode instantly, overriding any remaining time allocation. This provides immediate control during unforeseen circumstances.



Disclaimer: This tool is a technical aid. No software can replace active parental involvement and open communication regarding internet safety.