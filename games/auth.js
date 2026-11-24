// Hammerfall Games: Google sign-in (Firebase Authentication) + per-player save data (Cloud Firestore).
// Shared by the games homepage and every game. Each player's data lives in players/{their uid}.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
export const state = { ready: false, configured: !!firebaseConfig, user: null, error: null };
const listeners = new Set();
let auth = null, db = null, fb = {};

export function onAuth(cb) { listeners.add(cb); cb(state); return () => listeners.delete(cb); }
function emit() { listeners.forEach(cb => { try { cb(state); } catch (e) { console.error(e); } }); }

async function init() {
  if (!firebaseConfig) { state.ready = true; emit(); return; }
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
    fb = { ...authMod, ...fsMod };
    const app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    await authMod.setPersistence(auth, authMod.browserLocalPersistence);
    authMod.getRedirectResult(auth).catch(() => {});
    authMod.onAuthStateChanged(auth, u => {
      state.user = u ? { uid: u.uid, name: u.displayName || 'Player', photo: u.photoURL || '', email: u.email || '' } : null;
      state.ready = true; state.error = null; emit();
    });
  } catch (e) {
    // usually: offline, or the Firebase scripts were blocked
    state.ready = true; state.error = navigator.onLine === false ? 'offline' : 'unavailable'; emit();
  }
}

export async function signIn() {
  if (!state.configured) return 'not-configured';
  if (!auth) return state.error || 'unavailable';
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await fb.signInWithPopup(auth, provider); return 'ok'; }
  catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-environment') {
      await fb.signInWithRedirect(auth, provider); return 'redirect';
    }
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return 'cancelled';
    if (e.code === 'auth/unauthorized-domain') return 'unauthorized-domain';
    console.error(e); return 'error';
  }
}
export async function signOut() { if (auth) await fb.signOut(auth); }

const ref = () => fb.doc(db, 'players', state.user.uid);
export async function loadPlayer() {
  if (!state.user || !db) return null;
  const snap = await fb.getDoc(ref());
  return snap.exists() ? snap.data() : null;
}
export async function savePlayer(data) {
  if (!state.user || !db) return;
  await fb.setDoc(ref(), { ...data, name: state.user.name, updatedAt: fb.serverTimestamp() }, { merge: true });
}
// Record a finished chess game: new rating + win/loss/draw counters.
export async function recordChessGame({ rating, score }) {
  if (!state.user || !db) return;
  const inc = fb.increment(1);
  const result = score === 1 ? { 'chess.wins': inc } : score === 0 ? { 'chess.losses': inc } : { 'chess.draws': inc };
  await fb.updateDoc(ref(), { 'chess.rating': rating, 'chess.games': inc, ...result, updatedAt: fb.serverTimestamp() })
    .catch(() => savePlayer({ chess: { rating, games: 1, wins: score === 1 ? 1 : 0, losses: score === 0 ? 1 : 0, draws: score === .5 ? 1 : 0 } }));
}

