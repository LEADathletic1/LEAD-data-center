// ===== Server: web app entry point, auth, Sheet I/O =====
// Hand-written half of Code.gs. The shared logic above this line is generated from src/.

const SHEET_ATHLETES = 'Athletes';
const SHEET_IMPORT_LOG = 'Import Log';
const SHEET_CORRECTIONS = 'Corrections';
const SHEET_TAG_LOG = 'Tag Log';
const SHEET_DECISIONS = 'Name Decisions';

const HEADERS_ = {
  'Athletes': ['athlete_id', 'name', 'tags', 'aliases', 'first_seen', 'source'],
  'Import Log': ['import_id', 'timestamp', 'user_email', 'file_name', 'tags_applied', 'new_points', 'duplicates_skipped', 'time_corrections', 'new_athletes', 'matches_merged', 'matches_added_as_new'],
  'Corrections': ['import_id', 'timestamp', 'athlete_id', 'test', 'date', 'old_time', 'new_time'],
  'Tag Log': ['timestamp', 'user_email', 'action', 'tag', 'athlete_ids'],
  'Name Decisions': ['pair_key', 'athlete_id', 'incoming_name', 'decision', 'decided_by', 'timestamp'],
};
for (const tab of TEST_TABS) HEADERS_[tab] = ['athlete_id', 'date', 'time', 'source', 'import_id'];

// Columns that must stay plain text (IDs, ISO dates, names, tags). Time columns stay numeric.
const NUMERIC_COLS_ = { '10 Yard': [3], '30 Yard': [3], 'Corrections': [6, 7], 'Import Log': [6, 7, 8, 9, 10, 11] };

const BACKUP_KEEP_ = 12;
const BACKUP_PREFIX_ = 'LEAD Data Center backup ';

// ---------- Web app ----------

