// Generates apps-script/Code.gs from the same modules the tests exercise, so the server cannot drift from them.
// Usage: node scripts/build-gas.js          (write)
//        node scripts/build-gas.js --check  (exit 1 if Code.gs is stale)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = ['src/tests.js', 'src/import/normalize.js', 'src/import/tags.js', 'src/import/match.js', 'src/import/commit.js'];

function strip(src) {
  return src
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*\r?\n/gm, '')
    .replace(/^export\s*\{[\s\S]*?\};?[ \t]*\r?\n/gm, '')
    .replace(/^export\s+(function|const|class|let)\b/gm, '$1');
}

export function buildCodeGs() {
  const parts = [
    '// GENERATED FILE. Do not edit by hand.\n' +
    '// Source: src/tests.js, src/import/{normalize,tags,match,commit}.js and apps-script/server.part.gs.\n' +
    '// Regenerate with: node scripts/build-gas.js\n',
  ];
  for (const f of SHARED) parts.push('// ===== ' + f + ' =====\n' + strip(readFileSync(join(root, f), 'utf8')));
  parts.push(readFileSync(join(root, 'apps-script/server.part.gs'), 'utf8'));
  return parts.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, 'apps-script/Code.gs');
  const next = buildCodeGs();
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(out, 'utf8'); } catch {}
    if (cur !== next) { console.error('apps-script/Code.gs is stale. Run: node scripts/build-gas.js'); process.exit(1); }
    console.log('Code.gs is up to date');
  } else {
    writeFileSync(out, next);
    console.log('Wrote apps-script/Code.gs (' + next.split('\n').length + ' lines)');
  }
}
