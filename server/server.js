// Forge backend — runs on YOUR computer, drives the official Claude Code CLI
// (`claude -p`) signed in with your own subscription. Zero npm dependencies.
//
//   node setup.js      (once: set your password + monthly credit)
//   node server.js     (start the server)
//
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { routeModel, MODELS } = require('../router.js');

const DIR = __dirname;
const DATA = path.join(DIR, 'data');
const WORKSPACE = path.join(DIR, 'workspace');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(WORKSPACE, { recursive: true });

const CONFIG_FILE = path.join(DIR, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\n  No config.json yet. Run:  node setup.js\n');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = Number(process.env.PORT || config.port || 8787);
const CLAUDE_BIN = process.env.CLAUDE_BIN || config.claudeBin || 'claude';

// ---------- tiny JSON store ----------
function load(name, fallback) {
  const f = path.join(DATA, name);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
}
function save(name, obj) {
  const f = path.join(DATA, name);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);
}
let chats = load('chats.json', {});       // id -> chat
let usage = load('usage.json', { events: [] }); // usage log
let sessions = load('sessions.json', {}); // token -> {exp}

// ---------- auth ----------
const SESSION_DAYS = 30;
const attempts = new Map(); // ip -> {count, until}

function checkPassword(pw) {
  const { salt, hash } = config.password;
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function newSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { exp: Date.now() + SESSION_DAYS * 864e5 };
  save('sessions.json', sessions);
  return token;
}
function authed(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = token && sessions[token];
  if (!s) return false;
  if (s.exp < Date.now()) { delete sessions[token]; save('sessions.json', sessions); return false; }
  return true;
}
function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
}

// ---------- usage ----------
function monthKey(t = Date.now()) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function dayKey(t = Date.now()) { const d = new Date(t); return monthKey(t) + '-' + String(d.getDate()).padStart(2, '0'); }

function usageSummary() {
  const mk = monthKey(), dk = dayKey();
  const month = { cost: 0, input: 0, output: 0, messages: 0, byModel: {} };
  const today = { cost: 0, input: 0, output: 0, messages: 0 };
  const daily = {};
  for (const e of usage.events) {
    if (monthKey(e.t) !== mk) continue;
    month.cost += e.cost; month.input += e.input; month.output += e.output; month.messages++;
    const m = month.byModel[e.model] || (month.byModel[e.model] = { cost: 0, messages: 0 });
    m.cost += e.cost; m.messages++;
    const d = dayKey(e.t);
    daily[d] = (daily[d] || 0) + e.cost;
    if (d === dk) { today.cost += e.cost; today.input += e.input; today.output += e.output; today.messages++; }
  }
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const credit = Number(config.monthlyCredit) || 20;
  const pace = month.cost / dayOfMonth;                 // $/day so far
  const projected = pace * daysInMonth;
  const runsOutDay = pace > 0 ? Math.floor(credit / pace) + 1 : null;
  return {
    credit, hardStop: config.hardStop !== false, month, today, daily,
    daysInMonth, dayOfMonth, projected,
    runsOutDay: runsOutDay && runsOutDay <= daysInMonth ? runsOutDay : null,
    percent: Math.min(100, (month.cost / credit) * 100),
  };
}
function recordUsage(e) {
  usage.events.push(e);
  // keep ~13 months of events
  const cutoff = Date.now() - 400 * 864e5;
  if (usage.events.length > 5000) usage.events = usage.events.filter(x => x.t > cutoff);
  save('usage.json', usage);
}

// ---------- http helpers ----------
function cors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = (config.allowedOrigins || []).concat(['http://localhost:' + PORT, 'http://127.0.0.1:' + PORT]);
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const id = () => crypto.randomBytes(8).toString('hex');

// ---------- claude -p ----------
const running = new Map(); // chatId -> child

// Chat mode: no file/shell tools, so nobody with the password can touch your PC.
// Web search/fetch stay on so it can look things up like Claude does.
const BLOCKED_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'Task', 'KillShell', 'BashOutput'];

