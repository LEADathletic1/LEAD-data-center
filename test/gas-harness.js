// Runs the generated apps-script/Code.gs in a Node vm with in-memory fakes of the Apps Script services.
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLIENT_ID = 'test-client.apps.googleusercontent.com';

export function jwtLike(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'RS256' }) + '.' + b64(payload) + '.sig' + crypto.randomBytes(4).toString('hex');
}

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) { const v = (this.sheet.cells[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    this.sheet.writeLog.push({ r: this.r, c: this.c, vals: JSON.parse(JSON.stringify(vals)) });
    for (let i = 0; i < vals.length; i++) {
      const rowIdx = this.r - 1 + i;
      this.sheet.cells[rowIdx] = this.sheet.cells[rowIdx] || [];
      for (let j = 0; j < vals[i].length; j++) {
        let v = vals[i][j];
        // Sheets consumes a leading apostrophe and stores the rest as text.
        if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
        this.sheet.cells[rowIdx][this.c - 1 + j] = v;
      }
    }
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.cells = []; this.writeLog = []; }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  getLastRow() { let n = 0; this.cells.forEach((row, i) => { if (row && row.some((v) => v !== '' && v !== undefined)) n = i + 1; }); return n; }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  dataRows() { return this.cells.slice(1).filter((r) => r && r.length); }
}

export function createGas({ allowed = 'info@trainatlead.com,blair@trainatlead.com', archive = true } = {}) {
  const sheets = new Map();
  const props = { CLIENT_ID, ALLOWED_EMAILS: allowed };
  if (archive) props.ARCHIVE_FOLDER_ID = 'archive-folder';
  const cacheStore = new Map();
  const tokens = new Map(); // token -> { code, body }
  const state = { fetchCalls: 0, archived: [], locked: false, lockFails: false, lockCalls: 0 };

  const Utilities = {
    computeDigest: (_alg, s) => Array.from(crypto.createHash('sha256').update(s).digest()),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s, 'base64url')),
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d) => d.toISOString().slice(0, 10),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
  };
  const out = (s) => ({ content: s, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } });
  const spreadsheet = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    getId: () => 'ss-id',
  };
  const sandbox = {
    console: { log() {}, error() {} },
    Date, Math, JSON, Number, String, Array, Object, Map, Set, Error, RegExp, isFinite,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => { cacheStore.set(k, v); } }) },
    UrlFetchApp: {
      fetch: (url) => {
        state.fetchCalls++;
        const token = decodeURIComponent(url.split('id_token=')[1]);
        const t = tokens.get(token) || { code: 400, body: { error: 'invalid_token' } };
        return { getResponseCode: () => t.code, getContentText: () => JSON.stringify(t.body) };
      },
    },
    Utilities,
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { state.lockCalls++; if (state.lockFails) throw new Error('lock timeout'); state.locked = true; },
        releaseLock: () => { state.locked = false; },
      }),
    },
    ContentService: { createTextOutput: out, MimeType: { JSON: 'JSON', TEXT: 'TEXT' } },
    MimeType: { CSV: 'text/csv' },
    DriveApp: { getFolderById: (id) => ({ createFile: (name, content) => { state.archived.push({ folder: id, name, content }); return {}; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, 'apps-script/Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

  const call = (body) => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  const goodToken = (email = 'blair@trainatlead.com', extra = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { aud: CLIENT_ID, iss: 'https://accounts.google.com', email, email_verified: 'true', exp: String(now + 3000), ...extra };
    const t = jwtLike(payload);
    tokens.set(t, { code: 200, body: payload });
    return t;
  };
  return { sandbox, sheets, props, state, tokens, call, goodToken, cacheStore };
}
