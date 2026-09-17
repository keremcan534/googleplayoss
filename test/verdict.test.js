import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOpportunityVerdict, verdictFromScore, capVerdict, getTrend, getSignals, buildReason,
  demandLevel, difficultyLevel, opportunityLevel, marketLevel, competitorSummary, compareByVerdict, getNicheVerdict,
  reachability, fmtInstalls, THRESHOLDS, GUARDS
} from '../public/js/verdict.js';

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

test('yüksek talep + düşük zorluk → güçlü karar ve olumlu sinyaller', () => {
  const d = getOpportunityVerdict(rec({ demand: 86, difficulty: 24, opportunity: 82, comp: { n: 10, titleMatches: 2, weak: 4, lowRated: 2, stale: 3, big: 0, avgScore: 3.8, sumInstalls: 5_000_000 } }));
  assert.equal(d.verdict, 'GOLD');
  assert.ok(d.positives.some((s) => s.includes('4 zayıf uygulama')), 'zayıf rakip sinyali');
  assert.ok(d.positives.some((s) => s.includes("4.0'ın altında")), 'düşük puan sinyali');
  assert.ok(d.positives.some((s) => s.includes('güncellenmemiş')), 'bayat rakip sinyali');
  assert.ok(d.positives.some((s) => s.includes('dev uygulama (10M+) yok')));
  assert.equal(d.reason, 'Yüksek talep, düşük rekabet, 3 rakip bir yıldır güncellenmiyor.');
  assert.equal(d.trend.dir, 'new', 'tek kayıtla trend uydurulmaz');
});

test('düşük talep → asla GOLD (BUILD ile sınırlanır), çok düşük talep → en fazla WATCH', () => {
  const low = getOpportunityVerdict(rec({ demand: 40, difficulty: 5, opportunity: 72 }));
  assert.equal(low.verdict, 'BUILD');
  assert.ok(low.capped.length === 1);
  assert.ok(low.negatives.some((s) => s.startsWith('Talep düşük')));
  const vlow = getOpportunityVerdict(rec({ demand: 20, difficulty: 5, opportunity: 72 }));
  assert.equal(vlow.verdict, 'WATCH');
  assert.equal(buildReason(rec({ demand: 20, difficulty: 5, opportunity: 50 })), 'Zayıf rekabete rağmen talep düşük.');
});

test('aşırı zorluk → olumsuz uyarı ve GOLD yok', () => {
  const d = getOpportunityVerdict(rec({ demand: 96, difficulty: 94, opportunity: 21, comp: { n: 10, titleMatches: 8, weak: 0, lowRated: 0, stale: 0, big: 6, avgScore: 4.7 } }));
  assert.equal(d.verdict, 'SKIP');
  assert.ok(d.negatives.some((s) => s.startsWith('Rekabet aşırı')));
  assert.ok(d.negatives.some((s) => s.includes('dev uygulama')));
  assert.equal(d.reason, 'Çok güçlü rakipler arama sonuçlarına hakim, başlık rekabeti de çok yoğun.');
  // formül yüksek verse bile koruma kuralı GOLD'u engeller
  const forced = getOpportunityVerdict(rec({ demand: 96, difficulty: 85, opportunity: 75 }));
  assert.equal(forced.verdict, 'BUILD');
  const forced2 = getOpportunityVerdict(rec({ demand: 70, difficulty: 85, opportunity: 75 }));
  assert.equal(forced2.verdict, 'WATCH');
});

test('talep yok → SKIP, bekleyen → PENDING, eksik rakip verisi → en fazla WATCH', () => {
  assert.equal(getOpportunityVerdict({ k: 'x', st: 'no-demand', demand: 0 }).verdict, 'SKIP');
  assert.equal(getOpportunityVerdict({ k: 'x', st: 'pending' }).verdict, 'PENDING');
  const partial = getOpportunityVerdict(rec({ st: 'partial', demand: 80, difficulty: 20, opportunity: 80, comp: { n: 3, titleMatches: 0, weak: 3, lowRated: 0, stale: 0, big: 0, avgScore: 4.1 } }));
  assert.equal(partial.verdict, 'WATCH');
  assert.ok(partial.negatives.some((s) => s.includes('eksik')));
});

