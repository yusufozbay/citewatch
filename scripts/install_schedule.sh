#!/bin/zsh
# Installs two macOS launchd jobs:
#   com.citewatch.run    runs `python -m citewatch run` every hour. The tracker decides what is due
#                          from config.toml (fetch_every_hours, brief_every_days), so changing the
#                          frequency never requires reinstalling.
#   com.citewatch.serve  keeps the UI server (http://127.0.0.1:8765) running: starts at login and
#                          is restarted by launchd if it exits.
#
#   scripts/install_schedule.sh            install / update both
#   scripts/install_schedule.sh uninstall  remove both
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
RUN_LABEL="com.citewatch.run"
SERVE_LABEL="com.citewatch.serve"

if [[ "${1:-}" == "uninstall" ]]; then
  for label in $RUN_LABEL $SERVE_LABEL; do
    launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    rm -f "$AGENTS/$label.plist"
    echo "Removed $label"
  done
  exit 0
fi

[[ -x "$PY" ]] || { echo "Missing $PY. Run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"; exit 1; }
mkdir -p "$ROOT/logs" "$AGENTS"

# write_plist LABEL LOGFILE EXTRA_KEYS ARGS...
write_plist() {
  local label=$1 log=$2 extra=$3; shift 3
  local args=""
  for a in "$@"; do args+="<string>$a</string>"; done
  cat > "$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>$args</array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
$extra
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
}

write_plist $RUN_LABEL "$ROOT/logs/tracker.log" \
  "  <key>StartInterval</key><integer>3600</integer>" \
  "$PY" -m citewatch run
echo "Installed $RUN_LABEL (hourly tick). Log: $ROOT/logs/tracker.log"

# A server started by hand would hold the port; launchd's copy takes over.
pkill -f "citewatch serve" 2>/dev/null && sleep 1 || true
# Logged outside ~/Documents: macOS privacy protection can stop launchd opening files there.
SERVE_LOG="$HOME/Library/Logs/citewatch/serve.log"
mkdir -p "$(dirname "$SERVE_LOG")"
write_plist $SERVE_LABEL "$SERVE_LOG" \
  "  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>" \
  "$PY" -u -m citewatch serve --port 8765
echo "Installed $SERVE_LABEL (always on). UI: http://127.0.0.1:8765  Log: $SERVE_LOG"
