# BlueBubbles Server Setup — CoWork Runbook

> **Executor**: Claude CoWork (running on the MacBook)
> **Target machine**: MacBook Air M1 2020, macOS Tahoe 26.2
> **Goal**: Install and configure BlueBubbles Server, then hand off integration values to Claude Code (Railway side)
> **Handoff to**: Claude Code session managing the OpenClaw Railway instance

---

## How This Runbook Works

This document is split into two parts:

1. **Phases 1–6 (CoWork)**: You (Claude CoWork) execute these on the MacBook. You have computer use (screen control), terminal access, and browser access.
2. **Phase 7 (Handoff)**: You write a handoff file with the values Claude Code needs, then tell the user the Mac-side setup is done.
3. **Phase 8 (Claude Code)**: The Railway-side Claude Code session reads the handoff values and completes the OpenClaw integration. CoWork does NOT execute Phase 8.

### CoWork Execution Notes

- **Prefer terminal commands** over GUI clicks — they're faster and more reliable.
- **For GUI-only steps** (System Settings, Firebase console, BlueBubbles wizard): use computer use to take screenshots, locate UI elements, click, and type.
- **Drag-and-drop is unreliable** — use alternative methods (file pickers, CLI, copy-paste paths) wherever possible.
- **Verify each phase** before moving to the next. Every phase ends with a verification step.
- **If something fails**: screenshot the error, tell the user what happened, and ask before retrying.

---

## Phase 1: Download & Install BlueBubbles Server

### Step 1.1: Download the DMG

Run in Terminal:

```bash
cd ~/Downloads
curl -L -o BlueBubbles-Server.dmg \
  "https://github.com/BlueBubblesApp/bluebubbles-server/releases/latest/download/BlueBubbles-Server.dmg"
```

**If curl fails** (404 or redirect issues — the app is unsigned and filenames vary across releases):
1. Open Safari to `https://github.com/BlueBubblesApp/bluebubbles-server/releases/latest`
2. Look for a `.dmg` file in the "Assets" section at the bottom of the page
3. Click to download it
4. Wait for download to complete in `~/Downloads/`

### Step 1.2: Install to Applications

```bash
# Mount the DMG
hdiutil attach ~/Downloads/BlueBubbles-Server.dmg

# Find the exact volume name (it may vary)
ls /Volumes/ | grep -i blue

# Copy to Applications (adjust volume name if different)
cp -R "/Volumes/BlueBubbles Server/BlueBubbles Server.app" /Applications/

# Eject
hdiutil detach "/Volumes/BlueBubbles Server"
```

### Step 1.3: Bypass Gatekeeper and Launch

```bash
# Remove quarantine attribute (required — app is unsigned)
xattr -cr "/Applications/BlueBubbles Server.app"

# Launch
open "/Applications/BlueBubbles Server.app"
```

**If macOS still blocks it** (you'll see a dialog saying the app can't be opened):
1. Open **System Settings** (click Apple menu > System Settings)
2. Navigate to **Privacy & Security**
3. Scroll down — look for a message about "BlueBubbles Server" being blocked
4. Click **"Open Anyway"**
5. Confirm the dialog

### Step 1.4: Verify

Take a screenshot. You should see the BlueBubbles Server setup wizard window. If you see it, Phase 1 is complete.

---

## Phase 2: Grant macOS Permissions

BlueBubbles requires Full Disk Access (mandatory) and Accessibility (recommended). These must be set in System Settings.

### Step 2.1: Full Disk Access (REQUIRED)

This is mandatory — BlueBubbles reads the iMessage database at `~/Library/Messages/chat.db`.

1. Open **System Settings** (if not already open)
2. Click **Privacy & Security** in the left sidebar
3. Click **Full Disk Access**
4. If a lock icon appears at the bottom, click it and authenticate (Touch ID or password)
5. Look for **"BlueBubbles Server"** in the list
   - If present: toggle it **ON**
   - If not present: click the **"+"** button, navigate to `/Applications/`, select **"BlueBubbles Server.app"**, click **"Open"**