test('trend: yetersiz geçmişte "new", 7+ gün aralıkla yükseliş/düşüş/sabit', () => {
  assert.equal(getTrend({ hist: [] }).dir, 'new');
  assert.equal(getTrend({ hist: [['2026-09-01', 50, 50, 50]] }).dir, 'new');
  assert.equal(getTrend({ hist: [['2026-09-01', 50, 50, 50], ['2026-09-01', 50, 50, 60]] }).dir, 'new', 'aynı gün iki kayıt trend değildir');
  const up = getTrend({ hist: [['2026-09-01', 50, 50, 50], ['2026-09-05', 50, 50, 52], ['2026-09-10', 50, 50, 61]] });
  assert.equal(up.dir, 'rising');
  assert.equal(up.delta, 11);
  const down = getTrend({ hist: [['2026-09-01', 50, 50, 70], ['2026-09-09', 50, 50, 60]] });
  assert.equal(down.dir, 'falling');
  const flat = getTrend({ hist: [['2026-09-01', 50, 50, 60], ['2026-09-04', 50, 50, 62]] });
  assert.equal(flat.dir, 'stable');
  const s = getSignals(rec({ hist: up ? [['2026-09-01', 50, 50, 50], ['2026-09-10', 50, 50, 61]] : [] }), up);
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

test('niş kararı: en iyi 5 ortalaması + talep koruması, faydalı kelime sayısı', () => {
  const mk = (k, opp, demand, verdict) => ({ ...rec({ k, opportunity: opp, demand, difficulty: 40 }), decision: { verdict, trend: { dir: 'new' } } });
  const members = [mk('a', 80, 80, 'GOLD'), mk('b', 72, 75, 'GOLD'), mk('c', 65, 70, 'BUILD'), mk('d', 50, 60, 'WATCH'), mk('e', 20, 30, 'SKIP')];
  const nv = getNicheVerdict({ name: 'x' }, members);
  assert.equal(nv.topOpportunity, 57); // (80+72+65+50+20)/5
  assert.equal(nv.verdict, 'WATCH');
  assert.equal(nv.useful, 4);
  assert.equal(nv.counts.GOLD, 2);
  assert.equal(nv.best.k, 'a');
  assert.equal(nv.trend.dir, 'new');
  // yüksek fırsat ama düşük talep → GOLD yerine BUILD
  const lowDemand = [mk('a', 80, 30, 'GOLD'), mk('b', 78, 35, 'GOLD'), mk('c', 75, 40, 'GOLD')];
  assert.equal(getNicheVerdict({ name: 'y' }, lowDemand).verdict, 'BUILD');
  assert.equal(getNicheVerdict({ name: 'z' }, []).topOpportunity, null);
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

test('giriş duvarı: ilk 10un en zayıfı 1M+ ise karar WEAK ile sınırlanır', () => {
  const d = getOpportunityVerdict(reach({ entry: 1_200_000, midpack: 5_000_000 }));
  assert.equal(d.verdict, 'WEAK');
  assert.equal(d.reach.wall, 'hard');
  assert.ok(d.negatives.some((s) => s.startsWith('Giriş duvarı')));
  assert.ok(d.reason.includes('giremez'), d.reason);
  assert.ok(d.capped.some((c) => c.includes('duvar')));
});

test('giriş zor: en zayıf rakip 100K+ ise en fazla WATCH', () => {
  const d = getOpportunityVerdict(reach({ entry: 150_000, midpack: 800_000 }));
  assert.equal(d.verdict, 'WATCH');
  assert.equal(d.reach.wall, 'soft');
  assert.ok(d.negatives.some((s) => s.startsWith('Giriş zor')));
});

test('ölü gölet: orta sıra 1K altındaysa karar WEAK ile sınırlanır', () => {
  const d = getOpportunityVerdict(reach({ entry: 12, midpack: 400 }));
  assert.equal(d.verdict, 'WEAK');
  assert.equal(d.reach.pond, 'dead');
  assert.ok(d.negatives.some((s) => s.startsWith('Ölü gölet')));
  assert.ok(d.reason.includes('pazar boş'), d.reason);
});

test('ince pazar: orta sıra 5K altındaysa en fazla WATCH', () => {
  const d = getOpportunityVerdict(reach({ entry: 50, midpack: 3_000 }));
  assert.equal(d.verdict, 'WATCH');
  assert.equal(d.reach.pond, 'thin');
});

test('sağlıklı gölet + kolay giriş: GOLD korunur ve olumlu sinyaller gelir', () => {
  const d = getOpportunityVerdict(reach({ entry: 2_000, midpack: 250_000, newcomers: 4 }));
  assert.equal(d.verdict, 'GOLD');
  assert.deepEqual(d.capped, []);
  assert.ok(d.positives.some((s) => s.includes('girmek kolay')));
  assert.ok(d.positives.some((s) => s.includes('gerçek trafik')));
  assert.ok(d.positives.some((s) => s.includes('yeniye açık')));
});

test('donmuş pazar ve tek uygulamanın pazarı uyarı verir (karar sınırlamaz)', () => {
  const d = getOpportunityVerdict(reach({ newcomers: 0, dated: 10, medianAgeYears: 9, leaderShare: 0.85 }));
  assert.ok(d.negatives.some((s) => s.startsWith('Pazar donmuş')));
  assert.ok(d.negatives.some((s) => s.startsWith('Tek uygulamanın pazarı')));
  assert.equal(d.verdict, 'GOLD', 'bu ikisi tek başına kararı düşürmez');
});

test('erişilebilirlik verisi yoksa hiçbir kural uygulanmaz (geriye dönük uyum)', () => {
  const d = getOpportunityVerdict(rec({ demand: 80, difficulty: 30, opportunity: 75 }));
  assert.equal(d.reach.has, false);
  assert.equal(d.verdict, 'GOLD');
  assert.deepEqual(d.capped, []);
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
