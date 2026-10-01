/*
 * Yükleme ve gelir simülasyonu — "bu kelimeyi hedefleyen, reklam bütçesiz bir uygulama yayınlasam?"
 *
 * Dürüstlük kuralları (Ekim 2026 doğrulamasından):
 *   - Yükleme tarafı UYDURMA arama hacminden değil, KENDİ verimizden gelir: bu kelimenin ilk 10'una
 *     son 2 yılda girmiş bağımsız yeni uygulamaların günlük yükleme hızı (tüm kaynaklardan).
 *     Yetmezse aynı tür × "eski rakiplerin orta sırası" hücresindeki yeni uygulamalar (uygulama başına
 *     bir kez sayılır). İkisi de yoksa sayı üretilmez.
 *   - Talep, fırsat, erişim ya da pazar puanıyla ÖLÇEKLENMEZ: yeni girenlerin başarısıyla ilişkileri
 *     sıfır ya da ters çıktı.
 *   - Elde tutma ve gelir varsayımları yayımlanmış kaynaklara dayanır; her biri kaynağı ve doğrulama
 *     durumuyla gösterilir. Hep üç senaryo, hep aralık; tek bir vaat yok.
 *   - Hayatta kalma yanılgısı: yalnızca ilk 10'a girmeyi başaranları görüyoruz.
 */

const DAY = 86400000;
export const HORIZONS = [30, 90, 180, 365];
export const SCENARIOS = [
  { id: 'pess', label: 'Kötümser', q: 'p25' },
  { id: 'base', label: 'Temel', q: 'p50' },
  { id: 'opt', label: 'İyimser', q: 'p75' }
];

/* ---------------- varsayımlar ve kaynaklar ---------------- */

const SRC = {
  apptweakLag: { title: 'AppTweak — Measuring the effects of app updates on keyword visibility (2024)', url: 'https://www.apptweak.com/en/aso-blog/measuring-the-effects-of-app-updates-on-keyword-visibility', status: 'doğrulandı' },
  closedTest: { title: 'Play Console Yardım — yeni kişisel hesaplar için test şartı', url: 'https://support.google.com/googleplay/android-developer/answer/14151465', status: 'doğrulandı' },
  review: { title: 'Play Console Yardım — inceleme süreleri', url: 'https://support.google.com/googleplay/android-developer/answer/9859751', status: 'doğrulandı (7 güne kadar)' },
  appbrain: { title: 'AppBrain — Android app downloads (yeni uygulama kohortu, 2026-09-30)', url: 'https://www.appbrain.com/stats/android-app-downloads', status: 'doğrulandı' },
  gameanalytics: { title: 'GameAnalytics 2026 Mobile Benchmarks (2025 verisi, 16.000+ oyun)', url: 'https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks', status: 'doğrulandı' },
  adjustTr: { title: 'Adjust — Türkiye app trends 2025', url: 'https://investgame.net/wp-content/uploads/2025/11/turkey-app-trends-2025.pdf', status: 'doğrulandı (çapraz kontrol)' },
  adjustApps: { title: 'Adjust — Mobile app trends 2026', url: 'https://adindex.ru/publication/analitics/search/342586/img/mobile-app-trends-2026.pdf', status: 'doğrulandı; araç uygulamalarına uygulanması bizim varsayımımız' },
  onesignal: { title: 'OneSignal Mobile App Benchmarks 2024', url: 'https://onesignal.com/mobile-app-benchmarks-2024', status: 'düşük güven (push müşterileri)' },
  appsflyerUninstall: { title: 'AppsFlyer — App uninstall benchmarks 2024 (TR %58 / ABD %39, 30 günde)', url: 'https://www.appsflyer.com/resources/reports/app-uninstall-benchmarks-report/', status: 'doğrulandı; çarpana çevrilmesi türetme' },
  appodeal: { title: 'Appodeal casual benchmarks 2025 + Tenjin eCPM (ABD Android)', url: 'https://files.gameindustrylibrary.com/documents/mobile-casual-benchmarks-report-2025.pdf', status: 'kaynak kontrolünde düzeltildi (orta değer düşürüldü)' },
  topon: { title: 'TopOn Global Mobile Games Monetization Report 2025 H1 (bölgesel vekil)', url: 'https://mores.toponad.com/reports/TopOn%20Global%20Mobile%20Games%20Monetization%20Report%20_%202025%20H1.pdf', status: 'düşük güven (Türkiye\'ye özel veri yok, vekil)' },
  revenuecat: { title: 'RevenueCat — State of Subscription Apps 2026', url: 'https://www.revenuecat.com/state-of-subscription-apps', status: 'doğrulandı' },
  playFee: { title: 'Play Console Yardım — hizmet ücretleri (%15 dilim, ilk 1M $)', url: 'https://support.google.com/googleplay/android-developer/answer/112622', status: 'doğrulandı (%15 dilimine kayıt gerekir)' },
  playVat: { title: 'Play Console Yardım — Google\'ın vergi topladığı ülkeler (Türkiye)', url: 'https://support.google.com/googleplay/android-developer/answer/138000', status: 'doğrulandı; KDV oranı ikincil kaynaktan' },
  admobPay: { title: 'AdMob Yardım — ödeme eşiği (100 $)', url: 'https://support.google.com/admob/answer/6168758', status: 'doğrulandı' },
  ours: { title: 'Bu radarın verisi: kelimenin ilk 10\'una son 2 yılda girmiş bağımsız uygulamalar', url: null, status: 'kendi verimiz; hayatta kalanlar' }
};

