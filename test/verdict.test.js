import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOpportunityVerdict, verdictFromScore, capVerdict, getTrend, getSignals, buildReason,
  demandLevel, difficultyLevel, opportunityLevel, marketLevel, competitorSummary, compareByVerdict, getNicheVerdict,
  reachability, fmtInstalls, THRESHOLDS, GUARDS
} from '../public/js/verdict.js';
import { normalizeFor, stemTr, langOf } from '../public/js/lang.js';
import { titleMatches } from '../src/score.js';

const rec = (o = {}) => ({
  k: o.k || 'test kw', st: 'ok', first: '2026-09-01', demand: 70, difficulty: 40, opportunity: 65, market: 60,
  pop: { minPrefix: 4, pos: 1, len: 10, mode: 'exact' },
  comp: { n: 10, titleMatches: 3, weak: 1, lowRated: 0, stale: 0, big: 1, avgScore: 4.4, sumInstalls: 50_000_000, medianInstalls: 2_000_000 },
  hist: [['2026-09-01', 70, 40, 65]],
  ...o
});

test('eşik sınırları: 70 GOLD, 69 BUILD, 60 BUILD, 59 WATCH, 45 WATCH, 44 WEAK, 30 WEAK, 29 SKIP', () => {
  assert.equal(verdictFromScore(70), 'GOLD');
  assert.equal(verdictFromScore(69), 'BUILD');
  assert.equal(verdictFromScore(60), 'BUILD');
  assert.equal(verdictFromScore(59), 'WATCH');
  assert.equal(verdictFromScore(45), 'WATCH');
  assert.equal(verdictFromScore(44), 'WEAK');
  assert.equal(verdictFromScore(30), 'WEAK');
  assert.equal(verdictFromScore(29), 'SKIP');
  assert.equal(verdictFromScore(0), 'SKIP');
  assert.equal(verdictFromScore(null), 'PENDING');
  assert.equal(THRESHOLDS.GOLD, 70);
});

test('metrik etiket sınırları', () => {
  assert.equal(demandLevel(24).label, 'ÇOK DÜŞÜK');
  assert.equal(demandLevel(25).label, 'DÜŞÜK');
  assert.equal(demandLevel(44).label, 'DÜŞÜK');
  assert.equal(demandLevel(45).label, 'ORTA');
  assert.equal(demandLevel(64).label, 'ORTA');
  assert.equal(demandLevel(65).label, 'YÜKSEK');
  assert.equal(demandLevel(79).label, 'YÜKSEK');
  assert.equal(demandLevel(80).label, 'ÇOK YÜKSEK');
  assert.equal(difficultyLevel(80).label, 'AŞIRI');
  assert.equal(difficultyLevel(79).label, 'YÜKSEK');
  assert.equal(opportunityLevel(29).label, 'KÖTÜ');
  assert.equal(opportunityLevel(30).label, 'ZAYIF');
  assert.equal(opportunityLevel(45).label, 'İLGİNÇ');
  assert.equal(opportunityLevel(60).label, 'İYİ');
  assert.equal(opportunityLevel(70).label, 'MÜKEMMEL');
  assert.equal(opportunityLevel(84).label, 'MÜKEMMEL');
  assert.equal(opportunityLevel(85).label, 'OLAĞANÜSTÜ');
  assert.equal(marketLevel(null).label, '—');
});





