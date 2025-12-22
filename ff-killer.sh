#!/bin/bash
STOP_FIREFOX="/tmp/stop_firefox.lock"
log() {
    local message=$1
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $message" >> "/var/log/ff-killer.log"
}
kill_firefox() {
    log "Killing firefox"
    log $(pkill -9 -f firefox)
    log "Processes $(ps -edf | grep firefox)"
}
while true; do
    if [ -f "$STOP_FIREFOX" ]; then
        rm -f $STOP_FIREFOX
        # If lock doesn't exist, kill any Firefox process immediately
        kill_firefox

    fi
    sleep 1 # Check every second
done