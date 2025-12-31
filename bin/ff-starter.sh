#!/bin/bash
START_FIREFOX=/tmp/firefox_start.lock
# Log to a user-accessible location
LOG_FILE=$HOME/ff-starter.log

log() {
    cur_date=$(date +"%Y-%m-%d %H:%M:%S")
    echo "[$cur_date] $1" >> "$LOG_FILE"
}

# Wait for the graphical session to be fully ready
export DISPLAY=:0
export XAUTHORITY=$HOME/.Xauthority

while true; do
    if [ -f "$START_FIREFOX" ]; then
        log "Found start semaphore. Starting Firefox..."
        # Launch firefox and wait for it to exit before checking again
        firefox
        log "Firefox stopped."
        # Optional: remove lock file after starting to prevent loops
        # rm "$START_FIREFOX" 
    fi
    sleep 1
done
