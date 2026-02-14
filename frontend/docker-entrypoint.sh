#!/bin/sh
set -e

OUTPUT_DIR="dist/agora/browser"

# Provide a loading page so serve can start immediately
mkdir -p "$OUTPUT_DIR"
if [ ! -f "$OUTPUT_DIR/index.html" ]; then
  cat > "$OUTPUT_DIR/index.html" <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><title>Agora</title>
<style>body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;background:#1a1a2e;color:#e0e0e0}
.spinner{width:40px;height:40px;border:4px solid #333;border-top-color:#6c63ff;border-radius:50%;animation:spin .8s linear infinite;margin-right:16px}
@keyframes spin{to{transform:rotate(360deg)}}</style></head>
<body><div class="spinner"></div><span>Building&hellip;</span></body></html>
HTML
fi

# Start serve immediately so nginx can connect
echo "[entrypoint] Starting file server on port 80..."
npx serve -s "$OUTPUT_DIR" -l 80 &
SERVE_PID=$!

# Install dependencies if node_modules is empty or stale
if [ ! -f node_modules/.package-lock.json ] || [ package.json -nt node_modules/.package-lock.json ]; then
  echo "[entrypoint] Installing dependencies..."
  npm ci
fi

# Run the first build, then switch to watch mode
echo "[entrypoint] Running initial build..."
npx ng build --configuration development

echo "[entrypoint] Starting watch-mode rebuild..."
npx ng build --watch --configuration development &

# Keep the container alive with the serve process
wait $SERVE_PID
