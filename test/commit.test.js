import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from './fixtures/synthetic.js';
import { runImport, makeCtx, computeSetTags, applyChanges, emptyLibrary } from './helpers.js';
import { computeCommit } from '../src/import/commit.js';
import { makeCsv } from './fixtures/synthetic.js';

const s = buildScenario();
const total = (lib) => lib.points['10 Yard'].length + lib.points['30 Yard'].length;

test('uploading the same file twice writes zero rows', () => {
  const lib = emptyLibrary();
  const first = runImport(lib, s.csvA);
  assert.ok(first.out.ok);
  assert.equal(first.out.result.newPoints, first.parsed.records.length);
  const pointsAfterFirst = total(lib);
  const athletesAfterFirst = lib.athletes.length;

  const second = runImport(lib, s.csvA);
  assert.ok(second.out.ok);
  assert.equal(second.out.result.newPoints, 0);
  assert.equal(second.out.result.corrections, 0);
  assert.equal(second.out.result.newAthletes, 0);
  assert.equal(second.out.result.duplicates, first.parsed.records.length);
  assert.equal(total(lib), pointsAfterFirst);
  assert.equal(lib.athletes.length, athletesAfterFirst);
  assert.equal(lib.corrections.length, 0);
});

test('overlapping exports write only the dates not already stored', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const before = total(lib);
  const b = runImport(lib, s.csvB, { decisions: decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'merge' }) });
  assert.ok(b.out.ok, JSON.stringify(b.out));
  const overlap = new Set(s.datesA.filter((d) => s.datesB.includes(d)));
  // Everything on an overlapping date that A already held is a duplicate or correction, never a new row.
  const newDates = b.out.changes.appendPoints['10 Yard'].concat(b.out.changes.appendPoints['30 Yard']);
  const stored = new Set(lib.points['10 Yard'].slice(0, before).map((r) => r[0] + r[1]));
  for (const row of newDates) assert.ok(!stored.has(row[0] + row[1]) || !overlap.has(row[1]));
  assert.equal(total(lib), before + b.out.result.newPoints);
  assert.ok(b.out.result.duplicates > 0);
});

function decide(lib, csv, choices) {
  // choices: { 'michael tavarez': 'merge' | 'new' }, resolved against whatever candidates exist.
  const first = runImport(structuredClone(lib), csv, {});
  const decisions = {};
  for (const p of first.analysis.pairs) if (choices[p.norm]) decisions[p.key] = choices[p.norm];
  return decisions;
}

test('a changed time overwrites the old one and logs the old value in Corrections', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'merge' });
  const b = runImport(lib, s.csvB, { decisions });
  assert.ok(b.out.ok, JSON.stringify(b.out));
  assert.equal(b.out.result.corrections, 1);
  assert.equal(lib.corrections.length, 1);
  const c = lib.corrections[0];
  const pike = lib.athletes.find((a) => a.name === 'Jordan Pike');
  assert.equal(c[2], pike.id);
  assert.equal(c[3], '10 Yard');
  assert.equal(c[4], s.correction.date);
  assert.equal(c[5], s.correction.old);
  assert.equal(c[6], s.correction.next);
  const stored = lib.points['10 Yard'].find((r) => r[0] === pike.id && r[1] === s.correction.date);
  assert.equal(stored[2], s.correction.next);
  assert.equal(b.plan.counts.corrections, 1, 'preview agrees with the server');
});

test('preview counts match the authoritative server counts', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'new' });
  const b = runImport(lib, s.csvB, { decisions });
  assert.ok(b.out.ok);
  assert.equal(b.plan.counts.newPoints, b.out.result.newPoints);
  assert.equal(b.plan.counts.duplicates, b.out.result.duplicates);
  assert.equal(b.plan.counts.corrections, b.out.result.corrections);
  assert.equal(b.plan.counts.newAthletes, b.out.result.newAthletes);
  assert.equal(b.plan.counts.pendingMatches, 0);
});

