import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, PASSWORD, NAME } from './gas-harness.js';
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

test('a request with no session, a garbled body, or a bad session returns no data', () => {
  const gas = createGas();
  for (const body of [{ action: 'getLibrary' }, { action: 'getLibrary', sessionToken: '' }, '{not json', 'null', { action: 'getLibrary', sessionToken: 'garbage' }, { action: 'getLibrary', sessionToken: 'a.b' }, { action: 'getLibrary', sessionToken: 42 }]) {
    const r = gas.call(body);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'auth');
    assert.deepEqual(Object.keys(r).sort(), ['error', 'ok'], 'no data keys');
  }
  assert.equal(gas.sheets.size, 0, 'nothing was even touched');
});

test('every data action is refused without a session', () => {
  const gas = createGas();
  for (const action of ['whoami', 'getLibrary', 'commitImport', 'setTags', 'mergeAthletes', 'changePassword']) {
    assert.equal(gas.call({ action }).ok, false, action);
  }
  assert.equal(gas.sheets.size, 0);
});

test('login: right password returns a signed token carrying the name; wrong password is "bad_password"', () => {
  const gas = createGas();
  assert.deepEqual(gas.login('wrong wrong wrong', NAME), { ok: false, error: 'bad_password' });
  assert.deepEqual(gas.call({ action: 'login', displayName: NAME }), { ok: false, error: 'bad_password' });
  assert.deepEqual(gas.call({ action: 'login', password: { x: 1 }, displayName: NAME }), { ok: false, error: 'bad_password' });
  assert.deepEqual(gas.login(PASSWORD, '   '), { ok: false, error: 'name_required' });
  const r = gas.login(PASSWORD, '  Coach   Dana \n');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'Coach Dana');
  const [payload, sig] = r.token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.deepEqual(Object.keys(data).sort(), ['exp', 'name', 'ver']);
  assert.equal(data.name, 'Coach Dana');
  assert.ok(sig.length > 20);
  assert.equal(data.exp - Math.floor(Date.now() / 1000) > 6.9 * 86400, true, 'sessions last 7 days');
  assert.equal(gas.call({ action: 'whoami', sessionToken: r.token }).name, 'Coach Dana');
  assert.equal(JSON.stringify(r).includes(PASSWORD), false, 'the password is never echoed');
});

test('tampered, re-signed-with-wrong-key, expired and out-of-date tokens are refused', () => {
  const gas = createGas();
  const t = gas.goodToken();
  const [payload, sig] = t.split('.');
  const edit = (patch) => Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...patch })).toString('base64url');
  assert.equal(gas.call({ action: 'whoami', sessionToken: edit({ name: 'Someone Else' }) + '.' + sig }).error, 'auth', 'edited name');
  assert.equal(gas.call({ action: 'whoami', sessionToken: edit({ exp: 9999999999 }) + '.' + sig }).error, 'auth', 'edited expiry');
  assert.equal(gas.call({ action: 'whoami', sessionToken: payload + '.' + sig.slice(0, -2) + 'xx' }).error, 'auth', 'bad signature');
  // Correctly signed, but old: ask the page to sign in again.
  const signed = (patch) => { const p = edit(patch); return p + '.' + gas.sandbox.sign_(p); };
  assert.equal(gas.call({ action: 'whoami', sessionToken: signed({}) }).ok, true, 'control: harness signing works');
  assert.equal(gas.call({ action: 'whoami', sessionToken: signed({ exp: Math.floor(Date.now() / 1000) - 5 }) }).error, 'auth_expired');
  assert.equal(gas.call({ action: 'whoami', sessionToken: signed({ ver: 0 }) }).error, 'auth_expired');
});

test('failed logins are throttled: 2s, 4s, 6s, 8s, then 10s at most; a good login resets it', () => {
  const gas = createGas();
  for (let i = 0; i < 7; i++) gas.login('guess ' + i + ' xxxxxxxx');
  assert.deepEqual(gas.state.sleeps.map((ms) => ms / 1000), [2, 4, 6, 8, 10, 10]);
  gas.state.sleeps.length = 0;
  assert.equal(gas.login(PASSWORD).ok, true, 'still able to sign in with the right password');
  assert.deepEqual(gas.state.sleeps, [10000], 'the attempt itself is delayed');
  gas.state.sleeps.length = 0;
  gas.login('wrong again xxx');
  assert.deepEqual(gas.state.sleeps, [], 'counter was reset by the good login');
  gas.cacheStore.clear(); // 15 quiet minutes
  gas.login('x'.repeat(14));
  assert.deepEqual(gas.state.sleeps, []);
});

