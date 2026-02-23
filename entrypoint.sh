#!/bin/bash
set -e

mkdir -p /data/.openclaw/credentials /data/workspace
chown -R openclaw:openclaw /data
chmod 700 /data /data/.openclaw

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

# Auto-bootstrap workspace templates (only copy if file doesn't already exist)
if [ -d /app/workspace-templates ]; then
  for tmpl in /app/workspace-templates/*.md; do
    fname=$(basename "$tmpl")
    target="/data/workspace/$fname"
    if [ ! -f "$target" ]; then
      echo "[entrypoint] bootstrapping workspace template: $fname"
      cp "$tmpl" "$target"
      chown openclaw:openclaw "$target"
    fi
  done
fi

# Configure git with GH_PAT if available
if [ -n "$GH_PAT" ]; then
  gosu openclaw git config --global credential.helper store
  echo "https://x-access-token:${GH_PAT}@github.com" > /home/openclaw/.git-credentials
  chown openclaw:openclaw /home/openclaw/.git-credentials
  chmod 600 /home/openclaw/.git-credentials
  echo "[entrypoint] GitHub credentials configured"
fi

exec gosu openclaw node src/server.js