6. Toggle it **ON** if not already

### Step 2.2: Accessibility (recommended)

1. Go back to **Privacy & Security**
2. Click **Accessibility**
3. Same process: add BlueBubbles Server if not listed, toggle **ON**

### Step 2.3: Handle Permission Prompts

BlueBubbles may show permission dialogs for Contacts and Notifications when it first runs. Click **"Allow"** on both if they appear.

### Step 2.4: Restart BlueBubbles After Permissions

Full Disk Access only takes effect after restart:

```bash
# Quit BlueBubbles
osascript -e 'tell application "BlueBubbles Server" to quit'
sleep 2

# Relaunch
open "/Applications/BlueBubbles Server.app"
```

### Step 2.5: Verify

Take a screenshot of the BlueBubbles window. It should NOT show any "permissions required" warnings. If it does, revisit the steps above.

---

## Phase 3: Firebase Setup

BlueBubbles requires a Firebase project for push notifications infrastructure. Even if we only use webhook integration with OpenClaw, Firebase is required for the server to function.

**This entire phase happens in the browser (Safari or Chrome).**

### Step 3.1: Create Firebase Project

1. Open browser to `https://console.firebase.google.com/`
2. Sign in with a Google account (or create one) if prompted
3. Click **"Create a project"** (or **"Add project"**)
4. Project name: type `BlueBubblesApp`
5. Click **Continue**
6. When asked about Google Analytics: toggle it **OFF** (not needed)
7. Click **"Create project"**
8. Wait for creation to complete, then click **"Continue"**

### Step 3.2: Create Firestore Database

1. In the Firebase console left sidebar, click **"Cloud Firestore"** (or **"Firestore Database"**)
2. Click **"Create database"**
3. When asked about mode: select **"Start in test mode"**
4. Select any region (default is fine), click **"Create"** or **"Enable"**
5. Once created, click the **"Rules"** tab
6. Replace the entire rules content with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
7. Click **"Publish"**

### Step 3.3: Download Service Account Key

1. In the Firebase console, click the **gear icon** (top left, next to "Project Overview")
2. Click **"Project settings"**
3. Click the **"Service accounts"** tab
4. Click **"Generate new private key"**
5. Click **"Generate key"** in the confirmation dialog
6. A JSON file downloads (e.g., `bluebbubblesapp-firebase-adminsdk-xxxxx.json`)
7. Note the download location — it will be in `~/Downloads/`

Capture the filename:
```bash
ls -t ~/Downloads/*firebase*.json | head -1
```

### Step 3.4: Create Android App (for google-services.json)

1. Go back to **Project settings** > **"General"** tab
2. Scroll down to **"Your apps"**
3. Click the **Android icon** to add a new app
4. Package name: type `com.bluebubbles.messaging`
5. Click **"Register app"**
6. Click **"Download google-services.json"**
7. Click through the remaining steps (click **"Next"** then **"Continue to console"** — skip them)

Verify both files exist:
```bash
echo "=== Firebase files ==="
ls -la ~/Downloads/*firebase*.json
ls -la ~/Downloads/google-services.json
```

### Step 3.5: Load Firebase Config into BlueBubbles

BlueBubbles Server should be showing its setup wizard. Look for a step about Firebase/Google configuration.

**Important**: Drag-and-drop is unreliable with computer use. Instead:

1. In the BlueBubbles Server wizard, look for a **"Manual Setup"** tab (not "Google Sign-In") and click it
2. Look for the first file input field (for the service account key)
3. Click the file input / **"Browse"** / **"Choose File"** button
4. Navigate to `~/Downloads/` in the file picker
5. Select the Firebase service account JSON file (the one with `firebase-adminsdk` in the name)
6. Click **"Open"**
7. For the second file input field (google-services.json):
8. Click the file input / **"Browse"** / **"Choose File"** button
9. Navigate to `~/Downloads/`
10. Select `google-services.json`
11. Click **"Open"**
12. Click **"Next"** or **"Submit"** in the wizard

