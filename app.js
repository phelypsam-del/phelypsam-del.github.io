(() => {
'use strict';
const $ = s => document.querySelector(s);
const LS = {
  get: k => { try { return localStorage.getItem('forge.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem('forge.' + k) : localStorage.setItem('forge.' + k, v); } catch {} },
};
const MODELS = window.ForgeRouter.MODELS;

const state = {
  server: (LS.get('server') || window.FORGE_SERVER || (location.protocol.startsWith('http') && !location.hostname.endsWith('github.io') ? location.origin : '')).replace(/\/+$/, ''),
  token: LS.get('token'),
  chats: [], chat: null, model: LS.get('model') || 'auto',
  busy: false, abort: null, usage: null, filter: '',
};

// ---------------- api ----------------
async function api(path, opts = {}) {
  const r = await fetch(state.server + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}), ...(opts.headers || {}) },
  });
  if (r.status === 401 && path !== '/api/login') { signOut(true); throw new Error('Signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
  return data;
}

// ---------------- helpers ----------------
const fmt$ = n => '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2));
const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2200); }
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
const icons = {
  copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg>',
  retry: '<svg viewBox="0 0 20 20"><path d="M4 10a6 6 0 1 0 2-4.5M4 4v3h3"/></svg>',
  dots: '<svg viewBox="0 0 20 20"><circle cx="5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/></svg>',
};

// ---------------- auth ----------------
function showLogin() {
  $('#app').hidden = true; $('#login').hidden = false;
  $('#serverUrl').value = state.server;
  if (!state.server) $('#serverBox').open = true;
  $('#password').focus();
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const url = $('#serverUrl').value.trim().replace(/\/+$/, '');
  if (url) { state.server = url; LS.set('server', url); }
  if (!state.server) { $('#serverBox').open = true; $('#loginError').textContent = 'Add your server address first.'; return; }
  try {
    const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    state.token = r.token; LS.set('token', r.token);
    $('#password').value = '';
    start();
  } catch (err) {
    $('#loginError').textContent = err.message === 'Failed to fetch' ? "Can't reach your server. Is your PC on and the tunnel running?" : err.message;
  }
});
function signOut(expired) {
  if (!expired) api('/api/logout', { method: 'POST' }).catch(() => {});
  state.token = null; LS.set('token', null);
  showLogin();
  if (expired) $('#loginError').textContent = 'Please sign in again.';
}
$('#logoutBtn').onclick = () => signOut(false);

