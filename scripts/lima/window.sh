#!/usr/bin/env bash
# Builds the app from the current tree inside a Lima VM and runs its window
# there, in a VM-local sandbox, under X11 (Xvfb + openbox) or Wayland (sway
# headless). `provision.sh <vm>` installs what it needs.
#
#   window.sh <vm> start <x11|wayland> [--webdriver]
#                                        build, then start the window; --webdriver
#                                        starts it in a WebDriver session instead
#   window.sh <vm> click <xpath>         click an element (WebDriver session)
#   window.sh <vm> js <script>           run JS in the page, print its result (WebDriver session)
#   window.sh <vm> shot <out.png>        screenshot the VM display
#   window.sh <vm> close                 close the window as its close button would
#   window.sh <vm> status                app process, exit code and stderr
#   window.sh <vm> stop                  kill the app (keeps the display server)
#
# Everything in the VM lives in ~/gd: src, target, sandbox, app.err, app.exit,
# wd.sid. Under WebDriver no app.exit is written.
# One window per VM: `start` refuses while a window runs, and `stop` kills every
# WebKit process in the VM.
set -euo pipefail

VM=${1:?usage: window.sh <vm> start <x11|wayland> [--webdriver]|click <xpath>|js <script>|shot <out.png>|close|status|stop}
ACTION=${2:?missing action}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
vm() { limactl shell "$VM" -- bash -o pipefail -c "$1"; }
[ "$(limactl list --format "{{.Status}}" "$VM")" = Running ] || limactl start "$VM"

# Prelude run inside the VM: display env for the current mode.
VMENV='
mkdir -p ~/gd; cd ~/gd
MODE=$(cat mode 2>/dev/null || echo x11)
export XDG_RUNTIME_DIR=/tmp/xdg-gd; mkdir -p -m700 $XDG_RUNTIME_DIR
if [ "$MODE" = x11 ]; then export DISPLAY=:99 GDK_BACKEND=x11
else export WAYLAND_DISPLAY=wayland-1 GDK_BACKEND=wayland; unset DISPLAY; fi
'
# Prelude for WebDriver calls: `wd <method> <path> [body]` against the session.
WD='
cd ~/gd; [ -s wd.sid ] || { echo "no WebDriver session: start the window with --webdriver" >&2; exit 1; }
wd() { curl -s -X"$1" "localhost:4444/session/$(cat wd.sid)$2" -H content-type:application/json ${3:+-d "$3"}; }
'

status() {
  vm "$VMENV"'
    echo "mode=$MODE exit=$(cat app.exit 2>/dev/null || echo running-or-none)"
    echo "--- ps"; pgrep -af "[g]d/target/debug/ghostty-designer|[W]ebKit" | cut -c1-160 || true
    echo "--- app.err"; cat app.err 2>/dev/null || true'
}

