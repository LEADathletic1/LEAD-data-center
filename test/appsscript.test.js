import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, jwtLike, CLIENT_ID } from './gas-harness.js';
import { buildScenario, makeCsv } from './fixtures/synthetic.js';
import { parseLumin } from '../src/parsers/lumin.js';
import { analyze, computePlan, buildPayload } from '../src/import/plan.js';
import { buildCodeGs } from '../scripts/build-gas.js';
import { readFileSync } from 'node:fs';

const s = buildScenario();

function payloadFor(gas, token, csv, { tags = ['Performance'], decide = {}, fileName = 'x.csv' } = {}) {
  const parsed = parseLumin(csv, fileName);
  const lib = gas.call({ action: 'getLibrary', idToken: token });
  const included = new Set(parsed.athletes.filter((a) => !a.invalid).map((a) => a.norm));
  const analysis = analyze(parsed, lib, included);
  const decisions = {};
  for (const p of analysis.pairs) if (decide[p.norm]) decisions[p.key] = decide[p.norm];
  return buildPayload(parsed, analysis, decisions, tags, csv);
}

test('Code.gs is up to date with src/ (run `npm run build:gas` if this fails)', () => {
  assert.equal(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), buildCodeGs());
});

test('a request with no token, a garbled body, or an unknown token returns no data', () => {
  const gas = createGas();
  for (const body of [{ action: 'getLibrary' }, { action: 'getLibrary', idToken: '' }, '{not json', { action: 'getLibrary', idToken: 'garbage' }]) {
    const r = gas.call(body);
    assert.deepEqual(r, { ok: false, error: 'auth' });
  }
  assert.equal(gas.sheets.size, 0, 'nothing was even touched');
});

test('an expired token says auth_expired so the page can re-prompt, and returns no data', () => {
  const gas = createGas();
  const t = jwtLike({ aud: CLIENT_ID, email: 'blair@trainatlead.com', exp: String(Math.floor(Date.now() / 1000) - 60) });
  const r = gas.call({ action: 'getLibrary', idToken: t });
  assert.deepEqual(r, { ok: false, error: 'auth_expired' });
});

test('a token that tokeninfo accepts but is expired by its exp claim is refused', () => {
  const gas = createGas();
  const t = gas.goodToken('blair@trainatlead.com', { exp: String(Math.floor(Date.now() / 1000) - 5) });
  assert.equal(gas.call({ action: 'whoami', idToken: t }).error, 'auth_expired');
});

test('a wrong audience, unverified email, or foreign issuer is refused', () => {
  const gas = createGas();
  assert.deepEqual(gas.call({ action: 'whoami', idToken: gas.goodToken('blair@trainatlead.com', { aud: 'someone-elses-app' }) }), { ok: false, error: 'auth' });
  assert.deepEqual(gas.call({ action: 'whoami', idToken: gas.goodToken('blair@trainatlead.com', { email_verified: 'false' }) }), { ok: false, error: 'auth' });
  assert.deepEqual(gas.call({ action: 'whoami', idToken: gas.goodToken('blair@trainatlead.com', { iss: 'https://evil.example' }) }), { ok: false, error: 'auth' });
});

test('an email outside the allow list gets nothing, for every action', () => {
  const gas = createGas();
  const t = gas.goodToken('stranger@example.com');
  for (const action of ['whoami', 'getLibrary', 'commitImport', 'setTags', 'mergeAthletes']) {
    assert.deepEqual(gas.call({ action, idToken: t }), { ok: false, error: 'auth' }, action);
  }
  assert.equal(gas.sheets.size, 0);
});

test('allowed emails get in; the allow list is rechecked even on a cached token', () => {
  const gas = createGas();
  const t = gas.goodToken('Info@TrainAtLead.com');
  assert.deepEqual(gas.call({ action: 'whoami', idToken: t }), { ok: true, email: 'info@trainatlead.com' });
  assert.equal(gas.state.fetchCalls, 1);
  gas.call({ action: 'whoami', idToken: t });
  assert.equal(gas.state.fetchCalls, 1, 'verified token served from cache');
  gas.props.ALLOWED_EMAILS = 'blair@trainatlead.com';
  assert.deepEqual(gas.call({ action: 'whoami', idToken: t }), { ok: false, error: 'auth' });
});

