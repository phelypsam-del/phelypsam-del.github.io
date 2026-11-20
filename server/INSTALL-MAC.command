#!/bin/sh
cd "$(dirname "$0")"
echo "\n ===== Forge setup =====\n"
command -v brew >/dev/null || { echo "Install Homebrew first from https://brew.sh, then run this again."; exit 1; }
command -v node >/dev/null || brew install node
command -v cloudflared >/dev/null || brew install cloudflared
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code
echo "\nClaude Code opens next. Sign in with your CLAUDE ACCOUNT (not an API key),"
echo "then type /exit and press Enter."
printf "Press Enter to continue..."; read _
claude
[ -f config.json ] || node setup.js
echo "\nAll set! From now on just run start.sh. Starting Forge now...\n"
sh ./start.sh