test('trend: en az 3 ölçüm ve 21 gün yoksa "new"; varsa 7+ gün aralıkla yükseliş/düşüş/sabit', () => {
  assert.equal(getTrend({ hist: [] }).dir, 'new');
  assert.equal(getTrend({ hist: [['2026-09-01', 50, 50, 50]] }).dir, 'new');
  assert.equal(getTrend({ hist: [['2026-09-01', 50, 50, 50], ['2026-09-10', 50, 50, 61]] }).dir, 'new', 'iki ölçüm trend değildir');
  assert.equal(getTrend({ hist: [['2026-09-01', 50, 50, 50], ['2026-09-05', 50, 50, 52], ['2026-09-10', 50, 50, 61]] }).dir, 'new', '21 günden kısa');
  const up = getTrend({ hist: [['2026-09-01', 50, 50, 50], ['2026-09-12', 50, 50, 52], ['2026-09-25', 50, 50, 61]] });
  assert.equal(up.dir, 'rising');
  assert.equal(up.delta, 9);
  const down = getTrend({ hist: [['2026-09-01', 50, 50, 70], ['2026-09-10', 50, 50, 66], ['2026-09-24', 50, 50, 60]] });
  assert.equal(down.dir, 'falling');
  const flat = getTrend({ hist: [['2026-09-01', 50, 50, 60], ['2026-09-12', 50, 50, 61], ['2026-09-25', 50, 50, 62]] });
  assert.equal(flat.dir, 'stable');
  const s = getSignals(rec({ hist: [] }), up);
  assert.ok(s.positives.some((t) => t.includes('yükseliyor')));
});

test('rakip özeti ve varsayılan sıralama', () => {
  const cs = competitorSummary(rec({ difficulty: 30 }));
  assert.equal(cs.strength.label, 'DÜŞÜK');
  assert.equal(cs.n, 10);
  const rows = [
    { k: 'b', opportunity: 50, decision: { verdict: 'WATCH' } },
    { k: 'a', opportunity: 62, decision: { verdict: 'BUILD' } },
    { k: 'c', opportunity: 75, decision: { verdict: 'GOLD' } },
    { k: 'd', opportunity: 66, decision: { verdict: 'BUILD' } },
    { k: 'e', opportunity: null, decision: { verdict: 'PENDING' } }
  ].sort(compareByVerdict).map((r) => r.k);
  assert.deepEqual(rows, ['c', 'd', 'a', 'b', 'e']);
  assert.equal(capVerdict('GOLD', 'BUILD'), 'BUILD');
  assert.equal(capVerdict('SKIP', 'BUILD'), 'SKIP');
});


/* ---------- "0 indirme" koruması: giriş duvarı ve ölü gölet ---------- */

const reach = (o) => rec({
  demand: 80, difficulty: 35, opportunity: 75,
  comp: {
    n: 10, titleMatches: 2, weak: 5, lowRated: 0, stale: 0, big: 0, avgScore: 4.4,
    sumInstalls: 1_000_000, medianInstalls: 50_000,
    entry: 3_000, midpack: 60_000, leaderShare: 0.3, newcomers: 2, dated: 10, medianAgeYears: 4,
    ...o
  }
});








test('eşik sınırları: duvar ve gölet tam değerlerde', () => {
  assert.equal(getOpportunityVerdict(reach({ entry: 999_999, midpack: 5_000_000 })).reach.wall, 'soft');
  assert.equal(getOpportunityVerdict(reach({ entry: 1_000_000, midpack: 5_000_000 })).reach.wall, 'hard');
  assert.equal(getOpportunityVerdict(reach({ entry: 99_999 })).reach.wall, 'normal');
  assert.equal(getOpportunityVerdict(reach({ entry: 5_000 })).reach.wall, 'open');
  assert.equal(getOpportunityVerdict(reach({ midpack: 999 })).reach.pond, 'dead');
  assert.equal(getOpportunityVerdict(reach({ midpack: 1_000 })).reach.pond, 'thin');
  assert.equal(getOpportunityVerdict(reach({ midpack: 5_000 })).reach.pond, 'normal');
  assert.equal(getOpportunityVerdict(reach({ midpack: 100_000 })).reach.pond, 'healthy');
});

/* ---------- dil desteği: Türkçe ---------- */

