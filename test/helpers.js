import { parseLumin } from '../src/parsers/lumin.js';
import { analyze, computePlan, buildPayload } from '../src/import/plan.js';
import { computeCommit, computeSetTags } from '../src/import/commit.js';
import { applyChanges, emptyLibrary, toClientLibrary } from '../src/import/apply.js';

let counter = 0;
export function makeCtx(user = 'Test User') {
  counter++;
  return {
    now: '2026-10-09T12:00:' + String(counter % 60).padStart(2, '0') + '.000Z',
    user,
    importId: 'i_' + String(counter).padStart(8, '0'),
    newId: () => 'a_' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'),
  };
}

// Mirrors what the UI does: parse, preview, decide, then commit on the "server".
export function runImport(lib, csv, { tags = ['Performance'], decisions = {}, include } = {}) {
  const parsed = parseLumin(csv, 'test.csv');
  const included = new Set(parsed.athletes.filter((a) => (include ? include(a) : !a.invalid)).map((a) => a.norm));
  const client = toClientLibrary(lib);
  const analysis = analyze(parsed, client, included);
  const plan = computePlan(parsed, client, analysis, decisions);
  const payload = buildPayload(parsed, analysis, decisions, tags, csv);
  // The Review screen keeps Confirm disabled until every name match is decided.
  const out = plan.canConfirm || !analysis.pairs.length ? computeCommit(lib, payload, makeCtx()) : { ok: false, error: 'confirm_disabled' };
  if (out.ok) applyChanges(lib, out.changes);
  return { parsed, analysis, plan, payload, out };
}

export { computeSetTags, applyChanges, emptyLibrary, toClientLibrary, parseLumin };