### Step 3.6: Verify

Take a screenshot. The BlueBubbles wizard should advance to the next step (server password / proxy configuration). If you see a Firebase error, the JSON files may be wrong — re-check the filenames.

---

## Phase 4: Server Configuration

### Step 4.1: Set Server Password

Generate a strong password and set it in BlueBubbles:

```bash
# Generate a random password
BB_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=' | head -c 20)
echo "BlueBubbles server password: $BB_PASSWORD"

# Save it for later handoff
echo "$BB_PASSWORD" > ~/Desktop/bb-password.txt
echo "Password saved to ~/Desktop/bb-password.txt"
```

In the BlueBubbles Server wizard:
1. Find the **password field**
2. Type (or paste) the password shown in the terminal output
3. Click the **save icon** (floppy disk) or **"Save"** button

### Step 4.2: Select Proxy Service — Cloudflare

1. Look for a **proxy service dropdown** in the wizard
2. Click it and select **"Cloudflare"**
3. BlueBubbles will automatically create a Cloudflare tunnel (free, no account needed)
4. Click **"Next"** or **"Save"** to proceed

### Step 4.3: Wait for Server Startup

BlueBubbles will take 10–30 seconds to initialize and create the Cloudflare tunnel. Wait for the main dashboard to appear showing:
- **Status**: "Running" or a green indicator
- **URL**: A Cloudflare tunnel URL (e.g., `https://xxxxx.trycloudflare.com`)

### Step 4.4: Capture the Tunnel URL

Take a screenshot of the BlueBubbles Server dashboard. Look for the tunnel URL displayed in the server status area.

Once you can see the URL, also verify via terminal:

```bash
# The BB API should be reachable through the tunnel
BB_PASSWORD=$(cat ~/Desktop/bb-password.txt)

# You'll need to read the URL from the BB dashboard screenshot
# Once you have it, test:
# BB_URL="https://xxxxx.trycloudflare.com"
# curl -s "${BB_URL}/api/v1/server?password=${BB_PASSWORD}" | python3 -m json.tool
```

