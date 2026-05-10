#!/bin/bash

set -e
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

echo "=== FireFox Manager Installation ==="
echo ""
LOCAL_MAIL_CONFIG=$SCRIPT_DIR/../misc/config-mail.ini
OTA_PENDING="/var/lib/ff-limiter/ota_pending"
LOG_FILE="/var/log/ff-install.log"
FIREFOX_PERMANENT_FILES="/usr/local/etc/firefox_permanent_sites.txt"
LOCAL_DOT_ENV=$SCRIPT_DIR/../bin/.env
DOT_ENV="/usr/local/bin/.env"
MAIL_CONFIG="/etc/time_checker/config-mail.ini"
CONFIG_TIME_SHUTDOWN="/etc/time_checker/config-time-shutdown.conf"

preinstall() {

    sudo apt update && sudo apt install openssh-server -y && sudo apt install fswebcam -y
    sudo systemctl enable --now ssh
    sudo ufw allow ssh
    sudo ufw enable
    sudo ufw status
    sudo apt install pulseaudio-utils
    sudo usermod -aG video $USER
    # Disable the screensaver itself
    xfconf-query -c xfce4-screensaver -p /saver/enabled -n -t bool -s false
    # Disable the lock screen functionality
    xfconf-query -c xfce4-screensaver -p /lock/enabled -n -t bool -s false
    # Disable screen blanking (DPMS)
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-enabled -n -t bool -s false
    # Disable locking the screen when the system goes to sleep
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/lock-screen-suspend-hibernate -n -t bool -s false

    # (Optional) Set lid close action to 'nothing' (0) so it doesn't lock or suspend
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/lid-action-on-ac -n -t int -s 0
    # Completely remove the locker package
    sudo apt-get purge -y light-locker
    # Kill any currently running locker processes
    pkill -9 light-locker
    pkill -9 xfce4-screensaver
}

install_vnc() {
    sudo ufw allow 5900/tcp
    sudo apt install xfce4 xfce4-goodies -y
    sudo apt install x11vnc
    mkdir $HOME/.vnc
}

uninstall_all() {
    sudo systemctl stop ff-starter.service || true
    sudo systemctl stop ff-killer.service || true
    sudo systemctl stop ff-bell.service || true
    sudo systemctl stop time-checker.service || true
    sudo systemctl stop ff-poller-gate.service || true
    sudo systemctl stop "ff-limiter@*" || true

    sudo systemctl disable ff-starter.service || true
    sudo systemctl disable ff-killer.service || true
    sudo systemctl disable ff-bell.service || true
    sudo systemctl disable time-checker.service || true
    sudo systemctl disable ff-poller-gate.service || true

    systemctl --user stop ff-starter.service || true
    systemctl --user stop ff-bell.service || true
    systemctl --user disable ff-starter.service || true
    systemctl --user disable ff-bell.service || true
    
    sudo rm -f /etc/systemd/system/ff-limiter@.service || true
    sudo rm -f $FIREFOX_PERMANENT_FILES || true

    sudo systemctl daemon-reload
    systemctl --user daemon-reload

    ps -aux | grep -P "ff-.*.sh|time-checker.*.sh" | grep -v grep

}

git_pull() {
    local branch_name=${1:-main}
    echo "Pulling latest changes from git repository (branch: $branch_name)..."
    git -C "$SCRIPT_DIR/.." pull origin $branch_name
}

log() { 
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $1" >> $LOG_FILE
}

