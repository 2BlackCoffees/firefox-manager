#!/bin/bash
log() {
    local message=$1
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $message" >> "/var/log/ff-poller-gate.log"
}
# Load Environment Variables from .env
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Set a default poll interval if not defined in .env (in seconds)
POLL_INTERVAL=30
CONFIG_DIR="/var/lib/ff-limiter"
CONFIG_FILE="$CONFIG_DIR/state.cfg"
mkdir -p "$CONFIG_DIR"

# Defaults
MIN_START_TIME="16:00:00"
MAX_START_TIME="21:30:00"
SETTINGS_SYNC_INTERVAL=300 # Sync global hours every 5 minutes
LAST_SETTINGS_SYNC=0
# WARNING Following variables are used in the time-checker-shutdown.py script. Do not change their content without updating the Python script accordingly.
TIME_CHECKER_PATH=/etc/time_checker
POWER_ON_SCHEDULE=$TIME_CHECKER_PATH/config-time-shutdown.conf
REQUEST_FILE_SYNC=/run/time_checker_sync.request

save_config() {
    cat <<EOF > "$CONFIG_FILE"
MIN_START_TIME="$MIN_START_TIME"
MAX_START_TIME="$MAX_START_TIME"
REGISTERED_ID="$REGISTERED_ID"
EOF
}
# 1. Load persisted values or set defaults
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

# Function to convert HH:MM:SS to seconds since midnight for easy comparison
to_seconds() {
    date -d "$1" +%s
}

call_api() {
    local endpoint=$1
    log "curl -s -H \"Authorization: Bearer $TIMEGATE_API_SECRET\" -H \"x-client-id: $REGISTERED_ID\" \"${TIMEGATE_API_URL}$endpoint\""
    curl -s -H "Authorization: Bearer $TIMEGATE_API_SECRET" \
            -H "x-client-id: $REGISTERED_ID" \
            "${TIMEGATE_API_URL}$endpoint"
}

register_device() {
    if [[ -n "$REGISTERED_ID" ]]; then
        log "Device already registered as: $REGISTERED_ID"
        return 0
    fi

    log "No registration found. Starting handshake..."
    
    # Generate unique key based on MAC address
    local MAC_ADDR=$(cat /sys/class/net/$(ip route show default | awk '/default/ {print $5}')/address)
    
    # Prompt for name if running interactively, otherwise use hostname
    local DEVICE_NAME=$(hostname)

    log "Registering $DEVICE_NAME ($MAC_ADDR) with backend..."
    log "curl -s -X POST -H \"Content-Type: application/json\" -H \"Authorization: Bearer $TIMEGATE_API_SECRET\" -d \"{\"id\": \"$DEVICE_NAME\", \"unique_key\": \"$MAC_ADDR\"}\" \"$TIMEGATE_API_URL/api/register\""
    RESPONSE=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TIMEGATE_API_SECRET" \
        -d "{\"id\": \"$DEVICE_NAME\", \"unique_key\": \"$MAC_ADDR\"}" \
        "$TIMEGATE_API_URL/api/register")

    if [[ $? -eq 0 ]]; then
        REGISTERED_ID="$DEVICE_NAME"
        save_config
        log "Registration successful. ID stored: $REGISTERED_ID"
    else
        log "Registration failed. Will retry next loop."
        return 1
    fi
}

wait_for_request() {
    log "Waiting for Python service to request sync with $REQUEST_FILE_SYNC..."
    # Loop until the file exists
    while [ ! -f "$REQUEST_FILE_SYNC" ]; do
        sleep 1
    done
    log "Request received. Starting sync..."
}

