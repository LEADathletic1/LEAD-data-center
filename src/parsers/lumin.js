// Adapter for the Lumin "Physical Testing Report" CSV export.
// Other sources (Swift, the old Google Sheet) get their own adapter that returns the same shape.

import { parseCSV } from '../csv.js';
import { normalizeName } from '../import/normalize.js';
import { DATE_RE, TIME_TOLERANCE, isValidIsoDate } from '../tests.js';

export const SOURCE = 'lumin';

// Lumin test name (prefix, case-insensitive) -> library tab. Unknown tests block the import.
export const TEST_MAP = [
  { prefix: '10 yard sprint', tab: '10 Yard', label: '10 Yard Sprint', outlier: [1.0, 4.0] },
  { prefix: '30 yard sprint', tab: '30 Yard', label: '30 Yard Sprint', outlier: [3.0, 8.0] },
];
export const KNOWN_METRICS = ['elapsed time (ss:ms)'];
const MAX_ERRORS = 25;

export class ImportBlockedError extends Error {
  constructor(messages) {
    super(messages[0]);
    this.name = 'ImportBlockedError';
    this.messages = messages;
  }
}

function mapTest(raw) {
  const t = raw.trim().toLowerCase();
  return TEST_MAP.find((m) => t.startsWith(m.prefix)) || null;
}

export function parseLumin(text, fileName = '') {
  let rows;
  try { rows = parseCSV(text); } catch (e) { throw new ImportBlockedError([e.message]); }
  if (!rows.length) throw new ImportBlockedError(['The file is empty.']);

  const header = rows[0].map((h) => h.trim());
  const colIndex = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iAthlete = colIndex('Athlete'), iTest = colIndex('Test'), iMetric = colIndex('Metric');
  const missing = [['Athlete', iAthlete], ['Test', iTest], ['Metric', iMetric]].filter((x) => x[1] < 0).map((x) => x[0]);
  if (missing.length) {
    throw new ImportBlockedError(['This does not look like a Lumin Physical Testing Report. Missing column: ' + missing.join(', ') + '.']);
  }
  // Date columns are found by name, never by position; they vary by export.
  const dateCols = [];
  header.forEach((h, i) => { if (DATE_RE.test(h)) dateCols.push({ date: h, i }); });
  if (!dateCols.length) throw new ImportBlockedError(['No date columns (YYYY-MM-DD) were found in the header row.']);
  const badDates = dateCols.filter((c) => !isValidIsoDate(c.date)).map((c) => c.date);
  if (badDates.length) throw new ImportBlockedError(['Invalid date in header: ' + badDates.join(', ') + '.']);

  const errors = [];
  const addError = (msg) => { if (errors.length < MAX_ERRORS) errors.push(msg); else errors.moreCount = (errors.moreCount || 0) + 1; };
  const unknownTests = new Map();
  const unknownMetrics = new Map();

  let rowCount = 0;
  let blankNameRows = 0;
  const athletes = new Map(); // norm -> { name, norm, invalid }
  const keyed = new Map(); // norm|tab|date -> record
  const inFileDuplicates = [];
  const testInfo = new Map(); // tab -> { label, tab, luminNames:Set }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c.trim() === '')) continue;
    rowCount++;
    const fileRow = r + 1;
    const name = (row[iAthlete] || '').trim();
    const testRaw = (row[iTest] || '').trim();
    const metric = (row[iMetric] || '').trim();

    const test = mapTest(testRaw);
    if (!test) { if (!unknownTests.has(testRaw)) unknownTests.set(testRaw, fileRow); continue; }
    if (KNOWN_METRICS.indexOf(metric.toLowerCase()) < 0) { if (!unknownMetrics.has(metric)) unknownMetrics.set(metric, fileRow); continue; }

    if (!testInfo.has(test.tab)) testInfo.set(test.tab, { label: test.label, tab: test.tab, luminNames: new Set() });
    testInfo.get(test.tab).luminNames.add(testRaw);

    const norm = normalizeName(name);
    if (!norm) { blankNameRows++; continue; }
    if (!athletes.has(norm)) athletes.set(norm, { name, norm, invalid: name.indexOf('@') >= 0 ? 'email' : null, pointCount: 0 });

    for (const col of dateCols) {
      const cell = (row[col.i] ?? '').trim();
      if (cell === '') continue;
      if (!/^\d+(\.\d+)?$/.test(cell)) { addError('Row ' + fileRow + ', column ' + col.date + ': "' + cell + '" is not a number.'); continue; }
      const time = Number(cell);
      const key = norm + '|' + test.tab + '|' + col.date;
      const prev = keyed.get(key);
      if (prev && Math.abs(prev.time - time) > TIME_TOLERANCE) {
        inFileDuplicates.push({ name: athletes.get(norm).name, test: test.tab, date: col.date, kept: time, discarded: prev.time });
      }
      keyed.set(key, { name: athletes.get(norm).name, norm, test: test.tab, date: col.date, time });
    }
  }

  const blocked = [];
  for (const [t, row] of unknownTests) {
    blocked.push('Unknown test "' + t + '" (first seen on row ' + row + '). Add it to the test table in src/parsers/lumin.js before importing.');
  }
  for (const [m, row] of unknownMetrics) {
    blocked.push('Unknown metric "' + m + '" (first seen on row ' + row + '). Only Elapsed Time (ss:ms) is supported.');
  }
  if (blocked.length || errors.length) {
    const all = blocked.concat(errors);
    if (errors.moreCount) all.push('...and ' + errors.moreCount + ' more.');
    throw new ImportBlockedError(all);
  }

  const records = Array.from(keyed.values());
  const outliers = [];
  const perTest = new Map();
  for (const rec of records) {
    athletes.get(rec.norm).pointCount++;
    const t = TEST_MAP.find((m) => m.tab === rec.test);
    if (rec.time < t.outlier[0] || rec.time > t.outlier[1]) {
      outliers.push({ name: rec.name, test: rec.test, date: rec.date, time: rec.time, low: t.outlier[0], high: t.outlier[1] });
    }
    if (!perTest.has(rec.test)) perTest.set(rec.test, { points: 0, athletes: new Set(), dates: new Set() });
    const p = perTest.get(rec.test);
    p.points++; p.athletes.add(rec.norm); p.dates.add(rec.date);
  }

  const tests = Array.from(testInfo.values()).map((t) => {
    const p = perTest.get(t.tab) || { points: 0, athletes: new Set(), dates: new Set() };
    return {
      label: t.label, tab: t.tab, luminNames: Array.from(t.luminNames),
      points: p.points, athletesWithTimes: p.athletes.size, dates: Array.from(p.dates).sort(),
    };
  });

  return {
    source: SOURCE,
    fileName,
    rowCount,
    dates: dateCols.map((c) => c.date),
    athletes: Array.from(athletes.values()),
    tests,
    records,
    outliers,
    inFileDuplicates,
    blankNameRows,
  };
}
