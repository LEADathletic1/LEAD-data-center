// Sign in with Google (Google Identity Services). The ID token is sent with every request and
// verified server-side; nothing in the browser is trusted to grant access.

import { GOOGLE_CLIENT_ID } from '../config.js';

const STORE_KEY = 'lead_dc_id_token';
let token = null;
let onSignIn = null;
let refreshResolve = null;

export function isConfigured() {
  return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.indexOf('REPLACE_WITH') < 0 && /\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID);
}

function decodePayload(t) {
  try {
    const part = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  } catch { return null; }
}

// Display only. The server decides who is allowed.
export function emailFromToken(t) {
  const p = t && decodePayload(t);
  return p && typeof p.email === 'string' ? p.email : '';
}

function fresh(t) {
  const p = t && decodePayload(t);
  return !!(p && Number(p.exp) * 1000 > Date.now() + 30000);
}

export function getToken() { return token; }

export function storedToken() {
  try {
    const t = sessionStorage.getItem(STORE_KEY);
    if (t && fresh(t)) { token = t; return t; }
  } catch { /* storage unavailable: fine, the user signs in again */ }
  return null;
}

function setToken(t) {
  token = t;
  try { if (t) sessionStorage.setItem(STORE_KEY, t); else sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.id) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection and any content blockers.'));
    document.head.appendChild(s);
  });
}

export async function initAuth(callback) {
  onSignIn = callback;
  await loadGsi();
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    auto_select: true,
    cancel_on_tap_outside: false,
    callback: (resp) => {
      if (!resp || !resp.credential) return;
      setToken(resp.credential);
      if (refreshResolve) { const r = refreshResolve; refreshResolve = null; r(resp.credential); return; }
      if (onSignIn) onSignIn(resp.credential);
    },
  });
}

export function renderSignInButton(container) {
  window.google.accounts.id.renderButton(container, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular' });
}

// Ask Google for a fresh token without a click. Resolves null if that needs the user.
export function refreshToken() {
  return new Promise((resolve) => {
    if (!window.google || !window.google.accounts) { resolve(null); return; }
    let finished = false;
    const finish = (t) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (refreshResolve === finish) refreshResolve = null;
      resolve(t);
    };
    const timer = setTimeout(() => finish(null), 8000);
    refreshResolve = finish;
    try {
      window.google.accounts.id.prompt((n) => {
        if (n.isNotDisplayed && (n.isNotDisplayed() || n.isSkippedMoment())) finish(null);
      });
    } catch { finish(null); }
  });
}

export function signOut() {
  setToken(null);
  try { if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
}
