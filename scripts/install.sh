#!/bin/bash
export PS4='+ \d \t $BASH_SOURCE:$LINENO:  --> '

# Ensure script stops on first error
set -e

# Ensure the script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Error: This script must be run as root." >&2
  exit 1
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <action> <user_name>" >&2
  echo "Actions available: run, update, ota, uninstall" >&2
  exit 1
fi

ACTION=$1
USER_NAME=$2

# Validate the action argument
case "$ACTION" in
  run|update|ota|uninstall)
    # Action is valid, proceed
    ;;
  *)
    echo "Error: Invalid action '$ACTION'." >&2
    echo "Must be one of: run, update, ota, uninstall" >&2
    exit 1
    ;;
esac

# Verify the user actually exists on the system
if ! id "$USER_NAME" &>/dev/null; then
  echo "Error: User '$USER_NAME' does not exist." >&2
  exit 1
fi

# Dynamically find the target user's home directory since $HOME belongs to root
USER_HOME=$(getent passwd "$USER_NAME" | cut -d: -f6)

# Attempt to locate the DBUS session address
USER_PID=$(pgrep -u "$USER_NAME" -f "systemd --user" | head -n 1)
DBUS_ADDRESS=""

if [ -n "$USER_PID" ] && [ -f "/proc/$USER_PID/environ" ]; then
  DBUS_ADDRESS=$(grep -z DBUS_SESSION_BUS_ADDRESS /proc/"$USER_PID"/environ | tr '\0' '\n' | cut -d= -f2-)
else
  # Only warn, don't exit entirely; some actions might not need the graphical stack right away
  echo "Warning: Could not find an active graphical session for $USER_NAME. Xfconf tweaks will fail." >&2
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

echo "=== Installation & Management System ==="
echo ""
LOCAL_MAIL_CONFIG="$SCRIPT_DIR/../misc/config-mail.ini"
OTA_PENDING="/var/lib/ff-limiter/ota_pending"
LOG_FILE="/var/log/ff-install.log"
FIREFOX_PERMANENT_FILES="/usr/local/etc/firefox_permanent_sites.txt"
LOCAL_DOT_ENV="$SCRIPT_DIR/../bin/.env"
DOT_ENV="/usr/local/bin/.env"
MAIL_CONFIG="/etc/time_checker/config-mail.ini"
CONFIG_TIME_SHUTDOWN="/etc/time_checker/config-time-shutdown.conf"

run_command_as_user() {
  # Check if DBUS_ADDRESS variable exists and is not empty
  if [ -n "$DBUS_ADDRESS" ]; then
    sudo -u "$USER_NAME" DBUS_SESSION_BUS_ADDRESS="$DBUS_ADDRESS" "$@"
  else
    echo "Warning: DBUS_ADDRESS is not set. Skipping command: $*" >&2
  fi
}

preinstall() {
    apt update && apt install fswebcam pulseaudio-utils -y
    if [[ $OPEN_SSH == "1" ]]; then
        apt install openssh-server -y
        systemctl enable --now ssh
        ufw allow ssh
        ufw --force enable
        ufw status
    fi

    
    # Target the specified user instead of root ($USER)
    usermod -aG video "$USER_NAME"
    
    # XFCE Session Customizations
    run_command_as_user xfconf-query -c xfce4-screensaver -p /saver/enabled -n -t bool -s false
    run_command_as_user xfconf-query -c xfce4-screensaver -p /lock/enabled -n -t bool -s false
    run_command_as_user xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-enabled -n -t bool -s false
    run_command_as_user xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/lock-screen-suspend-hibernate -n -t bool -s false
    run_command_as_user xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/lid-action-on-ac -n -t int -s 0
    
    apt-get purge -y light-locker
    run_command_as_user pkill -9 light-locker || true
    run_command_as_user pkill -9 xfce4-screensaver || true
}

install_vnc() {
    ufw allow 5900/tcp
    apt install xfce4 xfce4-goodies x11vnc -y
    mkdir -p "$USER_HOME/.vnc"
    chown -R "$USER_NAME:$USER_NAME" "$USER_HOME/.vnc"
}

uninstall_all() {
    # System level services
    systemctl stop ff-starter.service ff-killer.service ff-bell.service time-checker.service ff-poller-gate.service "ff-limiter@*" 2>/dev/null || true
    systemctl disable ff-starter.service ff-killer.service ff-bell.service time-checker.service ff-poller-gate.service 2>/dev/null || true

    # User level services targeting correct user container
    systemctl --user -M "${USER_NAME}@" stop ff-starter.service ff-bell.service 2>/dev/null || true
    systemctl --user -M "${USER_NAME}@" disable ff-starter.service ff-bell.service 2>/dev/null || true
    
    rm -f /etc/systemd/system/ff-limiter@.service $FIREFOX_PERMANENT_FILES || true

    systemctl daemon-reload
    systemctl --user -M "${USER_NAME}@" daemon-reload || true

    ps -aux | grep -P "ff-.*.sh|time-checker.*.sh" | grep -v grep || true
}

