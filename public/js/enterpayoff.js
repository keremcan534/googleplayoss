/*
 * Kelime kararı — "Girebilirlik × Getiri" (enter × payoff).
 * Ekim 2026 geri testinden (sızıntısız, bir yıl önceki ilk 10 → bugünkü yeni girenler) seçilen tasarım;
 * referans uygulamadan birebir aktarıldı. Ayrıntı: docs/DOGRULAMA.md.
 *
 * (English notes from the reference implementation follow.)
 *
 * What a class means (per keyword, per market): in the backtest (keywords as of 2025-10-01, outcomes in the top-10 of
 * 2026-10-01), how often did a SMALL developer's app released in that year reach this keyword's top-10 with ≥ 50
 * installs/day — and, when one got in, did it get installs at all (zombie = best one < 10/day)? CALIBRATION holds the
 * per-class answer for each market; the UI shows those numbers, never a per-keyword probability.
 *
 *   ENTER axis   E (0-100) = 50 · (open + small), rank-weighted over the resolvable top-10 (weights 1×6, .8, .6, .4, .2)
 *                  open  = weighted share of apps released in the last 730 days
 *                  small = weighted share of apps from SMALL developers: the developer's biggest app in this top-10 has
 *                          < 10M installs and it has ≤ 2 apps here, AND in the market-wide developer table (every crawled
 *                          app) its biggest app is < 10M and it has ≤ 5 apps
 *                Bands: GOLD ≥ 60 · BUILD ≥ 40 · WATCH ≥ 30 · WEAK ≥ 15 · SKIP < 15 ("Duvar")
 *   PAYOFF axis  established apps only (≥ 365 days old, or undated):
 *                  entry2 = 2nd-smallest installs → dead (< 3K) caps at WEAK · thin (< 100K) caps at WATCH ("piyango")
 *                  midpack = median installs at ranks 3-10 → display level (sınırlı < 1M ≤ orta < 10M ≤ yüksek)
 *   GUARDS       head term (≤ 2 words) → at most WATCH · < 5 resolvable apps or st 'partial' → at most WATCH
 *                no market-wide developer table (bare live analysis) → at most BUILD
 *                flags.js: exclude → SKIP with state 'invalid' ("Geç", not evaluated) · cap → min(verdict, cap)
 *                supplementary keyword-text caps (real money, Azerbaijani, public agency) → at most WATCH
 *                st 'no-demand' → SKIP with state 'invalid'
 *   NOT USED     demand (does not predict newcomer outcomes), the stored difficulty / opportunity (shown elsewhere).
 *
 * Inputs are one keyword's record + its own top-10 apps + the flags.js context; the only market-wide input is the
 * developer table (ctx.apps, or a shipped data.devs), so a live analysis matches the dataset verdict.
 *
 * Exports
 *   classifyToday(record, appsMap, ctx, now, opts?) → {verdict, state, label, meaning, axes:{enter, payoff}, reasons[],
 *                                                     guards[], capped[], flags[], calibration, sentence, sortKey} | null
 *   fromLiveResult(result)   {record, appsMap} from /api/analyze's `result`
 *   buildDevTable, devLookup, serpFeatures, payoffLevel, decide, groupBySerp, trLoc,
 *   PARAMS, CLASS_TR, INVALID_TR, CALIBRATION, VERSION
 *
 * Pure ESM, no Node APIs. The only import is the snapshot flags.js (in the browser: './flags.js').
 */
import { detectFlags } from './flags.js';

export const VERSION = 'enter-payoff-v1 (backtest THEN=2025-10-01 → TODAY=2026-10-01)';
const DAY = 86400000;
export const ORD = Object.freeze({ GOLD: 4, BUILD: 3, WATCH: 2, WEAK: 1, SKIP: 0 });
export const CLASSES = Object.freeze(['GOLD', 'BUILD', 'WATCH', 'WEAK', 'SKIP']);