// ---------------- sidebar ----------------
async function loadChats() { state.chats = await api('/api/chats'); renderChatList(); }
function renderChatList() {
  const list = $('#chatList'); list.innerHTML = '';
  const q = state.filter.toLowerCase();
  const items = state.chats.filter(c => !q || c.title.toLowerCase().includes(q));
  const starred = items.filter(c => c.starred), rest = items.filter(c => !c.starred);
  const group = (title, arr) => {
    if (!arr.length) return;
    const h = document.createElement('h4'); h.textContent = title; list.appendChild(h);
    for (const c of arr) {
      const row = document.createElement('div');
      row.className = 'chat-item' + (state.chat && state.chat.id === c.id ? ' active' : '');
      const a = document.createElement('a'); a.textContent = c.title; a.title = c.title;
      a.onclick = () => openChat(c.id);
      const more = document.createElement('button'); more.className = 'icon-btn more'; more.innerHTML = icons.dots; more.setAttribute('aria-label', 'Chat options');
      more.onclick = e => { e.stopPropagation(); chatMenu(row, c); };
      row.append(a, more); list.appendChild(row);
    }
  };
  group('Starred', starred); group('Recents', rest);
  if (!items.length) list.innerHTML = '<p class="muted small" style="padding:8px 10px">' + (q ? 'No matches' : 'No chats yet') + '</p>';
}
function chatMenu(row, c) {
  closeMenus();
  const m = document.createElement('div'); m.className = 'menu down';
  const add = (label, fn, cls) => { const b = document.createElement('button'); b.innerHTML = '<span class="t ' + (cls || '') + '">' + label + '</span>'; b.onclick = e => { e.stopPropagation(); closeMenus(); fn(); }; m.appendChild(b); };
  add(c.starred ? 'Unstar' : 'Star', async () => { await api('/api/chats/' + c.id, { method: 'PATCH', body: JSON.stringify({ starred: !c.starred }) }); loadChats(); });
  add('Rename', async () => {
    const t = prompt('Rename chat', c.title); if (!t) return;
    await api('/api/chats/' + c.id, { method: 'PATCH', body: JSON.stringify({ title: t }) });
    if (state.chat && state.chat.id === c.id) { state.chat.title = t; $('#chatTitle').textContent = t; }
    loadChats();
  });
  add('Delete', async () => {
    if (!confirm('Delete "' + c.title + '"?')) return;
    await api('/api/chats/' + c.id, { method: 'DELETE' });
    if (state.chat && state.chat.id === c.id) newChat();
    loadChats();
  }, 'danger');
  row.style.position = 'relative'; row.appendChild(m);
}
function closeMenus() { document.querySelectorAll('.chat-item .menu').forEach(m => m.remove()); $('#modelMenu').hidden = true; }
document.addEventListener('click', e => { if (!e.target.closest('.menu') && !e.target.closest('.model-btn')) closeMenus(); });
$('#searchChats').oninput = e => { state.filter = e.target.value; renderChatList(); };
$('#collapseBtn').onclick = () => setSide(false);
$('#openSideBtn').onclick = () => setSide(true);
function setSide(open) { $('#app').classList.toggle('side-closed', !open); LS.set('side', open ? '1' : '0'); }
const isMobile = () => matchMedia('(max-width:760px)').matches;

// ---------------- chats ----------------
function newChat() {
  if (state.busy) return;
  state.chat = null;
  $('#messages').innerHTML = ''; $('#chatTitle').textContent = '';
  $('#greeting').textContent = greeting();
  $('#app').classList.add('is-empty'); $('#empty').hidden = false;
  renderChatList(); $('#input').focus();
  if (isMobile()) setSide(false);
}
$('#newChatBtn').onclick = newChat;

async function openChat(id) {
  if (state.busy) return;
  state.chat = await api('/api/chats/' + id);
  $('#chatTitle').textContent = state.chat.title;
  $('#app').classList.toggle('is-empty', !state.chat.messages.length);
  $('#empty').hidden = !!state.chat.messages.length;
  const box = $('#messages'); box.innerHTML = '';
  for (const m of state.chat.messages) box.appendChild(renderMsg(m));
  renderChatList(); scrollDown(true);
  if (isMobile()) setSide(false);
}

function renderMsg(m) {
  const el = document.createElement('div'); el.className = 'msg ' + m.role; el.dataset.id = m.id;
  if (m.role === 'user') {
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = m.text; el.appendChild(b);
    return el;
  }
  const body = document.createElement('div'); body.className = 'body';
  body.innerHTML = window.renderMarkdown(m.text || '');
  el.appendChild(body);
  if (m.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = m.error; el.appendChild(e); }
  el.appendChild(metaRow(m));
  return el;
}
function metaRow(m) {
  const meta = document.createElement('div'); meta.className = 'meta';
  const info = MODELS[m.model] || { label: m.model };
  const u = m.usage || {};
  meta.innerHTML =
    `<span class="chip m-${m.model}" title="${escAttr(m.reason || '')}${m.modelId ? ' · ' + escAttr(m.modelId) : ''}"><span class="d"></span>${info.label}</span>` +
    `<span title="Why this model">${escHtml(m.reason || '')}</span>` +
    (u.input || u.output ? `<span title="Tokens in / out">${fmtTok(u.input)} in · ${fmtTok(u.output)} out</span>` : '') +
    (u.cost ? `<span title="Taken from your monthly credit">${fmt$(u.cost)}</span>` : '') +
    (u.ms ? `<span>${(u.ms / 1000).toFixed(1)}s</span>` : '') +
    (m.stopped ? '<span>Stopped</span>' : '');
  const copy = document.createElement('button'); copy.innerHTML = icons.copy; copy.title = 'Copy';
  copy.onclick = () => { navigator.clipboard.writeText(m.text || ''); toast('Copied'); };
  meta.appendChild(copy);
  const last = state.chat && state.chat.messages[state.chat.messages.length - 1];
  if (last && last.id === m.id) {
    const retry = document.createElement('button'); retry.innerHTML = icons.retry; retry.title = 'Ask again';
    retry.onclick = () => {
      const prevUser = [...state.chat.messages].reverse().find(x => x.role === 'user');
      if (prevUser) send(prevUser.text);
    };
    meta.appendChild(retry);
  }
  return meta;
}
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escAttr = escHtml;