test('mergeAthletes is reserved for phase 2', () => {
  const gas = createGas();
  assert.deepEqual(gas.call({ action: 'mergeAthletes', idToken: gas.goodToken() }), { ok: false, error: 'not_implemented' });
});

test('import end to end: writes, archives, logs; the same file again writes zero rows', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const first = gas.call({ action: 'commitImport', idToken: t, ...payloadFor(gas, t, s.csvA, { fileName: 'A.csv' }) });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.result.newAthletes, s.roster.length);
  assert.equal(gas.state.archived.length, 1);
  assert.match(gas.state.archived[0].name, /A\.csv$/);
  assert.equal(gas.state.archived[0].content, s.csvA);
  assert.equal(gas.sheets.get('Import Log').dataRows().length, 1);
  assert.equal(gas.state.locked, false, 'lock released');

  const rowsBefore = ['10 Yard', '30 Yard', 'Athletes', 'Corrections'].map((n) => gas.sheets.get(n).dataRows().length);
  const second = gas.call({ action: 'commitImport', idToken: t, ...payloadFor(gas, t, s.csvA, { fileName: 'A.csv' }) });
  assert.equal(second.ok, true);
  assert.equal(second.result.newPoints, 0);
  assert.equal(second.result.corrections, 0);
  assert.equal(second.result.newAthletes, 0);
  const rowsAfter = ['10 Yard', '30 Yard', 'Athletes', 'Corrections'].map((n) => gas.sheets.get(n).dataRows().length);
  assert.deepEqual(rowsAfter, rowsBefore);
  assert.equal(gas.sheets.get('Import Log').dataRows().length, 2, 'the attempt is still logged');
});

test('overlap, a corrected time, merge decisions and aliases all land in the right tabs', () => {
  const gas = createGas();
  const t = gas.goodToken();
  gas.call({ action: 'commitImport', idToken: t, ...payloadFor(gas, t, s.csvA) });
  const b = gas.call({ action: 'commitImport', idToken: t, ...payloadFor(gas, t, s.csvB, { tags: ['1More'], decide: { 'michael tavarez': 'merge', 'nathen okafor': 'new' } }) });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.result.corrections, 1);
  assert.equal(b.result.matchesMerged, 1);
  assert.equal(b.result.matchesAddedAsNew, 1);
  const corr = gas.sheets.get('Corrections').dataRows();
  assert.equal(corr.length, 1);
  assert.equal(corr[0][5], s.correction.old);
  assert.equal(corr[0][6], s.correction.next);
  const decisions = gas.sheets.get('Name Decisions').dataRows().map((r) => r[3]).sort();
  assert.deepEqual(decisions, ['alias', 'different']);
  const lib = gas.call({ action: 'getLibrary', idToken: t });
  const tav = lib.athletes.find((a) => a.name === 'Mike Tavarez');
  assert.deepEqual(tav.aliases, ['Michael Tavarez']);
  assert.deepEqual(tav.tags, ['Performance', '1More']);
  const pike = lib.athletes.find((a) => a.name === 'Jordan Pike');
  const row = lib.points['10 Yard'].find((r) => r[0] === pike.id && r[1] === s.correction.date);
  assert.equal(row[2], s.correction.next);
  // Next export with the same spellings: no prompts, nothing to write.
  const again = payloadFor(gas, t, s.csvB, { tags: ['1More'] });
  const r = gas.call({ action: 'commitImport', idToken: t, ...again });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.newPoints, 0);
});

