#!/usr/bin/env bash
# Launch-and-close smoke for the Linux window: builds the app with the embedded
# UI, runs it under Xvfb in a throwaway sandbox, then checks it reports ready
# once the panel connects and exits cleanly on SIGTERM with no preview left
# behind.
set -euo pipefail

if [ -z "${GD_SMOKE_XVFB:-}" ]; then
  cargo build --locked -p ghostty-designer
  GD_SMOKE_XVFB=1 exec xvfb-run -a "$0"
fi

sandbox=$(mktemp -d)
trap 'kill "${pid:-}" 2>/dev/null || true; rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox"/{home,xdg,state}

GHOSTTY_DESIGNER_TARGET_PID= GHOSTTY_DESIGNER_ATTACHED=1 \
  scripts/sandbox-env.sh "$sandbox" target/debug/ghostty-designer >"$sandbox/out" 2>"$sandbox/err" &
pid=$!

deadline=$((SECONDS + 30))
until grep -qsx ready "$sandbox/out"; do
  if ! kill -0 "$pid" 2>/dev/null; then
    status=0
    wait "$pid" || status=$?
    echo "app exited with status $status during startup" >&2
    cat "$sandbox/err" >&2
    exit 1
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "app did not report ready within 30 s" >&2
    cat "$sandbox/err" >&2
    exit 1
  fi
  sleep 0.2
done
kill -TERM "$pid"
status=0
wait "$pid" || status=$?
if [ "$status" -ne 0 ]; then
  echo "app exited with status $status after SIGTERM" >&2
  cat "$sandbox/err" >&2
  exit 1
fi
preview=$sandbox/xdg/ghostty/ghostty-designer.conf
if [ -s "$preview" ]; then
  echo "preview file left behind:" >&2
  cat "$preview" >&2
  exit 1
fi
echo "smoke ok"
