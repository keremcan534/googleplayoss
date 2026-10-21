import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoveryScore, compactDiscovery, discoverySignal, gapSignal, visualSignal, feasibilitySignal, genreWeight, normWeights,
  discoveryLevel, PRIOR_WEIGHTS, SIGNALS
} from '../public/js/discovery.js';
import { annotateDiscovery, publicApp } from '../src/publish.js';

const app = (id, o = {}) => ({ id, genre: 'GAME_CASUAL', real: 500_000, score: 4.5, ratings: 5000, ads: true, iap: true, ...o });
const top = (n, o = {}, pre = 'a') => Array.from({ length: n }, (_, i) => app(`${pre}${i}`, typeof o === 'function' ? o(i) : o));
const mapOf = (...lists) => Object.fromEntries(lists.flat().map((a) => [a.id, a]));
const rec = (k, apps, o = {}) => ({ k, st: 'ok', demand: 30, top: apps.map((a) => a.id), comp: { sumInstalls: apps.reduce((s, a) => s + a.real, 0) }, ...o });
const dec = (o = {}) => ({ state: 'ok', verdict: 'GOLD', axes: { enter: { score: 70 } }, flags: [], ...o });

test('tür ağırlığı: görsel gündelik oyunlar yüksek, araç / verimlilik düşük, listede olmayan oyun 0,6', () => {
  assert.equal(genreWeight('GAME_CASUAL'), 1);
  assert.equal(genreWeight('ART_AND_DESIGN'), 0.8);
  assert.equal(genreWeight('TOOLS'), 0.2);
  assert.equal(genreWeight('PRODUCTIVITY'), 0.2);
  assert.equal(genreWeight('GAME_NEW_THING'), 0.6);
  assert.equal(genreWeight(null), null);
});

test('keşif sinyali: aynı yükleme ve talepte oyun > araç; talep yoksa oran bileşeni atlanır', () => {
  const games = top(10);
  const tools = top(10, { genre: 'TOOLS' }, 't');
  const g = discoverySignal(games, rec('x', games));
  const t = discoverySignal(tools, rec('y', tools));
  assert.ok(g.value > t.value);
  assert.equal(g.genre, 'GAME_CASUAL');
  const none = discoverySignal(games, rec('x', games, { demand: 0 }));
  assert.equal(none.parts.ratio, null);
  assert.ok(Number.isFinite(none.value));
});

test('benzer devler: kelime + tohum ilk 10\'u, yalnızca baskın tür, aynı uygulama iki kez sayılmaz', () => {
  const own = top(10, (i) => ({ real: i < 2 ? 20_000_000 : 50_000 }));
  const seedApps = [own[0], app('s1', { real: 50_000_000 }), app('s2', { real: 3_000_000 }), app('s3', { real: 90_000_000, genre: 'TOOLS' })];
  const d = discoverySignal(own, rec('x', own), seedApps);
  assert.equal(d.n1M, 4);   // a0, a1, s1, s2 (a0 tekrar sayılmaz, s3 başka tür)
  assert.equal(d.n10M, 3);  // a0, a1, s1
  assert.equal(d.pool, 13);
});

test('devler ceza değil (H4): ilk 10\'a aynı türden 10M+ uygulama girince keşif skoru düşmez', () => {
  const small = top(10);
  const withGiant = [app('giant', { real: 200_000_000 }), ...small.slice(1)];
  const s1 = discoveryScore(rec('k', small), mapOf(small), { decision: dec() });
  const s2 = discoveryScore(rec('k', withGiant), mapOf(withGiant), { decision: dec() });
  assert.ok(s2.score >= s1.score, `${s2.score} >= ${s1.score}`);
});

