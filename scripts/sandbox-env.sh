#!/usr/bin/env bash
# The environment that confines a designer run to a sandbox folder, for every
# runner: sandbox.ts, the smoke and vm.sh.
#
#   sandbox-env.sh <sandbox-dir> <command...>   exec the command in the sandbox
#   sandbox-env.sh <sandbox-dir>                print export lines for a shell
#
# The folder holds home/, xdg/ and state/. Ghostty's XDG fallbacks follow HOME
# (ghostty src/os/xdg.zig), an inherited XDG_CACHE_HOME moves its Sentry cache
# (src/crash/sentry.zig:116-131), and on macOS it resolves Application Support
# and Caches through Foundation, which follows CFFIXED_USER_HOME but not HOME
# (src/os/macos.zig:24-32). Callers set GHOSTTY_DESIGNER_TARGET_PID and
# GHOSTTY_DESIGNER_ATTACHED themselves.
set -eu

dir=${1:?usage: sandbox-env.sh <sandbox-dir> [command...]}
shift

HOME=$dir/home
CFFIXED_USER_HOME=$HOME
XDG_CONFIG_HOME=$dir/xdg
XDG_STATE_HOME=$dir/state
XDG_CACHE_HOME=$HOME/.cache
export HOME CFFIXED_USER_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME

if [ $# -gt 0 ]; then
  exec "$@"
fi
for name in HOME CFFIXED_USER_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME; do
  printf "export %s='%s'\n" "$name" "$(printf %s "${!name}" | sed "s/'/'\\\\''/g")"
done
