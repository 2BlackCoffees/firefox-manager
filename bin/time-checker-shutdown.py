#!/usr/bin/env python3
"""
Enhanced Time Range Checker with Auto-Shutdown and Cron Support
Features:
- Traditional time range configuration (0: 9:00-17:00)
- Cron-style scheduling (*/5 9-17 * * 1-5)
- Automatic system shutdown when outside time ranges
- Secure Gmail notifications via OAuth2 or App Password
- Time extension hook via /tmp file
- Grace period before shutdown
- Comprehensive logging
"""

import sys
import os
import re
import smtplib
import ssl
import subprocess
import time
from datetime import datetime, timedelta
import urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
from pathlib import Path


class Logger:
    """Simple logger with timestamp."""
    
    @staticmethod
    def log(message: str = ""):
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}")

class CronParser:
    """Parse and evaluate cron expressions."""
    
    WEEKDAY_MAP = {
        'SUN': 0, 'MON': 1, 'TUE': 2, 'WED': 3,
        'THU': 4, 'FRI': 5, 'SAT': 6
    }
    
    MONTH_MAP = {
        'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
        'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
    }
    
    @staticmethod
    def parse_field(field: str, min_val: int, max_val: int, name_map: dict | None = None) -> set[int]:
        """
        Parse a cron field and return set of matching values.
        
        Supports:
        - * (all values)
        - */n (every n)
        - n (specific value)
        - n-m (range)
        - n,m,o (list)
        - Named values (MON, TUE, JAN, etc.)
        """
        if field == '*':
            return set(range(min_val, max_val + 1))
        
        # Replace named values
        if name_map:
            for name, value in name_map.items():
                field = field.replace(name, str(value))
        
        values: set[int] = set()
        
        # Split by comma
        for part in field.split(','):
            # Handle step values (*/n or m-n/s)
            if '/' in part:
                range_part, step = part.split('/')
                step = int(step)
                
                if range_part == '*':
                    start, end = min_val, max_val
                elif '-' in range_part:
                    start, end = map(int, range_part.split('-'))
                else:
                    start = end = int(range_part)
                
                values.update(range(start, end + 1, step))
            
            # Handle ranges (n-m)
            elif '-' in part:
                start, end = map(int, part.split('-'))
                values.update(range(start, end + 1))
            
            # Handle single value
            else:
                values.add(int(part))
        
        return values
    
    @staticmethod
    def matches_cron(cron_expr: str, check_time: datetime | None = None) -> bool:
        """
        Check if current time matches cron expression.
        
        Format: minute hour day month weekday
        Examples:
            */5 9-17 * * 1-5    # Every 5 minutes, 9-5pm, Mon-Fri
            0 9 * * MON         # 9am every Monday
            0 */2 * * *         # Every 2 hours
            30 8-18/2 * * 1-5   # 8:30, 10:30, 12:30, 14:30, 16:30, 18:30 on weekdays
        """
        if check_time is None:
            check_time = datetime.now()
        
        parts = cron_expr.strip().split()
        if len(parts) != 5:
            raise ValueError(f"Invalid cron expression: {cron_expr}. Expected 5 fields.")
        
        minute_field, hour_field, day_field, month_field, weekday_field = parts
        
        # Parse each field
        try:
            minutes = CronParser.parse_field(minute_field, 0, 59)
            hours = CronParser.parse_field(hour_field, 0, 23)
            days = CronParser.parse_field(day_field, 1, 31)
            months = CronParser.parse_field(month_field, 1, 12, CronParser.MONTH_MAP)
            weekdays = CronParser.parse_field(weekday_field, 0, 6, CronParser.WEEKDAY_MAP)
            
            # Python weekday: 0=Monday, Cron: 0=Sunday
            # Convert Python weekday to cron weekday
            current_weekday = (check_time.weekday() + 1) % 7
            
            # Check if current time matches all fields
            return (
                check_time.minute in minutes and
                check_time.hour in hours and
                check_time.day in days and
                check_time.month in months and
                current_weekday in weekdays
            )
        except Exception as e:
            raise ValueError(f"Error parsing cron expression '{cron_expr}': {e}")
    
    @staticmethod
    def get_active_ranges_from_cron(cron_expr: str, date: datetime | None = None) -> list[tuple[int, int]]:
        """
        Convert cron expression to time ranges for a given date.
        Returns list of (start_minutes, end_minutes) tuples.
        """
        if date is None:
            date = datetime.now()
        
        # Check every minute of the day
        active_minutes: list[int] = []
        for minute in range(24 * 60):
            check_time = date.replace(hour=minute // 60, minute=minute % 60, second=0, microsecond=0)
            if CronParser.matches_cron(cron_expr, check_time):
                active_minutes.append(minute)
        
        if not active_minutes:
            return []
        
        # Convert continuous sequences to ranges
        ranges: list[tuple[int, int]] = []
        start = active_minutes[0]
        prev = start
        
        for minute in active_minutes[1:]:
            if minute != prev + 1:
                ranges.append((start, prev))
                start = minute
            prev = minute
        
        ranges.append((start, prev))
        return ranges


class EmailConfig:
    """Email configuration with secure Gmail settings."""
    
    def __init__(self, config_file: str = "/etc/time_checker/email_config.ini"):
        """Load email configuration from secure config file."""
        self.smtp_server = "smtp.gmail.com"
        self.smtp_port = 587  # TLS port
        self.sender_email = ""
        self.sender_password = ""
        self.recipient_email = ""
        
        if os.path.exists(config_file):
            self._load_from_file(config_file)
    
    def _load_from_file(self, config_file: str):
        """Load configuration from file."""
        try:
            with open(config_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if '=' in line and not line.startswith('#'):
                        key, value = line.split('=', 1)
                        key = key.strip()
                        value = value.strip()
                        
                        if key == 'SENDER_EMAIL':
                            self.sender_email = value
                        elif key == 'SENDER_PASSWORD':
                            self.sender_password = value
                        elif key == 'RECIPIENT_EMAIL':
                            self.recipient_email = value
        except Exception as e:
            Logger.log(f"Warning: Could not load email config: {e}")
    
    def is_configured(self) -> bool:
        """Check if email is properly configured."""
        return bool(self.sender_email and self.sender_password and self.recipient_email)


class TimeExtensionHook:
    """Handle time extension hook file in /tmp."""
    
    HOOK_FILE = "/tmp/time_checker_extension"
    HOOK_FILE_LOCKED = f"{HOOK_FILE}.locked-requires-human-intervention"
    
    @staticmethod
    def get_extension_minutes() -> int:
        """Read extension time from hook file. Format: HH:MM"""
        if os.path.exists(TimeExtensionHook.HOOK_FILE_LOCKED):
            Logger.log(f"{TimeExtensionHook.HOOK_FILE_LOCKED} found: Ignoring extension, please delete this file to reactivate this feature.")
            return 0
        if not os.path.exists(TimeExtensionHook.HOOK_FILE):
            return 0
        
        try:
            with open(TimeExtensionHook.HOOK_FILE, 'r') as f:
                content = f.read().strip()
            
            match = re.match(r'^(\d{1,2}):(\d{1,2})$', content)
            if match:
                hours = int(match.group(1))
                minutes = int(match.group(2))
                total_minutes = hours * 60 + minutes
                
                if total_minutes > 0:
                    Logger.log(f"Time extension found: {hours}h {minutes}m")
                    return total_minutes
        except Exception as e:
            Logger.log(f"Warning: Could not read extension file: {e}")
        
        return 0
    
    @staticmethod
    def clear_extension():
        """Clear the extension hook file."""
        try:
            if os.path.exists(TimeExtensionHook.HOOK_FILE):
                os.remove(TimeExtensionHook.HOOK_FILE)
                if os.path.exists(TimeExtensionHook.HOOK_FILE):
                    Path(TimeExtensionHook.HOOK_FILE_TOUCHED).touch()
                    Logger.log(f"Extension hook could not be cleared created {TimeExtensionHook.HOOK_FILE_LOCKED}, this will require human intervention to remove it.")
                else:
                    Logger.log("Extension hook cleared")
        except Exception as e:
            Logger.log(f"Warning: Could not delete extension file: {e}")


class SecureEmailNotifier:
    """Send secure email notifications with Location and Photo data."""
    
    def __init__(self, config: EmailConfig):
        self.mail_config = config

    def _get_coords(self):
        """Fetch approximate GPS coordinates via IP."""
        try:
            return urllib.request.urlopen("https://ipinfo.io/loc").read().decode().strip()
        except:
            return "Unknown (Location Offline)"

    def _capture_photo(self, path="/tmp/capture.jpg"):
        """Capture webcam photo using fswebcam."""
        try:
            # -v 0 silences output, -D 1 allows camera to warm up for exposure
            subprocess.run(["fswebcam", "-r", "1280x720", "-v", "0", "-D", "1", path], check=True)
            return path
        except Exception as e:
            print(f"Camera error: {e}")
            return None

    def send_notification(self, status_message: str, next_info: str, grace_period: int) -> bool:
        subject = f"⚠️ Access VIOLATION! - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        coords = self._get_coords()
        photo_path = self._capture_photo()
        
        # Base text body
        body_text = f"""System Auto-Shutdown Alert: Access Violation detected.

Location: https://www.google.com/maps?q={coords}
Hostname: {os.uname().nodename}
User: {os.getenv('USER', 'unknown')}

The system will shutdown in {grace_period} seconds.
"""

        if not self.mail_config.is_configured():
            return False
        
        try:
            message = MIMEMultipart("related") # "related" is better for embedded images
            message["Subject"] = subject
            message["From"] = self.mail_config.sender_email
            message["To"] = self.mail_config.recipient_email
            
            # Create HTML with embedded image reference
            html_body = f"""
            <html>
                <body style="font-family: sans-serif;">
                    <h2 style="color: #d9534f;">{subject}</h2>
                    <p><b>Location:</b> <a href="https://www.google.com/maps?q={coords}">{coords}</a></p>
                    <p><b>Status:</b> {status_message}</p>
                    <div style="background: #f8f9fa; padding: 10px; border-left: 4px solid #d9534f;">
                        <code>{next_info}</code>
                    </div>
                    <p><b>Incident Photo:</b></p>
                    <img src="cid:incident_photo" style="max-width: 500px; border: 2px solid #000;">
                    <hr>
                    <p style="color: #666; font-size: 12px;">Shutdown in {grace_period}s | Host: {os.uname().nodename}</p>
                </body>
            </html>
            """
            
            # Attach parts
            msg_alternative = MIMEMultipart("alternative")
            message.attach(msg_alternative)
            msg_alternative.attach(MIMEText(body_text, "plain"))
            msg_alternative.attach(MIMEText(html_body, "html"))

            # Attach the Image with CID
            if photo_path and os.path.exists(photo_path):
                with open(photo_path, "rb") as f:
                    img = MIMEImage(f.read())
                    img.add_header("Content-ID", "<incident_photo>")
                    message.attach(img)

            # SMTP Sending
            context = ssl.create_default_context()
            with smtplib.SMTP(self.mail_config.smtp_server, self.mail_config.smtp_port) as server:
                server.starttls(context=context)
                server.login(self.mail_config.sender_email, self.mail_config.sender_password)
                server.send_message(message)
            
            # Cleanup
            if photo_path and os.path.exists(photo_path):
                os.remove(photo_path)

            return True
            
        except Exception as e:
            print(f"Failed to send email: {e}")
            return False


class TimeRangeChecker:
    """Time range checker with cron support and shutdown capability."""
    
    DAY_NAMES = [
        "Sunday", "Monday", "Tuesday", "Wednesday", 
        "Thursday", "Friday", "Saturday"
    ]
    
    def __init__(self, config_file: str, request_file_sync: str):
        """Initialize with configuration file path."""
        self.config_file: str = config_file
        self.request_file_sync: str = request_file_sync
        self.time_config: dict[str, list[tuple[int, int]]] = {}
        self.cron_rules: list[str] = []
        self.__initialize_and_wait_bash_script()
        self._parse_config()

    def __initialize_and_wait_bash_script(self) -> None:
        # Clear old data so we CAN'T read stale settings
        if os.path.exists(self.config_file):
            os.remove(self.config_file)
            Logger.log(f"Deleted old config file: {self.config_file}")
        
        # Signal to Bash that we are ready for a refresh
        try:
            with open(self.request_file_sync, 'w') as f:
                f.write("sync_request")
            Logger.log(f"Created request file for sync with bash script service: {self.request_file_sync}")
        except PermissionError:
            Logger.log(f"Error: Python lacks permission to write to /run: {self.request_file_sync}")
            sys.exit(1)

        Logger.log("Waiting for Bash to provide fresh config...")
        
        # Block until the hand shake file is created by Bash
        while not os.path.exists(self.config_file):
            time.sleep(1)
        
        # Clean up the request flag
        os.remove(self.request_file_sync)
        Logger.log(f"Fresh config received, removed {self.request_file_sync}. Proceeding.")

    @staticmethod
    def time_to_minutes(time_str: str) -> int:
        """Convert time HH:MM to minutes since midnight."""
        hours, minutes = map(int, time_str.split(':'))
        return hours * 60 + minutes
    
    @staticmethod
    def expand_day_range(day_spec: str) -> list[int]:
        """Expand day specification to list of day numbers."""
        if '-' in day_spec:
            start, end = map(int, day_spec.split('-'))
            return list(range(start, end + 1))
        else:
            return [int(day_spec)]
    
    def _parse_config(self):
        """Parse configuration file supporting both formats."""
        try:
            with open(self.config_file, 'r') as f:
                for line_num, line in enumerate(f, 1):
                    line: str = line.split('#')[0].strip()
                    
                    if not line or line.startswith('#'):
                        continue
                    
                    # Try to detect format
                    # Cron format: 5 fields separated by spaces (might have @directives)
                    # Traditional format: day_spec: time_ranges
                    
                    # Check for cron format (@reboot, @hourly, etc. or 5 fields)
                    if line.startswith('@') or (len(line.split()) >= 5 and ':' not in line.split()[0]):
                        try:
                            # Handle special cron strings
                            if line.startswith('@'):
                                cron_expr = self._convert_special_cron(line)
                            else:
                                # Standard cron: take first 5 fields
                                parts = line.split(None, 5)
                                cron_expr = ' '.join(parts[:5])
                            
                            self.cron_rules.append(cron_expr)
                            Logger.log(f"Loaded cron rule: {cron_expr}")
                        except Exception as e:
                            Logger.log(f"Warning: Could not parse cron line {line_num}: {e}")
                    
                    # Traditional format
                    elif ':' in line:
                        match = re.match(r'^(?P<days>[0-6 ,\-]+)\s*:\s*(?P<times>.+)$', line)
                        if match:
                            days_part: str | sys.Any = match.group("days").replace(' ', '')
                            times_part: str | sys.Any = match.group("times")
                            
                            day_specs: list[str] = days_part.split(',')
                            days: list[str] = []
                            for day_spec in day_specs:
                                days.extend(self.expand_day_range(day_spec))
                            
                            time_ranges: list[tuple[int, int]] = []
                            for time_range in times_part.split(','):
                                time_range = time_range.strip()
                                time_match = re.match(r'^(?P<start_hour>\d{1,2}:\d{1,2})-(?P<end_hour>\d{1,2}:\d{1,2})$', time_range)
                                if time_match:
                                    start_time: str | sys.Any = time_match.group('start_hour')
                                    end_time: str | sys.Any = time_match.group('end_hour')
                                    start_minutes: int = self.time_to_minutes(start_time)
                                    end_minutes: int = self.time_to_minutes(end_time)
                                    time_ranges.append((start_minutes, end_minutes))
                                    Logger.log(f"Found time range Standard: Start {start_time}, start_minutes={start_minutes} to {end_time}, end_minutes={end_minutes}")
                            
                            for day in days:
                                if day not in self.time_config:
                                    self.time_config[day] = []
                                self.time_config[day].extend(time_ranges)
                                Logger.log(f"Day {day}: {time_ranges}")
        
        except FileNotFoundError:
            Logger.log(f"Error: Configuration file '{self.config_file}' not found")
            sys.exit(1)
        except Exception as e:
            Logger.log(f"Error parsing configuration file: {e}")
            sys.exit(1)
    
    def _convert_special_cron(self, special: str) -> str:
        """Convert special cron strings to standard format."""
        special = special.strip().upper()
        
        conversions = {
            '@YEARLY': '0 0 1 1 *',
            '@ANNUALLY': '0 0 1 1 *',
            '@MONTHLY': '0 0 1 * *',
            '@WEEKLY': '0 0 * * 0',
            '@DAILY': '0 0 * * *',
            '@MIDNIGHT': '0 0 * * *',
            '@HOURLY': '0 * * * *',
        }
        
        return conversions.get(special, special)
    
    def check_current_time(self, extension_minutes: int = 0) -> tuple[int, str]:
        """
        Check if current time is within any configured range or matches cron rules.
        
        Returns:
            Tuple of (exit_code, status_message)
            0 if in range, 1 if not in range, 2 if no config for today
        """
        now: datetime = datetime.now()
        current_day: int = (now.weekday() + 1) % 7
        current_time_str: str = now.strftime("%H:%M")
        current_minutes: int = now.hour * 60 + now.minute
        
        effective_minutes: int = current_minutes
        effective_time: datetime = now 
        
        status: str = f"Current day: {current_day} ({self.DAY_NAMES[current_day]})\n"
        status += f"Current time: {current_time_str} ({current_minutes} minutes since midnight)\n"
        
        if extension_minutes > 0:
            status += f"Extension applied: +{extension_minutes} minutes\n"
            status += f"Effective time: {effective_time.strftime('%H:%M')} ({effective_minutes} minutes)\n"
        
        in_range: bool = False
        
        # Check traditional time ranges
        if current_day in self.time_config:
            status += f"\nTraditional time ranges configured:\n"
            for start_min, end_min in self.time_config[current_day]:
                end_min += extension_minutes
                start_time = f"{start_min // 60}:{start_min % 60:02d}"
                end_time = f"{end_min // 60}:{end_min % 60:02d}"
                Logger.log(f"{current_day}: From {start_min} (={start_time}) to {end_min} (={end_time})")
                status += f"  Range: {start_time}-{end_time}"
                
                if start_min <= effective_minutes <= end_min:
                    status += " ✓ ACTIVE"
                    in_range = True
                status += "\n"
        
        # Check cron rules
        if self.cron_rules:
            status += f"\nCron rules configured:\n"
            for cron_rule in self.cron_rules:
                status += f"  Rule: {cron_rule}"
                try:
                    if CronParser.matches_cron(cron_rule, effective_time):
                        status += " ✓ ACTIVE"
                        in_range = True
                except Exception as e:
                    status += f" ✗ ERROR: {e}"
                status += "\n"
        
        # Determine result
        if not self.time_config and not self.cron_rules:
            status += f"\nNo configuration found for today (day {current_day})"
            return 2, status
        
        if in_range:
            status += f"\n✓ Within active time (traditional or cron matched)"
            return 0, status
        else:
            status += f"\n✗ Outside all configured time ranges"
            return 1, status
    
    def get_time_until_next_window(self) -> tuple[str, int] | None:
        """Calculate time until next active window."""
        now: datetime = datetime.now()
        current_day: int = (now.weekday() + 1) % 7
        current_minutes: int = now.hour * 60 + now.minute
        
        # Check remaining traditional windows today
        if current_day in self.time_config:
            for start_min, _ in self.time_config[current_day]:
                if current_minutes < start_min:
                    minutes_until: int = start_min - current_minutes
                    time_str: str = f"{start_min // 60}:{start_min % 60:02d}"
                    return time_str, minutes_until
        
        # Check cron rules for next match (check next 48 hours)
        for minutes_ahead in range(1, 48 * 60):
            check_time = now + timedelta(minutes=minutes_ahead)
            for cron_rule in self.cron_rules:
                try:
                    if CronParser.matches_cron(cron_rule, check_time):
                        return check_time.strftime("%H:%M"), minutes_ahead
                except:
                    pass
        
        # Check next days for traditional config
        for days_ahead in range(1, 8):
            check_day: int = (current_day + days_ahead) % 7
            if check_day in self.time_config:
                first_range: tuple[int, int] = self.time_config[check_day][0]
                start_min: int = first_range[0]
                minutes_until: int = (days_ahead * 24 * 60) - current_minutes + start_min
                day_name: str = self.DAY_NAMES[check_day]
                time_str: str = f"{start_min // 60}:{start_min % 60:02d}"
                return f"{day_name} {time_str}", minutes_until
        
        return None


def shutdown_system(grace_seconds: int = 60):
    """Shutdown the system after a grace period."""
    Logger.log(f"\n{'=' * 60}")
    Logger.log(f"⚠️  SYSTEM SHUTDOWN SCHEDULED")
    Logger.log(f"{'=' * 60}")
    Logger.log(f"Grace period: {grace_seconds} seconds")
    Logger.log(f"Shutdown time: {(datetime.now() + timedelta(seconds=grace_seconds)).strftime('%H:%M:%S')}")
    Logger.log(f"{'=' * 60}\n")
    
    try:
        subprocess.run([ "shutdown", "-P", f"+{grace_seconds // 60}" ], check=True)
        Logger.log("✓ Shutdown scheduled successfully")

        subprocess.run(["systemctl", "stop", "time-checker.service"], check=True)
        Logger.log("✓ Service stopped successfully")
        
    except subprocess.CalledProcessError as e:
        Logger.log(f"✗ Failed to schedule shutdown or stop service: {e}")
        Logger.log("Note: This script requires root privileges to shutdown the system")
        sys.exit(1)


def main():
    """Main entry point."""
    import argparse
    default_sleep: int = 120
    grace_period: int = 60
    
    parser = argparse.ArgumentParser(
        description='Time Range Checker with Auto-Shutdown and Cron Support',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Configuration Formats:

1. Traditional (day-based):
   0: 13:05-14:30,15:30-16:40    # Sunday
   1-5: 8:00-18:00                # Monday-Friday

2. Cron (minute hour day month weekday):
   */5 9-17 * * 1-5               # Every 5 min, 9am-5pm, Mon-Fri
   0 9 * * MON                    # 9am every Monday
   30 8-18/2 * * 1-5              # 8:30,10:30,12:30,14:30,16:30,18:30 weekdays
   @hourly                        # Every hour

3. Mixed (both formats in same file):
   0,6: 10:00-14:00               # Weekends traditional
   */15 9-17 * * 1-5              # Weekdays cron

Examples:
  sudo python3 time_checker_cron.py config.txt
  sudo python3 time_checker_cron.py config.txt --dry-run
  python3 time_checker_cron.py --create-extension-example
        """
    )
    
    parser.add_argument('config_file', nargs='?', default='/etc/time_checker/config-time-shutdown.conf',
                        help='Configuration file (default: /etc/time_checker/config-time-shutdown.conf)')    
    parser.add_argument('--request_file_sync', nargs='?', default='/run/time_checker_sync.request',
                        help='Synchronization file (default: /run/time_checker_sync.request)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Test mode - do not actually shutdown')
    parser.add_argument('--grace-period', type=int, default=60,
                        help='Grace period in seconds before shutdown (default: 60)')
    parser.add_argument('--email-config', default='/etc/time_checker/config-mail.ini',
                        help='Email configuration file')
    
    args = parser.parse_args()

    Logger.log("=" * 60)
    Logger.log("TIME RANGE CHECKER: SERVICE MODE START")
    Logger.log("=" * 60)

    email_config: EmailConfig = EmailConfig(args.email_config)
    notifier: SecureEmailNotifier = SecureEmailNotifier(email_config)
    mail_required: bool = email_config.is_configured()

    try:
        while True:
            checker: TimeRangeChecker = TimeRangeChecker(args.config_file, args.request_file_sync)
            Logger.log("Checking time range...")
            extension_minutes: int = TimeExtensionHook.get_extension_minutes()
            if extension_minutes > 0:
                TimeExtensionHook.clear_extension()
                time.sleep(60 * extension_minutes)
                # Ensure we have a chance to pause again
                continue
            exit_code, status_message = checker.check_current_time()
            
            if exit_code == 0:
                Logger.log("✓ System is within active hours")
                mail_required = False  # No need to send email if we're in the right time range
            
            elif exit_code == 1:
                Logger.log("✗ System is outside active hours")
                next_window = checker.get_time_until_next_window()
                next_info = f"Next window: {next_window[0]}" if next_window else "No upcoming windows"
                
                if mail_required:
                    notifier.send_notification(status_message, next_info, grace_period)
                
                if args.dry_run:
                    Logger.log("🧪 DRY RUN - Shutdown skipped")
                else:
                    shutdown_system(args.grace_period)
                    break # Exit loop so service stops after scheduling shutdown

            # Wait for before checking again
            if args.dry_run:
                time.sleep(10)
            else:
                time.sleep(default_sleep)


    except KeyboardInterrupt:
        Logger.log("Service stopped by user")
        sys.exit(0)



if __name__ == "__main__":
    main()