$('#messages').addEventListener('click', e => {
  const b = e.target.closest('.copy-code'); if (!b) return;
  navigator.clipboard.writeText(b.closest('.code').querySelector('code').textContent);
  b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1500);
});

let stick = true;
$('#scroller').addEventListener('scroll', () => { const s = $('#scroller'); stick = s.scrollHeight - s.scrollTop - s.clientHeight < 80; });
function scrollDown(force) { const s = $('#scroller'); if (force || stick) s.scrollTop = s.scrollHeight; }

// ---------------- model picker ----------------
function renderModelMenu() {
  const menu = $('#modelMenu'); menu.innerHTML = '';
  const opts = [['auto', 'Auto', 'Picks Haiku, Sonnet or Opus for each message to save your credit']]
    .concat(Object.entries(MODELS).map(([k, v]) => [k, v.label, v.blurb]));
  for (const [k, t, s] of opts) {
    const b = document.createElement('button'); if (k === state.model) b.className = 'sel';
    b.innerHTML = `<div><div class="t">${t}</div><div class="s">${s}</div></div><span class="check">✓</span>`;
    b.onclick = () => { state.model = k; LS.set('model', k); updateModelLabel(); closeMenus(); updateHint(); $('#input').focus(); };
    menu.appendChild(b);
  }
}
function updateModelLabel() { $('#modelLabel').textContent = state.model === 'auto' ? 'Auto' : MODELS[state.model].label; }
$('#modelBtn').onclick = e => { e.stopPropagation(); const m = $('#modelMenu'); if (m.hidden) { renderModelMenu(); m.hidden = false; } else m.hidden = true; };

function updateHint() {
  const t = $('#input').value.trim();
  $('#sendBtn').disabled = !t && !state.busy;
  if (state.busy) return;
  if (!t || state.model !== 'auto') { $('#routeHint').textContent = ''; return; }
  const r = window.ForgeRouter.routeModel(t, state.chat ? state.chat.messages : []);
  $('#routeHint').textContent = '→ ' + MODELS[r.model].label + ' · ' + r.reason;
}

// ---------------- composer ----------------
const input = $('#input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, innerHeight * 0.4) + 'px'; }
input.addEventListener('input', () => { autosize(); updateHint(); });
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()) { e.preventDefault(); $('#composer').requestSubmit(); }
});
$('#composer').addEventListener('submit', e => {
  e.preventDefault();
  if (state.busy) { stop(); return; }
  const t = input.value.trim(); if (!t) return;
  input.value = ''; autosize(); send(t);
});
function setBusy(b) {
  state.busy = b;
  $('#sendBtn').classList.toggle('stop', b);
  $('#sendBtn').setAttribute('aria-label', b ? 'Stop' : 'Send');
  if (!b) updateHint(); else $('#sendBtn').disabled = false;
}
function stop() {
  if (state.chat) api('/api/chats/' + state.chat.id + '/stop', { method: 'POST' }).catch(() => {});
  if (state.abort) state.abort.abort();
}