/** R(t) = (a/100)·t^-b, t ≥ 1 gün; R(0) = 1. [kötümser, temel, iyimser] */
const RETENTION = {
  game: {
    us: [[11.9, 0.95], [24.4, 0.87], [31.4, 0.85]],
    tr: [[11.9, 0.95], [22.7, 0.97], [31.4, 0.85]]
  },
  app: {
    us: [[13.2, 0.52], [12.9, 0.42], [29.2, 0.35]],
    tr: [[13.2 * 0.69, 0.52], [12.9 * 0.69, 0.42], [29.2 * 0.69, 0.35]]
  }
};
/** Reklam geliri, aktif kullanıcı başına günlük (ARPDAU, yayıncı net, USD). */
const ARPDAU = {
  game: { us: [0.003, 0.008, 0.017], tr: [0.0005, 0.001, 0.002] },
  app: { us: [0.0015, 0.004, 0.0085], tr: [0.00025, 0.0005, 0.001] }
};
/** Satın alma/abonelik geliri, yükleme başına brüt (USD); oyunlarda uygulama içi satın alma, uygulamalarda abonelik. */
const PURCHASE_RPI = {
  game: { us: [0, 0.034, 0.205], tr: [0, 0.01, 0.06] },
  app: { us: [0, 0.16, 0.26], tr: [0, 0.04, 0.10] }
};
/** Geliştiriciye kalan pay (satın alma): %15 Play ücreti; Türkiye'de fiyata dahil %20 KDV. Reklama uygulanmaz. */
const NET = { us: 0.85, tr: 0.85 / 1.2 };
/** Satın almanın olgunlaşma süresi (gün): yalnızca bu kadar yaşlı yüklemeler sayılır. */
const PURCHASE_MATURITY = { game: 35, app: 60 };
/** Kelime sıralamasından yükleme gelmeye başlaması (gün) ve tam hıza ulaşma rampası. */
const LAG = [30, 14, 7];
const RAMP = 21;
const PAYOUT_USD = 100;

