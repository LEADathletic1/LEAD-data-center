// Public values only. Safe to commit: a Google OAuth Client ID and a web-app URL are not secrets.
// Access control is enforced server-side in Apps Script (ID token check + email allow list).
//
// PLACEHOLDERS: fill both in after following SETUP.md. Until then the site shows a
// "not configured" notice, and the only way to explore it is mock mode on localhost.

export const GOOGLE_CLIENT_ID = 'REPLACE_WITH_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
export const SCRIPT_URL = 'REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL';