/** Every number the rule uses. Round values, identical in both markets. */
export const PARAMS = Object.freeze({
  // rank weights for positions 1..10 of the resolvable top-10 (smooth taper: one adjacent swap moves E by ≤ 10 points × 0.2)
  rankWeights: Object.freeze([1, 1, 1, 1, 1, 1, 0.8, 0.6, 0.4, 0.2]),
  youngDays: 730,            // "young" = released within this many days of now
  establishedDays: 365,      // "established" (payoff features) = released at least this long ago, or undated
  smallDevMaxInstalls: 10_000_000, // small developer: its biggest app IN THIS TOP-10 has < 10M installs …
  smallDevMaxApps: 2,              // … and it has ≤ 2 apps in this top-10 …
  tableDevMaxApps: 5,              // … and, in the market's developer table (all crawled apps), < 10M max and ≤ 5 apps
  minTableApps: 500,               // an apps map this large counts as a market-wide developer table
  enterBands: Object.freeze({ GOLD: 60, BUILD: 40, WATCH: 30, WEAK: 15 }), // E ≥ band → class; below WEAK → SKIP
  deadEntry2: 3_000,         // established entry2 below → at most WEAK ("ölü sıralar")
  thinEntry2: 100_000,       // established entry2 below → at most WATCH ("ince pazar: piyango")
  payoffMid: 1_000_000,      // display: midpack ≥ 1M → "orta"
  payoffHigh: 10_000_000,    // display: midpack ≥ 10M → "yüksek"
  headTermMaxWords: 2,       // keyword with ≤ this many words …
  headTermCap: 'WATCH',      // … is capped here (zombie-prone; no discrimination in TR)
  minApps: 5,                // fewer resolvable apps (or st 'partial') → at most WATCH (production only)
  extraCap: 'WATCH',         // supplementary keyword-text caps
  hysteresis: 3              // optional: E within ±3 of a band edge keeps the previous band (opts.prev)
});

/* ------------------------------------------------------------------ Turkish labels */

export const CLASS_TR = Object.freeze({
  GOLD: { title: 'Güçlü aday', meaning: 'İlk 10\'un büyük kısmı son 2 yılda çıkmış ve küçük geliştiricilerin uygulamaları; yerleşik rakipler de gerçek yükleme alıyor. Nadir bir sınıf: geçmişte bu tür kelimelerin çoğunda küçük bir geliştiricinin yeni uygulaması ilk 10\'a girip günde 50+ yükleme aldı (örneklem küçük, aralık geniş).' },
  BUILD: { title: 'İyi aday', meaning: 'İlk 10 yeni ve küçük uygulamalara açık; gölet ölü ya da ince değil. Geçmişte bu tür kelimelerin yaklaşık yarısında küçük bir geliştiricinin yeni uygulaması günde 50+ yüklemeye ulaştı; girenlerin çok azı ölü kaldı.' },
  WATCH: { title: 'Ortalama / riskli', meaning: 'Ya giriş ortalama, ya da girmek kolay ama gölet ince (piyango: giren küçük uygulamaların kabaca altıda biri günde 10 yüklemenin altında kaldı); kısa baş kelimeler ve marka / politika riski taşıyan kelimeler de burada.' },
  WEAK: { title: 'Zayıf', meaning: 'İlk 10 çoğunlukla eski ve büyük uygulamaların ya da sıralar ölü; yeni küçük uygulamalar buraya ortalamanın altında giriyor.' },
  SKIP: { title: 'Duvar', meaning: 'İlk 10\'u neredeyse tamamen eski, büyük yayıncıların uygulamaları tutuyor; yeni küçük bir uygulama buraya nadiren giriyor (girebilen nadir uygulamalar ise çoğu zaman iyi kazanıyor).' }
});
/** SKIP for a keyword that is not a real search: separate state so the wall label is not reused for junk. */
export const INVALID_TR = Object.freeze({
  exclude: { title: 'Geç', meaning: 'Gerçek bir arama değil (yapay ya da güncelliğini yitirmiş kelime): değerlendirilmedi.' },
  noDemand: { title: 'Geç', meaning: 'Talep kanıtı yok: kelime otomatik tamamlamada görünmüyor; değerlendirilmedi.' }
});
const ENTER_TR = { GOLD: 'Girmesi kolay', BUILD: 'Girilebilir', WATCH: 'Girmesi orta', WEAK: 'Girmesi zor', SKIP: 'Duvar' };
const PAYOFF_TR = { dead: 'Sıralar ölü', thin: 'İnce pazar (piyango)', unknown: 'Getiri belirsiz', low: 'Getirisi sınırlı', mid: 'Getirisi orta', high: 'Getirisi yüksek' };