export const ASSUMPTIONS = [
  { name: 'Yükleme hızı', value: 'Bu kelimenin ilk 10\'una son 2 yılda girmiş bağımsız uygulamaların günlük ortalaması: çeyrek, medyan, üst çeyrek', source: SRC.ours },
  { name: 'Sıralamaya girme gecikmesi', value: `${LAG[0]} / ${LAG[1]} / ${LAG[2]} gün (kötümser / temel / iyimser), ardından ${RAMP} günlük doğrusal rampa`, source: SRC.apptweakLag },
  { name: 'Oyun elde tutma (ABD)', value: 'R(t)=a·t^-b; a=11,9 / 24,4 / 31,4 (≈1. gün %), b=0,95 / 0,87 / 0,85', source: SRC.gameanalytics },
  { name: 'Oyun elde tutma (Türkiye)', value: 'temel eğri Orta Doğu medyanı: a=22,7, b=0,97', source: SRC.adjustTr },
  { name: 'Uygulama elde tutma', value: 'a=13,2 / 12,9 / 29,2; b=0,52 / 0,42 / 0,35', source: SRC.adjustApps },
  { name: 'Uygulama elde tutma (Türkiye çarpanı)', value: '×0,69 (30 günde silme oranı TR %58, ABD %39)', source: SRC.appsflyerUninstall },
  { name: 'Reklam geliri — oyun, ABD', value: '0,003 / 0,008 / 0,017 $ aktif kullanıcı başına günlük', source: SRC.appodeal },
  { name: 'Reklam geliri — oyun, Türkiye', value: '0,0005 / 0,001 / 0,002 $ aktif kullanıcı başına günlük', source: SRC.topon },
  { name: 'Reklam geliri — uygulama', value: 'oyunun yarısı (araç uygulamalarında tam ekran reklam daha az)', source: { title: 'Kaynaksız varsayım', url: null, status: 'kaynaksız — dikkatle kullan' } },
  { name: 'Uygulama içi satın alma — oyun', value: 'ABD 0 / 0,034 / 0,205 $; Türkiye 0 / 0,01 / 0,06 $ yükleme başına (35 gün)', source: SRC.revenuecat },
  { name: 'Abonelik — uygulama', value: 'ABD 0 / 0,16 / 0,26 $; Türkiye 0 / 0,04 / 0,10 $ yükleme başına (60 gün)', source: SRC.revenuecat },
  { name: 'Play hizmet ücreti', value: '%15 (satın alma ve abonelikte; reklama uygulanmaz)', source: SRC.playFee },
  { name: 'Türkiye KDV', value: '%20, fiyata dahil, Google öder → net = fiyat / 1,2 × 0,85', source: SRC.playVat },
  { name: 'AdMob ödeme eşiği', value: '100 $ bakiye; ertesi ayın ~21\'i', source: SRC.admobPay }
];

/* ---------------- yeni uygulama kanıtı ---------------- */

