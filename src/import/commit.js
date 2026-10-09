// The authoritative write logic. Pure: takes the library and a payload, returns a change set.
// Used by the mock backend, and copied verbatim into apps-script/Code.gs by scripts/build-gas.js.
// Do not trust any count sent by the client; everything here is recomputed.

import { normalizeName, pairKey } from './normalize.js';
import { buildIndex, differentSet, findCandidates } from './match.js';
import { cleanTag, unionTags } from './tags.js';
import { TEST_TABS, TIME_TOLERANCE, isValidIsoDate } from '../tests.js';

export function cleanName(s) {
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
export function computeCommit(lib, payload, ctx) {
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
export function computeSetTags(lib, params, ctx) {
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