test('rakip boşluğu: reklam + satın alma payı, ortalama puan; şikâyet yalnızca ilk 5\'te yeterli örnek varsa', () => {
  const heavy = top(10, { score: 3.9 });
  const clean = top(10, { ads: false, iap: false, score: 4.8 }, 'c');
  assert.ok(gapSignal(heavy).value > gapSignal(clean).value);
  assert.equal(gapSignal(heavy).parts.rating, 1);
  assert.equal(gapSignal(clean).parts.rating, 0);
  const one = heavy.map((a, i) => (i === 0 ? { ...a, cx: { n: 100, any: 0.3, ads: 0.3, pay: 0, content: 0 } } : a));
  assert.equal(gapSignal(one).parts.complaints, null, 'tek uygulama yetmez');
  const tiny = heavy.map((a, i) => (i < 2 ? { ...a, cx: { n: 5, any: 0.6, ads: 0.6, pay: 0, content: 0 } } : a));
  assert.equal(gapSignal(tiny).parts.complaints, null, 'küçük örneklem sayılmaz');
  const two = heavy.map((a, i) => (i < 2 ? { ...a, cx: { n: 100, any: 0.15, ads: 0.1, pay: 0.05, content: 0 } } : a));
  const g = gapSignal(two);
  assert.equal(g.parts.complaints, 0.5);
  assert.equal(g.nReviewed, 2);
  assert.deepEqual(g.kinds, { ads: 0.1, pay: 0.05, content: 0 });
});

test('görsel kanca: elle değer önce gelir; görsel kelime artırır, araç / metin kelimesi azaltır (iki dil)', () => {
  const games = top(10);
  const tools = top(10, { genre: 'TOOLS' }, 't');
  assert.equal(visualSignal('color by number', games, 'en', { 'color by number': 0.4 }).value, 0.4);
  const pos = visualSignal('color by number jewels', games, 'en');
  const plain = visualSignal('offline games', games, 'en');
  const neg = visualSignal('word games', games, 'en');
  assert.ok(pos.value > plain.value && plain.value > neg.value);
  assert.deepEqual(pos.pos, ['color', 'jewels']);
  assert.equal(visualSignal('su terazisi ücretsiz', tools, 'tr').value, 0);
  assert.deepEqual(visualSignal('boyama oyunları', games, 'tr').pos, ['boya']);
  assert.deepEqual(visualSignal('pilot oyunu', games, 'tr').neg, [], '"pil" kelime başı eşleşmesi "pilot"u yakalamaz');
});

test('yapılabilirlik: politika riski engeller, marka düşürür, ağır yapım çarpar, exclude işaretleri yok sayılır', () => {
  const f = (id, level = 'cap') => ({ id, level, label: id });
  const reg = feasibilitySignal('slots casino', [f('regulated')], 'en');
  assert.equal(reg.value, 0);
  assert.equal(reg.blocked, true);
  assert.equal(feasibilitySignal('lego games', [f('ip')], 'en').value, 0.2);
  assert.equal(feasibilitySignal('online multiplayer chess', [], 'en').value, 0.6);
  assert.equal(feasibilitySignal('çevrimiçi okey', [], 'tr').value, 0.6);
  assert.equal(feasibilitySignal('sudoku', [f('junk', 'exclude')], 'en').value, 1);
  assert.equal(feasibilitySignal('sudoku', [f('zombie')], 'en').value, 1, 'arama tarafı işaretleri (ölü sıralar) yapılabilirliği etkilemez');
});

test('yapılabilirlik sözlükleri: marka, platform, başka ülke, yetişkin, başlık parçası; tuzak kelimeler etkilenmez', () => {
  const v = (k, lang = 'en') => feasibilitySignal(k, [], lang);
  assert.equal(v('truck simulator x bmw').value, 0.2);
  assert.equal(v('block blast').value, 0.2);
  assert.equal(v('araba oyunları jeep', 'tr').value, 0.2);
  assert.equal(v('simulator games pc').value, 0.3);
  assert.equal(v('truck simulator zimbabwe').value, 0.4);
  assert.equal(v('tır oyunları amerikan', 'tr').value, 0.4);
  assert.equal(v('puzzle games girls hot').blocked, true);
  assert.equal(v('kız giydirme oyunları seksi', 'tr').blocked, true);
  assert.equal(v('farm games pizza wala game').value, 0.2, 'başka pazar (0,4) × başlık parçası (0,5)');
  assert.equal(v('araba oyunu oyunları', 'tr').value, 0.5);
  for (const k of ['cooking games korean', 'mac and cheese cooking', 'steam train games', 'air traffic controller', 'youtuber simulator',
    'dodge games', 'adult coloring book', 'truck simulator usa']) assert.equal(v(k).value, 1, k);
  for (const k of ['seksen gün', 'yetişkin boyama', 'sudan kaçış', 'bulmaca oyunları araba']) assert.equal(v(k, 'tr').value, 1, k);
});

