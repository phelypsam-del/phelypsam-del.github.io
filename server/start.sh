#!/bin/sh
cd "$(dirname "$0")"
[ -f config.json ] || node setup.js
cloudflared tunnel --url http://localhost:8787 &
node server.js