test('same-athlete spellings resolve to one athlete: Dash Murphy and Austin Doyle Jr.', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const n = lib.athletes.length;
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'merge' });
  runImport(lib, s.csvB, { decisions });
  assert.equal(lib.athletes.filter((a) => /dash murphy/i.test(a.name)).length, 1);
  assert.equal(lib.athletes.filter((a) => /austin doyle/i.test(a.name)).length, 1);
  assert.equal(lib.athletes.length, n + 3, 'Rowan Ellis, Quinn Vale and Sprint Outlier are new; email profile excluded');
});

test('Mike vs Michael Tavarez is flagged; Brody and Roxy Smith are not', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const b = runImport(lib, s.csvB, {});
  const names = b.analysis.pairs.map((p) => p.name);
  assert.ok(names.includes('Michael Tavarez'));
  assert.ok(names.includes('Nathen Okafor'));
  assert.ok(!names.some((n) => /smith/i.test(n)));
  assert.equal(b.plan.counts.pendingMatches, 2);
  assert.equal(b.plan.canConfirm, false);
});

test('Confirm stays disabled while name matches are undecided, and the server also refuses them', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const before = lib.athletes.length;
  const b = runImport(lib, s.csvB, {});
  assert.equal(b.out.ok, false);
  assert.equal(b.plan.canConfirm, false);
  // A client that skips the UI and sends no resolutions is refused by the server.
  const direct = computeCommit(lib, { ...b.payload, resolutions: [] }, makeCtx());
  assert.equal(direct.error, 'unresolved_matches');
  assert.equal(lib.athletes.length, before);
});

test('after Merge, the next export using the new spelling maps with no prompt', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'merge' });
  runImport(lib, s.csvB, { decisions });
  const tav = lib.athletes.find((a) => a.name === 'Mike Tavarez');
  assert.deepEqual(tav.aliases, ['Michael Tavarez']);
  assert.ok(lib.decisions.some((d) => d.decision === 'alias'));
  const again = runImport(lib, s.csvB, {});
  assert.ok(again.out.ok);
  assert.equal(again.analysis.pairs.length, 0);
  assert.equal(again.out.result.newPoints, 0);
});

test('after Add as new, the pair is never flagged again', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'new', 'nathen okafor': 'new' });
  const b = runImport(lib, s.csvB, { decisions });
  assert.ok(b.out.ok);
  assert.equal(b.out.result.matchesAddedAsNew, 2);
  assert.ok(lib.athletes.some((a) => a.name === 'Michael Tavarez'));
  assert.ok(lib.athletes.some((a) => a.name === 'Mike Tavarez'));
  const again = runImport(lib, s.csvB, {});
  assert.ok(again.out.ok);
  assert.equal(again.analysis.pairs.length, 0);
});

test('athletes with no times are registered and tagged; excluded names are not imported', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'merge' });
  runImport(lib, s.csvB, { tags: ['1More'], decisions });
  const quinn = lib.athletes.find((a) => a.name === 'Quinn Vale');
  assert.ok(quinn);
  assert.deepEqual(quinn.tags, ['1More']);
  assert.ok(!lib.athletes.some((a) => a.name.includes('@')), 'email profile is excluded by default');
});

test('an excluded name can be included on purpose', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA);
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'merge' });
  runImport(lib, s.csvB, { decisions, include: () => true });
  assert.ok(lib.athletes.some((a) => a.name.includes('@')));
});

test('tags union on re-upload and never replace', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA, { tags: ['Performance'] });
  const decisions = decide(lib, s.csvB, { 'michael tavarez': 'merge', 'nathen okafor': 'merge' });
  runImport(lib, s.csvB, { tags: ['1More', 'performance'], decisions });
  const pike = lib.athletes.find((a) => a.name === 'Jordan Pike');
  assert.deepEqual(pike.tags, ['Performance', '1More']);
  assert.ok(lib.tagLog.some((t) => t.action === 'add' && t.tag === '1More'));
  assert.equal(lib.tags.filter((t) => t.toLowerCase() === 'performance').length, 1, 'case-insensitive uniqueness');
});

