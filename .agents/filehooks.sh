#!/usr/bin/env bash
# Runs one filehooks check from the repository root, whatever the session's cwd.
#
#   filehooks.sh <check> <cwd> <files relative to cwd>...
#
# `skip-node` exits 0 to skip a hook in a fresh clone, before
# `mise run install`.
set -euo pipefail

check=$1 cwd=$2
shift 2
files=()
for file; do files+=("$cwd/$file"); done
cd "$(git -C "$(dirname -- "${files[0]}")" rev-parse --show-toplevel)"

case $check in
  skip-node) test ! -d node_modules ;;
  oxlint) mise exec -- oxlint --fix "${files[@]}" ;;
  oxfmt) mise exec -- oxfmt --no-error-on-unmatched-pattern "${files[@]}" ;;
  rustfmt) mise exec -- rustfmt --edition 2024 "${files[@]}" ;;
  tsc) mise run typecheck ;;
  clippy)
    # The app crate embeds dist/ui unless default features are off.
    features=()
    test -d dist/ui || features=(--no-default-features)
    mise exec -- cargo clippy -q --workspace --all-targets "${features[@]}" -- -D warnings
    ;;
  *)
    echo "unknown check: $check" >&2
    exit 2
    ;;
esac