/**
 * Public calibration (backtest: keywords as of 2025-10-01, outcomes measured 2026-10-01; one keyword per SERP cluster).
 * t50 = share of keywords where a small developer's app released in the following year reached the top-10 with
 * ≥ 50 installs/day; zombie = share where the best such app got < 10/day; zombieIfEntered = the same among keywords
 * where a small developer's new app got in; medV = median installs/day of the best such app, when one got in.
 * Filled from final/eval.out (dedup block); ci = 95% cluster-bootstrap interval of t50.
 */
export const CALIBRATION = Object.freeze({
  'us-en': Object.freeze({
    base: { t50: 33.7, t50All: 30.4 },
    GOLD: { n: 32, t50: 68.8, ci: [53.1, 84.4], t50Shown: 70, entered: 81.3, zombie: 3.1, zombieIfEntered: 3.9, medV: 2413, p25V: 717, p75V: 7729, all: { n: 52, t50: 73.1, ci: [58.5, 85.5], zombieIfEntered: 2.3, medV: 3833 } },
    BUILD: { n: 296, t50: 52.7, ci: [47, 58.5], t50Shown: 55, entered: 60.5, zombie: 1.7, zombieIfEntered: 2.8, medV: 1139, p25V: 286, p75V: 8481, all: { n: 488, t50: 51.2, ci: [45.3, 56.9], zombieIfEntered: 2.9, medV: 837 } },
    WATCH: { n: 733, t50: 39.8, ci: [36.4, 43.5], t50Shown: 40, entered: 58, zombie: 9.3, zombieIfEntered: 16, medV: 302, p25V: 30, p75V: 1929, all: { n: 1190, t50: 40.7, ci: [36.8, 45], zombieIfEntered: 14.7, medV: 377 } },
    WEAK: { n: 809, t50: 30.2, ci: [27.2, 33.4], t50Shown: 30, entered: 38.8, zombie: 4.2, zombieIfEntered: 10.8, medV: 764, p25V: 62, p75V: 4421, all: { n: 1343, t50: 27.7, ci: [24.3, 31.4], zombieIfEntered: 10.4, medV: 837 } },
    SKIP: { n: 615, t50: 20.2, ci: [17.2, 23.1], t50Shown: 20, entered: 22.4, zombie: 0.7, zombieIfEntered: 2.9, medV: 1762, p25V: 391, p75V: 12766, all: { n: 1598, t50: 17.2, ci: [14.3, 21], zombieIfEntered: 7, medV: 1834 } },
    invalid: { n: 19, note: 'flag-excluded keywords are not evaluated (their SERPs mirror real keywords)' }
  }),
  'tr-tr': Object.freeze({
    base: { t50: 27.9, t50All: 22.1 },
    GOLD: { n: 15, t50: 73.3, ci: [53.3, 93.3], t50Shown: 75, entered: 80, zombie: 0, zombieIfEntered: 0, medV: 1866, p25V: 353, p75V: 4844, all: { n: 19, t50: 68.4, ci: [44.4, 88.9], zombieIfEntered: 0, medV: 1866 } },
    BUILD: { n: 131, t50: 52.7, ci: [44.3, 61.1], t50Shown: 55, entered: 61.1, zombie: 1.5, zombieIfEntered: 2.5, medV: 1857, p25V: 239, p75V: 6129, all: { n: 257, t50: 42.4, ci: [32.8, 52.4], zombieIfEntered: 3.6, medV: 715 } },
    WATCH: { n: 395, t50: 37.2, ci: [32.4, 42], t50Shown: 35, entered: 56.5, zombie: 8.6, zombieIfEntered: 15.3, medV: 193, p25V: 34, p75V: 1858, all: { n: 692, t50: 32.7, ci: [27, 38.5], zombieIfEntered: 18.1, medV: 106 } },
    WEAK: { n: 494, t50: 24.9, ci: [21.1, 28.7], t50Shown: 25, entered: 34.8, zombie: 4.7, zombieIfEntered: 13.4, medV: 390, p25V: 40, p75V: 5629, all: { n: 1064, t50: 21.2, ci: [15.9, 26.4], zombieIfEntered: 14, medV: 685 } },
    SKIP: { n: 499, t50: 15.6, ci: [12.6, 18.6], t50Shown: 15, entered: 17, zombie: 0.4, zombieIfEntered: 2.4, medV: 3154, p25V: 754, p75V: 14890, all: { n: 1452, t50: 13.4, ci: [9.9, 17.5], zombieIfEntered: 1.5, medV: 2561 } },
    invalid: { n: 289, note: 'flag-excluded keywords are not evaluated (their SERPs mirror real keywords)' }
  })
});

