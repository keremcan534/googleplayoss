import test from 'node:test';
import assert from 'node:assert/strict';
import { complaintKinds, summarizeReviews, pickReviewTargets } from '../src/reviews.js';

test('şikâyet sınıfları: yalnızca 1-3 yıldız; reklam, ödeme, içerik; iki dil', () => {
  assert.deepEqual(complaintKinds({ score: 5, text: 'Great game, no ads!' }), []);
  assert.deepEqual(complaintKinds({ score: 2, text: 'Too many ADS after every level' }), ['ads']);
  assert.deepEqual(complaintKinds({ score: 1, text: 'Pay to unlock everything, subscription is a scam' }), ['pay']);
  assert.deepEqual(complaintKinds({ score: 3, text: 'Fun but I ran out of pictures, no new levels' }), ['content']);
  assert.deepEqual(complaintKinds({ score: 2, text: 'Reklam çok fazla, abonelik istiyor' }), ['ads', 'pay']);
  assert.deepEqual(complaintKinds({ score: 3, text: 'BÖLÜMLER BİTTİ, hep aynı resimler' }), ['content']);
  assert.deepEqual(complaintKinds({ score: 1, text: 'crashes on start' }), []);
  assert.deepEqual(complaintKinds({ score: 1, text: '' }), []);
  assert.deepEqual(complaintKinds({ text: 'ads' }), [], 'yıldızsız yorum sayılmaz');
});

test('özet: oranlar örneklem büyüklüğüne bölünür; boş örneklem null', () => {
  const s = summarizeReviews([
    { score: 1, text: 'ads ads ads' },
    { score: 2, text: 'too expensive, premium only' },
    { score: 2, text: 'ads and paywall' },
    { score: 5, text: 'love it' }
  ]);
  assert.deepEqual(s, { n: 4, neg: 0.75, any: 0.75, ads: 0.5, pay: 0.5, content: 0 });
  assert.equal(summarizeReviews([]), null);
});

test('hedef seçimi: ilk 3\'te en sık görünen önce; taze önbellek ve eksik uygulamalar atlanır', () => {
  const recs = [
    { st: 'ok', top: ['a', 'b', 'c', 'z'] },
    { st: 'ok', top: ['a', 'c', 'd'] },
    { st: 'ok', top: ['a', 'e', 'b'] },
    { st: 'pending', top: ['x', 'x2', 'x3'] }
  ];
  const now = 100 * 86400000;
  const out = pickReviewTargets(recs, { c: { t: now - 86400000 } }, { now, ttlMs: 30 * 86400000, limit: 3, apps: { d: { missing: true } } });
  assert.deepEqual(out, ['a', 'b', 'e']); // a ×3, b ×2, c taze, d eksik, z ilk 3'te değil
});