git_pull() {
    local branch_name=${1:-main}
    echo "Pulling latest changes from git repository (branch: $branch_name)..."
    git -C "$SCRIPT_DIR/.." pull origin "$branch_name"
}

log() { 
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] $1" >> "$LOG_FILE"
}

update_var_in_file() {
    local target_file="$1"
    shift
    touch "$target_file"
    for kv in "$@"; do
        key=$(echo "$kv" | cut -d= -f1)
        value=$(echo "$kv" | cut -d= -f2-)
        if grep -q "^$key=" "$target_file"; then
            grep -v "^$key=" "$target_file" > "$target_file.tmp" || true
            echo "$key=\"$value\"" >> "$target_file.tmp"
            mv "$target_file.tmp" "$target_file"
        else
            echo "$key=\"$value\"" >> "$target_file"
        fi
    done
}

install_files() {
    local update=${1:-manual}
    echo "Installing files... (update type: $update)"
    uninstall_all || true
    apt update && apt install -y jq curl

    if [ ! -f "$LOCAL_DOT_ENV" ]; then
        echo "Warning: $LOCAL_DOT_ENV file not found, please read the README.md file to learn how to set it up: No connection to the backend will be possible."
    else
        cp "$LOCAL_DOT_ENV" "$DOT_ENV"
        chown root:root "$DOT_ENV"
        chmod 600 "$DOT_ENV"
    fi

    # Target the corrected user config path, not root's home directory
    mkdir -p "$USER_HOME/.config/systemd/user"
    mkdir -p /etc/time_checker
    
    cp "$SCRIPT_DIR/../services/ff-starter.service" "$USER_HOME/.config/systemd/user/ff-starter.service"
    cp "$SCRIPT_DIR/../services/ff-bell.service" "$USER_HOME/.config/systemd/user/ff-bell.service"
    chown -R "$USER_NAME:$USER_NAME" "$USER_HOME/.config"

    cp "$SCRIPT_DIR/../bin/ff-starter.sh" /usr/local/bin/ff-starter.sh
    cp "$SCRIPT_DIR/../bin/ff-bell.sh" /usr/local/bin/ff-bell.sh
    cp "$SCRIPT_DIR/../bin/ff-killer.sh" /usr/local/bin/ff-killer.sh
    cp "$SCRIPT_DIR/../bin/ff-limiter.sh" /usr/local/bin/ff-limiter.sh
    cp "$SCRIPT_DIR/../bin/ff-poller-gate.sh" /usr/local/bin/ff-poller-gate.sh
    cp "$SCRIPT_DIR/../bin/time-checker-shutdown.py" /usr/local/bin/time-checker-shutdown.py
    
    [ -f "$LOCAL_MAIL_CONFIG" ] && cp "$LOCAL_MAIL_CONFIG" "$MAIL_CONFIG"    
    cp "$SCRIPT_DIR/../misc/config-time-shutdown.conf" "$CONFIG_TIME_SHUTDOWN"
    
    cp "$SCRIPT_DIR/../services/time-checker.service" /etc/systemd/system/time-checker.service
    cp "$SCRIPT_DIR/../services/ff-poller-gate.service" /etc/systemd/system/ff-poller-gate.service
    cp "$SCRIPT_DIR/../services/ff-killer.service" /etc/systemd/system/ff-killer.service
    sed "s|/home/<user>|$USER_HOME|g" "$SCRIPT_DIR/../services/ff-limiter@.service" > /etc/systemd/system/ff-limiter@.service
    cp "$SCRIPT_DIR/../misc/firefox_permanent_sites.txt" "$FIREFOX_PERMANENT_FILES"
    
    chown root:root "$FIREFOX_PERMANENT_FILES" "$CONFIG_TIME_SHUTDOWN"
    [ -f "$MAIL_CONFIG" ] && chown root:root "$MAIL_CONFIG"
    
    chmod 644 "$FIREFOX_PERMANENT_FILES"
    chmod 600 "$CONFIG_TIME_SHUTDOWN"
    [ -f "$MAIL_CONFIG" ] && chmod 600 "$MAIL_CONFIG"

    chmod +x /usr/local/bin/ff-*.sh

    # Fixed linger logic to use user parameter
    loginctl enable-linger "$USER_NAME"
    systemctl daemon-reload
    systemctl --user -M "${USER_NAME}@" daemon-reload
    
    systemctl enable --now ff-killer.service ff-poller-gate.service time-checker.service

    systemctl --user -M "${USER_NAME}@" enable ff-starter.service ff-bell.service
    systemctl --user -M "${USER_NAME}@" start ff-starter.service ff-bell.service

    if [[ "$update" == "ota" ]]; then
        if [ -f "$OTA_PENDING" ]; then
            echo "OTA update completed ... OTA update flag detected. Cleaning up..."
            rm -f "$OTA_PENDING"
        else
            echo "OTA update completed ... No OTA update flag detected."
        fi
    fi
    
    systemctl list-units --all "ff-*" || true
    systemctl list-units --all "time-checker*" || true
    systemctl --user -M "${USER_NAME}@" status ff-starter.service --no-pager || true
}

