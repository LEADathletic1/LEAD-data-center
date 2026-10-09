// Synthetic data only. Every name here is invented. Never paste real athlete data into this repo.
// Builds CSV text in the exact Lumin "Physical Testing Report" shape: UTF-8 BOM, CRLF,
// Athlete/Test/Metric/Min/Max/Average columns, then date columns newest first, two rows per athlete.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Avery', 'Blake', 'Cameron', 'Dylan', 'Emery', 'Finley', 'Harper', 'Jamie', 'Kendall', 'Logan', 'Morgan', 'Parker', 'Quincy', 'Reese', 'Sawyer', 'Taylor', 'Wren', 'Zion', 'Arlo', 'Briar', 'Cleo', 'Dane', 'Elio', 'Fern', 'Gage', 'Hollis', 'Indy', 'Jules', 'Kit', 'Lark'];
const LAST = ['Ashford', 'Bellamy', 'Calloway', 'Dunmore', 'Ellison', 'Fairbanks', 'Garrity', 'Hollander', 'Ivers', 'Jessup', 'Kimura', 'Lockhart', 'Maddox', 'Norwood', 'Oakley', 'Prescott', 'Quill', 'Rutledge', 'Sterling', 'Thackeray', 'Underhill', 'Vandermeer', 'Whitlock', 'Yarrow', 'Zeller'];

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 20 test dates, oldest first.
export function allDates() {
  const out = [];
  for (let i = 0; i < 20; i++) out.push(addDays('2026-04-12', i * 9));
  return out;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

// Athletes with scripted behaviour for the matching and correction scenarios.
// nameB is the spelling used in the later export (file B).
const SPECIALS = [
  { name: 'Mike Tavarez', nameB: 'Michael Tavarez' },
  { name: 'Nathan Okafor', nameB: 'Nathen Okafor' },
  { name: 'Brody Smith', nameB: 'Brody Smith' },
  { name: 'Roxy Smith', nameB: 'Roxy Smith' },
  { name: 'Dash Murphy', nameB: 'dash murphy' },
  { name: 'Austin Doyle Jr.', nameB: 'Austin Doyle jr' },
  { name: 'Jordan Pike', nameB: 'Jordan Pike' },
  { name: 'Aiden Madison', nameB: 'Aiden Madison' },
];

// Timelines cover all 20 dates. File A uses dates 0-11, file B uses dates 5-19 (overlap: 5-11).
export function buildWorld({ seed = 7, fillers = 30 } = {}) {
  const dates = allDates();
  const r = rng(seed);
  const roster = SPECIALS.map((s) => ({ ...s }));
  const used = new Set(roster.map((p) => p.name));
  while (roster.length < SPECIALS.length + fillers) {
    const name = FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)];
    if (!used.has(name)) { used.add(name); roster.push({ name, nameB: name }); }
  }
  roster.forEach((p, n) => {
    const base10 = 1.55 + r() * 0.4;
    const base30 = 4.1 + r() * 0.6;
    p.ten = {};
    p.thirty = {};
    dates.forEach((d, i) => {
      if (r() < 0.35) p.ten[d] = round3(base10 - i * 0.002 + (r() - 0.5) * 0.06);
      if (r() < 0.08) p.thirty[d] = round3(base30 - i * 0.003 + (r() - 0.5) * 0.1);
    });
    if (n < SPECIALS.length) {
      // Guarantee data in the A-only, overlap, and B-only ranges.
      for (const i of [3, 8, 14]) p.ten[dates[i]] = round3(base10 - i * 0.002);
    }
  });
  return { dates, roster };
}

const TEN = '10 Yard Sprint (1 Yard Build)';
const THIRTY = '30 Yard Sprint';
const METRIC = 'Elapsed Time (ss:ms)';

function csvField(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// people: [{ name, ten:{date:time}, thirty:{date:time} }]; dates: ascending list for this export.
// Min/Max/Average are filled with values the importer must ignore.
export function makeCsv(people, dates, { bom = true, nameOf = (p) => p.name, columnOrder = 'desc' } = {}) {
  const cols = columnOrder === 'desc' ? dates.slice().sort().reverse() : dates.slice();
  const lines = [['Athlete', 'Test', 'Metric', 'Min', 'Max', 'Average', ...cols].map(csvField).join(',')];
  for (const p of people) {
    for (const [testName, series] of [[TEN, p.ten || {}], [THIRTY, p.thirty || {}]]) {
      const vals = cols.map((d) => (series[d] !== undefined ? series[d] : ''));
      const nums = vals.filter((v) => v !== '');
      const min = nums.length ? Math.min(...nums).toFixed(3) : '';
      const max = nums.length ? Math.max(...nums).toFixed(3) : '';
      const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3) : '';
      const cells = vals.map((v) => (v === '' ? '' : v.toFixed(3)));
      lines.push([nameOf(p), testName, METRIC, min, max, avg, ...cells].map(csvField).join(','));
    }
  }
  return (bom ? '\ufeff' : '') + lines.join('\r\n') + '\r\n';
}

// Two exports a few months apart, plus the traps the importer must handle.
export function buildScenario(opts = {}) {
  const { dates, roster } = buildWorld(opts);
  const datesA = dates.slice(0, 12);
  const datesB = dates.slice(5, 20);
  const peopleA = roster;
  const csvA = makeCsv(peopleA, datesA);

  // File B: same athletes under their later spellings, plus edits and new rows.
  const pike = roster.find((p) => p.name === 'Jordan Pike');
  const correctedDate = dates[8];
  const pikeOld = pike.ten[correctedDate];
  const pikeNew = Math.round((pikeOld + 0.006) * 1000) / 1000;
  const peopleB = roster.map((p) => (p === pike ? { ...p, ten: { ...p.ten, [correctedDate]: pikeNew } } : p));
  const extra = [
    { name: 'Rowan Ellis', nameB: 'Rowan Ellis', ten: { [dates[14]]: 1.702, [dates[18]]: 1.688 }, thirty: {} },
    { name: 'Quinn Vale', nameB: 'Quinn Vale', ten: {}, thirty: {} }, // registered, no times yet
    { name: 'placeholder@example.test', nameB: 'placeholder@example.test', ten: { [dates[16]]: 1.9 }, thirty: {} },
    { name: 'Sprint Outlier', nameB: 'Sprint Outlier', ten: { [dates[18]]: 0.85 }, thirty: { [dates[18]]: 9.2 } },
  ];
  const csvB = makeCsv([...peopleB, ...extra], datesB, { nameOf: (p) => p.nameB });
  return { dates, datesA, datesB, roster, csvA, csvB, extra, correction: { name: 'Jordan Pike', date: correctedDate, old: pikeOld, next: pikeNew } };
}
