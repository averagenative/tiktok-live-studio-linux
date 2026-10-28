#!/usr/bin/env bash
# Start a throwaway OBS on a virtual X display with its own config and an
# unauthenticated obs-websocket on port 4466, for testing the OBS automation
# without touching your real OBS. Ctrl+C (or kill) stops it.
set -euo pipefail
PORT=${PORT:-4466}
DIR=$(mktemp -d -t obs-sandbox-XXXXXX)
mkdir -p "$DIR/obs-studio/plugin_config/obs-websocket"
cat > "$DIR/obs-studio/plugin_config/obs-websocket/config.json" <<JSON
{"alerts_enabled": false, "auth_required": false, "first_load": false, "server_enabled": true, "server_password": "", "server_port": $PORT}
JSON
printf '[General]\nFirstRun=true\nBrowserHWAccel=false\n' > "$DIR/obs-studio/user.ini"
printf '[General]\nFirstRun=true\nBrowserHWAccel=false\n' > "$DIR/obs-studio/global.ini"
echo "sandbox config: $DIR (websocket port $PORT)"
exec env XDG_CONFIG_HOME="$DIR" QT_QPA_PLATFORM=xcb xvfb-run -a -s '-screen 0 1920x1080x24' \
  obs --multi --disable-shutdown-check --disable-updater --minimize-to-tray