update_var_in_file() {
    local target_file="$1"
    shift # Remove the file path from the argument list

    # Check if the file exists; if not, create it
    touch "$target_file"
    # This function can be used to update the .env file with new values
    # It takes key-value pairs as arguments and updates the .env file accordingly
    for kv in "$@"; do
        key=$(echo "$kv" | cut -d= -f1)
        value=$(echo "$kv" | cut -d= -f2-)
        if grep -q "^$key=" "$target_file"; then
            # Update existing key
            sed -i "s|^$key=.*|$key=\"$value\"|" "$target_file"
        else
            # Add new key
            echo "$key=\"$value\"" >> "$target_file"
        fi
    done
}
install_files() {
    update=${1:-manual}
    echo "Installing files... (update type: $update)"
    uninstall_all || true
    sudo apt update && sudo apt install jq curl

    # If ./.env does not exist exit with error 
    if [ ! -f $LOCAL_DOT_ENV ]; then
        echo "Warning: $LOCAL_DOT_ENV file not found, please read the README.md file to learn how to set it up: No connection to the beackend will be possible."
    fi

    mkdir -p ~/.config/systemd/user
    sudo mkdir -p /etc/time_checker
    cp $SCRIPT_DIR/../services/ff-starter.service ~/.config/systemd/user/ff-starter.service
    cp $SCRIPT_DIR/../services/ff-bell.service ~/.config/systemd/user/ff-bell.service
    sudo cp $SCRIPT_DIR/../bin/ff-starter.sh /usr/local/bin/ff-starter.sh
    sudo cp $SCRIPT_DIR/../bin/ff-bell.sh /usr/local/bin/ff-bell.sh
    sudo cp $SCRIPT_DIR/../bin/ff-killer.sh /usr/local/bin/ff-killer.sh
    sudo cp $SCRIPT_DIR/../bin/ff-limiter.sh /usr/local/bin/ff-limiter.sh
    sudo cp $SCRIPT_DIR/../bin/ff-poller-gate.sh /usr/local/bin/ff-poller-gate.sh
    sudo cp $SCRIPT_DIR/../bin/time-checker-shutdown.py /usr/local/bin/time-checker-shutdown.py
    sudo cp $LOCAL_DOT_ENV $DOT_ENV
    [ -f "$LOCAL_MAIL_CONFIG" ] && sudo cp "$LOCAL_MAIL_CONFIG" $MAIL_CONFIG    
    sudo cp $SCRIPT_DIR/../misc/config-time-shutdown.conf $CONFIG_TIME_SHUTDOWN
    sudo cp $SCRIPT_DIR/../services/time-checker.service /etc/systemd/system/time-checker.service
    sudo cp $SCRIPT_DIR/../services/ff-poller-gate.service /etc/systemd/system/ff-poller-gate.service
    sudo cp $SCRIPT_DIR/../services/ff-killer.service /etc/systemd/system/ff-killer.service
    sudo cp $SCRIPT_DIR/../services/ff-limiter@.service /etc/systemd/system/ff-limiter@.service

    sudo cp $SCRIPT_DIR/../misc/firefox_permanent_sites.txt $FIREFOX_PERMANENT_FILES
    sudo chown root:root $FIREFOX_PERMANENT_FILES
    sudo chown root:root $DOT_ENV
    sudo chown root:root $MAIL_CONFIG
    sudo chown root:root $CONFIG_TIME_SHUTDOWN
    sudo chmod 644 $FIREFOX_PERMANENT_FILES
    sudo chmod 600 $DOT_ENV
    sudo chmod 600 $MAIL_CONFIG
    sudo chmod 600 $CONFIG_TIME_SHUTDOWN

    sudo chmod +x /usr/local/bin/ff-*.sh

    sudo loginctl enable-linger $USER
    sudo systemctl daemon-reload
    systemctl --user daemon-reload
    sudo systemctl enable --now ff-killer.service
    sudo systemctl enable --now ff-poller-gate.service
    sudo systemctl enable --now time-checker.service
    sudo systemctl start time-checker.service
    systemctl --user enable ff-starter.service
    systemctl --user enable ff-bell.service
    systemctl --user start ff-starter.service
    systemctl --user start ff-bell.service

    # Verifications
    if [[ $update == "ota" ]]; then
        if [ -f "$OTA_PENDING" ]; then
            echo "OTA update completed ... OTA update flag detected. Cleaning up..."
            sudo rm -f "$OTA_PENDING"
            echo "Flag removed. OTA update process should proceed as expected."
        else
            echo "OTA update completed ... No OTA update flag detected. Please check the update process for issues."
        fi
    else
        systemctl list-units --all "ff-*"
        systemctl list-units --all "time-checker*"
        sudo systemctl status time-checker.service
        sudo systemctl status ff-killer.service
        sudo systemctl status ff-poller-gate.service
        systemctl --user status ff-starter.service
        systemctl --user status ff-bell.service

        ps -aux | grep -P "ff-.*.sh|time-checker" | grep -v grep
    fi

}

