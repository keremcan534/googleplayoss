import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateKeyword, simulateScenario, dailyInstalls, buildCohorts, newcomerEvidence, devStats, sig2, HORIZONS } from '../public/js/sim.js';
import { detectFlags, buildFlagContext, liveFlagContext } from '../public/js/flags.js';
import { getOpportunityVerdict } from '../public/js/verdict.js';

const NOW = Date.parse('2026-10-01');
const day = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const app = (id, real, ageD, o = {}) => ({ id, title: `App ${id}`, dev: `dev-${id}`, genre: 'TOOLS', real, released: day(ageD), score: 4.2, ratings: 100, ...o });

function dataset(appsList, top) {
  const apps = Object.fromEntries(appsList.map((a) => [a.id, a]));
  return { market: { lang: 'en' }, apps, keywords: [{ k: 'tip calculator', st: 'ok', demand: 50, difficulty: 50, opportunity: 50, comp: { n: 10, entry: 1000, entry2: 2000, midpack: 80000, newcomers: 3, dated: 10 }, top }] };
}

test('günlük yükleme eğrisi: gecikme, 21 günlük rampa, sonra sabit', () => {
  const d = dailyInstalls(21, 14, 60);
  assert.equal(d[13], 0);
  assert.equal(d[14], 1);
  assert.equal(d[34], 21);
  assert.equal(d[59], 21);
});

test('simülasyon: hız bilinen örnekle prototiple aynı (TR uygulama, temel senaryo)', () => {
  const r = simulateScenario(10.86, 1, 'app', 'tr', { ads: true, purchases: false });
  assert.equal(Math.round(r.byHorizon[365].installs), 3703);
  assert.equal(Math.round(r.byHorizon[365].ads), 7);
  assert.equal(r.payoutDay, null, '7 $ ile AdMob eşiği aşılmaz');
  for (const h of HORIZONS) assert.ok(r.byHorizon[h].purchases === 0);
});

test('satın alma geliri: Play %15 ve TR KDV düşülür, olgunlaşmamış yüklemeler sayılmaz', () => {
  const us = simulateScenario(100, 1, 'app', 'us', { ads: false, purchases: true });
  const tr = simulateScenario(100, 1, 'app', 'tr', { ads: false, purchases: true });
  assert.equal(us.byHorizon[30].purchases, 0, '60 günden genç yüklemeler sayılmaz');
  assert.ok(us.byHorizon[365].purchases > 0 && us.byHorizon[365].ads === 0);
  assert.ok(tr.byHorizon[365].purchases < us.byHorizon[365].purchases * 0.3);
});

test('kanıt: bu kelimedeki bağımsız yeni uygulamalar; büyük yayıncı ve çok yaşlı/çok genç sayılmaz', () => {
  const list = [app('a', 900_000, 2000), app('b', 600_000, 2500), app('n1', 9000, 300), app('n2', 30000, 400), app('n3', 3000, 200),
    app('big', 5_000_000, 200, { dev: 'giant' }), app('g2', 20_000_000, 3000, { dev: 'giant' }), app('baby', 100, 10), app('c', 400_000, 1500), app('d', 300_000, 1600)];
  const ds = devStats(Object.fromEntries(list.map((a) => [a.id, a])));
  const ev = newcomerEvidence(list, ds, NOW);
  assert.deepEqual(ev.list.map((x) => x.id), ['n1', 'n2', 'n3']);
  assert.equal(ev.own.n, 3);
  assert.ok(Math.abs(ev.own.p[1] - 30) < 0.01, `medyan ${ev.own.p[1]}`); // 9000/300
});

test('kelime simülasyonu: kanıt yoksa sayı üretmez; marka/yapay kelimede simülasyon yok', () => {
  const list = [app('a', 900_000, 2000), app('b', 600_000, 2500), app('c', 900_000, 1500), app('d', 800_000, 1600), app('e', 700_000, 1600), app('f', 600_000, 1900)];
  const d = dataset(list, list.map((a) => a.id));
  const r = d.keywords[0];
  const sim = simulateKeyword(r, { apps: d.apps, lang: 'en', cohorts: { minN: 20, cells: {} }, now: NOW });
  assert.equal(sim.level, 'none');
  assert.equal(sim.scenarios, undefined);
  assert.ok(sim.none);
  const gated = simulateKeyword(r, { apps: d.apps, lang: 'en', now: NOW, flags: [{ id: 'rarePrefix', level: 'cap', label: 'Marka adı', reason: 'x' }] });
  assert.match(gated.gate, /Simülasyon yok/);
  // kohort yeterliyse kullanılır
  const coh = { minN: 2, cells: { 'app|500K+': { n: 5, p: [1, 2, 3] } } };
  const viaCohort = simulateKeyword(r, { apps: d.apps, lang: 'en', cohorts: coh, now: NOW });
  assert.equal(viaCohort.level, 'cohort');
  assert.equal(viaCohort.scenarios.length, 3);
});

