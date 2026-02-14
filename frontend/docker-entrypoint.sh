#!/bin/sh
set -e

# Install dependencies if node_modules is empty or stale
if [ ! -f node_modules/.package-lock.json ] || [ package.json -nt node_modules/.package-lock.json ]; then
  echo "[entrypoint] Installing dependencies..."
  npm ci
fi

# Initial build (development mode, fast)
echo "[entrypoint] Running initial build..."
npx ng build --configuration development

# Start watch-mode rebuild in background
echo "[entrypoint] Starting watch-mode rebuild..."
npx ng build --watch --configuration development &

# Serve the built output
echo "[entrypoint] Serving on port 80..."
exec npx serve -s dist/agora/browser -l 80
