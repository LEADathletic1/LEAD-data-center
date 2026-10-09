import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, PASSWORD } from './gas-harness.js';
import { buildScenario, makeCsv } from './fixtures/synthetic.js';
import { parseLumin } from '../src/parsers/lumin.js';
import { analyze, computePlan, buildPayload } from '../src/import/plan.js';
import { buildCodeGs } from '../scripts/build-gas.js';
import { readFileSync } from 'node:fs';

const s = buildScenario();

function payloadFor(gas, token, csv, { tags = ['Performance'], decide = {}, fileName = 'x.csv' } = {}) {
  const parsed = parseLumin(csv, fileName);
  const lib = gas.call({ action: 'getLibrary', sessionToken: token });
  const included = new Set(parsed.athletes.filter((a) => !a.invalid).map((a) => a.norm));
  const analysis = analyze(parsed, lib, included);
  const decisions = {};
  for (const p of analysis.pairs) if (decide[p.norm]) decisions[p.key] = decide[p.norm];
  return buildPayload(parsed, analysis, decisions, tags, csv);
}

test('Code.gs is up to date with src/ (run `npm run build:gas` if this fails)', () => {
  assert.equal(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), buildCodeGs());
});

test('a request with no session, a garbled body, or an unknown session returns no data', () => {
  const gas = createGas();
  for (const body of [{ action: 'getLibrary' }, { action: 'getLibrary', sessionToken: '' }, '{not json', 'null', { action: 'getLibrary', sessionToken: 'garbage' }, { action: 'getLibrary', sessionToken: 42 }]) {
    const r = gas.call(body);
    assert.equal(r.ok, false);
    assert.ok(r.error === 'auth' || r.error === 'auth_expired');
    assert.deepEqual(Object.keys(r).sort(), ['error', 'ok'], 'no data keys');
  }
  assert.equal(gas.sheets.size, 0, 'nothing was even touched');
});

test('every data action is refused without a session', () => {
  const gas = createGas();
  for (const action of ['whoami', 'getLibrary', 'commitImport', 'setTags', 'mergeAthletes']) {
    assert.equal(gas.call({ action }).ok, false, action);
  }
  assert.equal(gas.sheets.size, 0);
});

test('the right password gets a session; a wrong one does not', () => {
  const gas = createGas();
  assert.deepEqual(gas.call({ action: 'login', password: 'nope nope nope' }), { ok: false, error: 'auth' });
  assert.deepEqual(gas.call({ action: 'login' }), { ok: false, error: 'auth' });
  assert.deepEqual(gas.call({ action: 'login', password: { x: 1 } }), { ok: false, error: 'auth' });
  const r = gas.call({ action: 'login', password: PASSWORD });
  assert.equal(r.ok, true);
  assert.ok(r.token.length >= 60);
  assert.equal(gas.call({ action: 'whoami', sessionToken: r.token }).ok, true);
  assert.equal(JSON.stringify(r).includes(PASSWORD), false, 'the password is never echoed');
});

test('repeated wrong guesses lock logins, even for the right password, until the lock expires', () => {
  const gas = createGas();
  for (let i = 0; i < 5; i++) assert.equal(gas.call({ action: 'login', password: 'guess ' + i + ' xxxxx' }).error, 'auth');
  assert.deepEqual(gas.call({ action: 'login', password: PASSWORD }), { ok: false, error: 'locked' });
  gas.cacheStore.delete('login_lock'); // the 15 minute cache entry expiring
  assert.equal(gas.call({ action: 'login', password: PASSWORD }).ok, true);
});

test('a successful login resets the failure count', () => {
  const gas = createGas();
  for (let i = 0; i < 4; i++) gas.call({ action: 'login', password: 'wrong wrong ' + i });
  assert.equal(gas.call({ action: 'login', password: PASSWORD }).ok, true);
  for (let i = 0; i < 4; i++) gas.call({ action: 'login', password: 'wrong again ' + i });
  assert.equal(gas.call({ action: 'login', password: PASSWORD }).ok, true, 'not locked: counter restarted');
});

test('an expired session says auth_expired so the page can ask for the password again', () => {
  const gas = createGas();
  const t = gas.goodToken();
  gas.cacheStore.clear(); // CacheService dropped it after its lifetime
  assert.deepEqual(gas.call({ action: 'getLibrary', sessionToken: t }), { ok: false, error: 'auth_expired' });
});

test('changing the password signs everyone out', () => {
  const gas = createGas();
  const t = gas.goodToken();
  assert.equal(gas.call({ action: 'whoami', sessionToken: t }).ok, true);
  gas.props.APP_PASSWORD = 'a brand new passphrase';
  assert.equal(gas.call({ action: 'whoami', sessionToken: t }).ok, false);
});

test('no password set, or one that is too short, means nobody gets in', () => {
  for (const password of [null, '', 'short']) {
    const gas = createGas({ password });
    assert.equal(gas.call({ action: 'login', password: password || '' }).ok, false);
    assert.equal(gas.call({ action: 'getLibrary', sessionToken: 'x' }).ok, false);
  }
});

test('mergeAthletes is reserved for phase 2', () => {
  const gas = createGas();
  assert.deepEqual(gas.call({ action: 'mergeAthletes', sessionToken: gas.goodToken() }), { ok: false, error: 'not_implemented' });
});

