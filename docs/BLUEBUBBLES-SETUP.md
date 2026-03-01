# BlueBubbles Server Setup Guide (MacBook Air M1)

> **Target machine**: MacBook Air M1 2020, macOS Tahoe 26.2
> **Goal**: Run BlueBubbles Server so OpenClaw (on Railway) can send/receive iMessages
> **Audience**: Claude Code session running on the MacBook

---

## Overview

BlueBubbles Server runs on this Mac and bridges iMessage to OpenClaw via webhooks.
The data flow is:

```
iMessage <-> BlueBubbles Server (this Mac, port 1234)
                    |
            Cloudflare Tunnel (free, auto-configured)
                    |
            OpenClaw Gateway (Railway, port 18789)
```

---

## Phase 1: Install BlueBubbles Server

### Step 1.1: Download

```bash
# Download the latest BlueBubbles Server .dmg
# Check https://github.com/BlueBubblesApp/bluebubbles-server/releases/latest
# As of March 2026, latest is v1.9.9
cd ~/Downloads
curl -L -o BlueBubbles-Server.dmg \
  "https://github.com/BlueBubblesApp/bluebubbles-server/releases/latest/download/BlueBubbles-Server.dmg"
```

If the direct link doesn't work (the app is unsigned, filenames vary), open this URL in Safari instead:
`https://github.com/BlueBubblesApp/bluebubbles-server/releases/latest`

Download the `.dmg` file from the Assets section.

### Step 1.2: Install

```bash
# Mount the DMG
hdiutil attach ~/Downloads/BlueBubbles-Server.dmg

# Copy to Applications
cp -R "/Volumes/BlueBubbles Server/BlueBubbles Server.app" /Applications/

# Eject
hdiutil detach "/Volumes/BlueBubbles Server"
```

### Step 1.3: First Launch (bypassing Gatekeeper)

The app is unsigned. You must right-click > Open (or use `xattr`):

```bash
# Remove quarantine attribute
xattr -cr "/Applications/BlueBubbles Server.app"

# Launch
open "/Applications/BlueBubbles Server.app"
```

If macOS still blocks it: **System Settings > Privacy & Security > scroll down > "Open Anyway"**

---

## Phase 2: macOS Permissions

BlueBubbles needs several permissions. Grant these when prompted, or set them manually:

### Step 2.1: Full Disk Access (REQUIRED)

This is mandatory — BlueBubbles reads the iMessage database at `~/Library/Messages/chat.db`.

```
System Settings > Privacy & Security > Full Disk Access > toggle ON for "BlueBubbles Server"
```

If the app doesn't appear in the list, click the `+` button and navigate to `/Applications/BlueBubbles Server.app`.

### Step 2.2: Accessibility (optional, for Private API)

```
System Settings > Privacy & Security > Accessibility > toggle ON for "BlueBubbles Server"
```

### Step 2.3: Contacts Access (recommended)

When prompted, allow Contacts access so BlueBubbles can resolve contact names.

### Step 2.4: Notifications

Allow notifications when prompted so you can see BlueBubbles status alerts.

---

## Phase 3: Firebase Setup (required for push notifications)

BlueBubbles uses Firebase Cloud Messaging for push notifications to mobile clients.
Even for the OpenClaw webhook integration, Firebase is required for the server to function.

### Step 3.1: Create Firebase Project

1. Go to https://console.firebase.google.com/
2. Click "Create a project" (or "Add project")
3. Project name: `BlueBubblesApp` (or anything you want)
4. **Disable Google Analytics** (not needed)
5. Click "Create project"

### Step 3.2: Create Firestore Database

