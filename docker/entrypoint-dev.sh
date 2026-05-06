#!/bin/sh
set -e
cd /app
STAMP="node_modules/.docker-install-stamp"
mkdir -p node_modules
if [ ! -f "$STAMP" ] || ! cmp -s package-lock.json "$STAMP" 2>/dev/null; then
  echo "Installing npm dependencies..."
  npm ci
  cp package-lock.json "$STAMP"
fi
exec npm run dev -- --host 0.0.0.0
