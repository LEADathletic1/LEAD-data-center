// GENERATED FILE. Do not edit by hand.
// Source: src/tests.js, src/import/{normalize,tags,match,commit}.js and apps-script/server.part.gs.
// Regenerate with: node scripts/build-gas.js

// ===== src/tests.js =====
// Source-independent constants shared by the importer, the mock backend and Apps Script.

const TEST_TABS = ['10 Yard', '30 Yard'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_TOLERANCE = 0.0005;
const STARTER_TAGS = ['Performance', '1More'];
const MAX_TAG_LENGTH = 30;

function isValidIsoDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}


// ===== src/import/normalize.js =====
// Name normalization, used for matching only. Display always uses the original spelling.

const SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];

// Lowercase, strip diacritics, drop punctuation, collapse whitespace. Keeps suffixes.
function foldName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(name) {
  const tokens = foldName(name).split(' ').filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.indexOf(tokens[tokens.length - 1]) >= 0) tokens.pop();
  return tokens.join(' ');
}

// First token is the first name; the remaining tokens are the last name.
function splitName(norm) {
  const tokens = String(norm).split(' ').filter(Boolean);
  return { first: tokens[0] || '', last: tokens.slice(1).join(' ') };
}

function pairKey(incomingNorm, athleteId) {
  return incomingNorm + '|' + athleteId;
}

// ===== src/import/tags.js =====

// Trim, enforce length and forbidden characters. Casing is resolved against known tags elsewhere.
function cleanTag(raw) {
  const tag = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!tag) return { ok: false, error: 'Tag name is empty' };
  if (tag.length > MAX_TAG_LENGTH) return { ok: false, error: 'Tag names can be at most ' + MAX_TAG_LENGTH + ' characters' };
  if (/[,|]/.test(tag)) return { ok: false, error: 'Tag names cannot contain commas or pipes' };
  return { ok: true, tag };
}

// Case-insensitive union that keeps the first casing seen.
function unionTags(existing, adding) {
  const out = existing.slice();
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const t of adding) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

// ===== src/import/match.js =====

const NICKNAME_PAIRS = [
  ['mike', 'michael'], ['matt', 'matthew'], ['nick', 'nicholas'], ['ben', 'benjamin'],
  ['jake', 'jacob'], ['josh', 'joshua'], ['zach', 'zachary'], ['alex', 'alexander'],
  ['sam', 'samuel'], ['chris', 'christopher'], ['tony', 'anthony'], ['dan', 'daniel'],
  ['will', 'william'], ['jack', 'john'], ['liz', 'elizabeth'], ['abby', 'abigail'],
  ['maddie', 'madeline'],
];
const NICKNAMES = new Set();
for (const [a, b] of NICKNAME_PAIRS) { NICKNAMES.add(a + '|' + b); NICKNAMES.add(b + '|' + a); }

// Optimal string alignment distance (a swap of two adjacent letters counts as one edit).
function editDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = [];
  for (let i = 0; i <= n; i++) { d.push(new Array(m + 1).fill(0)); d[i][0] = i; }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

// One edit needs 4+ letters on both sides (5+ for last names); two edits need 6+ (7+).
// The brief allows two edits at 4+/5+, but that flags Brody/Roxy Smith, which must not be flagged.
function closeSpelling(a, b, minOne, minTwo) {
  const minLen = Math.min(a.length, b.length);
  if (minLen < minOne) return 0;
  const dist = editDistance(a, b);
  if (dist === 0) return 0;
  if (dist === 1) return 1;
  if (dist === 2 && minLen >= minTwo) return 2;
  return 0;
}

// a and b are normalized names. Returns a short reason when they are a possible match, else null.
function nearMatchReason(aNorm, bNorm) {
  if (!aNorm || !bNorm || aNorm === bNorm) return null;
  const a = splitName(aNorm);
  const b = splitName(bNorm);

  if (a.last && a.last === b.last && a.first !== b.first) {
    if (NICKNAMES.has(a.first + '|' + b.first)) return 'Same last name, nickname variation';
    const short = a.first.length <= b.first.length ? a.first : b.first;
    const long = short === a.first ? b.first : a.first;
    if (short.length >= 3 && long.startsWith(short)) return 'Same last name, one first name starts the other';
    const e = closeSpelling(a.first, b.first, 4, 6);
    if (e === 1) return 'Same last name, first name one letter off';
    if (e === 2) return 'Same last name, similar first name';
  }
  if (a.first && a.first === b.first && a.last && b.last && a.last !== b.last) {
    const e = closeSpelling(a.last, b.last, 5, 7);
    if (e === 1) return 'Same first name, last name one letter off';
    if (e === 2) return 'Same first name, similar last name';
  }
  if (a.first && a.last && a.first === b.last && a.last === b.first && a.first !== a.last) {
    return 'First and last name look swapped';
  }
  return null;
}

