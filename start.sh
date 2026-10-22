#!/bin/sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22 or newer is required. Install Node.js and try again.' >&2
  exit 127
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"; then
  printf '%s\n' 'Node.js 22 or newer is required. Upgrade Node.js and try again.' >&2
  exit 1
fi

# Resolve files beside this launcher, even when called from another directory.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd -- "$script_dir"

# Keep Node as the foreground process so Ctrl+C and SIGTERM release the registry lock.
exec node server.mjs