test('Türkçe normalize: İ ve I harfleri kelimeyi bölmez, doğru küçültülür', () => {
  assert.equal(normalizeFor('İSTANBUL Haritası', 'tr'), 'istanbul haritası');
  assert.equal(normalizeFor('IŞIK Efekti', 'tr'), 'ışık efekti');
  assert.equal(normalizeFor('Namaz Vakitleri İstanbul', 'tr'), 'namaz vakitleri istanbul');
  // İngilizce tarafta I → i kalır (iPhone bozulmaz)
  assert.equal(normalizeFor('IPHONE Case', 'en'), 'iphone case');
  // noktalı İ hiçbir dilde birleşen nokta bırakmaz
  assert.ok(!normalizeFor('İzmir', 'en').includes('̇'));
});

test('Türkçe kökleme: çoğul, iyelik ve ünlü düşmesi aynı köke iner', () => {
  const pairs = [['oyunlar', 'oyun'], ['oyunları', 'oyunu'], ['vakitleri', 'vakti'], ['vakit', 'vakti'],
    ['arabalar', 'araba'], ['haritası', 'harita'], ['sesleri', 'ses'], ['resimleri', 'resmi'],
    ['şehirleri', 'şehri'], ['fotoğrafları', 'fotoğraf']];
  for (const [a, b] of pairs) assert.equal(stemTr(a), stemTr(b), `${a} / ${b}`);
  // aşırı kökleme farklı kelimeleri çakıştırmasın
  assert.notEqual(stemTr('araba'), stemTr('arap'));
  assert.notEqual(stemTr('harita'), stemTr('hariç'));
  assert.notEqual(stemTr('ses'), stemTr('sen'));
});

test('Türkçe başlık eşleşmesi: çoğul ve dolgu kelimeleri doğru ele alınır', () => {
  assert.equal(titleMatches('çevrimdışı oyunlar', 'Çevrimdışı Oyun - İnternetsiz', 'tr'), true);
  assert.equal(titleMatches('namaz vakitleri', 'Namaz Vakti', 'tr'), true);
  assert.equal(titleMatches('araba oyunları', 'Araba Oyunu 3D', 'tr'), true);
  assert.equal(titleMatches('ücretsiz oyun', 'Oyun Merkezi', 'tr'), true, 'ücretsiz dolgudur');
  assert.equal(titleMatches('istanbul haritası', 'İSTANBUL Harita Rehberi', 'tr'), true);
  assert.equal(titleMatches('namaz vakitleri', 'Hava Durumu', 'tr'), false);
  // İngilizce bozulmadı
  assert.equal(titleMatches('offline games', 'Offline Games', 'en'), true);
  assert.equal(titleMatches('sudoku free', 'Sudoku Classic', 'en'), true);
  assert.equal(titleMatches('chess timer', 'Weather App', 'en'), false);
});

test('Türkçe niş gruplaması: oyun/uygulama gibi genel kelimeler niş adı olmaz', () => {
  const L = langOf('tr');
  for (const w of ['oyun', 'oyunlar', 'uygulama', 'ücretsiz', 'indir', 'için', 've']) {
    assert.ok(L.stopwords.has(w) || L.stopwords.has(L.stem(w)), `${w} stopword olmalı`);
  }
  assert.ok(!L.stopwords.has('namaz'), 'anlamlı kelime stopword olmamalı');
  assert.ok(!L.titleFiller.has('çevrimdışı'), 'çevrimdışı dolgu değildir');
  assert.ok(L.titleFiller.has('ücretsiz'));
});

/* ---------- karar: Girebilirlik × Getiri (geri testle seçilen kural) ---------- */

