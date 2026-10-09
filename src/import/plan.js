// Front-end preview of an import. The server recomputes everything at commit time.

import { buildIndex, differentSet, resolveName } from './match.js';
import { pairKey } from './normalize.js';
import { TEST_TABS, TIME_TOLERANCE } from '../tests.js';

// includedNorms: Set of normalized names the user wants imported.
export function analyze(parsed, library, includedNorms) {
  const index = buildIndex(library.athletes);
  const different = differentSet(library.decisions);
  const entries = [];
  for (const a of parsed.athletes) {
    if (!includedNorms.has(a.norm)) continue;
    const r = resolveName(a.name, index, different);
    entries.push({ name: a.name, norm: a.norm, kind: r.kind, athlete: r.athlete, candidates: r.candidates });
  }
  const pairs = [];
  for (const e of entries) {
    if (e.kind !== 'match') continue;
    for (const c of e.candidates) pairs.push({ key: pairKey(e.norm, c.athlete.id), norm: e.norm, name: e.name, athlete: c.athlete, reason: c.reason });
  }
  return { entries, pairs };
}

// decisions: { [pairKey]: 'merge' | 'new' }
export function resolveEntries(analysis, decisions) {
  const out = new Map(); // norm -> { id, state: 'existing'|'merged'|'new'|'pending' }
  for (const e of analysis.entries) {
    if (e.kind === 'existing') { out.set(e.norm, { id: e.athlete.id, state: 'existing' }); continue; }
    if (e.kind === 'new') { out.set(e.norm, { id: 'new:' + e.norm, state: 'new' }); continue; }
    const merged = e.candidates.find((c) => decisions[pairKey(e.norm, c.athlete.id)] === 'merge');
    if (merged) { out.set(e.norm, { id: merged.athlete.id, state: 'merged' }); continue; }
    const allNew = e.candidates.every((c) => decisions[pairKey(e.norm, c.athlete.id)] === 'new');
    out.set(e.norm, allNew ? { id: 'new:' + e.norm, state: 'new', matched: true } : { id: null, state: 'pending' });
  }
  return out;
}

export function computePlan(parsed, library, analysis, decisions) {
  const resolved = resolveEntries(analysis, decisions);
  const have = new Map();
  for (const tab of TEST_TABS) {
    for (const row of library.points[tab] || []) {
      const k = row[0] + '|' + tab + '|' + row[1];
      if (!have.has(k)) have.set(k, Number(row[2]));
    }
  }
  const perTest = {};
  for (const tab of TEST_TABS) perTest[tab] = { new: 0, duplicates: 0, corrected: 0 };
  const corrections = [];
  let pendingPoints = 0;
  for (const rec of parsed.records) {
    const r = resolved.get(rec.norm);
    if (!r) continue; // excluded name
    if (r.state === 'pending') { pendingPoints++; continue; }
    const old = have.get(r.id + '|' + rec.test + '|' + rec.date);
    if (old === undefined) perTest[rec.test].new++;
    else if (Math.abs(old - rec.time) <= TIME_TOLERANCE) perTest[rec.test].duplicates++;
    else {
      perTest[rec.test].corrected++;
      corrections.push({ name: rec.name, test: rec.test, date: rec.date, previous: old, next: rec.time });
    }
  }
  let newPoints = 0, duplicates = 0, corrected = 0;
  for (const tab of TEST_TABS) { newPoints += perTest[tab].new; duplicates += perTest[tab].duplicates; corrected += perTest[tab].corrected; }

  const pairStatus = new Map();
  for (const p of analysis.pairs) {
    const e = resolved.get(p.norm);
    const d = decisions[p.key];
    let status = 'pending';
    if (d === 'merge') status = 'merged';
    else if (d === 'new') status = 'new';
    else if (e && e.state === 'merged') status = 'skipped'; // another candidate for this name was merged
    pairStatus.set(p.key, status);
  }
  const pendingPairs = analysis.pairs.filter((p) => pairStatus.get(p.key) === 'pending').length;
  const entries = Array.from(resolved.values());
  return {
    counts: {
      newPoints, duplicates, corrections: corrected,
      newAthletes: entries.filter((e) => e.state === 'new').length,
      pendingMatches: pendingPairs,
    },
    perTest, corrections, pendingPoints, pairStatus,
    athletesInFile: analysis.entries.length,
    canConfirm: pendingPairs === 0 && analysis.entries.length > 0,
  };
}

export function buildPayload(parsed, analysis, decisions, tags, csvText) {
  const resolutions = [];
  for (const e of analysis.entries) {
    if (e.kind !== 'match') continue;
    const merged = e.candidates.find((c) => decisions[pairKey(e.norm, c.athlete.id)] === 'merge');
    if (merged) resolutions.push({ name: e.name, action: 'merge', candidate_id: merged.athlete.id });
    else resolutions.push({ name: e.name, action: 'new', different_from: e.candidates.map((c) => c.athlete.id) });
  }
  const included = new Set(analysis.entries.map((e) => e.norm));
  return {
    fileName: parsed.fileName,
    source: parsed.source,
    csv: csvText,
    tags,
    resolutions,
    athletes: analysis.entries.map((e) => e.name),
    records: parsed.records.filter((r) => included.has(r.norm)).map((r) => ({ name: r.name, test: r.test, date: r.date, time: r.time })),
  };
}
