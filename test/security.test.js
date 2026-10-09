import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockAllowed } from '../src/mockgate.js';
import { visibleSelected, bulkChips, allVisibleSelected } from '../src/selection.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test('mock mode needs localhost AND ?mock=1, and is impossible on any other host', () => {
  assert.equal(mockAllowed('localhost', '?mock=1'), true);
  assert.equal(mockAllowed('127.0.0.1', '?mock=1'), true);
  assert.equal(mockAllowed('localhost', ''), false);
  assert.equal(mockAllowed('localhost', '?mock=0'), false);
  for (const host of ['data.trainatlead.com', 'leadathletic1.github.io', 'localhost.evil.com', 'evil.com', 'trainatlead.com', '127.0.0.1.evil.com', 'foo.localhost', '']) {
    assert.equal(mockAllowed(host, '?mock=1'), false, host);
  }
});

test('mock.js is only ever loaded through the gated dynamic import in api.js', () => {
  const users = walk(join(root, 'src')).filter((f) => /\.js$/.test(f) && /mock\.js['"]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(users.map((f) => f.replace(root + '/', '')), ['src/api.js']);
  const api = readFileSync(join(root, 'src/api.js'), 'utf8');
  assert.match(api, /import\('\.\/mock\.js'\)/);
  assert.match(api, /isMock\(\)\) \{\s*const data = await \(await mock\(\)\)/);
});

test('athlete names and tags are never injected as HTML', () => {
  const banned = /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|dangerouslySetInnerHTML|\beval\(|new Function\(/;
  for (const f of walk(join(root, 'src')).filter((p) => p.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), banned, f);
  }
  assert.doesNotMatch(readFileSync(join(root, 'src/ui/dom.js'), 'utf8'), /setAttribute\(\s*['"]style/);
});

test('the repo holds no athlete data or secrets', () => {
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
  for (const line of ['*.csv', 'data/', '.env']) assert.ok(ignore.split('\n').includes(line), line + ' is ignored');
  const config = readFileSync(join(root, 'config.js'), 'utf8');
  assert.match(config, /REPLACE_WITH_GOOGLE_CLIENT_ID/);
  assert.match(config, /REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL/);
  const tracked = walk(root).filter((f) => !/node_modules|\.git\//.test(f));
  assert.deepEqual(tracked.filter((f) => /\.csv$/i.test(f)), []);
});

const A = (id, tags) => ({ id, name: id, tags });

test('selection only ever reaches visible rows, and chips count only the selection', () => {
  const visible = [A('a', ['Performance']), A('b', []), A('c', ['Performance', '1More'])];
  const selected = new Set(['a', 'b', 'hidden-one']);
  const sel = visibleSelected(selected, visible);
  assert.deepEqual(sel.map((x) => x.id), ['a', 'b']);
  const chips = bulkChips(sel, ['Performance', '1More']);
  assert.deepEqual(chips.add.map((c) => c.label), ['Performance  +1', '1More  +2']);
  assert.deepEqual(chips.remove.map((c) => c.label), ['Performance  −1']);
  assert.equal(allVisibleSelected(selected, visible), false);
  assert.equal(allVisibleSelected(new Set(['a', 'b', 'c']), visible), true);
  assert.equal(allVisibleSelected(new Set(['a']), []), false);
});