// Index of library athletes by every normalized spelling (name and aliases).
function buildIndex(athletes) {
  const byNorm = new Map();
  const entries = [];
  for (const athlete of athletes) {
    const forms = [];
    for (const raw of [athlete.name].concat(athlete.aliases || [])) {
      const norm = normalizeName(raw);
      if (!norm || forms.indexOf(norm) >= 0) continue;
      forms.push(norm);
      if (!byNorm.has(norm)) byNorm.set(norm, athlete);
    }
    entries.push({ athlete, forms });
  }
  return { byNorm, entries };
}

// Pairs the user already answered "different". Aliases need no entry: they are stored on the athlete.
function differentSet(decisions) {
  const set = new Set();
  for (const d of decisions || []) if (d.decision === 'different') set.add(d.pair_key);
  return set;
}

function findCandidates(norm, index, different) {
  const out = [];
  for (const { athlete, forms } of index.entries) {
    if (different.has(pairKey(norm, athlete.id))) continue;
    let reason = null;
    for (const f of forms) {
      reason = nearMatchReason(norm, f);
      if (reason) break;
    }
    if (reason) out.push({ athlete, reason });
  }
  return out;
}

// kind: 'existing' (exact or alias match), 'match' (needs a decision), 'new'
function resolveName(name, index, different) {
  const norm = normalizeName(name);
  const exact = index.byNorm.get(norm);
  if (exact) return { norm, kind: 'existing', athlete: exact, candidates: [] };
  const candidates = findCandidates(norm, index, different);
  return { norm, kind: candidates.length ? 'match' : 'new', athlete: null, candidates };
}

// ===== src/import/commit.js =====
// The authoritative write logic. Pure: takes the library and a payload, returns a change set.
// Used by the mock backend, and copied verbatim into apps-script/Code.gs by scripts/build-gas.js.
// Do not trust any count sent by the client; everything here is recomputed.


function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const fail = (error, detail) => ({ ok: false, error, detail: detail || '' });

// Resolve incoming tag names against the known list, case-insensitively.
function canonicalTags(rawTags, knownTags) {
  const known = new Map();
  for (const t of knownTags || []) known.set(t.toLowerCase(), t);
  const tags = [];
  const created = [];
  for (const raw of rawTags) {
    const c = cleanTag(raw);
    if (!c.ok) return { error: c.error };
    const k = c.tag.toLowerCase();
    let canon = known.get(k);
    if (!canon) { canon = c.tag; known.set(k, canon); created.push(canon); }
    if (!tags.some((t) => t.toLowerCase() === k)) tags.push(canon);
  }
  return { tags, created };
}

