import test from 'node:test';
import assert from 'node:assert/strict';
import { titleMatches, scoreCompetition, opportunityScore, verdict } from '../src/score.js';

const NOW = new Date('2026-09-15T00:00:00Z').getTime();
const mk = (o) => ({ id: o.id || 'x', title: o.title || 'App', real: o.real ?? 1000, ratings: o.ratings ?? 10, score: o.score ?? 4.2, updated: o.updated || '2026-08-01', ...o });

test('titleMatches: köklenmiş kelimeler başlıkta', () => {
  assert.equal(titleMatches('offline games', 'Offline Games - No Wifi Games'), true);
  assert.equal(titleMatches('offline game', 'Best OFFLINE Games!'), true);
  assert.equal(titleMatches('offline rpg', 'Offline Games'), false);
});

test('scoreCompetition: güçlü rakipler → yüksek zorluk', () => {
  const strong = Array.from({ length: 10 }, (_, i) => mk({ id: `s${i}`, title: 'Offline Games Pro', real: 50_000_000, ratings: 800_000, score: 4.6, updated: '2026-09-01' }));
  const weak = Array.from({ length: 10 }, (_, i) => mk({ id: `w${i}`, title: 'Random App', real: 5_000, ratings: 20, score: 3.6, updated: '2023-01-01' }));
  const a = scoreCompetition('offline games', strong, { now: NOW });
  const b = scoreCompetition('offline games', weak, { now: NOW });
  assert.ok(a.difficulty > 85, `güçlü: ${a.difficulty}`);
  assert.ok(b.difficulty < 20, `zayıf: ${b.difficulty}`);
  assert.equal(a.comp.titleMatches, 10);
  assert.equal(b.comp.weak, 10);
  assert.equal(b.comp.stale, 10);
  assert.equal(a.comp.big, 10);
  assert.ok(a.market > b.market);
});

test('scoreCompetition: veri yoksa null', () => {
  const r = scoreCompetition('x', []);
  assert.equal(r.difficulty, null);
  assert.equal(r.comp.n, 0);
});

test('opportunityScore: talep yüksek + zorluk düşük → yüksek fırsat', () => {
  assert.equal(opportunityScore(0, 50), 0);
  assert.equal(opportunityScore(100, 100), 0);
  const good = opportunityScore(80, 30, { weak: 5 });
  const bad = opportunityScore(80, 90, {});
  assert.ok(good > 60 && bad < 35, `${good} / ${bad}`);
  assert.equal(opportunityScore(50, null), null);
  assert.ok(opportunityScore(100, 0, { weak: 10 }) <= 100);
});

test('verdict etiketleri', () => {
  assert.equal(verdict(70, 60), 'guclu');
  assert.equal(verdict(50, 60), 'iyi');
  assert.equal(verdict(35, 60), 'orta');
  assert.equal(verdict(10, 60), 'zor');
  assert.equal(verdict(null, 0), 'talep-yok');
  assert.equal(verdict(null, 40), 'eksik');
});