configure_ota() {
    vars_to_sync=("TIMEGATE_API_URL" "TIMEGATE_API_SECRET" "USER_NAME")
    for var_name in "${vars_to_sync[@]}"; do
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
        echo "Next steps in case you want to access from a remote computer on a local network:"
    run_command_as_user paplay /usr/share/sounds/freedesktop/stereo/complete.oga || true
    echo "On this computer:"
    echo "echo \"source $SCRIPT_DIR/alias.sh\" >> $USER_HOME/.bashrc"
    echo "In /etc/lightdm/lightdm.conf"
    echo "autologin-user=$USER_NAME"
    echo "autologin-user-timeout=0"
    echo "On your remote computer"
    echo "ssh-keygen -t ed25519 -f ~/.ssh/$(hostname)_key -N '' -C ''"
    ip_addr=$(hostname -I | awk '{print $1}')
    echo "ssh-copy-id -i ~/.ssh/$(hostname)_key.pub ${USER_NAME}@${ip_addr}"
    echo "echo \"alias ff=\\\"ssh -i ~/.ssh/$(hostname)_key ${USER_NAME}@${ip_addr}\\\"\" >> .bashrc"
    echo "Then you can use the 'ff' command to login to this computer remotely."
    echo "Once logged in you can control firefox with ff"
}

test_services() {
    run_command_as_user paplay /usr/share/sounds/freedesktop/stereo/complete.oga || true
    run_command_as_user pactl set-sink-volume @DEFAULT_SINK@ +5% || true

    systemctl set-environment SITES_TO_UNLOCK="youtube.com"
    systemctl start ff-limiter@2

    tail -n 60 /var/log/firefox_usage.log 2>/dev/null || true
}

# --- Runtime Execution Entrypoint ---

# Skip interactive config creation if action is unattended (ota/update/uninstall)
if [ ! -f "$LOCAL_MAIL_CONFIG" ] && [ "$ACTION" == "run" ]; then
    echo "=========================================================================" >&2
    echo "WARNING: Mail Configuration file not found!" >&2
    echo "The service will deploy, but email notifications will not function." >&2
    echo "To enable email alerts, please manually create the file at:" >&2
    echo "  $LOCAL_MAIL_CONFIG" >&2
    echo "" grading
    echo "With the following content format:" >&2
    echo "  SENDER_EMAIL=\"your_email@example.com\"" >&2
    echo "  RECIPIENT_EMAIL=\"your_email@example.com\"" >&2
    echo "  SENDER_PASSWORD=\"your_mail_app_password\"" >&2
    echo "=========================================================================" >&2
fi


REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$REPO_ROOT" ]; then
    update_var_in_file "$LOCAL_DOT_ENV" "GIT_REPO_PATH=$REPO_ROOT"
    echo "Git repository detected at: $REPO_ROOT, GIT_REPO_PATH variable updated in $LOCAL_DOT_ENV"

else
    echo "Warning: Not currently in a Git repository: OTA will not work!"
fi

# Action Matrix
if [ "$ACTION" == "run" ]; then
    preinstall
    install_files
    next_steps
    test_services
elif [ "$ACTION" == "update" ]; then
    install_files
elif [ "$ACTION" == "ota" ]; then

    log "Starting OTA update process..."
    if [[ -f "$OTA_PENDING" ]]; then
        # shellcheck disable=SC1090
        source "$OTA_PENDING"

        configure_ota 2>&1 | tee -a "$LOG_FILE"
        git_pull "${BRANCH_NAME}" 2>&1 | tee -a "$LOG_FILE"
        install_files ota 2>&1 | tee -a "$LOG_FILE"
    else
        echo "Error: $OTA_PENDING not found." 2>&1 | tee -a "$LOG_FILE"
    fi
elif [ "$ACTION" == "uninstall" ]; then
    uninstall_all
fi
