#!/bin/bash
# Installs the Folder Sidebar cast helper and starts it at login.
set -euo pipefail

LABEL="com.foldersidebar.casthelper"
DIR="$HOME/Library/Application Support/FolderSidebarCast"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/FolderSidebarCast.log"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Prefer a modern Python (Homebrew) over the old one that ships with macOS.
PY=""
for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 || true)"; do
  if [ -n "$p" ] && [ -x "$p" ]; then PY="$p"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3 not found. Run:  xcode-select --install   (or: brew install python)"; exit 1
fi
echo "Using $("$PY" --version) at $PY"

mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$HERE/cast_helper.py" "$DIR/"
if [ ! -x "$DIR/venv/bin/python" ]; then "$PY" -m venv "$DIR/venv"; fi
"$DIR/venv/bin/python" -m pip install --quiet --upgrade pip
"$DIR/venv/bin/python" -m pip install --quiet --upgrade pychromecast

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DIR/venv/bin/python</string>
    <string>$DIR/cast_helper.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Waiting for Chromecasts…"
sleep 6
if curl -s "http://127.0.0.1:47800/status" -H "Host: 127.0.0.1:47800" >/tmp/fscast.json; then
  "$DIR/venv/bin/python" - <<'PYEOF'
import json
d = json.load(open('/tmp/fscast.json'))['devices']
print(f"Helper running. Found {len(d)} device(s):")
for x in d: print("  -", x['name'], f"({x['model']})", "—", x.get('app') or 'idle')
if not d:
    print("  None yet. If macOS asked about finding devices on your local network, click Allow.")
    print("  Otherwise check System Settings > Privacy & Security > Local Network and turn on Python.")
PYEOF
else
  echo "Helper didn't answer. See the log: $LOG"
fi
