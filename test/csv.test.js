import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, toCSV, csvSafe } from '../src/csv.js';

test('strips a BOM and reads CRLF rows', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('handles quotes, embedded commas, doubled quotes and newlines in fields', () => {
  assert.deepEqual(parseCSV('a,b\n"x, y","say ""hi"""\n"two\nlines",z\n'), [['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
});

test('keeps empty cells and drops blank lines', () => {
  assert.deepEqual(parseCSV('a,,c\n\n,,\n1,2,3'), [['a', '', 'c'], ['', '', ''], ['1', '2', '3']]);
});

test('rejects an unterminated quote', () => {
  assert.throws(() => parseCSV('a,"b\n1,2'), /unterminated/);
});

test('csv output neutralizes formula cells', () => {
  assert.equal(csvSafe('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvSafe('-5'), "'-5");
  assert.equal(csvSafe('Dash'), 'Dash');
  assert.equal(toCSV([['a,b', '@x', 'plain']]), '"a,b",\'@x,plain\r\n');
});
