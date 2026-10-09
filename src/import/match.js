import { normalizeName, splitName, pairKey } from './normalize.js';

const NICKNAME_PAIRS = [
  ['mike', 'michael'], ['matt', 'matthew'], ['nick', 'nicholas'], ['ben', 'benjamin'],
  ['jake', 'jacob'], ['josh', 'joshua'], ['zach', 'zachary'], ['alex', 'alexander'],
  ['sam', 'samuel'], ['chris', 'christopher'], ['tony', 'anthony'], ['dan', 'daniel'],
  ['will', 'william'], ['jack', 'john'], ['liz', 'elizabeth'], ['abby', 'abigail'],
  ['maddie', 'madeline'],
];
const NICKNAMES = new Set();
for (const [a, b] of NICKNAME_PAIRS) { NICKNAMES.add(a + '|' + b); NICKNAMES.add(b + '|' + a); }

// Optimal string alignment distance (a swap of two adjacent letters counts as one edit).
export function editDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = [];
  for (let i = 0; i <= n; i++) { d.push(new Array(m + 1).fill(0)); d[i][0] = i; }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

// One edit needs 4+ letters on both sides (5+ for last names); two edits need 6+ (7+).
// The brief allows two edits at 4+/5+, but that flags Brody/Roxy Smith, which must not be flagged.
function closeSpelling(a, b, minOne, minTwo) {
  const minLen = Math.min(a.length, b.length);
  if (minLen < minOne) return 0;
  const dist = editDistance(a, b);
  if (dist === 0) return 0;
  if (dist === 1) return 1;
  if (dist === 2 && minLen >= minTwo) return 2;
  return 0;
}

// a and b are normalized names. Returns a short reason when they are a possible match, else null.
export function nearMatchReason(aNorm, bNorm) {
  if (!aNorm || !bNorm || aNorm === bNorm) return null;
  const a = splitName(aNorm);
  const b = splitName(bNorm);

  if (a.last && a.last === b.last && a.first !== b.first) {
    if (NICKNAMES.has(a.first + '|' + b.first)) return 'Same last name, nickname variation';
    const short = a.first.length <= b.first.length ? a.first : b.first;
    const long = short === a.first ? b.first : a.first;
    if (short.length >= 3 && long.startsWith(short)) return 'Same last name, one first name starts the other';
    const e = closeSpelling(a.first, b.first, 4, 6);
    if (e === 1) return 'Same last name, first name one letter off';
    if (e === 2) return 'Same last name, similar first name';
  }
  if (a.first && a.first === b.first && a.last && b.last && a.last !== b.last) {
    const e = closeSpelling(a.last, b.last, 5, 7);
    if (e === 1) return 'Same first name, last name one letter off';
    if (e === 2) return 'Same first name, similar last name';
  }
  if (a.first && a.last && a.first === b.last && a.last === b.first && a.first !== a.last) {
    return 'First and last name look swapped';
  }
  return null;
}

// Index of library athletes by every normalized spelling (name and aliases).
export function buildIndex(athletes) {
  const byNorm = new Map();
  const entries = [];
  for (const athlete of athletes) {
    const forms = [];
    for (const raw of [athlete.name].concat(athlete.aliases || [])) {
      const norm = normalizeName(raw);
      if (!norm || forms.indexOf(norm) >= 0) continue;
      forms.push(norm);
      if (!byNorm.has(norm)) byNorm.set(norm, athlete);
    }
    entries.push({ athlete, forms });
  }
  return { byNorm, entries };
}

// Pairs the user already answered "different". Aliases need no entry: they are stored on the athlete.
export function differentSet(decisions) {
  const set = new Set();
  for (const d of decisions || []) if (d.decision === 'different') set.add(d.pair_key);
  return set;
}

export function findCandidates(norm, index, different) {
  const out = [];
  for (const { athlete, forms } of index.entries) {
    if (different.has(pairKey(norm, athlete.id))) continue;
    let reason = null;
    for (const f of forms) {
      reason = nearMatchReason(norm, f);
      if (reason) break;
    }
    if (reason) out.push({ athlete, reason });
  }
  return out;
}

// kind: 'existing' (exact or alias match), 'match' (needs a decision), 'new'
export function resolveName(name, index, different) {
  const norm = normalizeName(name);
  const exact = index.byNorm.get(norm);
  if (exact) return { norm, kind: 'existing', athlete: exact, candidates: [] };
  const candidates = findCandidates(norm, index, different);
  return { norm, kind: candidates.length ? 'match' : 'new', athlete: null, candidates };
}
