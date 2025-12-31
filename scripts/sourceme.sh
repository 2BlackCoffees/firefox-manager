SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
if ! pgrep -x "x11vnc" > /dev/null
then
    echo "x11vnc not running. Starting now..."
    x11vnc -ncache 10 -display :0 -forever -bg -o ~/.vnc/x11vnc.log
else
    echo "x11vnc is already running."
fi

source $SCRIPT_DIR/alias.sh
export PS1="\[\e[32m\][\D{%Y-%m-%d %H:%M:%S}] \[\e[36m\]\u@\h:\[\e[35m\]\w\[\e[m\]\$ "
