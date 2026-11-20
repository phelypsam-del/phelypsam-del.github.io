@echo off
title Forge setup
cd /d "%~dp0"
echo.
echo  ===== Forge setup =====
echo.

where node >nul 2>nul || (
  echo  Installing Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo  Node.js installed. Close this window and double-click INSTALL-WINDOWS.bat again.
  pause & exit /b
)

where cloudflared >nul 2>nul || (
  echo  Installing Cloudflare tunnel...
  winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
)

where claude >nul 2>nul || (
  echo  Installing Claude Code...
  call npm install -g @anthropic-ai/claude-code
)

echo.
echo  Next, Claude Code opens. Sign in with your CLAUDE ACCOUNT (your subscription),
echo  not an API key. When it says you're signed in, type /exit and press Enter.
echo.
pause
call claude

echo.
if not exist config.json node setup.js

echo.
echo  All set! From now on just double-click start.bat.
echo  Starting Forge now...
echo.
call start.bat