test('the server refuses unresolved matches, and writes nothing', () => {
  const gas = createGas();
  const t = gas.goodToken();
  gas.call({ action: 'commitImport', idToken: t, ...payloadFor(gas, t, s.csvA) });
  const p = payloadFor(gas, t, s.csvB, {});
  const before = gas.sheets.get('Athletes').dataRows().length;
  const r = gas.call({ action: 'commitImport', idToken: t, ...p, resolutions: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unresolved_matches');
  assert.equal(gas.sheets.get('Athletes').dataRows().length, before);
});

test('a name beginning with = is written as text and never evaluates', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const evil = '=HYPERLINK("http://example.test","click")';
  const csv = makeCsv([{ name: evil, ten: { '2026-10-01': 1.7 }, thirty: {} }, { name: '-2+3', ten: {}, thirty: {} }, { name: '+cmd', ten: {}, thirty: {} }], ['2026-10-01']);
  const r = gas.call({ action: 'commitImport', idToken: t, ...payloadFor(gas, t, csv) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const written = gas.sheets.get('Athletes').writeLog.flatMap((w) => w.vals.flat()).filter((v) => typeof v === 'string');
  assert.equal(gas.sandbox.cell_('@SUM(A1)'), "'@SUM(A1)");
  for (const raw of [evil, '-2+3', '+cmd']) {
    assert.ok(written.includes("'" + raw), 'prefixed with a single quote: ' + raw);
    assert.ok(!written.includes(raw), 'never written bare: ' + raw);
  }
  const lib = gas.call({ action: 'getLibrary', idToken: t });
  assert.ok(lib.athletes.some((a) => a.name === evil), 'reads back as the original text');
  // A cell that keeps the quote (plain-text format) is also cleaned up on read.
  const sheet = gas.sheets.get('Athletes');
  const idx = sheet.cells.findIndex((row) => row && row[1] === evil);
  sheet.cells[idx][1] = "'" + evil;
  assert.ok(gas.call({ action: 'getLibrary', idToken: t }).athletes.some((a) => a.name === evil));
});

test('tags: bulk add/remove through setTags and the Tag Log', () => {
  const gas = createGas();
  const t = gas.goodToken();
  gas.call({ action: 'commitImport', idToken: t, ...payloadFor(gas, t, s.csvA) });
  const lib = gas.call({ action: 'getLibrary', idToken: t });
  const ids = lib.athletes.slice(0, 3).map((a) => a.id);
  const added = gas.call({ action: 'setTags', idToken: t, athlete_ids: ids, add: ['Camp'], remove: ['performance'] });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(added.updated.length, 3);
  assert.ok(added.tags.includes('Camp'));
  const lib2 = gas.call({ action: 'getLibrary', idToken: t });
  assert.deepEqual(lib2.athletes.find((a) => a.id === ids[0]).tags, ['Camp']);
  const actions = gas.sheets.get('Tag Log').dataRows().map((r) => r[2] + ':' + r[3]);
  assert.ok(actions.includes('create:Camp') && actions.includes('add:Camp') && actions.includes('remove:Performance'));
  assert.equal(gas.call({ action: 'setTags', idToken: t, athlete_ids: ['a_missing'], add: ['X'] }).error, 'unknown_athlete');
});

test('writes are locked; a lock timeout writes nothing; archive failure writes nothing', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const p = payloadFor(gas, t, s.csvA);
  gas.state.lockFails = true;
  assert.equal(gas.call({ action: 'commitImport', idToken: t, ...p }).error, 'busy');
  assert.equal(gas.sheets.get('Athletes').dataRows().length, 0);
  gas.state.lockFails = false;
  assert.ok(gas.state.lockCalls >= 1);

  const noArchive = createGas({ archive: false });
  const t2 = noArchive.goodToken();
  const r = noArchive.call({ action: 'commitImport', idToken: t2, ...payloadFor(noArchive, t2, s.csvA) });
  assert.equal(r.error, 'archive_failed');
  assert.equal(noArchive.sheets.get('Athletes').dataRows().length, 0);
});

test('bad payloads from an allowed user are rejected without writing', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const r = gas.call({ action: 'commitImport', idToken: t, tags: [], athletes: ['A B'], records: [] });
  assert.equal(r.error, 'no_tags');
  assert.equal(gas.call({ action: 'commitImport', idToken: t, tags: ['x'], athletes: ['A B'], records: [{ name: 'A B', test: '10 Yard', date: 'nope', time: 1.6 }] }).error, 'bad_record');
  assert.equal(gas.call({ action: 'nope', idToken: t }).error, 'unknown_action');
  assert.equal(gas.sheets.get('Athletes').dataRows().length, 0);
});
