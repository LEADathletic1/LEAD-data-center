// Session handling. The server issues a signed token after the shared password is checked; the page
// keeps it in localStorage and sends it with every request. Nothing here grants access: the server
// verifies the signature, expiry and password version on every call. The password is never stored.

const STORE_KEY = 'lead_dc_session';
let token = null;

export function getToken() { return token; }

export function storedToken() {
  try {
    const t = localStorage.getItem(STORE_KEY);
    if (t && nameFromToken(t)) { token = t; return t; }
  } catch { /* storage unavailable: the user signs in again */ }
  return null;
}

export function setToken(t) {
  token = t;
  try { if (t) localStorage.setItem(STORE_KEY, t); else localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

// Display only. The signature is checked by the server, not here.
export function nameFromToken(t) {
  try {
    const part = String(t).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(decodeURIComponent(escape(atob(part))));
    return typeof data.name === 'string' && data.name ? data.name : '';
  } catch { return ''; }
}

export function signOut() { setToken(null); }