test('changePassword needs a valid session and the current password, enforces 12 characters, and signs everyone out', () => {
  const gas = createGas();
  const t1 = gas.goodToken('Coach A');
  const t2 = gas.goodToken('Coach B');
  const next = 'a brand new passphrase';
  assert.equal(gas.call({ action: 'changePassword', currentPassword: PASSWORD, newPassword: next }).error, 'auth', 'no session');
  assert.equal(gas.call({ action: 'changePassword', sessionToken: t1, currentPassword: 'not it at all', newPassword: next }).error, 'bad_password');
  assert.equal(gas.call({ action: 'changePassword', sessionToken: t1, currentPassword: PASSWORD, newPassword: 'too short' }).error, 'weak_password');
  assert.equal(gas.call({ action: 'changePassword', sessionToken: t1, currentPassword: PASSWORD, newPassword: 'x'.repeat(11) }).error, 'weak_password');
  assert.equal(gas.call({ action: 'whoami', sessionToken: t1 }).ok, true, 'refused changes leave sessions alone');
  const ok = gas.call({ action: 'changePassword', sessionToken: t1, currentPassword: PASSWORD, newPassword: next });
  assert.deepEqual(ok, { ok: true });
  for (const t of [t1, t2]) assert.equal(gas.call({ action: 'whoami', sessionToken: t }).error, 'auth_expired', 'every session ends, including the changer');
  assert.equal(gas.login(PASSWORD).error, 'bad_password');
  assert.equal(gas.call({ action: 'login', password: next, displayName: NAME }).ok, true);
});

test('initSetup: stores a salted hash, deletes INITIAL_PASSWORD, and re-running it recovers a lost password', () => {
  const gas = createGas();
  assert.equal('INITIAL_PASSWORD' in gas.props, false);
  for (const k of ['PASSWORD_HASH', 'PASSWORD_SALT', 'PASSWORD_VERSION', 'SESSION_SECRET']) assert.ok(gas.props[k], k);
  assert.equal(gas.props.PASSWORD_VERSION, '1');
  const t = gas.goodToken();
  const secret = gas.props.SESSION_SECRET;
  gas.props.INITIAL_PASSWORD = 'recovery passphrase 99';
  gas.sandbox.initSetup();
  assert.equal('INITIAL_PASSWORD' in gas.props, false);
  assert.equal(gas.props.PASSWORD_VERSION, '2');
  assert.equal(gas.props.SESSION_SECRET, secret, 'secret kept');
  assert.equal(gas.call({ action: 'whoami', sessionToken: t }).error, 'auth_expired', 'old sessions end');
  assert.equal(gas.login(PASSWORD).error, 'bad_password');
  assert.equal(gas.call({ action: 'login', password: 'recovery passphrase 99', displayName: NAME }).ok, true);
  gas.props.INITIAL_PASSWORD = 'short';
  assert.throws(() => gas.sandbox.initSetup(), /at least 12/);
});

test('before initSetup runs, nobody can sign in or read anything', () => {
  const gas = createGas({ setup: false });
  assert.deepEqual(gas.call({ action: 'login', password: PASSWORD, displayName: NAME }), { ok: false, error: 'not_configured' });
  assert.equal(gas.call({ action: 'getLibrary', sessionToken: 'a.b' }).ok, false);
});

test('no plaintext password exists in code, properties, logs, responses or the Sheet', () => {
  const gas = createGas();
  const t = gas.goodToken();
  gas.login('some wrong guess');
  gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvA) });
  gas.call({ action: 'changePassword', sessionToken: gas.goodToken(), currentPassword: 'nope nope nope', newPassword: 'x'.repeat(14) });
  const everything = JSON.stringify({
    props: gas.props, logs: gas.logs, cache: [...gas.cacheStore.entries()],
    sheets: [...gas.sheets.values()].map((sh) => sh.cells), writes: [...gas.sheets.values()].map((sh) => sh.writeLog),
  });
  assert.equal(everything.includes(PASSWORD), false);
  assert.equal('INITIAL_PASSWORD' in gas.props, false, 'the temporary property is gone');
  assert.equal(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8').includes(PASSWORD), false);
  assert.equal(/INITIAL_PASSWORD|APP_PASSWORD/.test(JSON.stringify(gas.call({ action: 'getLibrary', sessionToken: t }))), false);
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

test('the signed-in display name is recorded in Import Log, Tag Log and Corrections', () => {
  const gas = createGas();
  const t = gas.goodToken('Coach Dana');
  gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvA) });
  gas.call({ action: 'commitImport', sessionToken: t, ...payloadFor(gas, t, s.csvB, { decide: { 'michael tavarez': 'merge', 'nathen okafor': 'new' } }) });
  const ids = gas.call({ action: 'getLibrary', sessionToken: t }).athletes.slice(0, 2).map((a) => a.id);
  gas.call({ action: 'setTags', sessionToken: t, athlete_ids: ids, add: ['Camp'] });
  const header = (n) => gas.sheets.get(n).cells[0];
  for (const name of ['Import Log', 'Tag Log', 'Corrections']) {
    const col = header(name).indexOf('user_name');
    assert.ok(col >= 0, name + ' has a user_name column');
    const rows = gas.sheets.get(name).dataRows();
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r[col] === 'Coach Dana'), name);
  }
  assert.ok(gas.sheets.get('Name Decisions').dataRows().every((r) => r[4] === 'Coach Dana'));
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