1. In the Firebase console, click **"Cloud Firestore"** in the left sidebar
2. Click **"Create database"**
3. Start in **test mode** (or production mode — doesn't matter much)
4. Select any region, click **"Enable"**
5. Go to the **Rules** tab and update to:
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
6. Click **"Publish"**

### Step 3.3: Download Service Account Key

1. In Firebase console, click the **gear icon** > **"Project settings"**
2. Go to **"Service accounts"** tab
3. Click **"Generate new private key"** > **"Generate key"**
4. Save the downloaded JSON file (e.g., `firebase-service-account.json`)

### Step 3.4: Create Android App (for google-services.json)

1. In Project settings > **"General"** tab
2. Under "Your apps", click the **Android icon** to add an app
3. Package name: `com.bluebubbles.messaging`
4. Click **"Register app"**
5. Download `google-services.json`
6. Click through the remaining steps (skip them)

### Step 3.5: Load into BlueBubbles

In the BlueBubbles Server setup wizard:
1. Click the **"Manual Setup"** tab (not Google Sign-In)
2. Drag the **service account JSON** into the first field
3. Drag **google-services.json** into the second field
4. Click **Next**

---

## Phase 4: Server Configuration

### Step 4.1: Set Server Password

In the BlueBubbles Server setup wizard:
1. Enter a strong password (this is your API password)
2. Click the save/floppy icon
3. **SAVE THIS PASSWORD** — you'll need it for the OpenClaw config

### Step 4.2: Select Proxy Service

BlueBubbles needs a way for external services (OpenClaw on Railway) to reach it.

**Recommended: Cloudflare** (free, no account needed, auto-configured)
- Select **"Cloudflare"** from the proxy dropdown
- BlueBubbles will auto-create a tunnel
- The tunnel URL will appear in the server status (e.g., `https://xxxxx.trycloudflare.com`)

**Note**: Cloudflare tunnel URLs change on each server restart. For a stable URL, consider:
- **zrok** (free tier, 5GB/day bandwidth, more stable URLs)
- **Ngrok** with a reserved domain (requires free account)

### Step 4.3: Verify Server is Running

After setup completes, the BlueBubbles Server dashboard should show:
- **Status**: Running
- **URL**: Your tunnel URL (e.g., `https://xxxxx.trycloudflare.com`)
- **Port**: 1234

Test the API:
```bash
# Replace with your actual URL and password
BB_URL="https://xxxxx.trycloudflare.com"
BB_PASSWORD="your-password-here"

curl -s "${BB_URL}/api/v1/server?password=${BB_PASSWORD}" | python3 -m json.tool
```

You should see server info (version, macOS version, etc.).

---

## Phase 5: Connect to OpenClaw (Railway)

### Step 5.1: Gather Your Values

You need:
- `BB_URL`: The Cloudflare tunnel URL from BlueBubbles Server dashboard
- `BB_PASSWORD`: The server password you set in Step 4.1
- `SETUP_PASSWORD`: Your OpenClaw Railway instance setup password

### Step 5.2: Store Credentials on Railway

```bash
SETUP_PASSWORD="your-openclaw-setup-password"
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="https://openclaw-production-4e3d.up.railway.app"

BB_URL="https://YOUR-TUNNEL-URL-HERE"
BB_PASSWORD="YOUR-BB-PASSWORD-HERE"

# Set as Railway env vars (persistent across deploys)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/env" \
  -d "{\"variables\":{\"BB_URL\":\"${BB_URL}\",\"BB_PASSWORD\":\"${BB_PASSWORD}\"},\"skipDeploys\":true}"
```

### Step 5.3: Configure BlueBubbles Channel in OpenClaw

```bash
# Add BlueBubbles as a channel
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/openclaw-cmd" \
  -d "{\"args\":[\"config\",\"set\",\"--json\",\"channels.bluebubbles\",\"{\\\"enabled\\\":true,\\\"url\\\":\\\"${BB_URL}\\\",\\\"password\\\":\\\"${BB_PASSWORD}\\\",\\\"dmPolicy\\\":\\\"pairing\\\"}\"]}"
```

### Step 5.4: Restart OpenClaw Gateway

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" "$BASE/setup/api/restart-gateway"
```

### Step 5.5: Verify Connection

```bash
# Wait 15 seconds for gateway restart, then check health
sleep 15
curl -s "$BASE/setup/healthz" | python3 -m json.tool

# Run the bluebubbles-healthcheck skill diagnostic
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/shell" \
  -d "{\"command\":\"BB_URL=${BB_URL} BB_PASSWORD=${BB_PASSWORD} /data/workspace/skills/bluebubbles-healthcheck/scripts/diagnose.sh 2>&1\"}"
```

### Step 5.6: Approve Pairing (if needed)

If OpenClaw uses pairing mode for BlueBubbles DMs, send a test iMessage to yourself.
OpenClaw will generate a pairing code. Approve it:

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/pairing/approve" \
  -d '{"channel":"bluebubbles","code":"THE_PAIRING_CODE"}'
```

---

## Phase 6: Keep Mac Running 24/7

### Step 6.1: Prevent Sleep

```bash
# Disable sleep entirely (while on power)
sudo pmset -c sleep 0
sudo pmset -c disablesleep 1

# Disable display sleep (optional, saves power but may affect some features)
sudo pmset -c displaysleep 0

# Disable hibernation
sudo pmset -c hibernatemode 0

# Verify settings
pmset -g
```

### Step 6.2: Auto-Start BlueBubbles on Login

```bash
# Add BlueBubbles to Login Items via command line
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/BlueBubbles Server.app", hidden:false}'
```

Or manually: **System Settings > General > Login Items > add BlueBubbles Server**

### Step 6.3: Keep-Alive with caffeinate (belt and suspenders)

Create a LaunchAgent to keep the system awake:

```bash
cat > ~/Library/LaunchAgents/com.bluebubbles.keepalive.plist << 'EOF'
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
EOF

launchctl load ~/Library/LaunchAgents/com.bluebubbles.keepalive.plist
```

### Step 6.4: Auto-Restart BlueBubbles if it Crashes

```bash
cat > ~/Library/LaunchAgents/com.bluebubbles.server.plist << 'EOF'
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
EOF

launchctl load ~/Library/LaunchAgents/com.bluebubbles.server.plist
```

---

## Phase 7: Handling Cloudflare Tunnel URL Changes

The free Cloudflare tunnel URL changes every time BlueBubbles restarts.
When this happens, you need to update the OpenClaw config.

### Option A: Manual Update (simplest)

After each BlueBubbles restart, get the new URL from the BB dashboard and run:

```bash
NEW_BB_URL="https://NEW-TUNNEL-URL-HERE"
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="https://openclaw-production-4e3d.up.railway.app"

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

### Option B: Ngrok with Reserved Domain (stable URL, free account)

1. Sign up at https://ngrok.com (free)
2. Get your auth token from the ngrok dashboard
3. Install ngrok: `brew install ngrok`
4. Authenticate: `ngrok config add-authtoken YOUR_TOKEN`
5. In BlueBubbles: change proxy service to **"Ngrok"** and enter your auth token
6. The URL will be stable (e.g., `https://your-subdomain.ngrok-free.app`)

### Option C: Cloudflare Tunnel with Custom Domain (requires Cloudflare account + domain)

If you own a domain on Cloudflare, you can create a persistent tunnel:

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel login
cloudflared tunnel create bluebubbles
cloudflared tunnel route dns bluebubbles bb.yourdomain.com
```

Then configure BB to use your custom domain.

---

## Troubleshooting

### iMessages not arriving in OpenClaw

1. **Check BlueBubbles is running**: Look for the BB icon in the macOS menu bar
2. **Check the tunnel**: `curl -s "${BB_URL}/api/v1/server?password=${BB_PASSWORD}"`
3. **Run healthcheck**: Use the bluebubbles-healthcheck skill on the Railway instance
4. **Check if tunnel URL changed**: Compare BB dashboard URL with what's in OpenClaw config

### "Full Disk Access" not working

1. Quit BlueBubbles completely (Cmd+Q)
2. Re-grant Full Disk Access in System Settings
3. Relaunch BlueBubbles

### Messages database locked

If you see errors about `chat.db` being locked:
```bash
# Check what's using it
lsof ~/Library/Messages/chat.db
```
Usually resolved by restarting BlueBubbles or closing the Messages app.

### Mac went to sleep despite settings

```bash
# Verify power settings
pmset -g

# Force caffeinate in foreground (for testing)
caffeinate -dims &

# Check if Power Nap is interfering
sudo pmset -c powernap 0
```

### BlueBubbles shows "Disconnected" after Mac restart

The LaunchAgent from Phase 6.4 should auto-restart it. If not:
1. Check if the LaunchAgent loaded: `launchctl list | grep bluebubbles`
2. Re-load if needed: `launchctl load ~/Library/LaunchAgents/com.bluebubbles.server.plist`

---

## Quick Reference

| Item | Value |
|------|-------|
| BlueBubbles App | `/Applications/BlueBubbles Server.app` |
| BB API Port | `1234` |
| BB Config Dir | `~/Library/Application Support/bluebubbles-server/` |
| iMessage DB | `~/Library/Messages/chat.db` |
| OpenClaw Instance | `https://openclaw-production-4e3d.up.railway.app` |
| Healthcheck Skill | `/data/workspace/skills/bluebubbles-healthcheck/` |
| BB Skill | `/data/workspace/skills/bluebubbles/` |

## Environment Variables (for scripts)

```bash
export BB_URL="https://YOUR-TUNNEL-URL"
export BB_PASSWORD="YOUR-BB-PASSWORD"
export SETUP_PASSWORD="your-openclaw-setup-password"
export OPENCLAW_WEBHOOK_URL="http://127.0.0.1:18789/bluebubbles-webhook"
```
