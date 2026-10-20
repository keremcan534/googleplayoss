import test from 'node:test';
import assert from 'node:assert/strict';
import { labelOutcome, isOwnTitleQuery, genericRanks, auc, proposeWeights, roundWeights, serpAt } from '../src/outcomes.js';
import { PRIOR_WEIGHTS, SIGNALS } from '../public/js/discovery.js';

const NOW = Date.parse('2026-12-01');

test('etiket: 20+ edinme hemen başarılı; zayıf / orta ancak 28 gün dolunca kesinleşir', () => {
  assert.equal(labelOutcome({ published: '2026-10-13', asOf: '2026-10-18', impressions: 212, acquisitions: 37 }, NOW).label, 'success');
  const early = labelOutcome({ published: '2026-10-13', asOf: '2026-10-18', impressions: 29, acquisitions: 2 }, NOW);
  assert.equal(early.label, 'pending');
  assert.equal(early.lean, 'weak');
  assert.equal(early.final, false);
  assert.equal(labelOutcome({ published: '2026-10-13', asOf: '2026-11-10', impressions: 29, acquisitions: 2 }, NOW).label, 'weak');
  assert.equal(labelOutcome({ published: '2026-10-13', asOf: '2026-11-10', impressions: 1790, acquisitions: 19 }, NOW).label, 'mid');
  assert.equal(labelOutcome({ published: '2026-10-13', asOf: '2026-11-10' }, NOW).label, 'pending', 'veri yoksa bekler');
  assert.equal(labelOutcome({ published: '2026-10-13', asOf: '2026-11-10', impressions: 49 }, NOW).label, 'weak', 'eksik edinme 0 sayılmaz ama zayıflık gösterimden gelir');
});

test('kendi adıyla arama başarı sayılmaz: ad iki nokta / tire öncesi ya da brand alanı', () => {
  const o = { title: 'Gem Art: Color by Number' };
  assert.equal(isOwnTitleQuery('gem art', o), true);
  assert.equal(isOwnTitleQuery('Gem Art color', o), true);
  assert.equal(isOwnTitleQuery('color by number', o), false);
  assert.equal(isOwnTitleQuery('gem art: color by number', o), true);
  assert.equal(isOwnTitleQuery('odak', { title: 'Odak - Pomodoro', brand: 'Odak' }), true);
  assert.equal(isOwnTitleQuery('pomodoro', { title: 'Odak - Pomodoro' }), false);
  const g = genericRanks({ title: 'Gem Art: Color by Number', ranks: [{ q: 'gem art', pos: 1 }, { q: 'color by number', pos: 44 }, { q: 'diamond art', pos: null }] });
  assert.equal(g.own, 1);
  assert.equal(g.best, 44);
});

test('AUC: tam ayrım 1, ters 0, eşitlik 0,5, veri yoksa null', () => {
  assert.equal(auc([3, 4], [1, 2]), 1);
  assert.equal(auc([1, 2], [3, 4]), 0);
  assert.equal(auc([1], [1]), 0.5);
  assert.equal(auc([], [1]), null);
});

test('ağırlık kapısı: 20 etiketten ve sınıf başına 4\'ten az iken öncül korunur', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ label: i < 2 ? 'success' : 'weak', score: 50, signals: Object.fromEntries(SIGNALS.map((s) => [s, 0.5])) }));
  const f = proposeWeights(rows, PRIOR_WEIGHTS);
  assert.equal(f.open, false);
  assert.deepEqual(f.weights, { ...PRIOR_WEIGHTS });
  assert.match(f.reason, /8 etiket daha.*2 başarılı daha/);
});

test('kapı açıkken: ayıran sinyalin ağırlığı artar ama öncüle doğru büzülür, toplam 1', () => {
  const rows = Array.from({ length: 24 }, (_, i) => {
    const ok = i < 8;
    return { label: ok ? 'success' : 'weak', score: ok ? 70 : 40, signals: { discovery: 0.5, gap: 0.5, visual: ok ? 0.9 : 0.2, band: 0.5, feasibility: 1 } };
  });
  const f = proposeWeights(rows, PRIOR_WEIGHTS);
  assert.equal(f.open, true);
  assert.equal(f.aucs.visual, 1);
  assert.equal(f.aucs.gap, 0.5);
  assert.ok(f.weights.visual > PRIOR_WEIGHTS.visual);
  assert.ok(f.weights.discovery > 0.15, 'tek sinyal bütün ağırlığı almaz');
  assert.equal(Math.round(SIGNALS.reduce((s, k) => s + f.weights[k], 0) * 100) / 100, 1);
  assert.ok(f.lambda > 0.3 && f.lambda < 0.4);
});

test('roundWeights toplamı 1\'e tamamlar; serpAt seçim tarihindeki ya da önceki en son ilk 10\'u verir', () => {
  const w = roundWeights({ discovery: 0.333, gap: 0.333, visual: 0.334, band: 0, feasibility: 0 });
  assert.equal(Math.round(Object.values(w).reduce((s, v) => s + v, 0) * 100), 100);
  const hist = [{ d: '2026-10-01', serp: { k: ['a'] } }, { d: '2026-10-05', serp: { k: ['b'] } }, { d: '2026-10-09', serp: { k: ['c'] } }, { d: '2026-10-06', serp: { other: ['x'] } }];
  assert.deepEqual(serpAt(hist, 'k', '2026-10-08'), { d: '2026-10-05', top: ['b'] });
  assert.equal(serpAt(hist, 'k', '2026-09-01'), null);
  assert.equal(serpAt(hist, 'k', null), null);
});