/* ------------------------------------------------------------------ helpers */

const relT = (a) => { const t = a && a.released ? Date.parse(a.released) : NaN; return Number.isFinite(t) ? t : null; };
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const capTo = (c, to) => (to && ORD[c] > ORD[to] ? to : c);
const fmt = (n) => (!Number.isFinite(n) ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} milyon` : n >= 1e3 ? `${Math.round(n / 1e3)} bin` : String(Math.round(n)));
export const wordCount = (k) => String(k || '').trim().split(/\s+/).filter(Boolean).length;

/* ------------------------------------------------------------------ features */

/**
 * Features of one SERP.
 * @param {Array<{real:number, released?:string|null, dev?:string, rank?:number}>} apps resolvable top-10 in rank order
 * @param {{now:number, measuredAt?:number, P?:object}} o now = date the SERP is judged at; measuredAt = when `real`
 *        was read (production: now; harness cf view: TODAY, because incumbents' installs are today's)
 */
export function serpFeatures(apps, { now, measuredAt = now, devTable = null, P = PARAMS } = {}) {
  const L = (apps || []).filter(Boolean).slice(0, 10);
  const byDev = new Map();
  for (const a of L) {
    const k = a.dev ?? `__nodev__${a.id}`;
    const s = byDev.get(k) || { n: 0, max: 0 };
    s.n++; s.max = Math.max(s.max, a.real || 0); byDev.set(k, s);
  }
  const isYoung = (a) => { const t = relT(a); return t !== null && t <= now && t >= now - P.youngDays * DAY; };
  // small developer = small inside this top-10 AND (when a developer table is available) small in the whole market
  const isSmall = (a) => {
    const s = byDev.get(a.dev ?? `__nodev__${a.id}`);
    if (!(s.max < P.smallDevMaxInstalls && s.n <= P.smallDevMaxApps)) return false;
    const t = devTable ? devTable(a) : null;
    return !t || (t.max < P.smallDevMaxInstalls && t.n <= P.tableDevMaxApps);
  };
  let wsum = 0, wy = 0, ws = 0, nYoung = 0, nSmall = 0;
  L.forEach((a, i) => {
    const w = P.rankWeights[i] ?? 0;
    const y = isYoung(a), s = isSmall(a);
    if (y) nYoung++;
    if (s) nSmall++;
    wsum += w; if (y) wy += w; if (s) ws += w;
  });
  const open = wsum ? wy / wsum : 0, small = wsum ? ws / wsum : 0;
  const est = L.map((a, i) => ({ a, rank: a.rank ?? i + 1 }))
    .filter(({ a }) => { const t = relT(a); return t === null || measuredAt - t >= P.establishedDays * DAY; });
  const reals = est.map(({ a }) => a.real || 0).sort((x, y) => x - y);
  const entry2 = reals.length ? (reals.length > 1 ? reals[1] : reals[0]) : null;
  const midpack = median(est.filter((x) => x.rank >= 3).map(({ a }) => a.real || 0));
  return {
    nApps: L.length, nYoung, nSmall, nEstablished: est.length,
    open, small, enter: Math.round(50 * (open + small)),
    entry2, midpack
  };
}

/* ------------------------------------------------------------------ developer table */

const DEV_CACHE = new WeakMap();
const SIZE_CACHE = new WeakMap();
/** Uygulama haritasının boyutu (harita nesnesi başına bir kez sayılır; her kelimede 12 bin anahtar saymak yavaştı). */
function mapSize(m) {
  let n = SIZE_CACHE.get(m);
  if (n === undefined) { n = Object.keys(m).length; SIZE_CACHE.set(m, n); }
  return n;
}
/**
 * Market-wide developer table {dev → {n: apps in the map, max: largest installs}} over a dataset's apps map (cached per
 * map object). The crawler can ship it precomputed as data.devs = {dev: [n, max]} so a live analysis can use it without
 * the whole apps map. Built over every app in the map, as the backtest did.
 */
export function buildDevTable(appsMap) {
  if (!appsMap || typeof appsMap !== 'object') return null;
  let t = DEV_CACHE.get(appsMap);
  if (!t) {
    t = new Map();
    for (const a of Object.values(appsMap)) {
      if (!a) continue;
      const k = a.dev ?? `__nodev__${a.id}`;
      const s = t.get(k) || { n: 0, max: 0 };
      s.n++; s.max = Math.max(s.max, a.real || 0); t.set(k, s);
    }
    DEV_CACHE.set(appsMap, t);
  }
  return t;
}
/** Lookup function over a Map (buildDevTable) or a plain object {dev: [n, max] | {n, max}}. */
export function devLookup(table) {
  if (!table) return null;
  if (table instanceof Map) return (a) => table.get(a.dev ?? `__nodev__${a.id}`) || null;
  return (a) => { const e = table[a.dev]; return !e ? null : Array.isArray(e) ? { n: e[0], max: e[1] } : e; };
}

/* Ek anahtar-kelime kuralları (gerçek para, Azerbaycan Türkçesi, kamu kurumu, ekli marka adı)
 * referans uygulamada burada duruyordu; tek kural kümesi olsun diye flags.js'e taşındı. */

/* ------------------------------------------------------------------ decision */

const bandOf = (E, B) => (E >= B.GOLD ? 'GOLD' : E >= B.BUILD ? 'BUILD' : E >= B.WATCH ? 'WATCH' : E >= B.WEAK ? 'WEAK' : 'SKIP');
function bandWithHysteresis(E, prev, P) {
  const b = bandOf(E, P.enterBands);
  if (!prev || !(prev in ORD) || prev === b || Math.abs(ORD[prev] - ORD[b]) !== 1) return b;
  const edge = P.enterBands[ORD[prev] > ORD[b] ? prev : b];
  return Math.abs(E - edge) < P.hysteresis ? prev : b;
}
export function payoffLevel(f, P = PARAMS) {
  if (f.entry2 === null) return 'unknown';
  if (f.entry2 < P.deadEntry2) return 'dead';
  if (f.entry2 < P.thinEntry2) return 'thin';
  if (f.midpack === null || f.midpack < P.payoffMid) return 'low';
  return f.midpack < P.payoffHigh ? 'mid' : 'high';
}

/**
 * Core rule. f = serpFeatures(...); o = {k, st, flags (detectFlags), fewAppsGuard, prevBand, P}.
 * @returns {{verdict, state, enterBand, payoff, guards:string[], capped:Array}}
 */
export function decide(f, { k = '', st = 'ok', flags = [], fewAppsGuard = true, devTableOk = true, prevBand = null, holdBand = false, P = PARAMS } = {}) {
  if (st === 'no-demand') return { verdict: 'SKIP', state: 'invalid', invalid: 'noDemand', enterBand: null, payoff: null, guards: [INVALID_TR.noDemand.meaning], capped: [] };
  const ex = flags.find((x) => x.level === 'exclude');
  if (ex) return { verdict: 'SKIP', state: 'invalid', invalid: 'exclude', enterBand: null, payoff: null, guards: [`${ex.label}: ${ex.reason || ''}`.trim()], capped: [] };
  const enterBand = holdBand && prevBand in ORD ? prevBand : bandWithHysteresis(f.enter, prevBand, P);
  const payoff = payoffLevel(f, P);
  let v = enterBand;
  const guards = [], capped = [];
  const step = (to, id, msg) => { const n = capTo(v, to); if (n !== v) { capped.push({ id, from: v, to: n }); guards.push(msg); v = n; } };
  if (payoff === 'dead') step('WEAK', 'deadPond', `Sıralar ölü: yerleşik rakiplerin en zayıf ikincisi ${fmt(f.entry2)} yükleme (< 3 bin); girenler indirme alamıyor.`);
  else if (payoff === 'thin') step('WATCH', 'thinPond', `İnce pazar: yerleşik rakiplerin en zayıf ikincisi ${fmt(f.entry2)} yükleme (< 100 bin). Girmek kolay olabilir ama girenlerin önemli kısmı günde 10 yüklemenin altında kalıyor (piyango).`);
  else if (payoff === 'unknown') step('WATCH', 'noEstablished', 'İlk 10\'da 1 yaşından büyük uygulama yok: getiri ölçülemiyor.');
  if (wordCount(k) <= P.headTermMaxWords) step(P.headTermCap, 'headTerm', 'Kısa baş kelime (1-2 kelime): trafik ilk sıralara gidiyor, giren küçük uygulamaların ölü kalma oranı yüksek.');
  if (fewAppsGuard && (st === 'partial' || f.nApps < P.minApps)) step('WATCH', 'fewApps', `Rakip verisi eksik (${f.nApps} uygulama): karar en fazla "Ortalama".`);
  if (!devTableOk) step('BUILD', 'noDevTable', 'Pazar geneli geliştirici tablosu yok (yalnızca bu ilk 10 bilindi): "Güçlü aday" verilmedi.');
  for (const x of flags) if (x.level === 'cap' && x.cap) step(x.cap, x.id, `${x.label}: ${x.reason || ''}`.trim());
  return { verdict: v, state: 'ok', enterBand, payoff, guards, capped };
}

/* ------------------------------------------------------------------ explanation */

function reasonsOf(f, d, P = PARAMS) {
  if (d.state === 'invalid') return d.guards;
  const pc = (x) => Math.round(100 * x);
  return [
    `${ENTER_TR[d.enterBand]} (girebilirlik ${f.enter}/100): ilk ${f.nApps} uygulamanın ${f.nYoung} tanesi son 2 yılda çıkmış, ${f.nSmall} tanesi küçük geliştiricilerin (sıra ağırlıklı: yeni %${pc(f.open)}, küçük %${pc(f.small)}).`,
    d.payoff === 'dead' || d.payoff === 'thin' || d.payoff === 'unknown'
      ? `${PAYOFF_TR[d.payoff]}.`
      : `${PAYOFF_TR[d.payoff]}: yerleşik rakiplerin en zayıf ikincisi ${fmt(f.entry2)}, orta sırası (3.-10.) ${fmt(f.midpack)} yükleme. Orta sıra büyüdükçe girmek zorlaşır ama girenin aldığı yükleme artar.`,
    ...d.guards
  ];
}

/* ------------------------------------------------------------------ production */

const marketOf = (ctx, opts) => opts.market || (ctx && ctx.lang === 'tr' ? 'tr-tr' : ctx && ctx.lang === 'en' ? 'us-en' : null);

/**
 * Production verdict from TODAY's data only.
 * @param {object} record  keyword record ({k, st, top[], ...}) as stored in public/data/<market>.json, or fromLiveResult().record
 * @param {object} appsMap {id: {real, released, dev, missing?}}
 * @param {object|null} ctx buildFlagContext(data, {now}) — MUST carry the market's lang ('tr' turns on the Turkish rules).
 *        Live analysis: buildFlagContext({market, keywords:[record], apps: appsMap}, {now}) (or the loaded dataset's ctx).
 * @param {number} now ms
 * @param {{market?:string, prev?:object, devTable?:Map|object, flags?:Array}} opts
 *        prev = yesterday's classifyToday result for this keyword (optional): E within ±3 of a band edge keeps
 *        yesterday's band, and a SERP that lost resolvable apps keeps yesterday's band;
 *        devTable = shipped developer table (data.devs = {dev: [n, maxInstalls]}); flags = precomputed detectFlags()
 * @returns {object|null} null = PENDING (not analysed yet)
 */
export function classifyToday(record, appsMap, ctx, now = Date.now(), opts = {}) {
  const r = record || {};
  const P = opts.P || PARAMS;
  const market = marketOf(ctx, opts);
  if (r.st === 'no-demand') {
    const d = decide(null, { st: 'no-demand', P });
    return finish(r, null, d, [], market, P);
  }
  if (!(r.st === 'ok' || r.st === 'partial') || !Array.isArray(r.top) || !r.top.length) return null;
  const apps = r.top.slice(0, 10).map((id, i) => ({ a: appsMap && appsMap[id], rank: i + 1 }))
    .filter((x) => x.a && !x.a.missing).map(({ a, rank }) => ({ ...a, rank }));
  if (!apps.length) return null;
  // developer table: shipped table (opts.devTable) > the dataset's apps (ctx.apps) > the apps map passed in
  const src = (ctx && ctx.apps) || appsMap;
  const table = devLookup(opts.devTable || buildDevTable(src));
  const devTableOk = !!opts.devTable || (!!src && mapSize(src) >= P.minTableApps);
  const f = serpFeatures(apps, { now, measuredAt: now, devTable: table, P });
  const base = opts.flags || detectFlags(r, ctx ? { ...ctx, now: ctx.now ?? now } : null);
  const flags = base;
  const prevEnter = opts.prev && opts.prev.axes && opts.prev.axes.enter ? opts.prev.axes.enter : null;
  // fewer resolvable apps than yesterday = probably a fetch gap: hold yesterday's enter band instead of re-banding
  const shrunk = !!(prevEnter && prevEnter.band && prevEnter.nApps > f.nApps);
  const d = decide(f, { k: r.k, st: r.st, flags, fewAppsGuard: true, devTableOk, prevBand: prevEnter ? prevEnter.band : null, holdBand: shrunk, P });
  if (shrunk) d.guards.push(`Bugün ${f.nApps} uygulama çözülebildi (dün ${prevEnter.nApps}): giriş bandı dünkü haliyle tutuldu.`);
  d.approx = !devTableOk;
  return finish(r, f, d, flags, market, P);
}

function finish(r, f, d, flags, market, P) {
  const meta = d.state === 'invalid' ? INVALID_TR[d.invalid] : CLASS_TR[d.verdict];
  // no rate for: invalid keywords, unknown market (no backtest), or a bare live analysis without a developer table
  const cal = d.state === 'invalid' || d.approx || !market || !CALIBRATION[market] ? null : CALIBRATION[market][d.verdict] || null;
  const wide = cal && cal.ci[1] - cal.ci[0] > 20 ? ` (örneklem küçük: %${Math.round(cal.ci[0])}–${Math.round(cal.ci[1])} aralığı)` : '';
  const sentence = cal
    ? `Geçmiş veride bu sınıftaki benzer kelimelerin yaklaşık %${cal.t50Shown}'${trLoc(cal.t50Shown)}${wide}, bir yıl içinde çıkan küçük bir geliştiricinin uygulaması ilk 10'a girip günde 50+ yükleme aldı.`
      + (cal.zombieIfEntered >= 10 ? ` Giren küçük uygulamaların yaklaşık %${Math.round(cal.zombieIfEntered)}'${trLoc(Math.round(cal.zombieIfEntered))} ise günde 10 yüklemenin altında kaldı.` : '')
      + ' (Deneyip ilk 10\'a giremeyenler görünmez; bu, tek bir uygulamanın başarı şansı değildir.)'
    : d.approx && d.state === 'ok' ? 'Yaklaşık karar: pazar geneli geliştirici tablosu olmadan hesaplandı; geçmiş oranlar gösterilmez.' : null;
  return {
    verdict: d.verdict,
    state: d.state,
    approx: !!d.approx,
    label: meta.title,
    meaning: meta.meaning,
    axes: f ? {
      enter: { score: f.enter, band: d.enterBand, label: d.enterBand ? ENTER_TR[d.enterBand] : null, open: +f.open.toFixed(3), small: +f.small.toFixed(3), nYoung: f.nYoung, nSmall: f.nSmall, nApps: f.nApps },
      payoff: { level: d.payoff, label: d.payoff ? PAYOFF_TR[d.payoff] : null, entry2: f.entry2, midpack: f.midpack, nEstablished: f.nEstablished }
    } : null,
    reasons: f ? reasonsOf(f, d, P) : d.guards,
    guards: d.guards,
    capped: d.capped,
    flags,
    calibration: cal,
    sentence,
    sortKey: f && d.state === 'ok' ? ORD[d.verdict] * 1000 + f.enter : -1
  };
}