configure_ota() {

    # List the variables you want to sync
    vars_to_sync=("TIMEGATE_API_URL" "TIMEGATE_BYPASS_SECRET")

    for var_name in "${vars_to_sync[@]}"; do
        # Get the value of the variable name stored in var_name
        value="${!var_name}"

        if [[ -n "$value" && "$value" != "none" ]]; then
            update_var_in_file "$LOCAL_DOT_ENV" "$var_name=$value"
            echo "Synced $var_name to $LOCAL_DOT_ENV with value: $value"
        else
            echo "Variable $var_name is not set or is set to 'none'. Skipping sync for this variable."
        fi
    done
}   

next_steps() {
    echo "Installation complete!"
    echo "Next steps:"
    paplay /usr/share/sounds/freedesktop/stereo/complete.oga
    echo "On this computer:"
    SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
    echo "echo \"source $SCRIPT_DIR/alias.sh\" > .bashrc"

    echo "In /etc/lightdm/lightdm.conf"
    echo "autologin-user=$USER"
    echo "autologin-user-timeout=0"
    echo "On your remote computer"
    echo "ssh-keygen -t ed25519 -f ~/.ssh/$(hostname)_key -N '' -C ''"
    ip_addr=$(hostname -I | perl -npe 's: .*::')
    echo "ssh-copy-id -i ~/.ssh/$(hostname)_key.pub ${USER}@${ip_addr}"
    echo "echo \"alias ff=\\\"ssh -i ~/.ssh/$(hostname)_key ${USER}@${ip_addr}\\\"\" >> .bashrc"
    echo "Then you can use the 'ff' command to login to this computer remotely."
    echo "Once logged in you can control firefox with ff"
}

test() {
    paplay /usr/share/sounds/freedesktop/stereo/complete.oga
    pactl set-sink-volume @DEFAULT_SINK@ +5%

    sudo systemctl start ff-limiter@2 youtube.com

    ## Kill any existing Firefox instances
    #sudo systemctl stop "ff-limiter@*"

    # Check logs
    tail -n 60 /var/log/firefox_usage.log
}

if [ ! -f $LOCAL_MAIL_CONFIG ]; then
    echo ""
    echo "Mail Configuration file not found."
    echo "Please create $LOCAL_MAIL_CONFIG with your mail credentials."
    echo ""
    read -p "Do you want to create the config file now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your mail address: " mail_addr
        read -p "Enter your mail App Password: " mail_pass
        
        cat > $LOCAL_MAIL_CONFIG <<EOF
# Time Monitor Configuration
SENDER_EMAIL="$mail_addr"
RECIPIENT_EMAIL="$mail_addr"
SENDER_PASSWORD="$mail_pass"
EOF
        echo "Configuration file created!"
    else
        echo "Skipping config creation. Please create it manually if you want to be neotified per mail by the service."
        exit 1
    fi
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

if [ -n "$REPO_ROOT" ]; then
    update_var_in_file $DOT_ENV "GIT_REPO_PATH=$REPO_ROOT"
else
    echo "Error: Not currently in a Git repository: OTA will not work!"
fi

action=${1:-none}
if [ "$action" == "run" ]; then
    preinstall
    install_files
    next_steps
    test
elif [ "$action" == "update" ]; then
    install_files
elif [ "$action" == "ota" ]; then

    log "Starting OTA update process..."
    if [[ -f "$OTA_PENDING" ]]; then
        source "$OTA_PENDING"
        configure_ota 2>&1 | tee -a "$LOG_FILE"
        git_pull "$BRANCH_NAME" 2>&1 | tee -a "$LOG_FILE"
        install_files ota 2>&1 | tee -a "$LOG_FILE"

    else
        echo "Error: $OTA_PENDING not found." 2>&1 | tee -a "$LOG_FILE"
    fi

elif [ "$action" == "uninstall" ]; then
    uninstall_all
else
    echo "Usage: $0 {run|update|ota [branch_name]|uninstall}"

fi

