#!/bin/bash
BELL_SEMAPHORE=/tmp/firefox_bell.lock
LOG_FILE=/var/log/ff-bell.log
SOUND_FILE=/usr/share/sounds/freedesktop/stereo/message.oga


log() {
    cur_date=$(date +"%Y-%m-%d %H:%M:%S")
    echo "[$cur_date] $1" >> "$LOG_FILE"
}

log Started
while true; do
    if [ -f "$BELL_SEMAPHORE" ]; then
        for i in {1..4}; do
            # Only play if Firefox is still running
            if pgrep -f firefox > /dev/null; then
                paplay "$SOUND_FILE" 2>/dev/null || echo -e "\a" # Fallback to terminal beep
            fi
            sleep 10
        done
        # 4. Final Minute Alerts (every 20 seconds)
        for i in {1..4}; do
            # Only play if Firefox is still running
            if pgrep -f firefox > /dev/null; then
                paplay "$SOUND_FILE" 2>/dev/null || echo -e "\a" # Fallback to terminal beep
            fi
            sleep 10
        done
    fi
    sleep 1
done
