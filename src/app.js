import { state, setLibrary, resetUpload } from './state.js';
import * as api from './api.js';
import * as auth from './auth.js';
import { mountShell, mountGate } from './ui/shell.js';
import { h, clear } from './ui/dom.js';
import { render as renderUpload } from './ui/upload.js';
import { render as renderReview } from './ui/review.js';
import { render as renderLibrary } from './ui/library.js';
import { render as renderSettings } from './ui/settings.js';

const root = document.getElementById('app');
let shell = null;

const ROUTES = { '#/upload': { name: 'upload', render: renderUpload }, '#/review': { name: 'review', render: renderReview }, '#/library': { name: 'library', render: renderLibrary }, '#/settings': { name: 'settings', render: renderSettings } };

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

async function enter(label) {
  state.user = label;
  try {
    setLibrary((await api.getLibrary()));
  } catch (e) {
    if (e.code === 'auth' || e.code === 'auth_expired') { auth.signOut(); showSignIn(e.message); return; }
    gateError('Could not load the library', e.message, h('button', { type: 'button', class: 'btn-outline mono', onclick: () => enter(label) }, 'TRY AGAIN'));
    return;
  }
  shell = mountShell(root, { name: label, mock: state.mock, onSignOut: signOut });
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
  let busy = false;
  const err = h('p', { class: 'mono error-text', role: 'alert' }, message || '');
  const name = h('input', { id: 'login-name', type: 'text', class: 'input wide', autocomplete: 'name', maxlength: '40', required: true });
  const pass = h('input', { id: 'login-pass', type: 'password', class: 'input wide', autocomplete: 'current-password', maxlength: '200', required: true });
  const button = h('button', { type: 'submit', class: 'btn-primary' }, 'Enter');
  try { name.value = localStorage.getItem('lead_dc_name') || ''; } catch { /* ignore */ }
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!name.value.trim()) { err.textContent = 'Enter your name'; name.focus(); return; }
    if (!pass.value) { err.textContent = 'Enter the password'; pass.focus(); return; }
    busy = true; button.disabled = true; err.textContent = '';
    try {
      const who = await api.login(pass.value, name.value);
      pass.value = '';
      try { localStorage.setItem('lead_dc_name', who); } catch { /* ignore */ }
      await enter(who);
    } catch (ex) {
      err.textContent = ex.message;
      pass.value = '';
      pass.focus();
    }
    busy = false; button.disabled = false;
  } },
    h('label', { class: 'field', for: 'login-name' }, h('span', { class: 'mono dim label-sm' }, 'YOUR NAME'), name),
    h('label', { class: 'field', for: 'login-pass' }, h('span', { class: 'mono dim label-sm' }, 'PASSWORD'), pass),
    err, button);
  mountGate(root, { title: 'Sign in', body: 'Enter your name and the LEAD Data Center password.', extra: form });
  (name.value ? pass : name).focus();
}

async function boot() {
  window.addEventListener('hashchange', route);
  window.addEventListener('lead:auth-lost', (e) => {
    auth.signOut(); state.library = null; resetUpload();
    showSignIn((e.detail && e.detail.message) || 'Your sign-in ended. Please sign in again.');
  });

  state.mock = api.isMock();
  if (state.mock) {
    const saved = auth.storedToken();
    if (saved) { await enter(auth.nameFromToken(saved)); } else showSignIn('Mock mode: any password works.');
    return;
  }
  if (!api.isConfigured()) {
    gateError('Not configured yet', 'SCRIPT_URL in config.js is still a placeholder. Follow SETUP.md, then reload. To explore the screens with synthetic data, open this page from localhost with ?mock=1.');
    return;
  }
  const saved = auth.storedToken();
  if (saved) await enter(auth.nameFromToken(saved)); else showSignIn('');
}

boot();