async function send(text) {
  if (state.busy) return;
  setBusy(true); $('#routeHint').textContent = '';
  try {
    if (!state.chat) {
      state.chat = await api('/api/chats', { method: 'POST' });
      $('#app').classList.remove('is-empty'); $('#empty').hidden = true;
    }
    const chat = state.chat;
    const box = $('#messages');
    const tempUser = renderMsg({ id: 'tmp', role: 'user', text });
    box.appendChild(tempUser);
    const live = document.createElement('div'); live.className = 'msg assistant';
    live.innerHTML = '<div class="status"><span class="spark"></span><span class="st">Thinking…</span></div><div class="body"></div>';
    box.appendChild(live); scrollDown(true);
    const body = live.querySelector('.body'), status = live.querySelector('.status');

    state.abort = new AbortController();
    const r = await fetch(state.server + '/api/chats/' + chat.id + '/send', {
      method: 'POST', signal: state.abort.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ text, model: state.model }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { signOut(true); return; }
      throw new Error(d.error || 'Error ' + r.status);
    }
    const reader = r.body.getReader(); const dec = new TextDecoder();
    let buf = '', answer = '', raf = 0;
    const paint = () => { raf = 0; body.innerHTML = window.renderMarkdown(answer); body.classList.add('caret'); scrollDown(); };
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (chunk.match(/^event: (.*)$/m) || [])[1];
        const data = JSON.parse((chunk.match(/^data: (.*)$/m) || [, '{}'])[1]);
        if (ev === 'route') {
          tempUser.dataset.id = data.userMsg.id;
          chat.messages.push(data.userMsg);
          status.querySelector('.st').textContent = data.label + ' is thinking…';
          if (chat.title === 'New chat') { chat.title = text.replace(/\s+/g, ' ').slice(0, 48); $('#chatTitle').textContent = chat.title; loadChats(); }
        } else if (ev === 'status') {
          status.hidden = false; status.querySelector('.st').textContent = data.text;
        } else if (ev === 'delta') {
          status.hidden = true; answer += data.text; if (!raf) raf = requestAnimationFrame(paint);
        } else if (ev === 'done') {
          chat.messages.push(data.message);
          live.replaceWith(renderMsg(data.message));
          // only the newest answer keeps the retry button
          box.querySelectorAll('.msg.assistant').forEach(el => { if (el.dataset.id !== data.message.id) { const rb = el.querySelector('.meta button[title="Ask again"]'); if (rb) rb.remove(); } });
          setUsage(data.usage); scrollDown();
        }
      }
    }
    if (live.isConnected) live.remove(); // ended without "done"
  } catch (err) {
    if (err.name !== 'AbortError') {
      const e = document.createElement('div'); e.className = 'msg assistant';
      e.innerHTML = '<div class="err"></div>';
      e.firstChild.textContent = err.message === 'Failed to fetch' ? "Can't reach your server. Is your PC on and the tunnel running?" : err.message;
      $('#messages').appendChild(e); scrollDown(true);
    }
    document.querySelectorAll('.msg.assistant .status').forEach(s => s.closest('.msg').remove());
    if (state.chat) openChat(state.chat.id).catch(() => {});
  } finally {
    state.abort = null; setBusy(false); input.focus();
  }
}

