ff() {
    case "$1" in
        start)
            # Usage: ff start <mins> <site1> <site2> ...
            local mins=${2:-30}
            shift 2
            local sites=${*:-"youtube.com"}

            echo "Starting Firefox for $mins minutes with extra sites: $sites"
            
            # Set the environment variable for systemd, then start the service
            sudo systemctl set-environment SITES_TO_UNLOCK="$sites"
            sudo systemctl start "ff-limit@$mins"

            ;;
        unlock-perm)
            # Usage: ff unlock-perm google.com
            echo "$2" | sudo tee -a /usr/local/etc/firefox_permanent_sites.txt
            sudo systemctl restart ff-enforcer
            echo "Site $2 added to permanent whitelist."
            ;;
        stop)
            echo "Stopping Firefox and locking sites..."
            sudo systemctl stop "ff-limit@*"
            ;;
        status)
            # Check for any active instance of the template
            local unit=$(systemctl list-units "ff-limit@*" --state=active --format=json | jq -r '.[0].unit' 2>/dev/null || systemctl list-units "ff-limit@*" --state=active | grep -o 'ff-limit@[0-9]*\.service' | head -1)
            
            if [ -z "$unit" ]; then
                echo "Firefox timer is NOT running."
            else
                local limit_mins=$(echo "$unit" | grep -oP '@\K[0-9]+')
                local start_timestamp=$(systemctl show "$unit" --property=ActiveEnterTimestamp | cut -d= -f2)
                local start_sec=$(date -d "$start_timestamp" +%s)
                local now_sec=$(date +%s)
                local elapsed_sec=$((now_sec - start_sec))
                local remaining_sec=$(( (limit_mins * 60) - elapsed_sec ))
                printf "ACTIVE | Limit: %d min | Remaining: %d:%02d\n" "$limit_mins" $((remaining_sec / 60)) $((remaining_sec % 60))
            fi
            ;;
        logs)
            tail -n 60 /var/log/firefox_usage.log
            ;;
        *)
            echo "Usage: ff [start <mins> <sites> | stop | status | logs | unlock-perm <site>]"
            ;;
    esac
}