/** Turkish locative suffix after a whole percentage ("%55'inde", "%40'ında", "%30'unda", "%20'sinde"). */
export function trLoc(n) {
  const last = n % 10, tens = Math.floor(n / 10) % 10;
  if (n === 0) return 'ında';
  if (last !== 0) return { 1: 'inde', 2: 'sinde', 3: 'ünde', 4: 'ünde', 5: 'inde', 6: 'sında', 7: 'sinde', 8: 'inde', 9: 'unda' }[last];
  return { 1: 'unda', 2: 'sinde', 3: 'unda', 4: 'ında', 5: 'sinde', 6: 'ında', 7: 'inde', 8: 'inde', 9: 'ında' }[tens] || 'ünde';
}

/** Adapter for /api/analyze's `result` ({k, status, demand, results[{id}], apps[], partial}). */
export function fromLiveResult(result) {
  const res = result || {};
  const appsMap = {};
  for (const a of res.apps || []) if (a && a.id) appsMap[a.id] = a;
  const st = res.status === 'no-demand' ? 'no-demand' : res.status === 'ok' ? (res.partial ? 'partial' : 'ok') : 'pending';
  const top = (res.top && res.top.length ? res.top : (res.results || []).map((x) => x.id || x.appId)).filter(Boolean).slice(0, 10);
  return { record: { k: res.k, st, demand: res.demand, pop: res.pop || null, difficulty: res.difficulty ?? null, comp: res.comp || null, top }, appsMap };
}

/* ------------------------------------------------------------------ UI helper */

/** Group keywords whose top-10s overlap ≥ 7/10 (same SERP cluster) so the UI lists one row per cluster. */
export function groupBySerp(records, minOverlap = 7) {
  const R = records.filter((r) => Array.isArray(r.top) && r.top.length);
  const parent = R.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const byApp = new Map();
  R.forEach((r, i) => { for (const id of r.top.slice(0, 10)) { if (!byApp.has(id)) byApp.set(id, []); byApp.get(id).push(i); } });
  R.forEach((r, i) => {
    const cnt = new Map();
    for (const id of r.top.slice(0, 10)) for (const j of byApp.get(id)) if (j > i) cnt.set(j, (cnt.get(j) || 0) + 1);
    for (const [j, c] of cnt) if (c >= minOverlap) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
  });
  const groups = new Map();
  R.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
  return [...groups.values()];
}