test('kohortlar: her yeni uygulama hücrede bir kez sayılır', () => {
  const list = [app('a', 900_000, 2000), app('b', 600_000, 2500), app('c', 400_000, 1500), app('d', 300_000, 1600), app('e', 200_000, 1600), app('n1', 9000, 300)];
  const d = dataset(list, list.map((a) => a.id));
  d.keywords.push({ ...d.keywords[0], k: 'tip calculator free' });
  const c = buildCohorts(d, NOW);
  assert.equal(c.cells['app|50K-500K'].n, 1);
});

test('sig2: iki anlamlı basamak', () => {
  assert.equal(sig2(3705), 3700);
  assert.equal(sig2(0.0473), 0.047);
  assert.equal(sig2(0), 0);
});

test('yanlış pozitif kapıları: yıl, ı/ğ yapay kelime, politika, tek yayıncı, ölü sıralar', () => {
  const tr = { market: { lang: 'tr' }, apps: {}, keywords: [] };
  const ctxTr = buildFlagContext(tr, { now: NOW });
  const ids = (k, ctx, extra = {}) => detectFlags({ k, st: 'ok', ...extra }, ctx).map((f) => `${f.id}:${f.level}`);
  assert.ok(ids('ıveco tır oyunları', ctxTr).includes('dotless:exclude'));
  assert.ok(!ids('ılık su', ctxTr).includes('dotless:exclude'), 'gerçek Türkçe ı kelimesi');
  assert.ok(ids('traktör oyunları 2019', ctxTr).includes('pastYear:exclude'));
  assert.ok(ids('namaz vakitleri 2026', ctxTr).some((x) => x.startsWith('yearStamped')));
  assert.ok(!ids('su içme hatırlatıcısı', ctxTr).some((x) => x.startsWith('junk')), 'iki harfli Türkçe kelime yapay değil');
  assert.ok(ids('araba oyunları araba oyunları', ctxTr).includes('junk:exclude'));
  assert.ok(ids('canlı bahis', ctxTr).includes('regulated:cap'));
  assert.ok(ids('e devlet şifre', ctxTr).includes('brandTr:cap'));
  const en = { market: { lang: 'en' }, apps: {}, keywords: [] };
  const ctxEn = buildFlagContext(en, { now: NOW });
  assert.ok(ids('real money games', ctxEn).includes('regulated:cap'));
  assert.ok(ids('cricket games india', ctxEn).includes('wrongGeo:cap'));
  assert.ok(ids('rpg games like final fantasy', ctxEn).includes('likeX:cap'));
  // tek yayıncı + ölü sıralar: ilk 10 verisiyle
  const apps = Array.from({ length: 10 }, (_, i) => app(`x${i}`, i < 2 ? 500 : 80_000, 2000, { dev: i < 6 ? 'Kemco' : `d${i}` }));
  const live = liveFlagContext(apps, 'en', NOW);
  const f = ids('kemco rpg', live, { top: apps.map((a) => a.id) });
  assert.ok(f.includes('singleDev:cap'));
  assert.ok(f.includes('zombie:cap'));
  assert.ok(!f.some((x) => x.startsWith('rarePrefix')), 'sözlük olmadan sıklık kuralı çalışmaz');
});

test('karar: yapay kelime SKIP ve "Geç" (değerlendirilmedi), gerekçe gösterilir', () => {
  const ctx = buildFlagContext({ market: { lang: 'tr' }, apps: {}, keywords: [] }, { now: NOW });
  const apps = Array.from({ length: 10 }, (_, i) => app(`t${i}`, 200_000, 2000));
  const v = getOpportunityVerdict({ k: 'ıveco kamyon oyunları', st: 'ok', demand: 89, difficulty: 20, opportunity: 80, comp: { n: 10 }, top: apps.map((a) => a.id) },
    { now: NOW, ctx, appsMap: Object.fromEntries(apps.map((a) => [a.id, a])) });
  assert.equal(v.verdict, 'SKIP');
  assert.equal(v.excluded, true);
  assert.equal(v.label, 'Geç');
  assert.match(v.reason, /yapay/);
});
