// All data goes through here. Real mode posts JSON (as text/plain, which avoids a CORS preflight
// that Apps Script cannot answer) with the Google ID token. Mock mode is in-memory, localhost only.

import { SCRIPT_URL } from '../config.js';
import * as auth from './auth.js';
import { mockAllowed } from './mockgate.js';

export class ApiError extends Error {
  constructor(code, message, data) { super(message); this.name = 'ApiError'; this.code = code; this.data = data; }
}

const MESSAGES = {
  auth: 'That password is not correct.',
  auth_expired: 'Your sign-in expired. Please sign in again.',
  locked: 'Too many wrong passwords. Sign-in is paused for 15 minutes.',
  not_configured_server: 'The password has not been set on the server yet. See SETUP.md.',
  busy: 'Another import or tag change is in progress. Wait a few seconds and try again.',
  archive_failed: 'The raw file could not be archived to Drive, so nothing was written. Check ARCHIVE_FOLDER_ID in Script Properties.',
  unresolved_matches: 'Some name matches still need a decision. Nothing was written.',
  no_tags: 'Every upload needs at least one tag.',
  bad_tag: 'That tag name is not allowed.',
  network: 'Could not reach the server. Check your connection and try again.',
  bad_response: 'The server sent a response the page could not read. Check the Apps Script deployment URL in config.js.',
  not_configured: 'SCRIPT_URL in config.js is still a placeholder. See SETUP.md.',
};

export { configured as isConfigured };

export function isMock() {
  return mockAllowed(location.hostname, location.search);
}

let mockBackend = null;
async function mock() {
  if (!mockBackend) mockBackend = (await import('./mock.js')).createMockBackend();
  return mockBackend;
}

function configured() {
  return typeof SCRIPT_URL === 'string' && SCRIPT_URL.indexOf('REPLACE_WITH') < 0;
}

async function post(action, params, useToken = true) {
  if (typeof SCRIPT_URL !== 'string' || SCRIPT_URL.indexOf('REPLACE_WITH') >= 0) throw new ApiError('not_configured', MESSAGES.not_configured);
  const token = useToken ? auth.getToken() : null;
  if (useToken && !token) throw new ApiError('auth_expired', MESSAGES.auth_expired);
  let resp;
  try {
    resp = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...params, action, sessionToken: token }),
    });
  } catch { throw new ApiError('network', MESSAGES.network); }
  try { return await resp.json(); } catch { throw new ApiError('bad_response', MESSAGES.bad_response); }
}

export async function call(action, params = {}) {
  if (isMock()) {
    const data = await (await mock())[action](params);
    if (!data.ok) throw new ApiError(data.error, MESSAGES[data.error] || data.detail || data.error, data);
    return data;
  }
  const data = await post(action, params);
  if (!data.ok) throw new ApiError(data.error || 'server_error', MESSAGES[data.error] || data.detail || 'The server reported an error (' + (data.error || 'unknown') + ').', data);
  return data;
}

export async function login(password) {
  if (isMock()) { auth.setToken('mock'); return; }
  const data = await post('login', { password }, false);
  if (!data.ok) throw new ApiError(data.error || 'auth', data.error === 'not_configured' ? MESSAGES.not_configured_server : MESSAGES[data.error] || 'Sign-in failed.', data);
  auth.setToken(data.token);
}

export const whoami = () => call('whoami');
export const getLibrary = () => call('getLibrary');
export const commitImport = (payload) => call('commitImport', payload);
export const setTags = (params) => call('setTags', params);

// Mock mode only: a synthetic export so the upload screen can be tried without a file.
export async function mockSampleFile() {
  if (!isMock()) return null;
  return (await mock()).sampleFile();
}
