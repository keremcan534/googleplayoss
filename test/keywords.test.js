import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProduct } from '../public/js/pack/product.js';
import { evaluateCandidate, choosePositioning, competitorPositioning } from '../public/js/pack/keywords.js';
import { summarizeRepo } from '../public/js/pack/repo.js';
import { TRUCK_FILES, TRUCK_PATHS } from './fixtures/truck-repo.js';

const repo = summarizeRepo(TRUCK_FILES, TRUCK_PATHS, { url: 'https://github.com/anatolia/road-haul', repo: 'road-haul' });
const analysis = analyzeProduct({ name: 'Road Haul', market: 'us-en', inputs: { repo } });
const NOW = Date.parse('2026-09-30T00:00:00Z');

const ids = (p, n = 10) => Array.from({ length: n }, (_, i) => `${p}.${i}`);
const comp = (extra = {}) => ({ n: 10, titleMatches: 3, weak: 3, lowRated: 2, stale: 2, big: 2, ads: 8, iap: 5, paid: 0, monetized: 9,
  engagement: 4, avgScore: 4.0, medianInstalls: 300000, sumInstalls: 9e6, entry: 20000, entry2: 40000, tiny: 1, midpack: 200000,
  leaderShare: 0.4, newcomers: 3, dated: 4, medianAgeYears: 3, ...extra });
const rec = (k, demand, opportunity, top, extra = {}) => ({ k, st: 'ok', demand, difficulty: 45, market: 60, opportunity, comp: comp(), top, pop: { minPrefix: 6 }, ...extra });

test('konumlandırma: marka, karşılıksız iddia, talepsiz ve düşük uyumlu adaylar elenir', () => {
  const noOffline = analyzeProduct({ name: 'Road Haul', market: 'us-en', inputs: { description: 'Drive a heavy truck and deliver cargo across the country.' } });
  const cands = [
    rec('truck simulator', 70, 62, ids('a')),
    rec('euro truck simulator', 80, 70, ids('b')),
    rec('bus simulator', 75, 66, ids('c')),
    rec('cargo truck', 40, 55, ids('d')),
    { k: 'truck parking', st: 'no-demand', demand: 0, opportunity: 0, top: [] },
    rec('offline truck game', 50, 60, ids('e'))
  ].map((r) => evaluateCandidate(r, noOffline));
  const p = choosePositioning(cands);
  assert.equal(p.primary.k, 'truck simulator');
  const why = Object.fromEntries(p.excluded.map((e) => [e.k, e.why]));
  assert.match(why['euro truck simulator'], /Marka/);
  assert.match(why['bus simulator'], /Başka bir ürünün konusu: "bus"/);
  assert.match(why['truck parking'], /talep/);
  assert.match(why['offline truck game'], /Karşılıksız iddia/);
  assert.deepEqual(p.secondary.map((c) => c.k), ['cargo truck']);
});

test('birincil tam uyum ister; ikincil küme aynı ilk 10\'u tekrarlamaz', () => {
  const shared = ids('s');
  const cands = [
    rec('truck simulator', 70, 60, shared),
    rec('truck simulator games', 60, 58, shared.slice(0, 9).concat('x.1')),
    rec('cargo truck', 40, 50, ids('d')),
    rec('trailer truck', 30, 48, ids('t'))
  ].map((r) => evaluateCandidate(r, analysis));
  const p = choosePositioning(cands);
  assert.equal(p.primary.rel.score, 1);
  assert.ok(!p.secondary.some((c) => c.k === 'truck simulator games'), 'aynı pazar ikincil sayılmaz');
  assert.ok(p.secondary.some((c) => c.k === 'cargo truck'));
  assert.ok(p.alternatives.some((c) => c.k === 'truck simulator games'));
});

test('uygun aday yoksa birincil boş kalır ve uyarı verilir', () => {
  const p = choosePositioning([evaluateCandidate(rec('bus simulator', 70, 60, ids('a')), analysis)]);
  assert.equal(p.primary, null);
  assert.ok(p.warnings.length);
});

test('rakip konumlandırması: açılar yalnızca ürün olgularından', () => {
  const apps = {};
  const top = ids('r');
  top.forEach((id, i) => { apps[id] = { id, title: i < 2 ? 'Truck Simulator Offline' : `Truck Driver ${i}`, dev: 'D', real: (10 - i) * 1e5, score: 3.9, ratings: 500, ads: true, iap: true, updated: i < 4 ? '2024-01-01' : '2026-08-01', released: '2021-01-01' }; });
  const cand = evaluateCandidate(rec('truck simulator', 70, 60, top), analysis);
  const cp = competitorPositioning(cand, analysis, apps, { now: NOW });
  assert.equal(cp.n, 10);
  assert.equal(cp.ads, 10);
  assert.equal(cp.stale, 4);
  assert.equal(cp.avgRating, 3.9);
  const text = cp.angles.map((a) => a.text).join('\n');
  assert.match(text, /Çevrimdışı/, 'repo çevrimdışı diyor, rakiplerde az');
  assert.doesNotMatch(text, /reklam yoksa bunu kısa/, 'üründe reklam var: reklamsız açısı önerilmez');
  assert.match(text, /satın alma olmadan/, 'repoda satın alma yok');
  assert.ok(cp.titleWords[0].w === 'truck');
  // olgu bilinmiyorsa soru olarak kalır
  const plain = analyzeProduct({ name: 'X', market: 'us-en', inputs: { description: 'Drive a heavy truck and deliver cargo across the country.' } });
  const cp2 = competitorPositioning(cand, plain, apps, { now: NOW });
  assert.ok(!cp2.angles.some((a) => /Çevrimdışı/.test(a.text)));
  assert.ok(cp2.angles.some((a) => /reklam" olgusunu belirt/.test(a.text)));
});

test('yan özellik, farklı niyet, farklı konu ve rakip adı elenir; kısmi uyum ayrı durur', () => {
  const bigApps = (title) => ids('n').map((id, i) => ({ id, title: i === 0 ? title : `Other ${i}`, real: i === 0 ? 5e7 : 1e5 }));
  const cands = [
    rec('truck simulator', 70, 60, ids('a')),
    rec('rain sounds offline', 44, 60, ids('r')),
    rec('weather apps for android', 50, 55, ids('w')),
    rec('car games simulator', 40, 55, ids('c')),
    rec('truck simulator indonesia', 30, 50, ids('i')),
    rec('offline truck game', 35, 52, ids('o'))
  ].map((r) => evaluateCandidate(r, analysis));
  const nav = evaluateCandidate(rec('truck simulator deluxe', 60, 60, ids('z')), analysis, { apps: bigApps('Truck Simulator : Deluxe') });
  const p = choosePositioning([...cands, nav]);
  const why = Object.fromEntries(p.excluded.map((e) => [e.k, e.why]));
  assert.match(why['rain sounds offline'], /çekirdeğine dayanmıyor|Başka bir ürünün konusu/);
  assert.match(choosePositioning([evaluateCandidate(rec('rain offline', 44, 60, ids('q')), analysis)]).excluded[0].why, /çekirdeğine dayanmıyor/);
  assert.match(why['weather apps for android'], /uygulama arıyor/);
  assert.match(why['car games simulator'], /"car"/);
  assert.match(why['truck simulator deluxe'], /Rakip uygulamanın adı/);
  assert.deepEqual(p.partial.map((c) => c.k), ['truck simulator indonesia']);
  assert.ok(!p.secondary.some((c) => c.rel.score < 1));
  assert.deepEqual(p.secondary.map((c) => c.k), ['offline truck game']);
});
