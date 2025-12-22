#!/bin/bash
START_FIREFOX="/tmp/firefox_start.lock"
log() {
    local message=$1
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $message" >> "/var/log/ff-starter.log"
}
while true; do
    if [ -f "$START_FIREFOX" ]; then
        log "Found start semaphore: $(ls -l $START_FIREFOX)"
        export DISPLAY=:0
        log "Starting Firefox"
        firefox 
        log "Firefox stopped"
    fi
    sleep 1 # Check every second
done
