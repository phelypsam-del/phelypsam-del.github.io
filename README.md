# Forge: a private Claude chat site

Forge is a personal chat site with a Claude-style layout. It runs on **your own Claude subscription** through the official Claude Code CLI (`claude -p`), and it doesn't need an API key.

```
GitHub Pages (site files)  ──HTTPS──▶  Cloudflare Tunnel  ──▶  your PC: server/ ──▶ claude -p (signed in with your plan)
     the website                                         password check, chats, usage
```

## Features
- **Password sign-in**, checked on your PC. The password is stored as a scrypt hash, sign-ins last 30 days, and 5 wrong tries locks sign-in for 15 minutes.
- **Auto model routing.** Simple chats and planning go to **Haiku 5.5**, normal work to **Sonnet 5.5**, and big builds, hard bugs and long inputs to **Opus 5.5**. A follow-up stays on the model the chat was already using. The composer shows which model a message will go to and why *before* you send it, and you can override it with the model menu.
- **Usage tracking.** Every answer shows its model, tokens, cost and time. The sidebar meter and the top pill show credit left. The usage panel shows today, this month, average cost per message, roughly how many messages you have left, spend by model, a daily chart, and the date you'll run out at your current pace.
- **Hard stop at 100% of your monthly credit**, so nothing can spill into paid "extra usage".
- Chats are saved on your PC, so they're the same on your phone and computer. You can search, star, rename and delete chats, use **Stop** and **Ask again**, copy messages and code blocks, and use it on mobile or in dark mode.

## How it uses your subscription
Since June 15, 2026, every Claude plan includes a monthly credit for programmatic Claude Code use (`claude -p` and the Agent SDK). Pro gets $20, Max 5x gets $100 and Max 20x gets $200. Forge spends only that credit. **Go to claude.ai/settings/usage and keep "Extra usage" turned OFF.** Then Claude itself can't charge you more, even if something goes wrong.

The server also deletes `ANTHROPIC_API_KEY` from its environment, so it can only ever run on your subscription sign-in.

For safety, Claude can't touch your PC from the site: Bash, file reading and file editing are turned off in Forge. It can still search the web.

---

## Setup (one time, about 15 minutes)

### 1. On your PC
1. Install **Node.js 18+** from nodejs.org.
2. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
3. Run `claude` once and **sign in with your Claude account** (not an API key). Then type `/exit`.
4. Install **cloudflared** (Cloudflare's tunnel tool).
   - Windows: `winget install --id Cloudflare.cloudflared`
   - Mac: `brew install cloudflared`
5. In the `server` folder run: `node setup.js`. Pick a password with 12+ characters and enter your plan's monthly credit.

### 2. Start it
- Windows: double-click `server/start.bat`
- Mac/Linux: `./server/start.sh`

The tunnel window prints a URL like `https://something-random.trycloudflare.com`. That URL is your **server address**.

> Quick tunnels get a new URL each time they start. For a URL that never changes, set up a named tunnel (`cloudflared tunnel login`, then `cloudflared tunnel create forge`, then route a hostname from a domain you have on Cloudflare). Then put that URL in `config.js`.

### 3. Put the site on GitHub Pages
These files go in your `phelypsam-del.github.io` repo. `.gitignore` already keeps your password hash and chats **out** of GitHub.
Open `https://phelypsam-del.github.io/`, click **Server address**, paste your tunnel URL, and sign in.

Your PC has to be on with `start.bat` running for the site to answer. You can also open `http://localhost:8787` straight on the PC.

## Settings (`server/config.json`)
| Key | What it does |
|---|---|
| `monthlyCredit` | Your plan's monthly credit in $ (used for the meter and the hard stop) |
| `hardStop` | `true` = refuse new messages once the credit is used up |
| `maxTurns` | Max tool rounds per answer (web search etc.) |
| `systemPrompt` | Extra instructions added to every chat |
| `name` | The site name shown in the app |
| `allowedOrigins` | Websites allowed to talk to your server (your GitHub Pages URL) |

To change your password, run `node setup.js` again. That signs out every device.

## Tuning the model picker
Edit `router.js`. It's a plain list of patterns, and the site and server both use it.
