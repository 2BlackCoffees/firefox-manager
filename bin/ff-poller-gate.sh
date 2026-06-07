#!/bin/bash
LOG_FILE="/var/log/ff-poller-gate.log"
log() {
    local message=$1
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $message" >> $LOG_FILE
}
LOCAL_DOT_ENV=".env"
DOT_ENV="/usr/local/bin/.env"

# Load Environment Variables from .env
if [ -f $LOCAL_DOT_ENV ]; then
    export $(grep -v '^#' $LOCAL_DOT_ENV | xargs)
fi

# Set a default poll interval if not defined in $LOCAL_DOT_ENV (in seconds)
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
OTA_PENDING="$CONFIG_DIR/ota_pending"

save_config() {
    cat <<EOF > "$CONFIG_FILE"
MIN_START_TIME="$MIN_START_TIME"
MAX_START_TIME="$MAX_START_TIME"
# REGISTERED_ID="$REGISTERED_ID"
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

get_unique_key() {
    
    # Get the default network interface
    local default_interface
    default_interface=$(ip route show default | awk '/default/ {print $5}')
    
    # Safety check: If there is no default route (offline), handle the error gracefully
    if [ -z "$default_interface" ]; then
        echo "Error: No default network interface found." >&2
        return 1
    fi
    
    # Fetch the MAC address for that interface
    local mac_addr
    mac_addr=$(cat "/sys/class/net/${default_interface}/address")
    
    # Construct the unique key
    local unique_key="${mac_addr}"
    
    # Return the key by printing it
    echo "$unique_key"
}

register_device() {
    
    # Generate unique key based on MAC address
    local UNIQUE_KEY=$(get_unique_key)
    local DEVICE_NAME="$(hostname)"

    log "Registering $DEVICE_NAME ($UNIQUE_KEY) with backend..."
    log "curl -s -X POST -H \"Content-Type: application/json\" -H \"Authorization: Bearer $TIMEGATE_API_SECRET\" -d '{\"id\": \"$DEVICE_NAME\", \"unique_key\": \"$UNIQUE_KEY\"}' \"$TIMEGATE_API_URL/api/register\""
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TIMEGATE_API_SECRET" \
        -d "{\"id\": \"$DEVICE_NAME\", \"unique_key\": \"$UNIQUE_KEY\"}" \
        "$TIMEGATE_API_URL/api/register")
    CURL_EXIT=$?
    if [[ $CURL_EXIT -ne 0 ]]; then
        log "Curl failed with exit code $CURL_EXIT (e.g., DNS failure, timeout, or refused connection)"
        return 1
    fi

    # Extract HTTP status and body
    HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [[ "$HTTP_STATUS" -ne 200 && "$HTTP_STATUS" -ne 300 ]]; then
        log "Registration failed with HTTP status code: $HTTP_STATUS. Will retry next loop."
        return 1
    else
        REGISTERED_ID=$(echo "$RESPONSE_BODY" | jq -r '.id')
        save_config
        log "Registration successful. ID stored: $REGISTERED_ID"
        return 0
    fi
}

unregister_device() {
    if [[ ! -n "$REGISTERED_ID" ]]; then
        log "Device registered id is not existing cannot unregister!"
        return 0
    fi
    log "Starting unregistration..."
    
    # Generate unique key based on MAC address
    local UNIQUE_KEY=$(get_unique_key)

    log "Unregistering $REGISTERED_ID ($UNIQUE_KEY) with backend..."
    log "curl -s -X POST -H \"Content-Type: application/json\" -H \"Authorization: Bearer $TIMEGATE_API_SECRET\" -d '{\"id\": \"$REGISTERED_ID\", \"unique_key\": \"$UNIQUE_KEY\"}' \"$TIMEGATE_API_URL/api/unregister\""
    RESPONSE=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TIMEGATE_API_SECRET" \
        -d "{\"id\": \"$REGISTERED_ID\", \"unique_key\": \"$UNIQUE_KEY\"}" \
        "$TIMEGATE_API_URL/api/unregister")

    if [[ $? -eq 0 ]]; then
        REGISTERED_ID=""
        save_config
        log "Unregistration successful. ID cleared REGISTERED_ID: $REGISTERED_ID"
    else
        log "Unregistration failed."
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
    RESPONSE=$(call_api "/api/settings/poweronschedule")    
    
    if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
        # 1. Determine the new Photo Status (default to false)
        NEW_PHOTO_STATUS=$(echo "$RESPONSE" | jq -r '.send_photo // false')

        # 2. Check if the "days" object has any actual content
        # This counts how many keys have non-empty arrays
        DAYS_COUNT=$(echo "$RESPONSE" | jq -r '.days | to_entries | map(select(.value | length > 0)) | length')


        # NEW DATA FOUND: Overwrite the whole file with new photo status and new schedule
        {
            log "send_photo: $NEW_PHOTO_STATUS"
            log "registered_id: $REGISTERED_ID"
            echo "$RESPONSE" | jq -r '
                .days | to_entries | 
                map(select(.value | length > 0)) | 
                map("\(.key): \(.value | join(","))") | 
                .[]
            '
        } > "$POWER_ON_SCHEDULE.tmp"
        mv "$POWER_ON_SCHEDULE.tmp" "$POWER_ON_SCHEDULE"
        log "Schedule and Photo Status updated."

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
            log "Received response: $RESPONSE"
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
            elif [[ "$STATUS" == "ota" ]]; then
                log "OTA update requested. Detaching update process..."

                # 1. Check if .env exists
                if [ ! -f "$DOT_ENV" ]; then
                    log "Error: $DOT_ENV not found: OTA update aborted"
                    exit 1
                fi

                # 2. Extract GIT_REPO_PATH
                # We use 'sed' to remove potential quotes if you added them earlier
                REPO_PATH=$(grep '^GIT_REPO_PATH=' "$DOT_ENV" | cut -d= -f2- | sed 's/^"//;s/"$//')

                # 3. Validate the path isn't empty
                if [ -z "$REPO_PATH" ]; then
                    log "Error: GIT_REPO_PATH is not defined in $DOT_ENV: OTA update aborted"
                    exit 1
                fi

                # 4. Execute systemd-run
                BRANCH_LABEL_NAME=$(echo "$RESPONSE" | jq -r '.branch_label_name // "main"')
                TIMEGATE_API_URL=$(echo "$RESPONSE" | jq -r '.timegate_api_url // "none"')
                TIMEGATE_API_SECRET=$(echo "$RESPONSE" | jq -r '.timegate_bypass_secret // "none"')

                if [[ -n "$TIMEGATE_API_URL" && "$TIMEGATE_API_URL" != "none" ]] && \
                   [[ -n "$TIMEGATE_API_SECRET" && "$TIMEGATE_API_SECRET" != "none" ]]; then
                    log "TIMEGATE_API_URL ($TIMEGATE_API_URL) and TIMEGATE_API_SECRET ($TIMEGATE_API_SECRET) are set. Unregistering device, setting to new backend and updating Linux code."
                    unregister_device
                    cat <<EOF > "$OTA_PENDING"
BRANCH_LABEL_NAME=$BRANCH_LABEL_NAME
USER_NAME=$USER_NAME
TIMEGATE_API_URL=$TIMEGATE_API_URL
TIMEGATE_API_SECRET=$TIMEGATE_API_SECRET
EOF
                else
                    log "TIMEGATE_API_URL ($TIMEGATE_API_URL) and TIMEGATE_API_SECRET ($TIMEGATE_API_SECRET) are not set. Considering this an update of the Linux code without reregistering device."
                    cat <<EOF > "$OTA_PENDING"
BRANCH_LABEL_NAME=$BRANCH_LABEL_NAME
USER_NAME=$USER_NAME
EOF
                fi
                # Run the installer in a separate, transient systemd unit
                # --collect ensures the transient unit is cleaned up after it finishes
                log "Starting systemd-run with path: $REPO_PATH and branch: $BRANCH_LABEL_NAME and API URL: $TIMEGATE_API_URL: File content of $OTA_PENDING: $(cat $OTA_PENDING)"
                systemd-run --unit=ff-ota-worker --collect /bin/bash -x "$REPO_PATH/scripts/install.sh" ota $USER_NAME > $LOG_FILE 2>&1
                log "Started systemd-run with path: $REPO_PATH and branch: $BRANCH_LABEL_NAME and API URL: $TIMEGATE_API_URL: File content of $OTA_PENDING: $(cat $OTA_PENDING)"
                log "Analyze logs with: journalctl -u ff-ota-worker.service -f"

                log "Update handoff complete. This service will now be restarted by the updater."
                # We don't remove the flag here; the installer or the recovery script will.
            else
                log "Status: $STATUS from poll ($RESPONSE). No action taken."
            fi
        fi

        # Control the loop speed using the variable
        sleep "$POLL_INTERVAL"
    fi
done
