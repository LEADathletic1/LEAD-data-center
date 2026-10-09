// Writes synthetic Lumin-shaped CSVs to ./data/ (git-ignored) so you can try the upload screen by hand.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildScenario } from '../test/fixtures/synthetic.js';

const s = buildScenario();
mkdirSync('data', { recursive: true });
writeFileSync('data/Physical Testing Report 2026-04-12 - 2026-07-01.csv', s.csvA);
writeFileSync('data/Physical Testing Report 2026-05-26 - 2026-10-09.csv', s.csvB);
console.log('Wrote 2 synthetic files to ./data/');
