@echo off
cd /d "%~dp0"
if not exist config.json node setup.js
start "Forge tunnel" cloudflared tunnel --url http://localhost:8787
node server.js
pause