// lib: { athletes, points: {tab: [[id,date,time,source,import_id]]}, decisions, tags }
// payload: { fileName, source, tags, resolutions, athletes: [names], records: [{name,test,date,time}] }
// ctx: { now, email, importId, newId(): string }
function computeCommit(lib, payload, ctx) {
  if (!payload || typeof payload !== 'object') return fail('bad_request');
  const source = String(payload.source || 'lumin');
  const rawTags = Array.isArray(payload.tags) ? payload.tags : [];
  if (!rawTags.length) return fail('no_tags', 'Every upload needs at least one tag.');
  const names = Array.isArray(payload.athletes) ? payload.athletes : [];
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (!names.length) return fail('no_athletes', 'Nothing to import.');
  if (names.length > 5000 || records.length > 200000) return fail('too_large');

  const tagInfo = canonicalTags(rawTags, lib.tags);
  if (tagInfo.error) return fail('bad_tag', tagInfo.error);

  // Names in the file, keyed by normalized form (first spelling wins).
  const display = new Map();
  for (const n of names) {
    if (typeof n !== 'string') return fail('bad_name');
    const clean = cleanName(n);
    const norm = normalizeName(clean);
    if (!norm) return fail('bad_name', 'A blank athlete name cannot be imported.');
    if (!display.has(norm)) display.set(norm, clean);
  }
  for (const rec of records) {
    if (!rec || typeof rec.name !== 'string') return fail('bad_record');
    if (TEST_TABS.indexOf(rec.test) < 0) return fail('bad_record', 'Unknown test: ' + rec.test);
    if (!isValidIsoDate(rec.date)) return fail('bad_record', 'Invalid date: ' + rec.date);
    if (typeof rec.time !== 'number' || !isFinite(rec.time) || rec.time <= 0 || rec.time >= 1000) return fail('bad_record', 'Invalid time');
    if (!display.has(normalizeName(cleanName(rec.name)))) return fail('bad_record', 'A record names an athlete not in the athlete list.');
  }

  const index = buildIndex(lib.athletes);
  const different = differentSet(lib.decisions);
  const resByNorm = new Map();
  for (const r of Array.isArray(payload.resolutions) ? payload.resolutions : []) {
    if (r && typeof r.name === 'string') resByNorm.set(normalizeName(cleanName(r.name)), r);
  }
  const byId = new Map(lib.athletes.map((a) => [a.id, a]));
  const usedIds = new Set(lib.athletes.map((a) => a.id));

  const idByNorm = new Map();
  const newAthletes = [];
  const aliasAdds = new Map(); // id -> [alias]
  const decisions = [];
  let matchesMerged = 0;
  let matchesAddedAsNew = 0;
  const unresolved = [];

  for (const [norm, name] of display) {
    const exact = index.byNorm.get(norm);
    if (exact) { idByNorm.set(norm, exact.id); continue; }
    const candidates = findCandidates(norm, index, different);
    const res = resByNorm.get(norm);

    if (res && res.action === 'merge') {
      const target = byId.get(res.candidate_id);
      if (!target || !candidates.some((c) => c.athlete.id === target.id)) return fail('bad_resolution', 'Merge target is not a candidate for ' + name);
      idByNorm.set(norm, target.id);
      if (!aliasAdds.has(target.id)) aliasAdds.set(target.id, []);
      aliasAdds.get(target.id).push(name.replace(/\|/g, ' '));
      decisions.push({ pair_key: pairKey(norm, target.id), athlete_id: target.id, incoming_name: name, decision: 'alias', decided_by: ctx.email, timestamp: ctx.now });
      matchesMerged++;
      continue;
    }

    if (candidates.length) {
      const declared = new Set(res && res.action === 'new' && Array.isArray(res.different_from) ? res.different_from : []);
      if (!candidates.every((c) => declared.has(c.athlete.id))) { unresolved.push(name); continue; }
      for (const c of candidates) {
        decisions.push({ pair_key: pairKey(norm, c.athlete.id), athlete_id: c.athlete.id, incoming_name: name, decision: 'different', decided_by: ctx.email, timestamp: ctx.now });
      }
      matchesAddedAsNew++;
    }

    let id;
    do { id = ctx.newId(); } while (usedIds.has(id));
    usedIds.add(id);
    idByNorm.set(norm, id);
    newAthletes.push({ id, name, tags: [], aliases: [], first_seen: ctx.now.slice(0, 10), source });
  }
  if (unresolved.length) return fail('unresolved_matches', 'These names need a Merge or Add-as-new decision: ' + unresolved.slice(0, 5).join(', '));

  // Points: dedupe within the file (later wins), then against the library.
  const lastInFile = new Map();
  for (const rec of records) {
    const id = idByNorm.get(normalizeName(cleanName(rec.name)));
    lastInFile.set(id + '|' + rec.test + '|' + rec.date, { id, test: rec.test, date: rec.date, time: rec.time });
  }
  const pointIndex = {};
  const perTest = {};
  for (const tab of TEST_TABS) {
    perTest[tab] = { new: 0, duplicates: 0, corrected: 0 };
    const m = new Map();
    const rows = (lib.points && lib.points[tab]) || [];
    for (let i = 0; i < rows.length; i++) {
      const k = rows[i][0] + '|' + tab + '|' + rows[i][1];
      if (!m.has(k)) m.set(k, i);
    }
    pointIndex[tab] = m;
  }
  const appendPoints = {};
  const updatePoints = {};
  const corrections = [];
  for (const tab of TEST_TABS) { appendPoints[tab] = []; updatePoints[tab] = []; }
  for (const [key, rec] of lastInFile) {
    const hit = pointIndex[rec.test].get(key);
    if (hit === undefined) {
      appendPoints[rec.test].push([rec.id, rec.date, rec.time, source, ctx.importId]);
      perTest[rec.test].new++;
      continue;
    }
    const old = Number(lib.points[rec.test][hit][2]);
    if (Math.abs(old - rec.time) <= TIME_TOLERANCE) { perTest[rec.test].duplicates++; continue; }
    updatePoints[rec.test].push({ row: hit, time: rec.time });
    corrections.push([ctx.importId, ctx.now, rec.id, rec.test, rec.date, old, rec.time]);
    perTest[rec.test].corrected++;
  }

  // Tags are added to what an athlete already has; never replaced.
  const fileIds = Array.from(new Set(idByNorm.values()));
  const tagLog = [];
  const gained = new Map(); // tag -> [ids]
  const newById = new Map(newAthletes.map((a) => [a.id, a]));
  const updatedAthletes = [];
  for (const id of fileIds) {
    const isNew = newById.has(id);
    const cur = isNew ? newById.get(id) : byId.get(id);
    const before = cur.tags || [];
    const after = unionTags(before, tagInfo.tags);
    for (const t of tagInfo.tags) {
      if (!before.some((b) => b.toLowerCase() === t.toLowerCase())) {
        if (!gained.has(t)) gained.set(t, []);
        gained.get(t).push(id);
      }
    }
    const aliases = unionAliases(cur.aliases || [], aliasAdds.get(id) || []);
    if (isNew) { cur.tags = after; cur.aliases = aliases; }
    else if (after.length !== before.length || aliases.length !== (cur.aliases || []).length) {
      updatedAthletes.push({ id, tags: after, aliases });
    }
  }
  for (const t of tagInfo.created) tagLog.push({ timestamp: ctx.now, user_email: ctx.email, action: 'create', tag: t, athlete_ids: '' });
  for (const [t, ids] of gained) tagLog.push({ timestamp: ctx.now, user_email: ctx.email, action: 'add', tag: t, athlete_ids: ids.join(',') });

  let newPoints = 0, duplicates = 0, corrected = 0;
  for (const tab of TEST_TABS) { newPoints += perTest[tab].new; duplicates += perTest[tab].duplicates; corrected += perTest[tab].corrected; }

  const result = {
    importId: ctx.importId,
    newPoints, duplicates, corrections: corrected,
    newAthletes: newAthletes.length, matchesMerged, matchesAddedAsNew,
    athletesInFile: fileIds.length,
    tags: tagInfo.tags,
    perTest,
  };
  const importLog = {
    import_id: ctx.importId, timestamp: ctx.now, user_email: ctx.email,
    file_name: cleanName(payload.fileName || ''), tags_applied: tagInfo.tags.join(', '),
    new_points: newPoints, duplicates_skipped: duplicates, time_corrections: corrected,
    new_athletes: newAthletes.length, matches_merged: matchesMerged, matches_added_as_new: matchesAddedAsNew,
  };
  return { ok: true, result, changes: { newAthletes, updatedAthletes, appendPoints, updatePoints, corrections, decisions, tagLog, importLog, createdTags: tagInfo.created } };
}

