#!/bin/bash
DURATION_MINS=$1
# Collect all arguments after the first as temporary websites
shift
TEMP_SITES=("$@")

POLICIES_DIR=/etc/firefox/policies
POLICY_FILE="$POLICIES_DIR/policies.json"
PERM_SITES_FILE="/usr/local/etc/firefox_permanent_sites.txt"
SOUND_FILE="/usr/share/sounds/freedesktop/stereo/message.oga" # Default Ubuntu alert sound
LOG_FILE="/var/log/firefox_usage.log"
LOCK_FILE="/tmp/firefox_allowed.lock"
START_EPOCH=$(date +%s)
echo "[$(date +"%Y-%m-%d %H:%M:%S")] Firefox timer started for $DURATION_MINS minutes, with temporary sites: ${TEMP_SITES[*]}" >> "$LOG_FILE"

# Cleanup on exit
stop_session() {
    rm -f $LOCK_FILE
    update_policy "lock"
    pkill -9 -f firefox
    # 5. Log completion
    END_EPOCH=$(date +%s)
    ELAPSED=$(( (END_EPOCH - START_EPOCH) / 60 ))
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] Firefox EXPIRED. Total: $ELAPSED mins" >> "$LOG_FILE"
}
trap "stop_session; exit" EXIT

# Create the necessary directory structure
if [[ ! -e $POLICY_FILE ]]; then
    sudo mkdir -p $POLICIES_DIR
    sudo touch $POLICY_FILE
fi
# sudo chmod 666 $POLICY_FILE

# Function to rebuild the Firefox policy
update_policy() {
    pkill -9 -f firefox

    local block_mode=$1
    local exceptions=""
    
    # 1. Add permanent sites
    while IFS= read -r site; do
        exceptions+="\"*://*.$site/*\", "
    done < "$PERM_SITES_FILE"

    # 2. Add temporary sites if we are in "unlock" mode
    if [ "$block_mode" == "unlock" ]; then
        for site in "${TEMP_SITES[@]}"; do
            exceptions+="\"*://*.$site/*\", "
        done
    fi

    # Trim trailing comma and build JSON
    exceptions=$(echo "$exceptions" | sed 's/, $//')
    
    cat <<EOF > "$POLICY_FILE"
{
  "policies": {
    "WebsiteFilter": {
      "Block": ["<all_urls>"],
      "Exceptions": [$exceptions]
    }
  }
}
EOF

    echo "[$(date +"%Y-%m-%d %H:%M:%S")] Updated Firefox policy ($block_mode mode):" >> "$LOG_FILE"
    cat "$POLICY_FILE" >> "$LOG_FILE"
}



# Start: Unlock internet/sites
touch $LOCK_FILE
update_policy "unlock"

# export DISPLAY=:0
su -p antoine -c "export DISPLAY=:0; firefox &"

# 3. Wait for (Duration - 1) minutes
if [ $DURATION_MINS -gt 1 ]; then
    sleep $(( (DURATION_MINS - 1) * 60 ))
fi

# 4. Final Minute Alerts (every 20 seconds)
for i in {1..4}; do
    # Only play if Firefox is still running
    if pgrep -f firefox > /dev/null; then
        paplay "$SOUND_FILE" 2>/dev/null || echo -e "\a" # Fallback to terminal beep
    fi
    sleep 10
done

for i in {1..6}; do
    # Only play if Firefox is still running
    if pgrep -f firefox > /dev/null; then
        paplay "$SOUND_FILE" 2>/dev/null || echo -e "\a" # Fallback to terminal beep
    fi
done

# Wait duration
sleep $((DURATION_MINS * 60))

stop_session





