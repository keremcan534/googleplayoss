import test from 'node:test';
import assert from 'node:assert/strict';
import { measureDemand, demandScore } from '../src/demand.js';
import { BudgetError } from '../src/store.js';

function fakeSuggest(triggerAt, keyword, extra = []) {
  const calls = [];
  const fn = async (prefix) => {
    calls.push(prefix);
    return prefix.length >= triggerAt && keyword.startsWith(prefix) ? [keyword, ...extra] : ['something else', ...extra];
  };
  fn.calls = calls;
  return fn;
}

test('measureDemand: en kısa ön eki ikili arama ile bulur', async () => {
  const kw = 'offline games';
  const s = fakeSuggest(3, kw, ['offline games free']);
  const m = await measureDemand(kw, s);
  assert.equal(m.status, 'ok');
  assert.equal(m.minPrefix, 3);
  assert.equal(m.pos, 1);
  assert.equal(m.len, kw.length);
  assert.ok(s.calls.length <= 6, `çok fazla çağrı: ${s.calls.length}`);
  assert.deepEqual(m.variants, ['offline games free']);
});

test('measureDemand: bilinen ön ek arama aralığını daraltır', async () => {
  const kw = 'offline games';
  const s = fakeSuggest(3, kw);
  const m = await measureDemand(kw, s, { knownPrefix: 5 });
  assert.equal(m.minPrefix, 3);
  assert.ok(s.calls.length <= 4);
});

test('measureDemand: tam metin önerilmiyorsa talep yok, öneriler variant olur', async () => {
  const s = async () => ['offline games', 'offline rpg'];
  const m = await measureDemand('offline zzz', s);
  assert.equal(m.status, 'none');
  assert.deepEqual(m.variants, ['offline games', 'offline rpg']);
  assert.equal(m.variantsPrefixLen, 'offline zzz'.length);
});

test('measureDemand: bütçe bitince status budget', async () => {
  const s = async () => { throw new BudgetError('suggest'); };
  const m = await measureDemand('offline games', s);
  assert.equal(m.status, 'budget');
});

test('demandScore: kısa ön ek → yüksek puan, tam metin → düşük', () => {
  const high = demandScore({ minPrefix: 1, len: 13, pos: 1 });
  const mid = demandScore({ minPrefix: 5, len: 13, pos: 2 });
  const low = demandScore({ minPrefix: 13, len: 13, pos: 5 });
  assert.equal(high, 100);
  assert.ok(high > mid && mid > low, `${high} > ${mid} > ${low}`);
  assert.equal(low, 0);
  assert.equal(demandScore({ minPrefix: null, len: 5 }), 0);
});
