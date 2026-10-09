import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLumin, ImportBlockedError } from '../src/parsers/lumin.js';
import { buildScenario, makeCsv } from './fixtures/synthetic.js';

const s = buildScenario();

function countCells(people, dates, key) {
  let n = 0;
  for (const p of people) for (const d of dates) if (p[key] && p[key][d] !== undefined) n++;
  return n;
}

test('parses to one record per non-blank cell and ignores Min, Max and Average', () => {
  const p = parseLumin(s.csvA, 'a.csv');
  const expected = countCells(s.roster, s.datesA, 'ten') + countCells(s.roster, s.datesA, 'thirty');
  assert.equal(p.records.length, expected);
  assert.equal(p.rowCount, s.roster.length * 2);
  assert.equal(p.athletes.length, s.roster.length);
  assert.equal(p.dates.length, 12);
  for (const r of p.records) assert.ok(r.time > 1 && r.time < 6, 'no summary value leaked in');
});

test('files each test under its own tab', () => {
  const p = parseLumin(s.csvA);
  const ten = p.tests.find((t) => t.tab === '10 Yard');
  const thirty = p.tests.find((t) => t.tab === '30 Yard');
  assert.equal(ten.luminNames[0], '10 Yard Sprint (1 Yard Build)');
  assert.equal(ten.points + thirty.points, p.records.length);
  assert.equal(p.records.filter((r) => r.test === '10 Yard').length, ten.points);
});

test('date columns are found by name, not position', () => {
  const asc = parseLumin(makeCsv(s.roster, s.datesA, { columnOrder: 'asc' }));
  const desc = parseLumin(s.csvA);
  assert.equal(asc.records.length, desc.records.length);
});

test('an unknown test or metric blocks the import with a clear message', () => {
  const bad = s.csvA.replace('30 Yard Sprint', '40 Yard Dash');
  assert.throws(() => parseLumin(bad), (e) => e instanceof ImportBlockedError && /Unknown test "40 Yard Dash"/.test(e.messages[0]));
  const badMetric = s.csvA.replaceAll('Elapsed Time (ss:ms)', 'Velocity (mph)');
  assert.throws(() => parseLumin(badMetric), (e) => e instanceof ImportBlockedError && /Unknown metric "Velocity \(mph\)"/.test(e.messages[0]));
});

test('a non-numeric cell blocks the import and names the row and column', () => {
  const lines = s.csvA.split('\r\n');
  const cols = lines[0].split(',');
  const row = lines[1].split(',');
  const dateIdx = cols.findIndex((c) => c === s.datesA[3]);
  row[dateIdx] = 'DNF';
  lines[1] = row.join(',');
  assert.throws(() => parseLumin(lines.join('\r\n')), (e) => e.messages.some((m) => m.includes('Row 2') && m.includes(s.datesA[3]) && m.includes('"DNF"')));
});

test('rejects a file that is not a Lumin report', () => {
  assert.throws(() => parseLumin('Name,Score\nA,1\n'), /Missing column/);
  assert.throws(() => parseLumin(''), /empty/);
});

test('names with @ are flagged, and athletes with no times are still registered', () => {
  const p = parseLumin(s.csvB);
  const email = p.athletes.find((a) => a.name.includes('@'));
  assert.equal(email.invalid, 'email');
  const quinn = p.athletes.find((a) => a.name === 'Quinn Vale');
  assert.ok(quinn, 'registered');
  assert.equal(quinn.pointCount, 0);
});

test('soft outlier warnings do not block', () => {
  const p = parseLumin(s.csvB);
  assert.equal(p.outliers.length, 2);
  assert.ok(p.outliers.some((o) => o.test === '10 Yard' && o.time === 0.85));
  assert.ok(p.outliers.some((o) => o.test === '30 Yard' && o.time === 9.2));
});

test('same athlete, test and date twice with different values: warn and keep the later one', () => {
  const lines = s.csvA.split('\r\n');
  const first = lines[1].split(',');
  const cols = lines[0].split(',');
  const di = cols.indexOf(s.datesA[11]);
  const dup = first.slice();
  first[di] = '1.600';
  dup[di] = '1.650';
  lines.splice(1, 1, first.join(','));
  lines.splice(2, 0, dup.join(','));
  const p = parseLumin(lines.join('\r\n'));
  assert.equal(p.inFileDuplicates.length, 1);
  assert.equal(p.inFileDuplicates[0].kept, 1.65);
  const r = p.records.find((x) => x.date === s.datesA[11] && x.test === '10 Yard' && x.name === first[0]);
  assert.equal(r.time, 1.65);
});
