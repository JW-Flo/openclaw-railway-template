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

exec gosu openclaw node src/server.js