function runClaude({ prompt, model, resume, system }, onEvent) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', model, '--max-turns', String(config.maxTurns || 8)];
  if (resume) args.push('--resume', resume);
  if (system) args.push('--append-system-prompt', system);
  args.push('--disallowedTools', BLOCKED_TOOLS.join(','));

  const env = { ...process.env };
  // Never let an API key sneak in — this must run on the subscription login only.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const child = spawn(CLAUDE_BIN, args, { cwd: WORKSPACE, env, shell: process.platform === 'win32' });
  child.stdin.end(prompt);
  let buf = '', errText = '';
  child.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line)); } catch { /* ignore non-json */ }
    }
  });
  child.stderr.on('data', d => { errText += d.toString(); });
  return { child, errText: () => errText };
}

async function handleSend(req, res, chatId) {
  const chat = chats[chatId];
  if (!chat) return json(res, 404, { error: 'No such chat' });
  if (running.has(chatId)) return json(res, 409, { error: 'Already answering' });
  const body = await readBody(req);
  const text = String(body.text || '').trim();
  if (!text) return json(res, 400, { error: 'Empty message' });

  const sum = usageSummary();
  if (sum.hardStop && sum.month.cost >= sum.credit) {
    return json(res, 402, { error: `Monthly credit of $${sum.credit.toFixed(2)} used up — stopping so nothing gets billed as extra usage. Change it in config.json if your plan's credit is bigger.` });
  }

  const choice = body.model || 'auto';
  const route = choice === 'auto'
    ? routeModel(text, chat.messages)
    : { model: choice, reason: 'Picked by you' };

  const userMsg = { id: id(), role: 'user', text, t: Date.now() };
  chat.messages.push(userMsg);
  if (chat.title === 'New chat') chat.title = text.replace(/\s+/g, ' ').slice(0, 48);
  chat.updated = Date.now();
  save('chats.json', chats);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  send('route', { ...route, label: MODELS[route.model].label, userMsg });

  let answer = '', result = null, modelUsed = null;
  const { child, errText } = runClaude({
    prompt: text, model: route.model, resume: chat.sessionId,
    system: config.systemPrompt || '',
  }, ev => {
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.session_id) chat.sessionId = ev.session_id;
      if (ev.model) modelUsed = ev.model;
    } else if (ev.type === 'stream_event' && ev.event) {
      const e = ev.event;
      if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
        answer += e.delta.text; send('delta', { text: e.delta.text });
      } else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'server_tool_use') {
        send('status', { text: e.content_block.name === 'web_search' ? 'Searching the web…' : 'Using ' + e.content_block.name + '…' });
      } else if (e.type === 'message_start' && answer && !answer.endsWith('\n\n')) {
        // new assistant turn after a tool call — separate paragraphs
        answer += '\n\n'; send('delta', { text: '\n\n' });
      }
    } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const c of ev.message.content) if (c.type === 'tool_use') send('status', { text: 'Using ' + c.name + '…' });
    } else if (ev.type === 'result') {
      result = ev;
      if (ev.session_id) chat.sessionId = ev.session_id;
    }
  });
  running.set(chatId, child);

  let aborted = false;
  req.on('close', () => { if (!res.writableEnded) { aborted = true; child.kill(); } });

  child.on('close', code => {
    running.delete(chatId);
    const u = (result && result.usage) || {};
    const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const output = u.output_tokens || 0;
    const cost = Number((result && result.total_cost_usd) || 0);
    if (!answer && result && typeof result.result === 'string') answer = result.result;

    let error = null;
    if (!result && !aborted) {
      const err = errText().trim();
      error = err ? err.split('\n').slice(-3).join(' ') : `Claude Code exited (code ${code}). Is it installed and logged in? Try running "claude" in a terminal.`;
    } else if (result && result.is_error) {
      error = typeof result.result === 'string' ? result.result : 'Claude Code reported an error.';
    }

    const msg = {
      id: id(), role: 'assistant', text: answer, t: Date.now(),
      model: route.model, modelId: modelUsed, reason: route.reason,
      usage: { input, output, cost, ms: result ? result.duration_ms : null },
      stopped: aborted || undefined, error: error || undefined,
    };
    if (answer || error) chat.messages.push(msg);
    chat.updated = Date.now();
    save('chats.json', chats);
    if (cost || input || output) recordUsage({ t: Date.now(), chat: chatId, model: route.model, input, output, cost });

    if (!res.writableEnded) {
      send('done', { message: msg, usage: usageSummary() });
      res.end();
    }
  });
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // Serve the website locally too (handy when testing on the same PC)
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      const siteDir = path.join(DIR, '..');
      const file = path.normalize(path.join(siteDir, p === '/' ? 'index.html' : p));
      const rel = path.relative(siteDir, file);
      if (rel.startsWith('..') || rel.split(path.sep).some(x => x.startsWith('.') || x === 'server') || !file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
      return fs.createReadStream(file).pipe(res);
    }

    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      const a = attempts.get(ip) || { count: 0, until: 0 };
      if (a.until > Date.now()) return json(res, 429, { error: `Too many tries. Wait ${Math.ceil((a.until - Date.now()) / 60000)} min.` });
      const body = await readBody(req, 1e4);
      await new Promise(r => setTimeout(r, 400)); // slow brute force
      if (!checkPassword(body.password || '')) {
        a.count++; if (a.count >= 5) { a.until = Date.now() + 15 * 60000; a.count = 0; }
        attempts.set(ip, a);
        return json(res, 401, { error: 'Wrong password' });
      }
      attempts.delete(ip);
      return json(res, 200, { token: newSession(), name: config.name || 'Forge' });
    }

    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    if (!authed(req)) return json(res, 401, { error: 'Sign in required' });

    if (p === '/api/logout' && req.method === 'POST') {
      const t = (req.headers.authorization || '').slice(7); delete sessions[t]; save('sessions.json', sessions);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/me') return json(res, 200, { name: config.name || 'Forge', models: MODELS });
    if (p === '/api/usage') return json(res, 200, usageSummary());

    if (p === '/api/chats' && req.method === 'GET') {
      const list = Object.values(chats).sort((a, b) => b.updated - a.updated)
        .map(c => ({ id: c.id, title: c.title, updated: c.updated, starred: !!c.starred }));
      return json(res, 200, list);
    }
    if (p === '/api/chats' && req.method === 'POST') {
      const c = { id: id(), title: 'New chat', created: Date.now(), updated: Date.now(), messages: [], sessionId: null };
      chats[c.id] = c; save('chats.json', chats);
      return json(res, 200, c);
    }
    const m = p.match(/^\/api\/chats\/([a-f0-9]+)(\/(send|stop))?$/);
    if (m) {
      const cid = m[1], action = m[3];
      if (action === 'send' && req.method === 'POST') return handleSend(req, res, cid);
      if (action === 'stop' && req.method === 'POST') { const ch = running.get(cid); if (ch) ch.kill(); return json(res, 200, { ok: true }); }
      const c = chats[cid];
      if (!c) return json(res, 404, { error: 'No such chat' });
      if (req.method === 'GET') return json(res, 200, c);
      if (req.method === 'PATCH') {
        const b = await readBody(req, 1e4);
        if (typeof b.title === 'string') c.title = b.title.slice(0, 80);
        if (typeof b.starred === 'boolean') c.starred = b.starred;
        save('chats.json', chats); return json(res, 200, c);
      }
      if (req.method === 'DELETE') { delete chats[cid]; save('chats.json', chats); return json(res, 200, { ok: true }); }
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Forge backend running on http://localhost:${PORT}`);
  console.log(`  Open it here, or point your GitHub Pages site at your tunnel URL.\n`);
});
