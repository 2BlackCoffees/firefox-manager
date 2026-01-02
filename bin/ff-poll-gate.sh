#!/bin/bash
log() {
    local message=$1
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $message" >> "/var/log/ff-poll-gate.log"
}
# Load Environment Variables from .env
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Set a default poll interval if not defined in .env (in seconds)
POLL_INTERVAL=2

log "Starting Timegate Poller (Interval: ${POLL_INTERVAL}s)..."

while true; do
    # Fetch status from Vercel
    RESPONSE=$(curl -s -H "x-vercel-protection-bypass: $TIMEGATE_BYPASS_SECRET $TIMEGATE_API_URL/api/poll")

    
    # Check if curl failed
    if [ $? -ne 0 ]; then
        log "Network error. Retrying in ${POLL_INTERVAL}s..."
    else
        STATUS=$(echo "$RESPONSE" | jq -r '.status')

        # Only act if the status has changed
        if [[ "$STATUS" == "active" ]]; then
            SITES=$(echo "$RESPONSE" | jq -r '.sites | join(",")')
            ALLOWED_TIME=$(echo "$RESPONSE" | jq -r '.duration')
            log "Status: ACTIVE. Unlocking: $SITES for $ALLOWED_TIME minutes"
            systemctl set-environment SITES_TO_UNLOCK="$SITES"
            systemctl start "ff-limit@$ALLOWED_TIME"

        elif [[ "$STATUS" == "stop"  ]]; then
            log "Status: STOP. Locking browser."
            systemctl stop "ff-limit@*"
        fi
    fi

    # Control the loop speed using the variable
    sleep "$POLL_INTERVAL"
done