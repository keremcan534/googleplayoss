import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFromTitles, isValidKeyword, seedPrefixes } from '../src/discover.js';
import { buildNiches } from '../src/niches.js';

test('candidatesFromTitles: tekrar eden n-gramları bulur, kenar stopword atar', () => {
  const titles = [
    'Offline Games - No Wifi Games',
    'Offline Games: Fun Puzzle',
    'No Wifi Games for Kids',
    'Block Blast!'
  ];
  const c = candidatesFromTitles(titles, { minFreq: 2 });
  const keys = c.map((x) => x.k);
  assert.ok(keys.includes('offline games'));
  assert.ok(keys.includes('no wifi games'));
  assert.ok(!keys.includes('games for'));
  assert.ok(!keys.includes('block blast'), 'tek başlıkta geçen aday olmamalı');
  assert.equal(c.find((x) => x.k === 'offline games').hits, 2);
});

test('isValidKeyword', () => {
  assert.equal(isValidKeyword('offline games'), true);
  assert.equal(isValidKeyword('123'), false);
  assert.equal(isValidKeyword(''), false);
  assert.equal(isValidKeyword('a b c d e f g h'), false);
});

test('seedPrefixes', () => {
  const p = seedPrefixes('Puzzle Games', 'ab');
  assert.deepEqual(p, ['puzzle games', 'puzzle games ', 'puzzle games a', 'puzzle games b']);
});

test('buildNiches: ortak kelimeye göre gruplar', () => {
  const rec = (k, opp, seed) => ({ k, demand: 50, difficulty: 40, opportunity: opp, seed });
  const kws = [
    rec('offline games', 40, 'offline games'),
    rec('offline rpg', 60, 'offline games'),
    rec('offline racing', 55, 'offline games'),
    rec('offline puzzle', 45, 'offline games'),
    rec('kids puzzle', 30, 'puzzle games'),
    rec('no demand', 0, 'x')
  ];
  kws[5].demand = 0;
  const n = buildNiches(kws, { minCount: 3 });
  const offline = n.find((g) => g.name === 'offline' && g.type === 'token');
  assert.ok(offline);
  assert.equal(offline.count, 4);
  assert.equal(offline.maxOpportunity, 60);
  assert.deepEqual(offline.keywords, ['offline rpg', 'offline racing', 'offline puzzle', 'offline games']);
  const seed = n.find((g) => g.type === 'seed' && g.name === 'offline games');
  assert.ok(seed);
  assert.equal(seed.count, 3, 'tohumun kendisi seed grubuna girmez');
});