const NOW = Date.parse('2026-10-01');
const ago = (d) => new Date(NOW - d * 86400000).toISOString().slice(0, 10);
/** n uygulamalık ilk 10: young = son 2 yılda çıkmış olanların sıraları, big = büyük yayıncılı sıralar. */
function serp({ young = [], big = [], real = (i) => 500_000 - i * 20_000, n = 10 } = {}) {
  const apps = Array.from({ length: n }, (_, i) => ({
    id: `app${i}`, title: `App ${i}`, dev: big.includes(i) ? 'Giant Corp' : `Studio ${i}`,
    real: big.includes(i) ? 50_000_000 : real(i), released: young.includes(i) ? ago(200) : ago(2000)
  }));
  return { apps, appsMap: Object.fromEntries(apps.map((a) => [a.id, a])), top: apps.map((a) => a.id) };
}
const kw = (k, s, o = {}) => ({ k, st: 'ok', demand: 50, difficulty: 40, opportunity: 50, top: s.top, ...o });
// pazar geneli geliştirici tablosu (ctx.apps ≥ 500 uygulama) — yoksa karar "yaklaşık" olur ve GOLD verilmez
const bigTable = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`x${i}`, { id: `x${i}`, dev: `Other ${i}`, real: 1000 }]));
const ctxWith = (s, lang = 'en') => ({ lang, apps: { ...bigTable, ...s.appsMap }, titleDF: null, kwDF: null, byK: null, dotlessEn: null, now: NOW, currentYear: 2026, verdictOf: null });

