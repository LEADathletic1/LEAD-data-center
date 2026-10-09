// Applies a change set from commit.js to an in-memory library. Used by the mock backend and tests.
// (Apps Script applies the same change set to the Sheet tabs instead.)

import { TEST_TABS, STARTER_TAGS } from '../tests.js';
import { unionTags } from './tags.js';

export function emptyLibrary() {
  const points = {};
  for (const tab of TEST_TABS) points[tab] = [];
  return {
    athletes: [], points, decisions: [], tags: STARTER_TAGS.slice(),
    corrections: [], tagLog: [], importLog: [], archive: [],
  };
}

export function applyChanges(lib, changes) {
  const byId = new Map(lib.athletes.map((a) => [a.id, a]));
  for (const a of changes.newAthletes || []) lib.athletes.push({ ...a, tags: a.tags.slice(), aliases: a.aliases.slice() });
  for (const u of changes.updatedAthletes || []) {
    const a = byId.get(u.id);
    if (!a) continue;
    a.tags = u.tags.slice();
    if (u.aliases) a.aliases = u.aliases.slice();
  }
  for (const tab of Object.keys(changes.appendPoints || {})) {
    for (const row of changes.appendPoints[tab]) lib.points[tab].push(row.slice());
  }
  for (const tab of Object.keys(changes.updatePoints || {})) {
    for (const u of changes.updatePoints[tab]) lib.points[tab][u.row][2] = u.time;
  }
  for (const c of changes.corrections || []) lib.corrections.push(c);
  for (const d of changes.decisions || []) lib.decisions.push(d);
  for (const t of changes.tagLog || []) lib.tagLog.push(t);
  if (changes.importLog) lib.importLog.push(changes.importLog);
  lib.tags = unionTags(lib.tags, changes.createdTags || []);
  for (const a of lib.athletes) lib.tags = unionTags(lib.tags, a.tags);
}

// The shape the front end receives from getLibrary (points are compact arrays).
export function toClientLibrary(lib) {
  const points = {};
  for (const tab of TEST_TABS) points[tab] = lib.points[tab].map((r) => [r[0], r[1], r[2], r[3]]);
  const last = lib.importLog.length ? lib.importLog[lib.importLog.length - 1] : null;
  return {
    athletes: lib.athletes.map((a) => ({ ...a, tags: a.tags.slice(), aliases: a.aliases.slice() })),
    points,
    tags: lib.tags.slice(),
    decisions: lib.decisions.map((d) => ({ pair_key: d.pair_key, athlete_id: d.athlete_id, incoming_name: d.incoming_name, decision: d.decision })),
    lastImport: last ? { ...last } : null,
    tests: TEST_TABS.slice(),
  };
}
