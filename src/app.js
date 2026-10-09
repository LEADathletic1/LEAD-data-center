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

async function enter(label) {
  state.user = label;
  try {
    setLibrary((await api.getLibrary()));
  } catch (e) {
    if (e.code === 'auth' || e.code === 'auth_expired') { showSignIn(e.code === 'auth_expired' ? e.message : ''); return; }
    gateError('Could not load the library', e.message, h('button', { type: 'button', class: 'btn-outline mono', onclick: () => enter(label) }, 'TRY AGAIN'));
    return;
  }
  shell = mountShell(root, { email: label, mock: state.mock, onSignOut: signOut });
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
  const input = h('input', { type: 'password', class: 'input wide', autocomplete: 'current-password', 'aria-label': 'Password', placeholder: 'Password', required: true, maxlength: '200' });
  const button = h('button', { type: 'submit', class: 'btn-primary' }, 'Sign in');
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (busy || !input.value) return;
    busy = true; button.disabled = true; err.textContent = '';
    try {
      await api.login(input.value);
      input.value = '';
      await enter('Signed in');
    } catch (ex) {
      err.textContent = ex.message;
      input.value = '';
      input.focus();
    }
    busy = false; button.disabled = false;
  } }, input, err, button);
  mountGate(root, { title: 'Sign in', body: 'Enter the LEAD Data Center password.', extra: form });
  input.focus();
}

async function boot() {
  window.addEventListener('hashchange', route);
  window.addEventListener('lead:auth-lost', () => { auth.signOut(); showSignIn('Your sign-in expired. Please sign in again.'); });

  if (api.isMock()) {
    state.mock = true;
    await enter('mock@example.test');
    return;
  }
  if (!api.isConfigured()) {
    gateError('Not configured yet', 'SCRIPT_URL in config.js is still a placeholder. Follow SETUP.md, then reload. To explore the screens with synthetic data, open this page from localhost with ?mock=1.');
    return;
  }
  if (auth.storedToken()) await enter('Signed in'); else showSignIn('');
}

boot();