sync_power_on_schedule() {
    log "Syncing Power-On Schedule..."
    # Fetch from the new endpoint
    RESPONSE=$(call_api "/api/settings/poweronschedule")    
    if [ $? -eq 0 ] && [ "$RESPONSE" != "" ]; then
        # 1. to_entries turns {"1": [...]} into [{"key": "1", "value": [...]}]
        # 2. select filters out days with empty arrays
        # 3. join(",") creates "08:00-10:00,17:00-18:00" (no extra spaces)
        log "Raw schedule response: $RESPONSE"
        FORMATTED_CONFIG=$(echo "$RESPONSE" | jq -r '
            .schedule | to_entries | 
            map(select(.value | length > 0)) | 
            map("\(.key): \(.value | join(","))") | 
            .[]
        ')

        if [[ -n "$FORMATTED_CONFIG" ]]; then
            # Ensure the directory exists
            mkdir -p $TIME_CHECKER_PATH
            # Write to the file the Python script reads
            echo "$FORMATTED_CONFIG" > $POWER_ON_SCHEDULE.tmp
            mv $POWER_ON_SCHEDULE.tmp $POWER_ON_SCHEDULE
            log "Power-On Schedule updated in $POWER_ON_SCHEDULE:\n$FORMATTED_CONFIG"
        else
            log "Schedule is empty. No changes made to config-time-shutdown.conf"
        fi
    else
        log "Failed to fetch Power-On Schedule."
    fi
}

sync_global_settings() {
    log "Syncing curfews for $REGISTERED_ID..."
    RESPONSE=$(call_api "/api/settings/time")
    
    if [ $? -eq 0 ] && [ "$RESPONSE" != "" ]; then

        # Parse the response (Assumes jq is installed for JSON parsing)
        NEW_MIN=$(echo "$RESPONSE" | jq -r '.min_start_time // empty')
        NEW_MAX=$(echo "$RESPONSE" | jq -r '.max_start_time // empty')

        # Update and Persist if new values are provided
        UPDATE_NEEDED=false
        if [[ -n "$NEW_MIN" ]]; then MIN_START_TIME=$NEW_MIN; UPDATE_NEEDED=true; fi
        if [[ -n "$NEW_MAX" ]]; then MAX_START_TIME=$NEW_MAX; UPDATE_NEEDED=true; fi

        if [ "$UPDATE_NEEDED" = true ]; then
            echo "MIN_START_TIME=\"$MIN_START_TIME\"" > "$CONFIG_FILE.tmp"
            echo "MAX_START_TIME=\"$MAX_START_TIME\"" >> "$CONFIG_FILE.tmp"
            mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
            log "Config updated: Min=$MIN_START_TIME, Max=$MAX_START_TIME"
        fi

        log "Global Hours Updated: $MIN_START_TIME to $MAX_START_TIME"
    else
        log "Failed to sync global settings. Using cached: $MIN_START_TIME"
    fi
}
log "Initial start: Time to sync global settings..."
register_device || exit 1
sync_global_settings
wait_for_request
sync_power_on_schedule

log "Starting Timegate Poller (Interval: ${POLL_INTERVAL}s)..."

while true; do
    CURRENT_TIME=$(date +%T)
    NOW=$(date +%s)

    # --- Step 1: Periodically Sync Global Settings ---
    if (( NOW - LAST_SETTINGS_SYNC > SETTINGS_SYNC_INTERVAL )); then
        log "Time to sync global settings..."
        sync_global_settings
        sync_power_on_schedule
        LAST_SETTINGS_SYNC=$NOW
    else
        log "Skipping global settings sync. Next sync in $((SETTINGS_SYNC_INTERVAL - (NOW - LAST_SETTINGS_SYNC))) seconds."
    fi

    # --- Step 2: Time Window Enforcement ---
    CURRENT_TIME_STR=$(date +%T)
    MIN_SEC=$(to_seconds "$MIN_START_TIME")
    MAX_SEC=$(to_seconds "$MAX_START_TIME")


    # --- Case 1: Before Minimum Time ---
    if [[ "$NOW" -lt "$MIN_SEC" ]]; then
        log "Too early ($CURRENT_TIME). Waiting until $MIN_START_TIME..."
        POLL_INTERVAL=60

    # --- Case 2: After Maximum Time ---
    elif [[ "$NOW" -gt "$MAX_SEC" ]]; then
        log "Past limit ($CURRENT_TIME). Stopping services..."
        systemctl stop "ff-limiter@*"
        POLL_INTERVAL=60
    else 

        # --- Case 3: Within Allowed Window ---
        # Fetch status from Vercel
        RESPONSE=$(call_api "/api/poll")
        # Check if curl failed
        if [ $? -ne 0 ]; then
            log "Network error. Received: $RESPONSE Retrying in ${POLL_INTERVAL}s..."
        else
            NEW_INTERVAL=$(echo "$RESPONSE" | jq -r '.next_poll_interval // 45')    
            
            # Ensure NEW_INTERVAL is a number before assignment
            if [[ "$NEW_INTERVAL" =~ ^[0-9]+$ ]]; then
                POLL_INTERVAL=$NEW_INTERVAL
                log "Next poll interval set to $POLL_INTERVAL seconds based on server response."
            else
                log "Invalid poll interval received: $NEW_INTERVAL. Keeping previous interval of $POLL_INTERVAL seconds."
            fi


            STATUS=$(echo "$RESPONSE" | jq -r '.status')

            # Only act if the status has changed
            if [[ "$STATUS" == "active" ]]; then
                SITES=$(echo "$RESPONSE" | jq -r '.sites | join(",")')
                ALLOWED_TIME=$(echo "$RESPONSE" | jq -r '.duration')
                log "Status: ACTIVE. Unlocking: $SITES for $ALLOWED_TIME minutes"
                systemctl set-environment SITES_TO_UNLOCK="$SITES"
                systemctl start "ff-limiter@$ALLOWED_TIME"

            elif [[ "$STATUS" == "stop"  ]]; then
                log "Status: STOP. Locking browser."
                systemctl stop "ff-limiter@*"
            fi
        fi

        # Control the loop speed using the variable
        sleep "$POLL_INTERVAL"
    fi
done