// Public leaderboard: leaderboard/{uid} holds only a display name, photo, rating and counts.
const shortName = n => { const p = String(n || 'Player').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };
export async function publishLeaderboard({ rating, games, crowns }) {
  if (!state.user || !db) return;
  await fb.setDoc(fb.doc(db, 'leaderboard', state.user.uid), {
    name: shortName(state.user.name), photo: state.user.photo || '', rating, games: games || 0, crowns: crowns || 0,
    updatedAt: fb.serverTimestamp() }, { merge: true });
}
export async function fetchLeaderboard(n = 50) {
  if (!db) throw new Error(state.error || 'not-ready');
  const q = fb.query(fb.collection(db, 'leaderboard'), fb.orderBy('rating', 'desc'), fb.limit(n));
  const snap = await fb.getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// ---------- shared account button (homepage + games) ----------
const G_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const CSS = `
.hf-acct{position:relative;font:600 14px Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.hf-gbtn{display:inline-flex;align-items:center;gap:10px;background:#fff;color:#1f1f1f;border:1px solid #dadce0;border-radius:20px;padding:7px 14px 7px 10px;font:500 14px Roboto,Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.hf-gbtn:hover{background:#f7f8f8}.hf-gbtn:disabled{opacity:.6;cursor:default}
.hf-me{display:inline-flex;align-items:center;gap:8px;background:#2d261e;border:1px solid #3a3127;color:#f1e9dc;border-radius:22px;padding:4px 12px 4px 4px;cursor:pointer}
.hf-me img,.hf-me .hf-ini{width:28px;height:28px;border-radius:50%;display:block}
.hf-me .hf-ini{background:#6b5a3e;display:flex;align-items:center;justify-content:center;font-size:13px}
.hf-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:230px;background:#211c16;border:1px solid #3a3127;border-radius:12px;padding:12px;box-shadow:0 14px 40px rgba(0,0,0,.5);z-index:200;color:#f1e9dc}
.hf-menu[hidden]{display:none}
.hf-menu .hf-em{color:#a99c88;font-weight:500;font-size:12px;margin:2px 0 10px;word-break:break-all}
.hf-menu .hf-row{display:flex;justify-content:space-between;font-weight:500;font-size:13px;padding:4px 0;color:#cfc4b2}
.hf-menu .hf-row b{color:#f1e9dc}
.hf-menu button{width:100%;margin-top:10px;background:#2d261e;border:1px solid #3a3127;color:#f1e9dc;border-radius:8px;padding:8px;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer}
.hf-menu button:hover{background:#3a3126}
.hf-note{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#211c16;border:1px solid #3a3127;color:#f1e9dc;border-radius:12px;padding:12px 16px;max-width:min(92vw,420px);font:500 14px/1.45 Inter,system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.5);z-index:300}`;
function note(msg) {
  const n = document.createElement('div'); n.className = 'hf-note'; n.textContent = msg;
  document.body.appendChild(n); setTimeout(() => n.remove(), 5000);
}
const MSG = {
  'not-configured': "Google sign-in isn't set up on this site yet. Games still work and save on this device.",
  offline: "You're offline. Sign in again when you're back online. Games still work and save on this device.",
  unavailable: "Sign-in couldn't load right now. Games still work and save on this device.",
  'unauthorized-domain': "This website isn't on the sign-in allow list yet (Firebase → Authentication → Settings → Authorized domains).",
  error: "Sign-in didn't work. Please try again."
};
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Mount the account button into `el`. `extra()` can return [label, value] rows for the menu.
export function mountAccount(el, extra) {
  if (!document.getElementById('hf-acct-css')) {
    const st = document.createElement('style'); st.id = 'hf-acct-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  el.classList.add('hf-acct');
  let open = false;
  const draw = () => {
    if (!state.user) {
      el.innerHTML = `<button class="hf-gbtn" type="button" ${state.ready ? '' : 'disabled'}>${G_LOGO}<span>Sign in with Google</span></button>`;
      el.querySelector('button').onclick = async () => {
        const r = await signIn(); if (MSG[r]) note(MSG[r]);
      };
      return;
    }
    const u = state.user, first = esc(u.name.split(' ')[0]);
    const rows = (extra ? extra() : []).map(([k, v]) => `<div class="hf-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    el.innerHTML = `<button class="hf-me" type="button" aria-haspopup="true">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="hf-ini">${first[0] || '?'}</span>`}<span>${first}</span></button>
      <div class="hf-menu" ${open ? '' : 'hidden'}><div>${esc(u.name)}</div><div class="hf-em">${esc(u.email)}</div>${rows}<button type="button" class="hf-out">Sign out</button></div>`;
    el.querySelector('.hf-me').onclick = e => { e.stopPropagation(); open = !open; draw(); };
    el.querySelector('.hf-out').onclick = async () => { open = false; await signOut(); };
  };
  document.addEventListener('click', e => { if (open && !el.contains(e.target)) { open = false; draw(); } });
  onAuth(draw);
  return { redraw: draw };
}

init();
