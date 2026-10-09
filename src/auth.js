// Password sign-in. The page trades the shared password for a session token (kept for this browser
// tab only) and sends that token with every request. The server decides; nothing here grants access.

const STORE_KEY = 'lead_dc_session';
let token = null;

export function getToken() { return token; }

export function storedToken() {
  try {
    const t = sessionStorage.getItem(STORE_KEY);
    if (t) { token = t; return t; }
  } catch { /* storage unavailable: the user signs in again */ }
  return null;
}

export function setToken(t) {
  token = t;
  try { if (t) sessionStorage.setItem(STORE_KEY, t); else sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

export function signOut() { setToken(null); }
