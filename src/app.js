import { state, setLibrary, resetUpload } from './state.js';
import * as api from './api.js';
import * as auth from './auth.js';
import { mountShell, mountGate } from './ui/shell.js';
import { h, clear } from './ui/dom.js';
import { render as renderUpload } from './ui/upload.js';
import { render as renderReview } from './ui/review.js';
import { render as renderLibrary } from './ui/library.js';

const root = document.getElementById('app');
let shell = null;

const ROUTES = { '#/upload': { name: 'upload', render: renderUpload }, '#/review': { name: 'review', render: renderReview }, '#/library': { name: 'library', render: renderLibrary } };

function route() {
  if (!shell) return;
  const r = ROUTES[location.hash] || ROUTES['#/upload'];
  clear(shell.main);
  shell.setActive(r.name === 'review' ? 'upload' : r.name);
  r.render(shell.main);
  document.title = 'LEAD Data Center — ' + (r.name[0].toUpperCase() + r.name.slice(1));
  window.scrollTo(0, 0);
}

function gateError(title, message, extra) {
  mountGate(root, { title, body: message, extra });
}

async function enter(email) {
  state.user = email;
  try {
    setLibrary((await api.getLibrary()));
  } catch (e) {
    if (e.code === 'auth' || e.code === 'auth_expired') { showSignIn(e.code === 'auth_expired' ? e.message : ''); return; }
    gateError('Could not load the library', e.message, h('button', { type: 'button', class: 'btn-outline mono', onclick: () => enter(email) }, 'TRY AGAIN'));
    return;
  }
  shell = mountShell(root, { email, mock: state.mock, onSignOut: signOut });
  if (!ROUTES[location.hash]) history.replaceState(null, '', '#/upload');
  route();
}

function signOut() {
  auth.signOut();
  state.user = null; state.library = null; state.pointIndex = null;
  resetUpload();
  shell = null;
  showSignIn('');
}

function showSignIn(message) {
  shell = null;
  const holder = h('div', { class: 'gsi-holder' });
  const card = mountGate(root, { title: 'Sign in', body: 'Sign in with your LEAD Google account to open the data center.', extra: holder });
  if (message) card.appendChild(h('p', { class: 'mono error-text', role: 'alert' }, message));
  try { auth.renderSignInButton(holder); } catch { card.appendChild(h('p', { class: 'mono error-text' }, 'Google sign-in did not load. Refresh the page.')); }
}

async function onToken(token) {
  const email = auth.emailFromToken(token);
  try {
    const who = await api.whoami();
    await enter(who.email || email);
  } catch (e) {
    if (e.code === 'auth') {
      // Signed in with Google, but not on the allow list. Show nothing else.
      mountGate(root, { title: 'This account does not have access', body: email ? 'Signed in as ' + email + '.' : '', extra: h('button', { type: 'button', class: 'btn-outline mono', onclick: signOut }, 'SIGN OUT') });
    } else if (e.code === 'auth_expired') showSignIn(e.message);
    else gateError('Could not reach the data center', e.message, h('button', { type: 'button', class: 'btn-outline mono', onclick: () => onToken(token) }, 'TRY AGAIN'));
  }
}

async function boot() {
  window.addEventListener('hashchange', route);
  window.addEventListener('lead:auth-lost', () => { auth.signOut(); showSignIn('Your sign-in expired. Please sign in again.'); });

  if (api.isMock()) {
    state.mock = true;
    await enter('mock@example.test');
    return;
  }
  if (!auth.isConfigured()) {
    gateError('Not configured yet', 'GOOGLE_CLIENT_ID and SCRIPT_URL in config.js are still placeholders. Follow SETUP.md, then reload. To explore the screens with synthetic data, open this page from localhost with ?mock=1.');
    return;
  }
  try {
    await auth.initAuth(onToken);
  } catch (e) {
    gateError('Sign-in unavailable', e.message);
    return;
  }
  const saved = auth.storedToken();
  if (saved) onToken(saved); else showSignIn('');
}

boot();