function doGet() {
  return ContentService.createTextOutput('LEAD Data Center API. Use POST.').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'auth' }); }
  const auth = verifyToken_(body && body.idToken);
  if (!auth.ok) return json_({ ok: false, error: auth.error });
  try {
    switch (body.action) {
      case 'whoami': return json_({ ok: true, email: auth.email });
      case 'getLibrary': return json_(getLibrary_());
      case 'commitImport': return json_(commitImport_(body, auth.email));
      case 'setTags': return json_(setTags_(body, auth.email));
      case 'mergeAthletes': return json_({ ok: false, error: 'not_implemented' });
      default: return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    return json_({ ok: false, error: err && err.code ? err.code : 'server_error' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Auth: runs on every request, no exceptions ----------

function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) return { ok: false, error: 'auth' };
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('CLIENT_ID');
  const allowed = String(props.getProperty('ALLOWED_EMAILS') || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (!clientId || !allowed.length) return { ok: false, error: 'auth' };

  const now = Math.floor(Date.now() / 1000);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'tok_' + digest_(token);
  let info = null;
  const hit = cache.get(cacheKey);
  if (hit) { try { info = JSON.parse(hit); } catch (err) { info = null; } }
  if (info && !(info.exp > now)) info = null;

  if (!info) {
    const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { ok: false, error: looksExpired_(token, now) ? 'auth_expired' : 'auth' };
    let t;
    try { t = JSON.parse(resp.getContentText()); } catch (err) { return { ok: false, error: 'auth' }; }
    const exp = Number(t.exp);
    if (t.aud !== clientId) return { ok: false, error: 'auth' };
    if (t.iss !== 'accounts.google.com' && t.iss !== 'https://accounts.google.com') return { ok: false, error: 'auth' };
    if (String(t.email_verified) !== 'true' || !t.email) return { ok: false, error: 'auth' };
    if (!exp || exp <= now) return { ok: false, error: 'auth_expired' };
    info = { email: String(t.email).toLowerCase(), exp: exp };
    cache.put(cacheKey, JSON.stringify(info), Math.max(1, Math.min(300, exp - now)));
  }
  // The allow list is checked on every request, including cache hits.
  if (allowed.indexOf(info.email) < 0) return { ok: false, error: 'auth' };
  return { ok: true, email: info.email };
}

// Only used to choose between "auth" and "auth_expired"; the token is not trusted for anything else.
function looksExpired_(token, now) {
  try {
    const part = token.split('.')[1];
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString());
    return Number(payload.exp) > 0 && Number(payload.exp) <= now;
  } catch (err) { return false; }
}

function digest_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
  return Utilities.base64EncodeWebSafe(bytes);
}

// ---------- Sheet helpers ----------

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

// Run once from the editor (see SETUP.md). Also called lazily before every read and write.
function setup() { ensureSheets_(); }

function ensureSheets_() {
  const ss = ss_();
  const names = Object.keys(HEADERS_);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let sh = ss.getSheetByName(name);
    if (sh) continue;
    sh = ss.insertSheet(name);
    const headers = HEADERS_[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Plain-text format keeps ISO dates as text and stops formulas from ever running.
    const numeric = NUMERIC_COLS_[name] || [];
    for (let c = 1; c <= headers.length; c++) {
      if (numeric.indexOf(c) < 0) sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    }
  }
}

// A leading = + - @ would run as a formula. Prefix a single quote so it stays text.
function cell_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

// Undo our own prefix on read (Sheets usually consumes it; plain-text cells can keep it).
function unprefix_(v) {
  if (typeof v === 'string' && /^'[=+\-@\t\r]/.test(v)) return v.slice(1);
  return v;
}

function str_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  return String(unprefix_(v));
}

function readRows_(name, ncols) {
  const sh = ss_().getSheetByName(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ncols).getValues();
}

function splitList_(v, sep) {
  const s = str_(v);
  return s ? s.split(sep).map(function (x) { return x.trim(); }).filter(Boolean) : [];
}

function readLibrary_() {
  ensureSheets_();
  const athletes = readRows_(SHEET_ATHLETES, 6).map(function (r) {
    return { id: str_(r[0]), name: str_(r[1]), tags: splitList_(r[2], ','), aliases: splitList_(r[3], '|'), first_seen: str_(r[4]), source: str_(r[5]) };
  });
  const points = {};
  for (let i = 0; i < TEST_TABS.length; i++) {
    const tab = TEST_TABS[i];
    points[tab] = readRows_(tab, 5).map(function (r) { return [str_(r[0]), str_(r[1]), Number(r[2]), str_(r[3]), str_(r[4])]; });
  }
  const decisions = readRows_(SHEET_DECISIONS, 6).map(function (r) {
    return { pair_key: str_(r[0]), athlete_id: str_(r[1]), incoming_name: str_(r[2]), decision: str_(r[3]) };
  });
  let tags = STARTER_TAGS.slice();
  readRows_(SHEET_TAG_LOG, 5).forEach(function (r) { if (str_(r[2]) === 'create') tags = unionTags(tags, [str_(r[3])]); });
  athletes.forEach(function (a) { tags = unionTags(tags, a.tags); });
  const logRows = readRows_(SHEET_IMPORT_LOG, 11);
  const lr = logRows.length ? logRows[logRows.length - 1] : null;
  const lastImport = lr ? {
    import_id: str_(lr[0]), timestamp: str_(lr[1]), user_email: str_(lr[2]), file_name: str_(lr[3]), tags_applied: str_(lr[4]),
    new_points: Number(lr[5]), duplicates_skipped: Number(lr[6]), time_corrections: Number(lr[7]),
    new_athletes: Number(lr[8]), matches_merged: Number(lr[9]), matches_added_as_new: Number(lr[10]),
  } : null;
  return { athletes: athletes, points: points, decisions: decisions, tags: tags, lastImport: lastImport };
}

function getLibrary_() {
  const lib = readLibrary_();
  const points = {};
  TEST_TABS.forEach(function (tab) { points[tab] = lib.points[tab].map(function (r) { return [r[0], r[1], r[2], r[3]]; }); });
  return { ok: true, athletes: lib.athletes, points: points, tags: lib.tags, decisions: lib.decisions, lastImport: lib.lastImport, tests: TEST_TABS.slice() };
}

function ctx_(email) {
  return {
    now: new Date().toISOString(),
    email: email,
    importId: 'i_' + hex8_(),
    newId: function () { return 'a_' + hex8_(); },
  };
}

function hex8_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) { const e = new Error('busy'); e.code = 'busy'; throw e; }
  try { return fn(); } finally { lock.releaseLock(); }
}

function appendRows_(name, rows) {
  if (!rows.length) return;
  const sh = ss_().getSheetByName(name);
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows.map(function (r) { return r.map(cell_); }));
}

