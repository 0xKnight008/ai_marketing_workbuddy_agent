import assert from 'node:assert/strict';
import test from 'node:test';

import { csvRecordToItem, normalizePlatform, parseCsv, pasteToItems } from './csv';

test('parseCsv handles quoted fields, embedded commas and escaped quotes', () => {
  const rows = parseCsv('text,author,views\n"Hello, world","Ann ""Pro""",1200\nplain,bob,5\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.text, 'Hello, world');
  assert.equal(rows[0]!.author, 'Ann "Pro"');
  assert.equal(rows[1]!.text, 'plain');
});

test('parseCsv keeps embedded newlines inside quoted fields', () => {
  const rows = parseCsv('text,platform\n"line one\nline two",youtube\nnext,tiktok\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.text, 'line one\nline two');
  assert.equal(rows[1]!.platform, 'tiktok');
});

test('parseCsv returns no records without a header row', () => {
  assert.deepEqual(parseCsv('only-one-line'), []);
  assert.deepEqual(parseCsv(''), []);
});

test('csvRecordToItem falls back across text columns and coerces metrics', () => {
  const item = csvRecordToItem({ title: 'Launch video', platform: 'B站', views: '12000', saves: '45', author: 'UP主小A' });
  assert.ok(item);
  assert.equal(item.text, 'Launch video');
  assert.equal(item.platform, 'bilibili');
  assert.equal(item.metrics.views, 12000);
  assert.equal(item.metrics.saves, 45);
  assert.equal(item.author, 'UP主小A');
  assert.equal(csvRecordToItem({ author: 'nobody' }), undefined);
});

test('normalizePlatform maps aliases and sanitizes unknown values', () => {
  assert.equal(normalizePlatform('小红书'), 'rednote');
  assert.equal(normalizePlatform('YT'), 'youtube');
  assert.equal(normalizePlatform('ig'), 'instagram');
  assert.equal(normalizePlatform('X'), 'twitter');
  assert.equal(normalizePlatform('Some Platform!'), 'someplatform');
  assert.equal(normalizePlatform(undefined), 'unknown');
});

test('pasteToItems splits non-empty lines and caps length', () => {
  const items = pasteToItems('first\n\n  \nsecond\r\nthird');
  assert.deepEqual(items.map((item) => item.text), ['first', 'second', 'third']);
  const long = pasteToItems(`x${'a'.repeat(5_000)}`);
  assert.equal(long[0]!.text.length, 2_000);
});