const quantile = (arr, p) => {
  const s = arr.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const ageDays = (a, now) => { const t = a && a.released ? Date.parse(a.released) : NaN; return Number.isFinite(t) ? (now - t) / DAY : null; };
export const velocity = (a, now) => { const g = ageDays(a, now); return g === null ? null : (a.real || 0) / Math.max(30, g); };

/** Geliştirici büyüklüğü: en büyük uygulaması ve uygulama sayısı (bağımsızlık testi için). */
export function devStats(apps) {
  const max = new Map();
  const count = new Map();
  for (const a of Object.values(apps || {})) {
    if (!a || !a.dev) continue;
    max.set(a.dev, Math.max(max.get(a.dev) || 0, a.real || 0));
    count.set(a.dev, (count.get(a.dev) || 0) + 1);
  }
  return { max, count };
}
/** Bağımsız: geliştiricinin en büyük uygulaması 10M altında ve 5'ten az uygulaması var. */
export function isIndie(a, ds) {
  if (!ds) return true;
  return (ds.max.get(a.dev) || 0) < 10_000_000 && (ds.count.get(a.dev) || 0) <= 5;
}
export function marketKey(lang) { return lang === 'tr' ? 'tr' : 'us'; }
export function appType(apps) { return (apps || []).filter((a) => /^GAME/.test(a.genre || '')).length >= 5 ? 'game' : 'app'; }
export function pondBucket(mp) { return mp < 5_000 ? '<5K' : mp < 50_000 ? '5K-50K' : mp < 500_000 ? '50K-500K' : '500K+'; }

/** Eski rakiplerin (son 2 yılda çıkmamış) 3.–10. sıradaki medyanı. */
export function incumbentMidpack(apps, now) {
  const inc = (apps || []).slice(2).filter((a) => { const g = ageDays(a, now); return g === null || g > 730; });
  return inc.length >= 3 ? quantile(inc.map((a) => a.real || 0), 0.5) : null;
}

/**
 * Bir kelimenin ilk 10'undaki karşılaştırılabilir yeni uygulamalar.
 * @param {Array} apps sıralı ilk 10 uygulama
 */
export function newcomerEvidence(apps, ds, now) {
  const list = [];
  (apps || []).forEach((a, i) => {
    const g = ageDays(a, now);
    if (g === null || g < 30 || g > 730 || !isIndie(a, ds)) return;
    list.push({ id: a.id, title: a.title, dev: a.dev, rank: i + 1, ageDays: Math.round(g), real: a.real || 0, v: velocity(a, now) });
  });
  const type = appType(apps);
  const mp = incumbentMidpack(apps, now);
  return {
    type, list, incMidpack: mp, bucket: mp === null ? null : pondBucket(mp),
    own: list.length >= 3 ? { n: list.length, p: [0.25, 0.5, 0.75].map((q) => quantile(list.map((x) => x.v), q)) } : null
  };
}

/**
 * Hücre kohortları: tür × eski rakip orta sırası. Her yeni uygulama hücre başına bir kez sayılır.
 * Tarayıcı her taramada hesaplayıp veri setine yazar; arayüz yalnızca okur.
 */
export function buildCohorts(data, now = Date.now()) {
  const apps = (data && data.apps) || {};
  const ds = devStats(apps);
  const cells = {};
  for (const r of (data && data.keywords) || []) {
    if (!(r.st === 'ok' || r.st === 'partial') || !Array.isArray(r.top)) continue;
    const top = r.top.map((id) => apps[id]).filter(Boolean);
    const ev = newcomerEvidence(top, ds, now);
    if (!ev.bucket) continue;
    const key = `${ev.type}|${ev.bucket}`;
    const m = (cells[key] ||= new Map());
    for (const x of ev.list) if (!m.has(x.id)) m.set(x.id, x.v);
  }
  const out = {};
  for (const [key, m] of Object.entries(cells)) {
    const v = [...m.values()];
    out[key] = { n: v.length, p: [0.25, 0.5, 0.75].map((q) => Math.round(quantile(v, q) * 10) / 10) };
  }
  return { at: new Date(now).toISOString().slice(0, 10), minN: 20, cells: out };
}

/* ---------------- simülasyon ---------------- */

/** Günlük yükleme eğrisi: gecikme, doğrusal rampa, sonra sabit hız. */
export function dailyInstalls(v, lag, H) {
  const out = new Float64Array(H);
  for (let d = 0; d < H; d++) out[d] = d < lag ? 0 : d < lag + RAMP ? (v * (d - lag + 1)) / RAMP : v;
  return out;
}

/**
 * @param {number} v günlük yükleme hızı (tam hız)
 * @param {number} sc senaryo indeksi 0|1|2
 * @param {'game'|'app'} type
 * @param {'us'|'tr'} mk
 * @param {{ads?:boolean, purchases?:boolean}} money
 * @returns {{byHorizon:object, payoutDay:number|null}}
 */
export function simulateScenario(v, sc, type, mk, money = { ads: true, purchases: false }) {
  const H = HORIZONS[HORIZONS.length - 1];
  const daily = dailyInstalls(v, LAG[sc], H);
  const [a, b] = RETENTION[type][mk][sc];
  const R = new Float64Array(H + 1);
  R[0] = 1;
  for (let t = 1; t <= H; t++) R[t] = (a / 100) * Math.pow(t, -b);
  // gün gün aktif kullanıcı (DAU) = Σ geçmiş yüklemeler × elde tutma
  const dau = new Float64Array(H);
  for (let d = 0; d < H; d++) { const i = daily[d]; if (!i) continue; for (let t = 0; d + t < H; t++) dau[d + t] += i * R[t]; }
  const arpdau = money.ads ? ARPDAU[type][mk][sc] : 0;
  const rpi = money.purchases ? PURCHASE_RPI[type][mk][sc] * NET[mk] : 0;
  const mature = PURCHASE_MATURITY[type];
  const byHorizon = {};
  let installs = 0;
  let userDays = 0;
  let adsCum = 0;
  let payoutDay = null;
  const cumInstalls = new Float64Array(H);
  for (let d = 0; d < H; d++) {
    installs += daily[d];
    cumInstalls[d] = installs;
    userDays += dau[d];
    adsCum += dau[d] * arpdau;
    if (payoutDay === null && money.ads && adsCum >= PAYOUT_USD) payoutDay = d + 1;
    const h = d + 1;
    if (HORIZONS.includes(h)) {
      const matured = h - mature > 0 ? cumInstalls[h - mature - 1] : 0;
      const purchases = matured * rpi;
      byHorizon[h] = { installs, dau: dau[d], userDays, ads: adsCum, purchases, total: adsCum + purchases };
    }
  }
  return { byHorizon, payoutDay };
}

/** İki anlamlı basamağa yuvarlar (sahte kesinlik yok). */
export function sig2(x) {
  if (!Number.isFinite(x) || x === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(x / p) * p;
}

/** Simülasyon yapılmayacak kelimeler: yapay/marka/tek yayıncı. */
const NO_SIM_FLAGS = new Set(['dotless', 'pastYear', 'junk', 'rarePrefix', 'singleDev', 'navDev', 'brandTr', 'likeX', 'ip']);

/**
 * Bir kelime için simülasyon.
 * @param {object} record kelime kaydı (top dahil)
 * @param {{apps:object, lang:string, cohorts?:object, ds?:object, now?:number, flags?:Array, money?:object}} opts
 */
export function simulateKeyword(record, opts) {
  const now = opts.now ?? Date.now();
  const mk = marketKey(opts.lang);
  const money = opts.money || { ads: true, purchases: false };
  if (!record || !(record.st === 'ok' || record.st === 'partial')) return { gate: 'Bu kelime henüz analiz edilmedi.' };
  const block = (opts.flags || []).find((f) => NO_SIM_FLAGS.has(f.id) && (f.level === 'exclude' || f.level === 'cap'));
  if (block) return { gate: `Simülasyon yok: ${block.label.toLowerCase()} — ${block.reason}` };
  const apps = (record.top || []).map((id) => (opts.apps || {})[id]).filter(Boolean);
  if (!apps.length) return { gate: 'İlk 10 uygulama verisi yok.' };
  const ds = opts.ds || devStats(opts.apps);
  const ev = newcomerEvidence(apps, ds, now);
  let level = 'none';
  let p = null;
  let n = 0;
  if (ev.own) { level = 'own'; p = ev.own.p; n = ev.own.n; } else if (ev.bucket && opts.cohorts && opts.cohorts.cells) {
    const cell = opts.cohorts.cells[`${ev.type}|${ev.bucket}`];
    if (cell && cell.n >= (opts.cohorts.minN || 20)) { level = 'cohort'; p = cell.p; n = cell.n; }
  }
  const c = record.comp || {};
  const entryNote = { newcomers: c.newcomers ?? null, dated: c.dated ?? null };
  const wall = Number.isFinite(c.entry) && c.entry >= 1_000_000;
  const out = { level, n, p, type: ev.type, bucket: ev.bucket, incMidpack: ev.incMidpack, newcomers: ev.list, entryNote, wall, market: mk, money };
  if (!p) return { ...out, gate: null, none: 'Karşılaştırılabilir yeni uygulama verisi yok.' };
  out.scenarios = SCENARIOS.map((s, i) => {
    const v = Math.max(0, p[i]);
    const r = simulateScenario(v, i, ev.type, mk, money);
    return { ...s, v, lag: LAG[i], ...r };
  });
  return out;
}

export const OUTSIDE_VIEW = {
  text: 'Google Play\'deki tüm yeni uygulamalarda yaklaşık 5 ay sonra: %66–72\'si en fazla 500 indirmede, yalnızca %13\'ü 5.000\'i, %4\'ü 50.000\'i geçiyor (reklamla büyüyenler dahil).',
  source: SRC.appbrain
};
export const CALENDAR = {
  text: 'Yeni kişisel geliştirici hesabıyla üretime çıkmadan önce: en az 12 test kullanıcısıyla 14 günlük kapalı test ve 7 güne kadar inceleme. Tablodaki gün 0 = üretimde yayın günü.',
  sources: [SRC.closedTest, SRC.review]
};