test('girebilirlik: ilk 10 yeni ve küçük uygulamalardan oluşuyorsa güçlü aday, eski ve büyükse duvar', () => {
  const open = serp({ young: [0, 1, 2, 3, 4, 5, 6] });
  const d = getOpportunityVerdict(kw('habit tracker for students', open), { now: NOW, ctx: ctxWith(open), appsMap: open.appsMap });
  assert.equal(d.verdict, 'GOLD');
  assert.equal(d.state, 'ok');
  assert.ok(d.axes.enter.score >= 60, `giriş ${d.axes.enter.score}`);
  assert.equal(d.axes.payoff.level, 'low');
  assert.match(d.reason, /Girmesi kolay/);
  assert.match(d.sentence, /günde 50\+ yükleme/);
  assert.match(d.sentence, /tek bir uygulamanın başarı şansı değildir/);
  const wall = serp({ big: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  const w = getOpportunityVerdict(kw('habit tracker for students', wall), { now: NOW, ctx: ctxWith(wall), appsMap: wall.appsMap });
  assert.equal(w.verdict, 'SKIP');
  assert.equal(w.label, 'Duvar');
  assert.equal(w.state, 'ok', 'duvar geçersiz değil, değerlendirilmiş bir sınıf');
});

test('getiri sınırları: ölü sıralar en fazla WEAK, ince pazar en fazla WATCH', () => {
  const dead = serp({ young: [0, 1, 2, 3, 4, 5, 6], real: () => 1_500 });
  const d = getOpportunityVerdict(kw('habit tracker for students', dead), { now: NOW, ctx: ctxWith(dead), appsMap: dead.appsMap });
  assert.equal(d.verdict, 'WEAK');
  assert.equal(d.axes.payoff.level, 'dead');
  assert.ok(d.capped.some((c) => c.startsWith('Sıralar ölü')));
  const thin = serp({ young: [0, 1, 2, 3, 4, 5, 6], real: () => 40_000 });
  const t = getOpportunityVerdict(kw('habit tracker for students', thin), { now: NOW, ctx: ctxWith(thin), appsMap: thin.appsMap });
  assert.equal(t.verdict, 'WATCH');
  assert.equal(t.axes.payoff.level, 'thin');
});

test('kısa baş kelime en fazla WATCH; eksik rakip verisi en fazla WATCH; geliştirici tablosu yoksa GOLD yok', () => {
  const open = serp({ young: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(getOpportunityVerdict(kw('habit tracker', open), { now: NOW, ctx: ctxWith(open), appsMap: open.appsMap }).verdict, 'WATCH');
  const few = serp({ young: [0, 1, 2], n: 4 });
  assert.equal(getOpportunityVerdict(kw('habit tracker for students', few), { now: NOW, ctx: ctxWith(few), appsMap: few.appsMap }).verdict, 'WATCH');
  const bare = getOpportunityVerdict(kw('habit tracker for students', open), { now: NOW, appsMap: open.appsMap });
  assert.equal(bare.verdict, 'BUILD', 'yalnızca bu ilk 10 bilinirken güçlü aday verilmez');
  assert.equal(bare.approx, true);
  assert.equal(bare.calibration, null, 'yaklaşık kararda geçmiş oran gösterilmez');
});

test('geçersiz kelimeler: talep yok ve yapay kelime "Geç" (değerlendirilmedi); bekleyen PENDING', () => {
  const nd = getOpportunityVerdict({ k: 'x', st: 'no-demand', demand: 0 }, { now: NOW });
  assert.equal(nd.verdict, 'SKIP');
  assert.equal(nd.state, 'invalid');
  assert.equal(nd.label, 'Geç');
  assert.equal(getOpportunityVerdict({ k: 'x', st: 'pending' }).verdict, 'PENDING');
  assert.equal(getOpportunityVerdict(rec({ top: ['a'] })).verdict, 'PENDING', 'uygulama verisi olmadan karar yok');
  const open = serp({ young: [0, 1, 2, 3, 4, 5, 6] });
  const old = getOpportunityVerdict(kw('habit tracker 2019', open), { now: NOW, ctx: ctxWith(open), appsMap: open.appsMap });
  assert.equal(old.verdict, 'SKIP');
  assert.equal(old.excluded, true);
});

test('yanlış pozitif sınırları karara uygulanır (politika riski en fazla WATCH)', () => {
  const open = serp({ young: [0, 1, 2, 3, 4, 5, 6] });
  const d = getOpportunityVerdict(kw('real money solitaire games', open), { now: NOW, ctx: ctxWith(open), appsMap: open.appsMap });
  assert.equal(d.verdict, 'WATCH');
  assert.ok(d.flags.some((f) => f.id === 'regulated' || f.id === 'realMoney'));
});

test('kararlılık: sınır komşusu puan dünkü bandı korur (histerezis)', () => {
  const open = serp({ young: [0, 1, 2, 3, 4, 5, 6] });
  const today = getOpportunityVerdict(kw('habit tracker for students', open), { now: NOW, ctx: ctxWith(open), appsMap: open.appsMap });
  const e = today.axes.enter.score;
  // dün bir alt banttaydı ve bugünkü puan sınıra 3 puandan yakınsa dünkü bant korunur
  const near = Math.abs(e - 60) < 3;
  const prev = { axes: { enter: { band: 'BUILD', nApps: 10 } } };
  const held = getOpportunityVerdict(kw('habit tracker for students', open), { now: NOW, ctx: ctxWith(open), appsMap: open.appsMap, prev });
  assert.equal(held.verdict, near ? 'BUILD' : 'GOLD');
  // dün daha çok uygulama çözülebildiyse (veri boşluğu) bant tutulur
  const shrunk = getOpportunityVerdict(kw('habit tracker for students', open), { now: NOW, ctx: ctxWith(open), appsMap: open.appsMap, prev: { axes: { enter: { band: 'WATCH', nApps: 12 } } } });
  assert.equal(shrunk.verdict, 'WATCH');
});

test('sıralama: önce sınıf, sonra girebilirlik puanı; niş kararı en iyi üç üyenin ortancası', () => {
  const mk = (k, verdict, sortKey) => ({ k, opportunity: 50, demand: 50, difficulty: 40, decision: { verdict, sortKey, state: 'ok', trend: { dir: 'new' } } });
  const rows = [mk('a', 'BUILD', 3045), mk('b', 'BUILD', 3052), mk('c', 'GOLD', 4061), mk('d', 'WATCH', 2050)].sort(compareByVerdict).map((r) => r.k);
  assert.deepEqual(rows, ['c', 'b', 'a', 'd']);
  const nv = getNicheVerdict({ name: 'x' }, [mk('a', 'GOLD', 4070), mk('b', 'WATCH', 2040), mk('c', 'WEAK', 1030), mk('d', 'SKIP', 5)]);
  assert.equal(nv.verdict, 'WATCH', 'tek bir GOLD üye nişi GOLD yapmaz');
  assert.equal(nv.counts.GOLD, 1);
  assert.equal(getNicheVerdict({ name: 'z' }, []).topOpportunity, null);
});
