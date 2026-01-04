
# Firefox Managed Session Controller (2025)

Disclaimer: This tool is a **technical** aid. **No software can replace active parental involvement** and open communication regarding internet safety.

This project provides a robust **system-wide lockdown and timer service** for Firefox on Ubuntu/Xubuntu. It is specifically designed to create a "Safe-by-Default" environment for children by maintaining a strict whitelist of educational sites while providing controlled, timed access to the broader internet via a command-line interface.

## 🛡️ Child Safety & Protection Features

This tool implements a "Whitelist-Only" architecture, recommended by global child safety experts as the most effective technical defense for younger users in 2025.

### 1. Guarding Against "Algorithm Rabbit Holes" (YouTube)
YouTube's recommendation engine can lead children from educational content to inappropriate "Shorts" or misleading videos.
*   **The Solution:** Use the `ff start` command to limit YouTube time, preventing endless watching videos.

### 2. Preventing AI "Jailbreaking" (ChatGPT & Generative AI)
AI tools can generate restricted content if prompted creatively.
*   **The Solution:** By not whitelisting AI sites permanently, you ensure children only use them under supervision during a timed session where logs are maintained.
*   **Reference:** [OpenAI Safety Standards](openai.com) recommend parental oversight for users under 18.

### 3. Mitigating Social Media Risks (TikTok, Discord, etc.)
These platforms pose risks of cyberbullying and predatory grooming through private messaging.
*   **The Solution:** Do not allow access by default but only for limited time.

---

## 🚀 Installation & Configuration

This project allows for remote management of Firefox instances via a cloud-based application. The installer automates system services, permission handling, and XFCE power settings to ensure the lock screen cannot be bypassed.

### 📋 Prerequisites

Before running the installation script, ensure you have your environment variables ready if you plan on using the **Web Remote Control** features.

---

#### Configure Web Remote Control (Optional)

If you intend to control Firefox remotely via the cloud application, you must configure your environment variables first.

1. Navigate to the `firefox-manager/bin/` directory.
2. Create or modify the `.env` file with your specific API credentials:

```bash
# Sensitive API Info
TIMEGATE_API_URL="Your project-name.vercel.app alias" # WITHOUT A TRAILING SLASH!!!!
TIMEGATE_BYPASS_SECRET="Your TIMEGATE_BYPASS_SECRET"

```


---

#### Run the Installer

The installation script will configure system dependencies and lock down XFCE power settings.

**Execute the following commands in your terminal:**
```bash
chmod +x scripts/install.sh
./scripts/install.sh run
```

### 2. Set the Alias
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