function unionAliases(existing, adding) {
  const out = existing.slice();
  const seen = new Set(out.map(normalizeName));
  for (const a of adding) {
    const n = normalizeName(a);
    if (n && !seen.has(n)) { seen.add(n); out.push(a); }
  }
  return out;
}

// params: { athlete_ids, add: [tag], remove: [tag] }
function computeSetTags(lib, params, ctx) {
  if (!params || typeof params !== 'object') return fail('bad_request');
  const ids = Array.isArray(params.athlete_ids) ? params.athlete_ids : [];
  const add = Array.isArray(params.add) ? params.add : [];
  const remove = Array.isArray(params.remove) ? params.remove : [];
  if (!ids.length) return fail('no_athletes');
  if (!add.length && !remove.length) return fail('no_tags');
  if (ids.length > 20000) return fail('too_large');
  const byId = new Map(lib.athletes.map((a) => [a.id, a]));
  for (const id of ids) if (!byId.has(id)) return fail('unknown_athlete', String(id));

  const addInfo = canonicalTags(add, lib.tags);
  if (addInfo.error) return fail('bad_tag', addInfo.error);
  const removeKeys = [];
  for (const raw of remove) {
    const c = cleanTag(raw);
    if (!c.ok) return fail('bad_tag', c.error);
    removeKeys.push(c.tag.toLowerCase());
  }

  const tagLog = [];
  for (const t of addInfo.created) tagLog.push({ timestamp: ctx.now, user_email: ctx.email, action: 'create', tag: t, athlete_ids: '' });
  const updatedAthletes = [];
  const added = new Map();
  const removed = new Map();
  for (const id of Array.from(new Set(ids))) {
    const a = byId.get(id);
    const before = a.tags || [];
    let after = unionTags(before, addInfo.tags);
    for (const t of addInfo.tags) {
      if (!before.some((b) => b.toLowerCase() === t.toLowerCase())) {
        if (!added.has(t)) added.set(t, []);
        added.get(t).push(id);
      }
    }
    const kept = after.filter((t) => {
      if (removeKeys.indexOf(t.toLowerCase()) < 0) return true;
      if (!removed.has(t)) removed.set(t, []);
      removed.get(t).push(id);
      return false;
    });
    after = kept;
    if (after.length !== before.length || after.some((t, i) => t !== before[i])) updatedAthletes.push({ id, tags: after });
  }
  for (const [t, list] of added) tagLog.push({ timestamp: ctx.now, user_email: ctx.email, action: 'add', tag: t, athlete_ids: list.join(',') });
  for (const [t, list] of removed) tagLog.push({ timestamp: ctx.now, user_email: ctx.email, action: 'remove', tag: t, athlete_ids: list.join(',') });
  return { ok: true, changes: { updatedAthletes, tagLog, createdTags: addInfo.created }, result: { changed: updatedAthletes.length } };
}

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
