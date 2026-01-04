#!/bin/bash
trap "stop_session; exit" EXIT

log() {
    local message=$1
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $message" >> "/var/log/ff-limit.log"
}

DURATION_MINS=$1
# Collect all arguments after the first as temporary websites
shift
TEMP_SITES=("$@")

POLICIES_DIR=/etc/firefox/policies
POLICY_FILE="$POLICIES_DIR/policies.json"
PERM_SITES_FILE="/usr/local/etc/firefox_permanent_sites.txt"
SOUND_FILE="/usr/share/sounds/freedesktop/stereo/message.oga" # Default Ubuntu alert sound
STOP_FIREFOX="/tmp/stop_firefox.lock"
SEMAPHORE_JSON="/tmp/firefox_request.json"

START_FIREFOX="/tmp/firefox_start.lock"
BELL_SEMAPHORE=/tmp/firefox_bell.lock

START_EPOCH=$(date +%s)
default_setup


wait_for_semaphore() {
    while [[ ! -f "$SEMAPHORE_JSON" ]]; do
        sleep 2
    done

    # Basic JSON validation
    if ! jq empty "$SEMAPHORE_JSON" 2>/dev/null; then
        log "Error: Invalid JSON in $SEMAPHORE_JSON. Deleting corrupted file."
        rm "$SEMAPHORE_JSON"
        return 1
    fi
    return 0
}

start_firefox() {
    touch $START_FIREFOX
    log "Enabled semaphore $START_FIREFOX: $(ls -l $START_FIREFOX)"
}

disable_firefox_start() {
    rm -f $START_FIREFOX
    log "Disabled semaphore $START_FIREFOX: $(ls -l $START_FIREFOX)"
}

kill_firefox() {
    disable_firefox_start
    log "Killing firefox"
    log $(pkill -9 -f firefox)
    log "Processes $(ps -edf | grep firefox)"
}

# Function to rebuild the Firefox policy
update_policy() {

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
    
    kill_firefox
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
    log "Updated Firefox policy ($block_mode mode), new content is:"
    log "$POLICY_FILE: $(cat $POLICY_FILE)"
}


# Cleanup on exit
stop_session() {
    log "Stopping session..."
    update_policy "lock"
    
    END_EPOCH=$(date +%s)
    ELAPSED=$(( (END_EPOCH - START_EPOCH) / 60 ))
    log "Firefox EXPIRED. Total: $ELAPSED mins"
}

init_files() {
    # Create the necessary directory structure
    if [[ ! -e $POLICY_FILE ]]; then
        # Set directory permissions
        sudo mkdir -p $POLICIES_DIR
        sudo chmod 755 $POLICIES_DIR

        sudo touch $POLICY_FILE
    fi

    sudo chown root:root $POLICY_FILE
    sudo chmod 644 $POLICY_FILE
    log "Updated access on $POLICY_FILE: $(ls -l $POLICY_FILE)"

    if [[ ! -e $PERM_SITES_FILE ]]; then
        sudo touch $PERM_SITES_FILE
        sudo chown root:root $PERM_SITES_FILE
        sudo chmod 644 $PERM_SITES_FILE
    fi
    log "Updated access on $PERM_SITES_FILE: $(ls -l $PERM_SITES_FILE), default white listed content is:"
    log $(cat $PERM_SITES_FILE)
}

default_setup() {
    init_files
    disable_firefox_start
    kill_firefox
    stop_session
}

main_prg() {


    # Start: Unlock internet/sites
    update_policy "unlock"

    start_firefox
    log "Firefox timer started for $DURATION_MINS minutes, with temporary sites: ${TEMP_SITES[*]}"


    # 3. Wait for (Duration - 1) minutes
    if [ $DURATION_MINS -gt 1 ]; then
        sleep $(( (DURATION_MINS - 1) * 60 ))
    fi

    touch $BELL_SEMAPHORE
    log "Time almost elapsed, starting belling"
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
    rm -f $BELL_SEMAPHORE

    log "Time is fully over, killing Firefox!"
    disable_firefox_start
    kill_firefox
    log "Stopping session"
    stop_session
}

while true; do
    if wait_for_semaphore; then
        
        # --- DATA EXTRACTION ---
        # Capture sites into an array and duration into a variable
        mapfile -t TEMP_SITES < <(jq -r '.sites[]' "$SEMAPHORE_JSON")
        DURATION_MINS=$(jq -r '.duration' "$SEMAPHORE_JSON")
        
        log "New request detected: ${#TEMP_SITES[@]} sites for $DURATION_MINS minutes."
        log "Whitelisting: ${TEMP_SITES[*]}"
        main_prg
        rm -f "$SEMAPHORE_JSON"
    fi
done

log "Done"