test('keşif skoru: değerlendirilmeyen kelimelerde null; ağırlıklar normalize; kısa biçim', () => {
  const games = top(10);
  const m = mapOf(games);
  assert.equal(discoveryScore(rec('k', games, { st: 'pending' }), m, { decision: dec() }), null);
  assert.equal(discoveryScore(rec('k', games), m, { decision: dec({ state: 'invalid' }) }), null);
  assert.equal(discoveryScore(rec('k', games), m, { decision: null }), null);
  const x = discoveryScore(rec('color by number', games), m, { decision: dec() });
  assert.ok(x.score > 0 && x.score <= 100);
  assert.equal(x.level.key, discoveryLevel(x.score).key);
  assert.equal(x.reasons.length, 5);
  const doubled = discoveryScore(rec('color by number', games), m, { decision: dec(), model: { weights: Object.fromEntries(SIGNALS.map((s) => [s, PRIOR_WEIGHTS[s] * 2])) } });
  assert.equal(doubled.score, x.score, 'ölçeklenmiş ağırlıklar aynı skoru verir');
  const c = compactDiscovery(x);
  assert.equal(c.s, x.score);
  assert.equal(c.p.length, 5);
  assert.equal(c.b, undefined);
  const blocked = discoveryScore(rec('slots', games), m, { decision: dec({ flags: [{ id: 'regulated', level: 'cap', label: 'Politika riski' }] }) });
  assert.equal(compactDiscovery(blocked).b, 1);
});

test('normWeights: geçersiz ağırlık öncüle döner, geçerli olan toplamı 1 yapılır', () => {
  assert.deepEqual(normWeights(null), { ...PRIOR_WEIGHTS });
  assert.deepEqual(normWeights({ ...PRIOR_WEIGHTS, gap: -1 }), { ...PRIOR_WEIGHTS });
  const w = normWeights({ discovery: 2, gap: 1, visual: 1, band: 0, feasibility: 0 });
  assert.equal(w.discovery, 0.5);
  assert.equal(Object.values(w).reduce((s, v) => s + v, 0), 1);
});

test('yayın: publicApp şikâyet özetini ekler; annotateDiscovery r.disc ve pazarın modelini yazar', () => {
  assert.equal(publicApp(app('z')).cx, undefined);
  assert.deepEqual(publicApp(app('z'), { t: 1, n: 80, neg: 0.3, any: 0.2, ads: 0.15, pay: 0.05, content: 0 }).cx, { n: 80, any: 0.2, ads: 0.15, pay: 0.05, content: 0 });
  const games = top(10);
  const data = { market: { id: 'us-en', lang: 'en' }, apps: mapOf(games), keywords: [rec('color by number', games), { k: 'bekleyen', st: 'pending', disc: { s: 1 } }] };
  const decisions = new Map([['color by number', dec()]]);
  annotateDiscovery('us-en', data, decisions, { weights: PRIOR_WEIGHTS, visual: { 'us-en': { 'color by number': 0.1 }, 'tr-tr': { x: 1 } } });
  assert.deepEqual(data.discoveryModel.visual, { 'color by number': 0.1 });
  assert.equal(data.keywords[0].disc.p[2], 10, 'elle girilen görsel değer kullanıldı');
  assert.equal(data.keywords[1].disc, undefined, 'eski r.disc temizlenir');
});
