// In-memory backend for local development. Loaded only when mockAllowed() is true (localhost + ?mock=1).
// Runs the same commit logic as Apps Script, seeded from synthetic fixtures. No real data, no network.

import { emptyLibrary, applyChanges, toClientLibrary } from './import/apply.js';
import { computeCommit, computeSetTags } from './import/commit.js';
import { parseLumin } from './parsers/lumin.js';
import { analyze, buildPayload } from './import/plan.js';
import { buildScenario } from '../test/fixtures/synthetic.js';

const MOCK_EMAIL = 'mock@example.test';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMockBackend() {
  const lib = emptyLibrary();
  const scenario = buildScenario();
  let n = 0;
  const ctx = (id) => ({
    now: new Date().toISOString(), email: MOCK_EMAIL,
    importId: 'i_' + String(++n).padStart(8, '0'),
    newId: () => 'a_' + Math.random().toString(16).slice(2, 10).padEnd(8, '0'),
  });

  // Seed: the first export is already in the library, tagged Performance. Some athletes also get 1More.
  const parsed = parseLumin(scenario.csvA, 'seed.csv');
  const included = new Set(parsed.athletes.map((a) => a.norm));
  const first = computeCommit(lib, buildPayload(parsed, analyze(parsed, toClientLibrary(lib), included), {}, ['Performance'], scenario.csvA), ctx());
  applyChanges(lib, first.changes);
  const some = lib.athletes.filter((_, i) => i % 3 === 0).map((a) => a.id);
  applyChanges(lib, computeSetTags(lib, { athlete_ids: some, add: ['1More'], remove: [] }, ctx()).changes);

  return {
    async whoami() { await delay(60); return { ok: true }; },
    async getLibrary() { await delay(120); return { ok: true, ...toClientLibrary(lib) }; },
    async commitImport(payload) {
      await delay(250);
      const c = ctx();
      const out = computeCommit(lib, payload, c);
      if (!out.ok) return out;
      applyChanges(lib, out.changes);
      lib.archive.push({ importId: c.importId, fileName: payload.fileName, bytes: String(payload.csv || '').length });
      return { ok: true, result: out.result };
    },
    async setTags(params) {
      await delay(120);
      const out = computeSetTags(lib, params, ctx());
      if (!out.ok) return out;
      applyChanges(lib, out.changes);
      return { ok: true, updated: out.changes.updatedAthletes.map((u) => ({ id: u.id, tags: u.tags })), tags: lib.tags.slice() };
    },
    async mergeAthletes() { return { ok: false, error: 'not_implemented' }; },
    sampleFile() { return { name: 'Physical Testing Report 2026-05-26 - 2026-10-09 (synthetic).csv', text: scenario.csvB }; },
  };
}