// Applies a change set from computeCommit / computeSetTags. Reads each tab once, writes in batches.
function applyChanges_(lib, changes) {
  const ss = ss_();
  if (changes.updatedAthletes && changes.updatedAthletes.length) {
    const byId = {};
    changes.updatedAthletes.forEach(function (u) { byId[u.id] = u; });
    const out = lib.athletes.map(function (a) {
      const u = byId[a.id];
      const tags = u ? u.tags : a.tags;
      const aliases = u && u.aliases ? u.aliases : a.aliases;
      return [cell_(tags.join(',')), cell_(aliases.join('|'))];
    });
    ss.getSheetByName(SHEET_ATHLETES).getRange(2, 3, out.length, 2).setValues(out);
  }
  if (changes.newAthletes && changes.newAthletes.length) {
    appendRows_(SHEET_ATHLETES, changes.newAthletes.map(function (a) {
      return [a.id, a.name, a.tags.join(','), a.aliases.join('|'), a.first_seen, a.source];
    }));
  }
  TEST_TABS.forEach(function (tab) {
    const updates = changes.updatePoints && changes.updatePoints[tab];
    if (updates && updates.length) {
      const times = lib.points[tab].map(function (r) { return [r[2]]; });
      updates.forEach(function (u) { times[u.row][0] = u.time; });
      ss.getSheetByName(tab).getRange(2, 3, times.length, 1).setValues(times);
    }
    const adds = changes.appendPoints && changes.appendPoints[tab];
    if (adds && adds.length) appendRows_(tab, adds);
  });
  appendRows_(SHEET_CORRECTIONS, changes.corrections || []);
  appendRows_(SHEET_DECISIONS, (changes.decisions || []).map(function (d) {
    return [d.pair_key, d.athlete_id, d.incoming_name, d.decision, d.decided_by, d.timestamp];
  }));
  appendRows_(SHEET_TAG_LOG, (changes.tagLog || []).map(function (t) {
    return [t.timestamp, t.user_email, t.action, t.tag, t.athlete_ids];
  }));
  if (changes.importLog) {
    const l = changes.importLog;
    appendRows_(SHEET_IMPORT_LOG, [[l.import_id, l.timestamp, l.user_email, l.file_name, l.tags_applied, l.new_points, l.duplicates_skipped, l.time_corrections, l.new_athletes, l.matches_merged, l.matches_added_as_new]]);
  }
}

function archiveCsv_(importId, fileName, csv) {
  const folderId = PropertiesService.getScriptProperties().getProperty('ARCHIVE_FOLDER_ID');
  if (!folderId) { const e = new Error('no archive folder'); e.code = 'archive_failed'; throw e; }
  const safe = String(fileName || 'upload.csv').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
  try {
    DriveApp.getFolderById(folderId).createFile(importId + ' - ' + safe, String(csv || ''), MimeType.CSV);
  } catch (err) { const e = new Error('archive failed'); e.code = 'archive_failed'; throw e; }
}

// ---------- Actions ----------

function commitImport_(body, email) {
  return withLock_(function () {
    const lib = readLibrary_();
    const c = ctx_(email);
    const out = computeCommit(lib, body, c);
    if (!out.ok) return { ok: false, error: out.error, detail: out.detail };
    // Archive first: if it fails nothing is written, so every stored row traces back to a file.
    archiveCsv_(c.importId, body.fileName, body.csv);
    applyChanges_(lib, out.changes);
    return { ok: true, result: out.result };
  });
}

function setTags_(body, email) {
  return withLock_(function () {
    const lib = readLibrary_();
    const out = computeSetTags(lib, body, ctx_(email));
    if (!out.ok) return { ok: false, error: out.error, detail: out.detail };
    applyChanges_(lib, out.changes);
    const touched = {};
    out.changes.updatedAthletes.forEach(function (u) { touched[u.id] = u.tags; });
    const updated = Object.keys(touched).map(function (id) { return { id: id, tags: touched[id] }; });
    let tags = lib.tags;
    tags = unionTags(tags, out.changes.createdTags || []);
    return { ok: true, updated: updated, tags: tags };
  });
}

// ---------- Backups ----------

// Copies the whole Spreadsheet into the backup folder and keeps the latest 12 copies.
function backupSheet() {
  const folderId = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID');
  if (!folderId) throw new Error('Set BACKUP_FOLDER_ID in Script Properties first.');
  const folder = DriveApp.getFolderById(folderId);
  const stamp = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HHmm'Z'");
  DriveApp.getFileById(ss_().getId()).makeCopy(BACKUP_PREFIX_ + stamp, folder);
  const copies = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX_) === 0) copies.push(f);
  }
  copies.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  copies.slice(BACKUP_KEEP_).forEach(function (f) { f.setTrashed(true); });
}

// Run once from the editor to schedule a weekly backup (Sundays, around 3 AM).
function installWeeklyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupSheet') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupSheet').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
}
