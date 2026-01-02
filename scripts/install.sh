preinstall() {
    sudo apt update && sudo apt install openssh-server -y
    sudo systemctl enable --now ssh
    sudo ufw allow ssh
    sudo ufw enable
    sudo ufw status
    sudo apt install pulseaudio-utils
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
    sudo systemctl stop ff-starter.sh
    sudo systemctl stop ff-killer.sh
    sudo systemctl stop ff-bell.sh
    sudo systemctl disable ff-starter.sh
    sudo systemctl disable ff-killer.sh
    sudo systemctl disable ff-bell.sh
    systemctl --user stop ff-starter.service
    systemctl --user stop ff-bell.service
    systemctl --user disable ff-starter.service
    systemctl --user disable ff-bell.service
    sudo rm /etc/systemd/system/ff-limit@.service
    sudo rm /usr/local/etc/firefox_permanent_sites.txt

    sudo systemctl daemon-reload
    systemctl --user daemon-reload

}
install_files() {
    uninstall_all

    SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

    mkdir -p ~/.config/systemd/user
    cp $SCRIPT_DIR/../services/ff-starter.service ~/.config/systemd/user/ff-starter.service
    cp $SCRIPT_DIR/../services/ff-bell.service ~/.config/systemd/user/ff-bell.service
    sudo cp $SCRIPT_DIR/../bin/ff-starter.sh /usr/local/bin/ff-starter.sh
    sudo cp $SCRIPT_DIR/../bin/ff-bell.sh /usr/local/bin/ff-bell.sh
    sudo cp $SCRIPT_DIR/../bin/ff-killer.sh /usr/local/bin/ff-killer.sh
    sudo cp $SCRIPT_DIR/../services/ff-killer.service /etc/systemd/system/ff-killer.service
    sudo cp $SCRIPT_DIR/../bin/ff-limit.sh /usr/local/bin/ff-limit.sh
    sudo cp $SCRIPT_DIR/../services/ff-limit@.service /etc/systemd/system/ff-limit@.service

    sudo cp $SCRIPT_DIR/../misc/firefox_permanent_sites.txt /usr/local/etc/firefox_permanent_sites.txt
    sudo chown root:root /usr/local/etc/firefox_permanent_sites.txt
    sudo chmod 644 /usr/local/etc/firefox_permanent_sites.txt

    sudo chmod +x /usr/local/bin/ff-*.sh
    # sudo sed -i "s/<user>/$USER/g" /etc/systemd/system/ff-starter.service

    sudo loginctl enable-linger $USER
    sudo systemctl daemon-reload
    systemctl --user daemon-reload
    sudo systemctl enable --now ff-killer.service
    systemctl --user enable ff-starter.service
    systemctl --user start ff-starter.service
    systemctl --user enable ff-bell.service
    systemctl --user start ff-bell.service
    systemctl list-units --all "ff-*"
    sudo systemctl status ff-killer.service
    systemctl --user status ff-starter.service
    systemctl --user status ff-bell.service

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

    sudo systemctl start ff-limit@2 youtube.com

    ## Kill any existing Firefox instances
    #sudo systemctl stop "ff-limit@*"

    # Check logs
    tail -n 60 /var/log/firefox_usage.log
}

if [ "$1" == "run" ]; then
    preinstall
    install_files
    next_steps
    test
fi

