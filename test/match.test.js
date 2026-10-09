import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, splitName } from '../src/import/normalize.js';
import { nearMatchReason, buildIndex, differentSet, resolveName, editDistance } from '../src/import/match.js';

test('normalization ignores case, punctuation, diacritics, spacing and suffixes', () => {
  assert.equal(normalizeName('dash murphy'), normalizeName('Dash Murphy'));
  assert.equal(normalizeName('Austin Doyle jr'), normalizeName('Austin Doyle Jr.'));
  assert.equal(normalizeName('  José   O\'Brien-Ríos '), 'jose obrienrios');
  assert.deepEqual(splitName('mary ann de la cruz'), { first: 'mary', last: 'ann de la cruz' });
});

test('a lone suffix-like token is not dropped', () => {
  assert.equal(normalizeName('Jr'), 'jr');
});

test('edit distance counts a swap as one edit', () => {
  assert.equal(editDistance('nathan', 'nathna'), 1);
  assert.equal(editDistance('nathan', 'nathen'), 1);
});

test('flags real near matches', () => {
  assert.ok(nearMatchReason('mike tavarez', 'michael tavarez'));
  assert.ok(nearMatchReason('nathen okafor', 'nathan okafor'));
  assert.ok(nearMatchReason('jaden brooks', 'jaden brookes'));
  assert.ok(nearMatchReason('smith jordan', 'jordan smith'), 'swapped names');
  assert.ok(nearMatchReason('matt jones', 'matthew jones'));
  assert.ok(nearMatchReason('ben lee', 'benjamin lee'));
});

test('does not flag people who only share a last name', () => {
  assert.equal(nearMatchReason('brody smith', 'roxy smith'), null);
  assert.equal(nearMatchReason('jordan blake', 'maya blake'), null);
  assert.equal(nearMatchReason('sam lee', 'ava lee'), null);
});

test('exact or identical normalized names are not "near"', () => {
  assert.equal(nearMatchReason('dash murphy', 'dash murphy'), null);
});

test('resolution: exact, alias, near, different, new', () => {
  const athletes = [
    { id: 'a_1', name: 'Mike Tavarez', aliases: [] },
    { id: 'a_2', name: 'Dash Murphy', aliases: ['Dashiell Murphy'] },
  ];
  const index = buildIndex(athletes);
  const none = differentSet([]);
  assert.equal(resolveName('DASH MURPHY', index, none).kind, 'existing');
  assert.equal(resolveName('dashiell murphy', index, none).athlete.id, 'a_2', 'alias matches with no prompt');
  const near = resolveName('Michael Tavarez', index, none);
  assert.equal(near.kind, 'match');
  assert.equal(near.candidates[0].athlete.id, 'a_1');
  const decided = differentSet([{ pair_key: 'michael tavarez|a_1', decision: 'different' }]);
  assert.equal(resolveName('Michael Tavarez', index, decided).kind, 'new');
  assert.equal(resolveName('Totally Different', index, none).kind, 'new');
});