**Read the tunnel URL from the BlueBubbles dashboard** (it's displayed prominently in the status area). Then test it:

```bash
BB_URL="<paste the URL you see on the dashboard>"
BB_PASSWORD=$(cat ~/Desktop/bb-password.txt)
curl -s "${BB_URL}/api/v1/server?password=${BB_PASSWORD}" | python3 -m json.tool
```

### Step 4.5: Verify

The curl command should return JSON with server info (version, macOS version, etc.). If it does, save the URL:

```bash
echo "$BB_URL" > ~/Desktop/bb-url.txt
echo "Tunnel URL saved to ~/Desktop/bb-url.txt"
```

---

## Phase 5: Keep Mac Running 24/7

### Step 5.1: Prevent Sleep

```bash
# Disable sleep while on power
sudo pmset -c sleep 0
sudo pmset -c disablesleep 1

# Disable display sleep
sudo pmset -c displaysleep 0

# Disable hibernation
sudo pmset -c hibernatemode 0

# Disable Power Nap
sudo pmset -c powernap 0

# Verify
pmset -g
```

**Note**: `sudo` will require the user's macOS password. If prompted, ask the user to enter it or use Touch ID.

### Step 5.2: Auto-Start BlueBubbles on Login

```bash
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/BlueBubbles Server.app", hidden:false}'
```

### Step 5.3: Create Keep-Alive LaunchAgent

```bash
mkdir -p ~/Library/LaunchAgents

cat > ~/Library/LaunchAgents/com.bluebubbles.keepalive.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bluebubbles.keepalive</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-dims</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
PLIST

launchctl load ~/Library/LaunchAgents/com.bluebubbles.keepalive.plist
```

### Step 5.4: Create Auto-Restart LaunchAgent

```bash
cat > ~/Library/LaunchAgents/com.bluebubbles.server.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bluebubbles.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>BlueBubbles Server</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
</dict>
</plist>
PLIST

launchctl load ~/Library/LaunchAgents/com.bluebubbles.server.plist
```

### Step 5.5: Verify

```bash
echo "=== LaunchAgents ==="
launchctl list | grep bluebubbles

echo "=== Power Settings ==="
pmset -g | grep -E "sleep|hibernatemode|powernap"

echo "=== Login Items ==="
osascript -e 'tell application "System Events" to get the name of every login item'
```

All three checks should show BlueBubbles-related entries.

---

## Phase 6: Final Verification (Mac Side)

Run this all-in-one check before handing off:

```bash
echo "========================================"
echo "  BlueBubbles Setup Verification"
echo "========================================"

echo ""
echo "--- App Installed ---"
ls -la "/Applications/BlueBubbles Server.app/Contents/Info.plist" 2>/dev/null && echo "OK: App installed" || echo "FAIL: App not found"

echo ""
echo "--- App Running ---"
pgrep -f "BlueBubbles" > /dev/null && echo "OK: BlueBubbles is running (PID: $(pgrep -f BlueBubbles))" || echo "FAIL: BlueBubbles not running"

echo ""
echo "--- Tunnel URL ---"
BB_URL=$(cat ~/Desktop/bb-url.txt 2>/dev/null)
if [ -n "$BB_URL" ]; then
    echo "OK: $BB_URL"
else
    echo "FAIL: No tunnel URL saved — read it from the BlueBubbles dashboard"
fi

echo ""
echo "--- API Reachable ---"
BB_PASSWORD=$(cat ~/Desktop/bb-password.txt 2>/dev/null)
if [ -n "$BB_URL" ] && [ -n "$BB_PASSWORD" ]; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${BB_URL}/api/v1/server?password=${BB_PASSWORD}" --max-time 10)
    if [ "$RESPONSE" = "200" ]; then
        echo "OK: API responding (HTTP 200)"
    else
        echo "FAIL: API returned HTTP $RESPONSE"
    fi
else
    echo "SKIP: Missing URL or password"
fi

echo ""
echo "--- LaunchAgents ---"
launchctl list | grep -q "com.bluebubbles.keepalive" && echo "OK: keepalive agent loaded" || echo "WARN: keepalive agent not loaded"
launchctl list | grep -q "com.bluebubbles.server" && echo "OK: auto-restart agent loaded" || echo "WARN: auto-restart agent not loaded"

echo ""
echo "--- Sleep Prevention ---"
SLEEP_VAL=$(pmset -g | grep '^ sleep' | awk '{print $2}')
[ "$SLEEP_VAL" = "0" ] && echo "OK: sleep disabled" || echo "WARN: sleep = $SLEEP_VAL (should be 0)"

echo ""
echo "========================================"
echo "  Handoff Values"
echo "========================================"
echo "BB_URL=$BB_URL"
echo "BB_PASSWORD=$BB_PASSWORD"
echo "========================================"
```

**All items should show OK.** If any show FAIL, fix them before proceeding.

---

## Phase 7: Handoff to Claude Code (Railway)

### Step 7.1: Write the Handoff File

```bash
BB_URL=$(cat ~/Desktop/bb-url.txt)
BB_PASSWORD=$(cat ~/Desktop/bb-password.txt)

cat > ~/Desktop/bluebubbles-handoff.json << EOF
{
  "status": "ready",
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "machine": "MacBook Air M1 2020",
  "bluebubbles": {
    "url": "$BB_URL",
    "password": "$BB_PASSWORD",
    "port": 1234,
    "proxy": "cloudflare"
  },
  "notes": {
    "tunnel_stability": "Cloudflare free tunnel URL changes on each BB restart. Consider upgrading to ngrok reserved domain or Cloudflare named tunnel for stability.",
    "mac_kept_alive": true,
    "auto_restart": true
  },
  "next_steps": "Pass this file to the Claude Code session managing the OpenClaw Railway instance. It will configure the BlueBubbles channel, store credentials on Railway, and verify the end-to-end connection."
}
EOF

echo ""
echo "============================================"
echo "  HANDOFF FILE WRITTEN"
echo "============================================"
echo ""
echo "  File: ~/Desktop/bluebubbles-handoff.json"
echo ""
echo "  Tell Joe:"
echo "  'BlueBubbles Server is installed and running"
echo "   on your MacBook Air. The handoff file is on"
echo "   your Desktop. Give these two values to your"
echo "   Claude Code session on Railway:'"
echo ""
echo "    BB_URL=$BB_URL"
echo "    BB_PASSWORD=$BB_PASSWORD"
echo ""
echo "============================================"
```

### Step 7.2: Clean Up Temp Files

```bash
# Remove the plain-text password file (it's now in the handoff JSON)
rm -f ~/Desktop/bb-password.txt ~/Desktop/bb-url.txt
```

### Step 7.3: Tell the User

Report to the user:

> BlueBubbles Server is installed and running on your MacBook Air M1. Here's what was set up:
>
> - BlueBubbles Server installed at `/Applications/BlueBubbles Server.app`
> - Full Disk Access and Accessibility permissions granted
> - Firebase project created and configured
> - Cloudflare tunnel active (URL in handoff file)
> - Sleep prevention configured (`pmset`)
> - Auto-restart on crash (LaunchAgent)
> - Auto-start on login
>
> **Next step**: Open the handoff file on your Desktop (`bluebubbles-handoff.json`) and give the `BB_URL` and `BB_PASSWORD` values to your Claude Code session. It will handle the OpenClaw integration from there.

**CoWork's job is done after this phase.** Do not attempt Phase 8.

---

## Phase 8: OpenClaw Integration (Claude Code — Railway Side)

> **Executor**: Claude Code (running in the Railway/remote environment)
> **Prerequisite**: Receive `BB_URL` and `BB_PASSWORD` from the user (provided by CoWork's handoff)

### Step 8.1: Store Credentials on Railway

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="https://openclaw-production-4e3d.up.railway.app"

# Set as Railway env vars (persistent across deploys)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/env" \
  -d "{\"variables\":{\"BB_URL\":\"${BB_URL}\",\"BB_PASSWORD\":\"${BB_PASSWORD}\"},\"skipDeploys\":true}"
```

### Step 8.2: Configure BlueBubbles Channel in OpenClaw

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/openclaw-cmd" \
  -d "{\"args\":[\"config\",\"set\",\"--json\",\"channels.bluebubbles\",\"{\\\"enabled\\\":true,\\\"url\\\":\\\"${BB_URL}\\\",\\\"password\\\":\\\"${BB_PASSWORD}\\\",\\\"dmPolicy\\\":\\\"pairing\\\"}\"]}"
```

### Step 8.3: Restart Gateway

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" "$BASE/setup/api/restart-gateway"
```

### Step 8.4: Verify End-to-End

```bash
# Wait for gateway to restart
sleep 15

# Check gateway health
curl -s "$BASE/setup/healthz" | python3 -m json.tool

# Run healthcheck diagnostic (if the skill is installed)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/shell" \
  -d "{\"command\":\"BB_URL=${BB_URL} BB_PASSWORD=${BB_PASSWORD} /data/workspace/skills/bluebubbles-healthcheck/scripts/diagnose.sh 2>&1\"}"
```

### Step 8.5: Approve Pairing (if needed)

If OpenClaw uses pairing mode for BlueBubbles DMs, the user sends a test iMessage. OpenClaw generates a pairing code. Approve it:

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/pairing/approve" \
  -d '{"channel":"bluebubbles","code":"THE_PAIRING_CODE"}'
```

---

## Appendix A: Handling Tunnel URL Changes

The free Cloudflare tunnel URL changes every time BlueBubbles restarts. When this happens, the Railway side needs to be updated.

### Option 1: Manual Update (tell Claude Code the new URL)

Give the new `BB_URL` to the Claude Code session. It will run:

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="https://openclaw-production-4e3d.up.railway.app"
NEW_BB_URL="https://NEW-TUNNEL-URL-HERE"
BB_PASSWORD="<existing password>"

# Update Railway env var
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/env" \
  -d "{\"variables\":{\"BB_URL\":\"${NEW_BB_URL}\"},\"skipDeploys\":true}"

# Update OpenClaw channel config
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/openclaw-cmd" \
  -d "{\"args\":[\"config\",\"set\",\"--json\",\"channels.bluebubbles\",\"{\\\"enabled\\\":true,\\\"url\\\":\\\"${NEW_BB_URL}\\\",\\\"password\\\":\\\"${BB_PASSWORD}\\\",\\\"dmPolicy\\\":\\\"pairing\\\"}\"]}"

# Restart gateway
curl -s -X POST -H "Authorization: Basic $AUTH" "$BASE/setup/api/restart-gateway"
```

### Option 2: Ngrok with Reserved Domain (stable URL)

Run on the Mac (CoWork or manually):
1. `brew install ngrok`
2. Sign up at `https://ngrok.com` (free), get auth token
3. `ngrok config add-authtoken YOUR_TOKEN`
4. In BlueBubbles: change proxy service to **"Ngrok"** and enter your auth token
5. The URL becomes stable (e.g., `https://your-subdomain.ngrok-free.app`)

### Option 3: Cloudflare Named Tunnel (requires Cloudflare account + domain)

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel login
cloudflared tunnel create bluebubbles
cloudflared tunnel route dns bluebubbles bb.yourdomain.com
```

Then configure BlueBubbles to use the custom domain.

---

## Appendix B: Troubleshooting

### iMessages not arriving in OpenClaw

1. Check BlueBubbles is running: `pgrep -f BlueBubbles`
2. Check tunnel reachability: `curl -s "${BB_URL}/api/v1/server?password=${BB_PASSWORD}"`
3. Check if tunnel URL changed (compare BB dashboard URL with saved URL)
4. Run healthcheck skill on Railway instance

### "Full Disk Access" not working

```bash
osascript -e 'tell application "BlueBubbles Server" to quit'
sleep 2
# Re-grant in System Settings > Privacy & Security > Full Disk Access
open "/Applications/BlueBubbles Server.app"
```

### Messages database locked

```bash
lsof ~/Library/Messages/chat.db
```

Usually fixed by restarting BlueBubbles or quitting the Messages app.

### Mac went to sleep

```bash
pmset -g
sudo pmset -c sleep 0 && sudo pmset -c disablesleep 1
caffeinate -dims &
```

### BlueBubbles not running after reboot

```bash
launchctl list | grep bluebubbles
# Re-load if needed:
launchctl load ~/Library/LaunchAgents/com.bluebubbles.server.plist
```

---

## Appendix C: Quick Reference

| Item | Value |
|------|-------|
| BlueBubbles App | `/Applications/BlueBubbles Server.app` |
| BB API Port | `1234` |
| BB Config Dir | `~/Library/Application Support/bluebubbles-server/` |
| iMessage DB | `~/Library/Messages/chat.db` |
| Handoff File | `~/Desktop/bluebubbles-handoff.json` |
| OpenClaw Instance | `https://openclaw-production-4e3d.up.railway.app` |
| Healthcheck Skill | `/data/workspace/skills/bluebubbles-healthcheck/` |
| BB Skill | `/data/workspace/skills/bluebubbles/` |