test('athletes not in a later file keep exactly their existing tags', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA, { tags: ['Performance'] });
  const subset = makeCsv(s.roster.slice(8, 11), s.datesA);
  runImport(lib, subset, { tags: ['1More'] });
  const inSubset = new Set(s.roster.slice(8, 11).map((p) => p.name));
  for (const a of lib.athletes) {
    assert.deepEqual(a.tags, inSubset.has(a.name) ? ['Performance', '1More'] : ['Performance']);
  }
});

test('every upload needs at least one valid tag', () => {
  const lib = emptyLibrary();
  const out = runImport(lib, s.csvA, { tags: [] }).out;
  assert.equal(out.error, 'no_tags');
  assert.equal(runImport(lib, s.csvA, { tags: ['a,b'] }).out.error, 'bad_tag');
  assert.equal(runImport(lib, s.csvA, { tags: ['x'.repeat(31)] }).out.error, 'bad_tag');
  assert.equal(lib.athletes.length, 0, 'nothing was written');
});

test('the server never trusts client data shapes', () => {
  const lib = emptyLibrary();
  const base = { tags: ['Performance'], athletes: ['A B'], records: [{ name: 'A B', test: '10 Yard', date: '2026-01-01', time: 1.6 }] };
  const bad = (mut) => computeCommit(lib, { ...base, ...mut }, makeCtx()).error;
  assert.equal(bad({ records: [{ name: 'A B', test: '99 Yard', date: '2026-01-01', time: 1.6 }] }), 'bad_record');
  assert.equal(bad({ records: [{ name: 'A B', test: '10 Yard', date: '01/01/2026', time: 1.6 }] }), 'bad_record');
  assert.equal(bad({ records: [{ name: 'A B', test: '10 Yard', date: '2026-01-01', time: '1.6' }] }), 'bad_record');
  assert.equal(bad({ records: [{ name: 'Someone Else', test: '10 Yard', date: '2026-01-01', time: 1.6 }] }), 'bad_record');
  assert.equal(bad({ athletes: ['   '] }), 'bad_name');
});

test('bulk add and remove work, and are logged to the Tag Log', () => {
  const lib = emptyLibrary();
  runImport(lib, s.csvA, { tags: ['Performance'] });
  const ids = lib.athletes.slice(0, 3).map((a) => a.id);
  let r = computeSetTags(lib, { athlete_ids: ids, add: ['1More'], remove: [] }, makeCtx());
  assert.ok(r.ok);
  applyChanges(lib, r.changes);
  assert.ok(ids.every((id) => lib.athletes.find((a) => a.id === id).tags.includes('1More')));
  r = computeSetTags(lib, { athlete_ids: ids.slice(0, 2), add: [], remove: ['1more'] }, makeCtx());
  applyChanges(lib, r.changes);
  assert.deepEqual(lib.athletes.find((a) => a.id === ids[0]).tags, ['Performance']);
  assert.ok(lib.athletes.find((a) => a.id === ids[2]).tags.includes('1More'));
  const actions = lib.tagLog.map((t) => t.action + ':' + t.tag);
  assert.ok(actions.includes('add:1More') && actions.includes('remove:1More'));
  const create = computeSetTags(lib, { athlete_ids: ids, add: ['Camp 2026'], remove: [] }, makeCtx());
  applyChanges(lib, create.changes);
  assert.ok(lib.tagLog.some((t) => t.action === 'create' && t.tag === 'Camp 2026'));
  assert.ok(lib.tags.includes('Camp 2026'));
  assert.equal(computeSetTags(lib, { athlete_ids: ['a_nope'], add: ['X'], remove: [] }, makeCtx()).error, 'unknown_athlete');
});
