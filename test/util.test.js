import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, tokens, stem, ngrams, median, stringifyLines, toISODate, pLimit } from '../src/util.js';

test('normalize: küçük harf, noktalama temizliği, tek boşluk', () => {
  assert.equal(normalize('  Offline Games - No Wifi!! '), 'offline games no wifi');
  assert.equal(normalize("Kid's 2-Player Games"), 'kids 2 player games');
  assert.equal(normalize('Türkçe Çeviri'), 'türkçe çeviri');
});

test('tokens ve stem', () => {
  assert.deepEqual(tokens('Puzzle Games!'), ['puzzle', 'games']);
  assert.equal(stem('games'), 'game');
  assert.equal(stem('stories'), 'story');
  assert.equal(stem('chess'), 'chess');
  assert.equal(stem('bus'), 'bus');
});

test('ngrams', () => {
  assert.deepEqual(ngrams(['a', 'b', 'c'], 2, 3), [['a', 'b'], ['b', 'c'], ['a', 'b', 'c']]);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
});

test('stringifyLines: geçerli JSON, satır başına kayıt', () => {
  const obj = { a: 1, list: [{ x: 1 }, { x: 2 }], map: { k1: [1, 2], k2: 'v' }, empty: [], emptyObj: {} };
  const text = stringifyLines(obj);
  assert.deepEqual(JSON.parse(text), obj);
  assert.ok(text.includes('{"x":1},\n{"x":2}'));
});

test('toISODate', () => {
  assert.equal(toISODate('Nov 15, 2012'), '2012-11-15');
  assert.equal(toISODate(0), '1970-01-01');
  assert.equal(toISODate('garbage'), null);
  assert.equal(toISODate(null), null);
});

test('pLimit eşzamanlılığı sınırlar', async () => {
  const limit = pLimit(2);
  let active = 0;
  let peak = 0;
  const job = () => limit(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return 1;
  });
  const results = await Promise.all([job(), job(), job(), job(), job()]);
  assert.equal(results.length, 5);
  assert.equal(peak, 2);
});