case $ACTION in
start)
  MODE=${3:?usage: window.sh <vm> start <x11|wayland>}
  [ "$MODE" = x11 ] || [ "$MODE" = wayland ] || { echo "mode must be x11 or wayland" >&2; exit 2; }
  WEBDRIVER=${4:-}
  [ -z "$WEBDRIVER" ] || [ "$WEBDRIVER" = --webdriver ] || { echo "unknown option: $WEBDRIVER" >&2; exit 2; }
  vm 'for c in cargo ghostty Xvfb openbox sway grim import wmctrl tauri-driver WebKitWebDriver; do
    command -v $c >/dev/null || { echo "$c is missing: run scripts/lima/provision.sh '"$VM"'" >&2; exit 1; }
  done'
  if vm 'pgrep -f "[g]d/target/debug/ghostty-designer" >/dev/null'; then
    echo "a window already runs in $VM. If it is yours, run: $0 $VM stop" >&2
    exit 1
  fi
  # The VM has no Bun, so the UI bundle is built here and copied with the crates.
  (cd "$ROOT" && mise run ui:build >/dev/null)
  "$0" "$VM" stop
  COPYFILE_DISABLE=1 tar -C "$ROOT" --exclude target --exclude gen -czf - Cargo.toml Cargo.lock crates dist/ui scripts/sandbox-env.sh |
    limactl shell "$VM" -- bash -c 'rm -rf ~/gd/src && mkdir -p ~/gd/src && tar -xzf - -C ~/gd/src 2>/dev/null'
  vm 'cd ~/gd/src && CARGO_TARGET_DIR=~/gd/target cargo build --locked -p ghostty-designer 2>&1 | tail -3'
  echo "$MODE" | limactl shell "$VM" -- tee gd/mode >/dev/null

  vm "$VMENV"'
    if [ "$MODE" = x11 ]; then
      pgrep -x Xvfb >/dev/null || { setsid nohup Xvfb :99 -screen 0 1280x900x24 >/dev/null 2>&1 </dev/null & sleep 2; }
      pgrep -x openbox >/dev/null || { setsid nohup openbox >/dev/null 2>&1 </dev/null & sleep 1; }
    else
      pgrep -x sway >/dev/null || {
        printf "output HEADLESS-1 resolution 1280x900\nfor_window [title=\".*\"] floating enable\n" > sway.conf
        WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 setsid nohup sway -c ~/gd/sway.conf >/tmp/sway.log 2>&1 </dev/null & sleep 3; }
    fi
    # Portal backends need the display in their environment. Without it every window start
    # stalls 40-80 s on xdg-desktop-portal timeouts (the headless VM has no desktop session).
    (
      export XDG_RUNTIME_DIR=/run/user/$(id -u)
      dbus-update-activation-environment --systemd DISPLAY=:99 ${WAYLAND_DISPLAY:+WAYLAND_DISPLAY=/tmp/xdg-gd/$WAYLAND_DISPLAY} XDG_CURRENT_DESKTOP=GNOME
      if ! systemctl --user is-active -q xdg-desktop-portal; then
        systemctl --user reset-failed; systemctl --user restart xdg-permission-store xdg-document-portal xdg-desktop-portal-gtk
        timeout 90 systemctl --user restart xdg-desktop-portal || true
      fi
    )
    S=~/gd/sandbox; mkdir -p $S/home $S/xdg $S/state
    rm -f app.exit app.err wd.sid
    APP=$HOME/gd/target/debug/ghostty-designer
    set -- env GHOSTTY_DESIGNER_TARGET_PID= GHOSTTY_DESIGNER_ATTACHED=1 ~/gd/src/scripts/sandbox-env.sh $S
    if [ -n "'"$WEBDRIVER"'" ]; then
      # tauri-driver passes its env and stderr on to the app it launches.
      setsid nohup "$@" tauri-driver --port 4444 >app.err 2>&1 </dev/null &
      sleep 2
      curl -s -XPOST localhost:4444/session -H content-type:application/json \
        -d "{\"capabilities\":{\"alwaysMatch\":{\"tauri:options\":{\"application\":\"$APP\"}}}}" |
        sed -n "s/.*\"sessionId\":\"\([^\"]*\)\".*/\1/p" >wd.sid
      [ -s wd.sid ] || echo "WebDriver session not created, see app.err" >&2
    else
      setsid nohup "$@" bash -c "$APP 2>$HOME/gd/app.err; echo \$? >$HOME/gd/app.exit" >/dev/null 2>&1 </dev/null &
    fi
    sleep 5'
  status
  ;;
click)
  XPATH=${3:?usage: window.sh <vm> click <xpath>}
  jq -nc --arg v "$XPATH" '{using: "xpath", value: $v}' | vm "$WD"'
    id=$(wd POST /element @- | sed -n "s/.*\":\"\([^\"]*\)\"}}$/\1/p")
    [ -n "$id" ] || { echo "no element matches" >&2; exit 1; }
    r=$(wd POST /element/$id/click "{}")
    case $r in *\"error\"*) echo "$r" >&2; exit 1 ;; esac'
  ;;
js)
  SCRIPT=${3:?usage: window.sh <vm> js <script>}
  jq -nc --arg s "$SCRIPT" '{script: $s, args: []}' | vm "$WD"'wd POST /execute/sync @-; echo'
  ;;
shot)
  OUT=${3:?usage: window.sh <vm> shot <out.png>}
  vm "$VMENV"'
    rm -f shot.png
    if [ "$MODE" = x11 ]; then import -window root shot.png; else grim shot.png; fi'
  mkdir -p "$(dirname "$OUT")"
  limactl cp "$VM:gd/shot.png" "$OUT"
  echo "$OUT"
  ;;
close)
  vm "$VMENV"'
    if [ "$MODE" = x11 ]; then wmctrl -c "Ghostty Designer"
    else swaymsg -s $(ls $XDG_RUNTIME_DIR/sway-ipc.*.sock | head -1) "[title=\"Ghostty Designer\"] kill" >/dev/null; fi
    for _ in $(seq 10); do [ -f app.exit ] && break; sleep 0.5; done'
  status
  ;;
status)
  status
  ;;
stop)
  vm 'pkill -x tauri-driver; pkill -x WebKitWebDriver
    pkill -f "[g]d/target/debug/ghostty-designer" || true; sleep 1; pkill -9 -f "[g]d/target/debug/ghostty-designer" || true; pkill -f "[W]ebKit(Web|Network)Process" || true'
  ;;
*)
  echo "unknown action: $ACTION" >&2
  exit 2
  ;;
esac