test('import end to end: writes, archives, logs; the same file again writes zero rows', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const first = gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvA, { fileName: 'A.csv' }) });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.result.newAthletes, s.roster.length);
  assert.equal(gas.state.archived.length, 1);
  assert.match(gas.state.archived[0].name, /A\.csv$/);
  assert.equal(gas.state.archived[0].content, s.csvA);
  assert.equal(gas.sheets.get('Import Log').dataRows().length, 1);
  assert.equal(gas.state.locked, false, 'lock released');

  const rowsBefore = ['10 Yard', '30 Yard', 'Athletes', 'Corrections'].map((n) => gas.sheets.get(n).dataRows().length);
  const second = gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvA, { fileName: 'A.csv' }) });
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
  gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvA) });
  const b = gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvB, { tags: ['1More'], decide: { 'michael tavarez': 'merge', 'nathen okafor': 'new' } }) });
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
  const lib = gas.call({ action: 'getLibrary', sessionToken: t });
  const tav = lib.athletes.find((a) => a.name === 'Mike Tavarez');
  assert.deepEqual(tav.aliases, ['Michael Tavarez']);
  assert.deepEqual(tav.tags, ['Performance', '1More']);
  const pike = lib.athletes.find((a) => a.name === 'Jordan Pike');
  const row = lib.points['10 Yard'].find((r) => r[0] === pike.id && r[1] === s.correction.date);
  assert.equal(row[2], s.correction.next);
  // Next export with the same spellings: no prompts, nothing to write.
  const again = payloadFor(gas, t, s.csvB, { tags: ['1More'] });
  const r = gas.call({ action: 'commitImport', sessionToken: t, ...again });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.newPoints, 0);
});

test('the server refuses unresolved matches, and writes nothing', () => {
  const gas = createGas();
  const t = gas.goodToken();
  gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvA) });
  const p = payloadFor(gas, t, s.csvB, {});
  const before = gas.sheets.get('Athletes').dataRows().length;
  const r = gas.call({ action: 'commitImport', sessionToken: t, ...p, resolutions: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unresolved_matches');
  assert.equal(gas.sheets.get('Athletes').dataRows().length, before);
});

test('a name beginning with = is written as text and never evaluates', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const evil = '=HYPERLINK("http://example.test","click")';
  const csv = makeCsv([{ name: evil, ten: { '2026-10-01': 1.7 }, thirty: {} }, { name: '-2+3', ten: {}, thirty: {} }, { name: '+cmd', ten: {}, thirty: {} }], ['2026-10-01']);
  const r = gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, csv) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const written = gas.sheets.get('Athletes').writeLog.flatMap((w) => w.vals.flat()).filter((v) => typeof v === 'string');
  assert.equal(gas.sandbox.cell_('@SUM(A1)'), "'@SUM(A1)");
  for (const raw of [evil, '-2+3', '+cmd']) {
    assert.ok(written.includes("'" + raw), 'prefixed with a single quote: ' + raw);
    assert.ok(!written.includes(raw), 'never written bare: ' + raw);
  }
  const lib = gas.call({ action: 'getLibrary', sessionToken: t });
  assert.ok(lib.athletes.some((a) => a.name === evil), 'reads back as the original text');
  // A cell that keeps the quote (plain-text format) is also cleaned up on read.
  const sheet = gas.sheets.get('Athletes');
  const idx = sheet.cells.findIndex((row) => row && row[1] === evil);
  sheet.cells[idx][1] = "'" + evil;
  assert.ok(gas.call({ action: 'getLibrary', sessionToken: t }).athletes.some((a) => a.name === evil));
});

test('tags: bulk add/remove through setTags and the Tag Log', () => {
  const gas = createGas();
  const t = gas.goodToken();
  gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvA) });
  const lib = gas.call({ action: 'getLibrary', sessionToken: t });
  const ids = lib.athletes.slice(0, 3).map((a) => a.id);
  const added = gas.call({ action: 'setTags', sessionToken: t, athlete_ids: ids, add: ['Camp'], remove: ['performance'] });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(added.updated.length, 3);
  assert.ok(added.tags.includes('Camp'));
  const lib2 = gas.call({ action: 'getLibrary', sessionToken: t });
  assert.deepEqual(lib2.athletes.find((a) => a.id === ids[0]).tags, ['Camp']);
  const actions = gas.sheets.get('Tag Log').dataRows().map((r) => r[2] + ':' + r[3]);
  assert.ok(actions.includes('create:Camp') && actions.includes('add:Camp') && actions.includes('remove:Performance'));
  assert.equal(gas.call({ action: 'setTags', sessionToken: t, athlete_ids: ['a_missing'], add: ['X'] }).error, 'unknown_athlete');
});

test('writes are locked; a lock timeout writes nothing; archive failure writes nothing', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const p = payloadFor(gas, t, s.csvA);
  gas.state.lockFails = true;
  assert.equal(gas.call({ action: 'commitImport', sessionToken: t, ...p }).error, 'busy');
  assert.equal(gas.sheets.get('Athletes').dataRows().length, 0);
  gas.state.lockFails = false;
  assert.ok(gas.state.lockCalls >= 1);

  const noArchive = createGas({ archive: false });
  const t2 = noArchive.goodToken();
  const r = noArchive.call({ action: 'commitImport', sessionToken: t2, ...payloadFor(noArchive, t2, s.csvA) });
  assert.equal(r.error, 'archive_failed');
  assert.equal(noArchive.sheets.get('Athletes').dataRows().length, 0);
});

test('bad payloads from an allowed user are rejected without writing', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const r = gas.call({ action: 'commitImport', sessionToken: t, tags: [], athletes: ['A B'], records: [] });
  assert.equal(r.error, 'no_tags');
  assert.equal(gas.call({ action: 'commitImport', sessionToken: t, tags: ['x'], athletes: ['A B'], records: [{ name: 'A B', test: '10 Yard', date: 'nope', time: 1.6 }] }).error, 'bad_record');
  assert.equal(gas.call({ action: 'nope', sessionToken: t }).error, 'unknown_action');
  assert.equal(gas.sheets.get('Athletes').dataRows().length, 0);
});