// ---------------- usage ----------------
async function refreshUsage() { try { setUsage(await api('/api/usage')); } catch {} }
function levelColor(p) { return p >= 90 ? 'var(--bad)' : p >= 70 ? 'var(--warn)' : 'var(--ok)'; }
function setUsage(u) {
  if (!u) return; state.usage = u;
  const p = u.percent, left = Math.max(0, u.credit - u.month.cost);
  $('#miniBar').style.width = p + '%'; $('#miniBar').style.background = levelColor(p);
  $('#miniPct').textContent = Math.round(p) + '% used';
  $('#miniLeft').textContent = fmt$(left) + ' left';
  $('#miniToday').textContent = 'Today ' + fmt$(u.today.cost);
  $('#pillText').textContent = fmt$(left) + ' left';
  document.querySelector('.usage-pill .dot').style.background = levelColor(p);
  if (!$('#usagePanel').hidden) renderUsage();
}
function renderUsage() {
  const u = state.usage; if (!u) return;
  const left = Math.max(0, u.credit - u.month.cost);
  const monthName = new Date().toLocaleString(undefined, { month: 'long' });
  const byModel = Object.entries(u.month.byModel).sort((a, b) => b[1].cost - a[1].cost);
  const maxM = Math.max(0.0001, ...byModel.map(([, v]) => v.cost));
  const now = new Date(), y = now.getFullYear(), mo = String(now.getMonth() + 1).padStart(2, '0');
  const dayVals = Array.from({ length: u.daysInMonth }, (_, i) => u.daily[`${y}-${mo}-${String(i + 1).padStart(2, '0')}`] || 0);
  const maxD = Math.max(0.0001, ...dayVals);
  const avg = u.month.messages ? u.month.cost / u.month.messages : 0;
  const msgsLeft = avg ? Math.floor(left / avg) : null;
  let forecast;
  if (!u.month.messages) forecast = 'No usage yet this month.';
  else if (u.runsOutDay) forecast = `At this pace you'll run out around <b>${monthName} ${u.runsOutDay}</b>.`;
  else forecast = `At this pace you'll use about <b>${fmt$(u.projected)}</b> of ${fmt$(u.credit)} this month. You're fine.`;

  $('#usageBody').innerHTML = `
    <div class="big-num">${fmt$(left)} <span class="muted" style="font-size:16px">left of ${fmt$(u.credit)}</span></div>
    <div class="bar big-bar"><i style="width:${u.percent}%;background:${levelColor(u.percent)}"></i></div>
    <div class="muted small">${monthName} credit · resets on the 1st · ${forecast}</div>
    <div class="stats">
      <div class="stat"><div class="k">Today</div><div class="v">${fmt$(u.today.cost)}</div><div class="muted small">${u.today.messages} msgs</div></div>
      <div class="stat"><div class="k">This month</div><div class="v">${fmt$(u.month.cost)}</div><div class="muted small">${u.month.messages} msgs</div></div>
      <div class="stat"><div class="k">Avg / message</div><div class="v">${fmt$(avg)}</div><div class="muted small">${msgsLeft != null ? '≈ ' + msgsLeft + ' left' : '—'}</div></div>
    </div>
    <div class="sec">By model</div>
    ${byModel.length ? byModel.map(([k, v]) => `
      <div class="model-row"><span>${(MODELS[k] || { label: k }).label}</span><div class="bar"><i style="width:${(v.cost / maxM) * 100}%"></i></div><span class="muted" style="text-align:right">${fmt$(v.cost)}</span></div>`).join('') : '<p class="muted small">Nothing yet.</p>'}
    <div class="sec">Daily spend</div>
    <div class="days">${dayVals.map((v, i) => `<i class="${i + 1 === u.dayOfMonth ? 'today' : ''}" style="height:${(v / maxD) * 100}%" title="${monthName} ${i + 1}: ${fmt$(v)}"></i>`).join('')}</div>
    <div class="note">
      This counts what Forge has used from your plan's monthly Claude Code credit${u.hardStop ? ', and Forge stops itself at 100% so nothing is charged as extra usage' : ''}.
      Other <code>claude -p</code> use on your account draws from the same credit, so
      <a href="https://claude.ai/settings/usage" target="_blank" rel="noopener">claude.ai/settings/usage</a> is the official number. Keep "extra usage" off there to make sure you never pay more.
    </div>`;
}
const openUsage = () => { renderUsage(); $('#usagePanel').hidden = false; refreshUsage(); };
$('#usageMini').onclick = openUsage; $('#usagePill').onclick = openUsage;
$('#closeUsage').onclick = () => $('#usagePanel').hidden = true;
$('#usagePanel').onclick = e => { if (e.target.id === 'usagePanel') $('#usagePanel').hidden = true; };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#usagePanel').hidden = true; closeMenus(); }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
});

// ---------------- start ----------------
async function start() {
  $('#login').hidden = true; $('#app').hidden = false;
  if (LS.get('side') === '0' || isMobile()) setSide(false);
  updateModelLabel();
  try {
    const me = await api('/api/me');
    document.title = me.name; $('#brandName').textContent = me.name;
  } catch (e) { if (!state.token) return; }
  newChat();
  await Promise.all([loadChats(), refreshUsage()]).catch(() => {});
  setInterval(refreshUsage, 60000);
}
if (state.token && state.server) start(); else showLogin();
})();
