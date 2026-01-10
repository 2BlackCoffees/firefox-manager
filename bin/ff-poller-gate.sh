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
POLL_INTERVAL=2
CONFIG_DIR="/var/lib/ff-limiter"
CONFIG_FILE="$CONFIG_DIR/state.cfg"
mkdir -p "$CONFIG_DIR"

# Defaults
MIN_START_TIME="07:00:00"
MAX_START_TIME="21:00:00"
LAST_UPDATE="1970-01-01T00:00:00Z"

# 1. Load persisted values or set defaults
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

# Function to convert HH:MM:SS to seconds since midnight for easy comparison
to_seconds() {
    date -d "$1" +%s
}
log "Starting Timegate Poller (Interval: ${POLL_INTERVAL}s)..."

while true; do
    CURRENT_TIME=$(date +%T)
    NOW=$(date +%s)
    MIN_SEC=$(to_seconds "$MIN_START_TIME")
    MAX_SEC=$(to_seconds "$MAX_START_TIME")

    # --- Case 1: Before Minimum Time ---
    if [[ "$NOW" -lt "$MIN_SEC" ]]; then
        echo "Too early ($CURRENT_TIME). Waiting until $MIN_START_TIME..."
        sleep 60
        continue

    # --- Case 2: After Maximum Time ---
    elif [[ "$NOW" -gt "$MAX_SEC" ]]; then
        echo "Past limit ($CURRENT_TIME). Stopping services..."
        systemctl stop "ff-limiter@*"
        # Exit or sleep until next day
        sleep 60
        continue
    else 

        # --- Case 3: Within Allowed Window ---
        # Fetch status from Vercel
        echo "curl -s -H \"x-vercel-protection-bypass: $TIMEGATE_BYPASS_SECRET\" \"$TIMEGATE_API_URL/api/poll?last_update=$LAST_UPDATE\""
        RESPONSE=$(curl -s -H "x-vercel-protection-bypass: $TIMEGATE_BYPASS_SECRET" "$TIMEGATE_API_URL/api/poll?last_update=$LAST_UPDATE")
        # Check if curl failed
        if [ $? -ne 0 ]; then
            log "Network error. Received: $RESPONSE Retrying in ${POLL_INTERVAL}s..."
        else
            # Parse the response (Assumes jq is installed for JSON parsing)
            NEW_MIN=$(echo "$RESPONSE" | jq -r '.min_start_time // empty')
            NEW_MAX=$(echo "$RESPONSE" | jq -r '.max_start_time // empty')
            NEW_TS=$(echo "$RESPONSE" | jq -r '.last_update // empty')

            # Update and Persist if new values are provided
            if [[ -n "$NEW_TS" ]]; then
                MIN_START_TIME=$NEW_MIN
                MAX_START_TIME=$NEW_MAX
                LAST_UPDATE=$NEW_TS
                
                # Persist to file
                cat <<EOF > "$CONFIG_FILE"
MIN_START_TIME="$MIN_START_TIME"
MAX_START_TIME="$MAX_START_TIME"
LAST_UPDATE="$LAST_UPDATE"
EOF
                echo "Config synchronized: Min=$MIN_START_TIME - Max=$MAX_START_TIME - LastUpdate=$LAST_UPDATE"
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
