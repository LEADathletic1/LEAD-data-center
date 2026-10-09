// Name normalization, used for matching only. Display always uses the original spelling.

const SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];

// Lowercase, strip diacritics, drop punctuation, collapse whitespace. Keeps suffixes.
export function foldName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeName(name) {
  const tokens = foldName(name).split(' ').filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.indexOf(tokens[tokens.length - 1]) >= 0) tokens.pop();
  return tokens.join(' ');
}

// First token is the first name; the remaining tokens are the last name.
export function splitName(norm) {
  const tokens = String(norm).split(' ').filter(Boolean);
  return { first: tokens[0] || '', last: tokens.slice(1).join(' ') };
}

export function pairKey(incomingNorm, athleteId) {
  return incomingNorm + '|' + athleteId;
}
