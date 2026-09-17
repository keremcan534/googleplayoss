/*
 * Karar katmanı — mevcut skorların ÜZERİNDE çalışan sunum/öneri mantığı.
 * Fırsat/talep/zorluk formüllerini DEĞİŞTİRMEZ; sadece yorumlar.
 * Saf fonksiyonlar: tarayıcıda (public/js) ve Node testlerinde aynı dosya kullanılır.
 *
 * Eşikler ve kurallar tek yerde: THRESHOLDS, GUARDS, LEVELS.
 */

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const VERDICT_ORDER = { GOLD: 0, BUILD: 1, WATCH: 2, WEAK: 3, SKIP: 4, PENDING: 5 };

/** Fırsat puanı alt sınırları (üstten alta). */
export const THRESHOLDS = { GOLD: 70, BUILD: 60, WATCH: 45, WEAK: 30 };

/** Koruma kuralları (guardrail). */
export const GUARDS = {
  veryLowDemand: 25,      // talep bunun altındaysa en fazla WATCH
  lowDemand: 45,          // talep bunun altındaysa en fazla BUILD (asla GOLD)
  extremeDifficulty: 80,  // rekabet bunun üstündeyse en fazla WATCH…
  demandOverride: 85,     // …talep bunun üstündeyse en fazla BUILD
  minCompetitors: 5,      // rakip verisi bundan azsa en fazla WATCH
  risingDelta: 5,         // trend: fırsat puanı değişimi eşiği
  trendMinDays: 2,        // trend için gereken en az gün aralığı

  // --- "0 indirme" koruması: iki ayrı başarısızlık biçimi
  // 1) DUVAR — ilk 10'un en zayıfı bile büyükse yeni uygulama sıralamaya hiç giremez.
  wallHard: 1_000_000,    // en zayıf rakip 1M+ → en fazla WEAK
  wallSoft: 100_000,      // en zayıf rakip 100K+ → en fazla WATCH
  easyEntry: 5_000,       // en zayıf rakip 5K altı → girmek kolay (olumlu sinyal)
  // 2) ÖLÜ GÖLET — girmek kolay ama orta sıradaki rakipler bile neredeyse boş.
  deadPondHard: 1_000,    // orta sıra medyanı 1K altı → en fazla WEAK
  deadPondSoft: 5_000,    // orta sıra medyanı 5K altı → en fazla WATCH
  healthyPond: 100_000,   // orta sıra medyanı 100K+ → olumlu sinyal
  leaderDominance: 0.7,   // lider ilk 10 toplamının %70'inden fazlasını alıyorsa uyarı
  frozenMarketMin: 8,     // bu kadar tarihli uygulamada hiç yeni giren yoksa pazar donmuş
  goldMinReach: 50        // GOLD için gereken en az erişim puanı
};

export const VERDICT_META = {
  GOLD: { label: 'GOLD', title: 'Olağanüstü fırsat', hint: 'Bunu yap', icon: '★', tone: 'gold' },
  BUILD: { label: 'BUILD', title: 'İyi fırsat', hint: 'Yapmaya değer', icon: '●', tone: 'build' },
  WATCH: { label: 'WATCH', title: 'İzle', hint: 'Takipte tut', icon: '●', tone: 'watch' },
  WEAK: { label: 'WEAK', title: 'Zayıf', hint: 'Muhtemelen değmez', icon: '●', tone: 'weak' },
  SKIP: { label: 'SKIP', title: 'Geç', hint: 'Vakit harcama', icon: '●', tone: 'skip' },
  PENDING: { label: 'BEKLİYOR', title: 'Henüz analiz edilmedi', hint: 'Sırada', icon: '○', tone: 'pending' }
};

/** Metrik seviye tanımları: [üst sınır, anahtar, etiket] */
export const LEVELS = {
  demand: [[24, 'vlow', 'ÇOK DÜŞÜK'], [44, 'low', 'DÜŞÜK'], [64, 'mid', 'ORTA'], [79, 'high', 'YÜKSEK'], [100, 'vhigh', 'ÇOK YÜKSEK']],
  difficulty: [[24, 'vlow', 'ÇOK DÜŞÜK'], [44, 'low', 'DÜŞÜK'], [64, 'mid', 'ORTA'], [79, 'high', 'YÜKSEK'], [100, 'extreme', 'AŞIRI']],
  opportunity: [[29, 'poor', 'KÖTÜ'], [44, 'weak', 'ZAYIF'], [59, 'interesting', 'İLGİNÇ'], [69, 'good', 'İYİ'], [84, 'excellent', 'MÜKEMMEL'], [100, 'exceptional', 'OLAĞANÜSTÜ']],
  market: [[24, 'vlow', 'ÇOK KÜÇÜK'], [44, 'low', 'KÜÇÜK'], [64, 'mid', 'ORTA'], [79, 'high', 'BÜYÜK'], [100, 'vhigh', 'ÇOK BÜYÜK']]
};

function level(kind, value) {
  if (!Number.isFinite(value)) return { key: 'na', label: '—', index: -1 };
  const table = LEVELS[kind];
  const v = Math.max(0, Math.min(100, value));
  for (let i = 0; i < table.length; i++) {
    if (v <= table[i][0]) return { key: table[i][1], label: table[i][2], index: i };
  }
  const last = table[table.length - 1];
  return { key: last[1], label: last[2], index: table.length - 1 };
}

export const demandLevel = (v) => level('demand', v);
export const difficultyLevel = (v) => level('difficulty', v);
export const opportunityLevel = (v) => level('opportunity', v);
export const marketLevel = (v) => level('market', v);

/** Fırsat puanından ham karar (guardrail'siz). */
export function verdictFromScore(opportunity) {
  if (!Number.isFinite(opportunity)) return 'PENDING';
  if (opportunity >= THRESHOLDS.GOLD) return 'GOLD';
  if (opportunity >= THRESHOLDS.BUILD) return 'BUILD';
  if (opportunity >= THRESHOLDS.WATCH) return 'WATCH';
  if (opportunity >= THRESHOLDS.WEAK) return 'WEAK';
  return 'SKIP';
}

/** Kararı en fazla `cap` seviyesine indirir (GOLD > BUILD > WATCH > WEAK > SKIP). */
export function capVerdict(verdict, cap) {
  return VERDICT_ORDER[verdict] < VERDICT_ORDER[cap] ? cap : verdict;
}

const DAY = 86400000;

/**
 * Trend: fırsat puanının geçmişe göre değişimi. Geçmiş yetersizse 'new' (uydurma yok).
 * hist: [[tarih, talep, zorluk, fırsat], ...] (tarih sırasıyla)
 */
export function getTrend(record) {
  const hist = (record && Array.isArray(record.hist) ? record.hist : []).filter((h) => Array.isArray(h) && Number.isFinite(h[3]));
  const none = { dir: 'new', delta: null, label: 'YENİ', arrow: '•', days: 0 };
  if (hist.length < 2) return none;
  const last = hist[hist.length - 1];
  const lastT = new Date(last[0]).getTime();
  if (!Number.isFinite(lastT)) return none;
  // 7+ gün önceki en yakın kayıt; yoksa en eski kayıt (en az trendMinDays gün önceyse)
  let base = null;
  for (let i = hist.length - 2; i >= 0; i--) {
    const t = new Date(hist[i][0]).getTime();
    if (Number.isFinite(t) && lastT - t >= 7 * DAY) { base = hist[i]; break; }
  }
  if (!base) {
    const first = hist[0];
    const t = new Date(first[0]).getTime();
    if (!Number.isFinite(t) || lastT - t < GUARDS.trendMinDays * DAY) return none;
    base = first;
  }
  const delta = last[3] - base[3];
  const days = Math.round((lastT - new Date(base[0]).getTime()) / DAY);
  if (delta >= GUARDS.risingDelta) return { dir: 'rising', delta, label: 'YÜKSELİYOR', arrow: '↑', days };
  if (delta <= -GUARDS.risingDelta) return { dir: 'falling', delta, label: 'DÜŞÜYOR', arrow: '↓', days };
  return { dir: 'stable', delta, label: 'SABİT', arrow: '→', days };
}

export function isNewRecord(record, now = Date.now(), days = 7) {
  if (!record || !record.first) return false;
  const t = new Date(record.first).getTime();
  return Number.isFinite(t) && now - t <= days * DAY;
}

export function fmtInstalls(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} milyar`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} milyon`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} bin`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} bin`;
  return String(n);
}

/**
 * Erişim puanı (0-100): "sıralamaya girersem gerçekten indirme gelir mi?"
 * Fırsat puanının YERİNE geçmez, yanında durur. Üç gerçek ölçüden oluşur:
 *   girilebilirlik — ilk 10'un en zayıf uygulamasının yüklemesi (düşükse girmek kolay)
 *   gölet büyüklüğü — 3. sıradan sonuncuya kadarki medyan yükleme (girince komşuların durumu)
 *   yeniye açıklık — son 2 yılda çıkıp ilk 10'a girebilmiş uygulama oranı
 * Hepsi logaritmik ölçekte; uydurma trafik tahmini yapılmaz.
 */
export function reachScore(reach) {
  if (!reach || !reach.has) return null;
  const log = (x) => Math.log10(Math.max(0, x || 0) + 1);
  // entry2 (en küçükten ikinci) 100 yükleme → 1.0 ; 1M → 0. Tek aykırı uygulamaya dayanmaz.
  const basis = Number.isFinite(reach.entry2) ? reach.entry2 : reach.entry;
  const enterability = clamp((6 - log(basis)) / 4, 0, 1);
  // midpack 1K → 0 ; 500K → 1
  const pondSize = clamp((log(reach.midpack) - 3) / 2.7, 0, 1);
  const openness = reach.dated ? clamp(reach.newcomers / Math.max(3, reach.dated * 0.4), 0, 1) : 0.5;
  return Math.round(100 * (0.40 * enterability + 0.40 * pondSize + 0.20 * openness));
}

export const REACH_LEVELS = [[24, 'vlow', 'ÇOK ZAYIF'], [44, 'low', 'ZAYIF'], [64, 'mid', 'ORTA'], [79, 'high', 'İYİ'], [100, 'vhigh', 'ÇOK İYİ']];
export function reachLevel(v) {
  if (!Number.isFinite(v)) return { key: 'na', label: '—', index: -1 };
  for (let i = 0; i < REACH_LEVELS.length; i++) if (v <= REACH_LEVELS[i][0]) return { key: REACH_LEVELS[i][1], label: REACH_LEVELS[i][2], index: i };
  return { key: 'vhigh', label: 'ÇOK İYİ', index: 4 };
}

/**
 * Erişilebilirlik teşhisi: sıralamaya girebilir miyim, girince ne alırım?
 * Tamamen gerçek yükleme verisinden; tahmin/uydurma yok.
 *   wall     → ilk 10'un en zayıfı bile büyük, yeni uygulama giremez (0 indirme riski)
 *   deadPond → girmek kolay ama orta sıra neredeyse boş (girsen de trafik yok)
 */
export function reachability(record) {
  const c = (record && record.comp) || {};
  const n = c.n || 0;
  const entry = Number.isFinite(c.entry) ? c.entry : null;
  const midpack = Number.isFinite(c.midpack) ? c.midpack : null;
  const out = {
    n, entry, midpack,
    entry2: Number.isFinite(c.entry2) ? c.entry2 : null,
    tiny: Number.isFinite(c.tiny) ? c.tiny : null,
    leaderShare: Number.isFinite(c.leaderShare) ? c.leaderShare : null,
    newcomers: Number.isFinite(c.newcomers) ? c.newcomers : null,
    dated: c.dated ?? null,
    medianAgeYears: c.medianAgeYears ?? null,
    wall: 'unknown', pond: 'unknown', frozen: false, dominated: false, has: false
  };
  if (!n || entry === null || midpack === null) return out;
  out.has = true;
  out.wall = entry >= GUARDS.wallHard ? 'hard' : entry >= GUARDS.wallSoft ? 'soft' : entry <= GUARDS.easyEntry ? 'open' : 'normal';
  out.pond = midpack < GUARDS.deadPondHard ? 'dead' : midpack < GUARDS.deadPondSoft ? 'thin' : midpack >= GUARDS.healthyPond ? 'healthy' : 'normal';
  out.frozen = out.newcomers === 0 && (out.dated || 0) >= GUARDS.frozenMarketMin;
  out.dominated = out.leaderShare !== null && out.leaderShare >= GUARDS.leaderDominance;
  out.score = reachScore(out);
  out.level = reachLevel(out.score);
  return out;
}

/** Olumlu / olumsuz sinyaller (ağırlığa göre sıralı). */
export function getSignals(record, trend) {
  const r = record || {};
  const c = r.comp || {};
  const n = c.n || 0;
  const reach = reachability(r);
  const demand = r.demand ?? 0;
  const difficulty = r.difficulty;
  const pos = [];
  const neg = [];
  const add = (arr, weight, text) => arr.push({ weight, text });

  // talep
  if (demand >= 80) add(pos, 5, `Çok yüksek otomatik tamamlama talebi (${demand})`);
  else if (demand >= 65) add(pos, 4, `Yüksek otomatik tamamlama talebi (${demand})`);
  else if (demand > 0 && demand < 25) add(neg, 5, `Talep çok düşük (${demand})`);
  else if (demand < 45) add(neg, 4, `Talep düşük (${demand})`);
  if (r.pop && r.pop.mode === 'exact' && r.pop.minPrefix <= 3 && demand > 0) add(pos, 3, `Sadece ${r.pop.minPrefix} harf yazınca öneriliyor`);
  if (r.pop && r.pop.mode === 'ext') add(neg, 2, `Kelimenin kendisi önerilmiyor, sadece uzantısı ("${r.pop.via}")`);

  // rekabet
  if (Number.isFinite(difficulty)) {
    if (difficulty <= 24) add(pos, 5, `Rekabet çok düşük (${difficulty})`);
    else if (difficulty <= 44) add(pos, 4, `Rekabet düşük (${difficulty})`);
    else if (difficulty >= 80) add(neg, 5, `Rekabet aşırı (${difficulty})`);
    else if (difficulty >= 65) add(neg, 4, `Rekabet yüksek (${difficulty})`);
  }
  if (n) {
    if (c.weak >= 3) add(pos, 4, `İlk 10'da ${c.weak} zayıf uygulama (100K altı yükleme)`);
    else if (c.weak >= 1) add(pos, 2, `İlk 10'da ${c.weak} zayıf uygulama`);
    if (c.lowRated >= 2) add(pos, 3, `${c.lowRated} rakibin puanı 4.0'ın altında`);
    else if (Number.isFinite(c.avgScore) && c.avgScore < 4.2 && n >= 3) add(pos, 3, `Rakiplerin ortalama puanı sadece ${c.avgScore}`);
    if (c.stale >= 2) add(pos, 3, `${c.stale} rakip bir yıldır güncellenmemiş`);
    else if (c.stale === 1) add(pos, 1, `1 rakip bir yıldır güncellenmemiş`);
    if (c.big === 0 && n >= GUARDS.minCompetitors) add(pos, 2, `İlk 10'da dev uygulama (10M+) yok`);
    if (c.titleMatches <= 2 && n >= GUARDS.minCompetitors) add(pos, 2, `Başlığında kelimeyi kullanan rakip az (${c.titleMatches}/${n})`);
    if (c.big >= 3) add(neg, 4, `${c.big} dev uygulama (10M+) sonuçlara hakim`);
    else if (c.big >= 1) add(neg, 2, `${c.big} dev uygulama (10M+) ilk 10'da`);
    if (c.titleMatches >= 6) add(neg, 3, `Rakiplerin çoğu kelimeyi başlığında kullanıyor (${c.titleMatches}/${n})`);
    else if (c.titleMatches >= 4) add(neg, 2, `Kelime birçok rakip başlığında geçiyor (${c.titleMatches}/${n})`);
    if (Number.isFinite(c.avgScore) && c.avgScore >= 4.5) add(neg, 2, `Rakipler yüksek puanlı (ort. ${c.avgScore})`);
    if (c.stale === 0 && n >= GUARDS.minCompetitors && Number.isFinite(difficulty) && difficulty >= 45) add(neg, 1, 'Rakipler aktif olarak güncelleniyor');
    if (Number.isFinite(r.market) && r.market >= 65) add(pos, 1, `Pazar puanı yüksek (${r.market}): ilk 10 toplam ${fmtInstalls(c.sumInstalls)} yükleme`);
    if (Number.isFinite(r.market) && r.market < 25 && demand >= 45) add(neg, 1, `Pazar puanı düşük (${r.market}): ilk 10 toplam ${fmtInstalls(c.sumInstalls)} yükleme`);
  }
  if (r.st === 'partial' || (n > 0 && n < GUARDS.minCompetitors)) add(neg, 3, `Rakip verisi eksik (${n}/10), bir sonraki taramada tamamlanır`);

  // erişilebilirlik: girebilir miyim, girince ne alırım
  if (reach.has) {
    if (reach.wall === 'hard') add(neg, 9, `Giriş duvarı: ilk 10'un en zayıf uygulaması bile ${fmtInstalls(reach.entry)} yükleme — yeni bir uygulama bu sıralamaya giremez`);
    else if (reach.wall === 'soft') add(neg, 7, `Giriş zor: ilk 10'un en zayıfı ${fmtInstalls(reach.entry)} yükleme`);
    else if (reach.wall === 'open') add(pos, 6, `Sıralamaya girmek kolay: ilk 10'un son sırasındaki uygulama sadece ${fmtInstalls(reach.entry)} yükleme`);

    if (reach.pond === 'dead') add(neg, 8, `Ölü gölet: orta sıradaki rakip sadece ${fmtInstalls(reach.midpack)} yükleme — sıralasan bile indirme gelmez`);
    else if (reach.pond === 'thin') add(neg, 6, `Pazar çok ince: orta sıradaki rakip ${fmtInstalls(reach.midpack)} yükleme`);
    else if (reach.pond === 'healthy') add(pos, 5, `Orta sıradaki rakip ${fmtInstalls(reach.midpack)} yükleme — sıralamak gerçek trafik demek`);

    if (reach.newcomers >= 3) add(pos, 5, `Pazar yeniye açık: son 2 yılda çıkan ${reach.newcomers} uygulama ilk 10'a girmiş`);
    else if (reach.frozen) add(neg, 5, `Pazar donmuş: son 2 yılda çıkan hiçbir uygulama ilk 10'a girememiş (medyan yaş ${reach.medianAgeYears} yıl)`);
    if (reach.dominated) add(neg, 4, `Tek uygulamanın pazarı: lider ilk 10 yüklemelerinin %${Math.round(reach.leaderShare * 100)}'ini almış`);
  }

  // para kazanma ve ilgi (CR/CPA yerine Play'in açık verisinden çıkarılabilenler)
  if (n >= 5) {
    if (Number.isFinite(c.monetized)) {
      if (c.monetized >= 8) add(pos, 4, `Para kazanılan bir alan: ilk 10'un ${c.monetized}'inde uygulama içi satın alma, reklam ya da ücretli sürüm var`);
      else if (c.monetized <= 2) add(neg, 5, `Para kazanma zor görünüyor: ilk 10'un sadece ${c.monetized}'inde gelir modeli var`);
    }
    if (Number.isFinite(c.iap) && c.iap >= 7) add(pos, 2, `İlk 10'un ${c.iap}'inde uygulama içi satın alma var (abonelik/tek seferlik satış çalışıyor)`);
    if (Number.isFinite(c.engagement)) {
      if (c.engagement >= 8) add(pos, 3, `Kullanıcı ilgisi yüksek: 1000 yüklemeye ${c.engagement} değerlendirme düşüyor`);
      else if (c.engagement > 0 && c.engagement < 2) add(neg, 3, `Kullanıcı ilgisi düşük: 1000 yüklemeye sadece ${c.engagement} değerlendirme düşüyor`);
    }
  }

  // trend
  if (trend && trend.dir === 'rising') add(pos, 3, `Fırsat puanı yükseliyor (+${trend.delta}, ${trend.days} günde)`);
  if (trend && trend.dir === 'falling') add(neg, 3, `Fırsat puanı düşüyor (${trend.delta}, ${trend.days} günde)`);

  const byWeight = (a, b) => b.weight - a.weight;
  return { positives: pos.sort(byWeight).map((s) => s.text), negatives: neg.sort(byWeight).map((s) => s.text) };
}

/** Tek cümlelik, deterministik açıklama. */
export function buildReason(record, trend) {
  const r = record || {};
  const c = r.comp || {};
  const demand = r.demand ?? 0;
  const difficulty = r.difficulty;
  const opportunity = r.opportunity;
  if (r.st === 'no-demand' || demand <= 0) return 'Talep kanıtı yok: kelime otomatik tamamlamada görünmüyor.';
  if (!Number.isFinite(difficulty) || !Number.isFinite(opportunity)) return 'Rakip verisi henüz eksik, karar bir sonraki taramada netleşir.';

  const D = demand >= 65 ? 'high' : demand >= 45 ? 'mid' : 'low';
  const C = difficulty >= 80 ? 'extreme' : difficulty >= 65 ? 'high' : difficulty >= 45 ? 'mid' : 'low';

  // Karar için belirleyici olan şey erişilebilirlikse tek cümle onu söyler.
  const reach = reachability(r);
  if (reach.has) {
    if (reach.wall === 'hard') return `İlk 10'un en zayıf uygulaması bile ${fmtInstalls(reach.entry)} yükleme: yeni bir uygulama bu sıralamaya giremez.`;
    if (reach.pond === 'dead') return `Sıralamaya girmek kolay ama pazar boş: orta sıradaki rakip sadece ${fmtInstalls(reach.midpack)} yükleme.`;
    if (reach.wall === 'soft' && C !== 'low') return `Giriş zor: ilk 10'un en zayıfı ${fmtInstalls(reach.entry)} yükleme, ${D === 'high' ? 'talep yüksek olsa da' : 'talep de sınırlı'}.`;
    if (reach.pond === 'thin' && opportunity >= 45) return `Girmek kolay ama pazar ince: orta sıradaki rakip ${fmtInstalls(reach.midpack)} yükleme.`;
  }

  if (opportunity >= 85 && D === 'high') return 'Mükemmel talep/rekabet oranı.';

  const base = {
    'high:low': 'Yüksek talep, düşük rekabet',
    'high:mid': 'İyi talep, rekabet orta düzeyde',
    'high:high': 'Güçlü talep ama güçlü rakipler sonuçlara hakim',
    'high:extreme': 'Çok güçlü rakipler arama sonuçlarına hakim',
    'mid:low': 'Orta talep, zayıf rekabet',
    'mid:mid': 'Orta talep, orta rekabet',
    'mid:high': 'Orta talep, rekabet yüksek',
    'mid:extreme': 'Orta talebe karşılık aşırı rekabet',
    'low:low': 'Zayıf rekabete rağmen talep düşük',
    'low:mid': 'Talep düşük, rekabet orta',
    'low:high': 'Talep düşük ve rekabet yüksek',
    'low:extreme': 'Talep düşük ve rekabet aşırı'
  }[`${D}:${C}`];

  // tek bir ek yan cümle (öncelik sırasıyla)
  let extra = '';
  if (C === 'low' || C === 'mid') {
    if (reach.has && reach.wall === 'open' && reach.pond === 'healthy') extra = `girmek kolay ve orta sıra ${fmtInstalls(reach.midpack)} yükleme`;
    else if (reach.has && reach.newcomers >= 3) extra = `son 2 yılda ${reach.newcomers} yeni uygulama ilk 10'a girmiş`;
    else if (c.stale >= 3) extra = `${c.stale} rakip bir yıldır güncellenmiyor`;
    else if (c.lowRated >= 3) extra = 'rakiplerin puanları zayıf';
    else if (c.weak >= 3) extra = `ilk 10'da ${c.weak} zayıf uygulama var`;
    else if (trend && trend.dir === 'rising') extra = 'fırsat puanı da yükseliyor';
    else if (Number.isFinite(c.avgScore) && c.avgScore < 4.2 && (c.n || 0) >= 3) extra = `rakiplerin ortalama puanı ${c.avgScore}`;
  } else if (C === 'high' || C === 'extreme') {
    if (c.titleMatches >= 6) extra = 'başlık rekabeti de çok yoğun';
    else if (c.big >= 3) extra = `${c.big} dev uygulama yüklemeleri domine ediyor`;
    else if (c.stale >= 3) extra = `yine de ${c.stale} rakip bir yıldır güncellenmiyor`;
    else if (c.weak >= 3) extra = `yine de ilk 10'da ${c.weak} zayıf uygulama var`;
  }
  if (D === 'low' && (C === 'low' || C === 'mid') && trend && trend.dir === 'rising') extra = 'ama fırsat puanı yükseliyor';
  return extra ? `${base}, ${extra}.` : `${base}.`;
}

/**
 * Ana giriş noktası: bir kelime kaydından karar üretir.
 * Dönen nesne sunum içindir; skorlar değiştirilmez.
 */
export function getOpportunityVerdict(record, opts = {}) {
  const now = opts.now ?? Date.now();
  const r = record || {};
  const trend = getTrend(r);
  const isNew = isNewRecord(r, now);
  const base = { trend, isNew, positives: [], negatives: [], capped: [], scoreLevel: opportunityLevel(r.opportunity), reach: reachability(r) };

  const analyzed = r.st === 'ok' || r.st === 'partial' || r.st === 'no-demand';
  if (!analyzed) {
    return { ...base, verdict: 'PENDING', label: VERDICT_META.PENDING.title, reason: 'Analiz sırada bekliyor, karar bir sonraki taramada oluşur.' };
  }
  const demand = r.demand ?? 0;
  if (r.st === 'no-demand' || demand <= 0) {
    return { ...base, verdict: 'SKIP', label: VERDICT_META.SKIP.title, reason: buildReason(r, trend), negatives: ['Otomatik tamamlamada ne kendisi ne de uzantısı görünüyor'] };
  }
  const { positives, negatives } = getSignals(r, trend);
  if (!Number.isFinite(r.opportunity) || !Number.isFinite(r.difficulty)) {
    return { ...base, verdict: 'PENDING', label: 'Eksik veri', reason: buildReason(r, trend), positives, negatives };
  }

  let verdict = verdictFromScore(r.opportunity);
  const capped = [];
  const cap = (to, why) => {
    const next = capVerdict(verdict, to);
    if (next !== verdict) { verdict = next; capped.push(why); }
  };
  if (demand < GUARDS.veryLowDemand) cap('WATCH', 'Talep çok düşük olduğu için karar sınırlandı');
  else if (demand < GUARDS.lowDemand) cap('BUILD', 'Talep düşük olduğu için GOLD verilmedi');
  if (r.difficulty >= GUARDS.extremeDifficulty) cap(demand >= GUARDS.demandOverride ? 'BUILD' : 'WATCH', 'Rekabet aşırı olduğu için karar sınırlandı');
  const n = (r.comp && r.comp.n) || 0;
  if (r.st === 'partial' || n < GUARDS.minCompetitors) cap('WATCH', 'Rakip verisi eksik olduğu için karar sınırlandı');

  // "0 indirme" koruması
  const reach = reachability(r);
  if (reach.has) {
    if (reach.wall === 'hard') cap('WEAK', 'İlk 10 duvar: en zayıf rakip bile çok büyük');
    else if (reach.wall === 'soft') cap('WATCH', 'Sıralamaya girmek zor: en zayıf rakip 100 binin üstünde');
    if (reach.pond === 'dead') cap('WEAK', 'Ölü gölet: sıralasan bile indirme gelmez');
    else if (reach.pond === 'thin') cap('WATCH', 'Pazar ince: orta sıra 5 binin altında');
    if (Number.isFinite(reach.score) && reach.score < GUARDS.goldMinReach) {
      cap('BUILD', `Erişim puanı ${reach.score}: sıralasan bile getirisi sınırlı, GOLD verilmedi`);
    }
  }

  return { ...base, verdict, label: VERDICT_META[verdict].title, reason: buildReason(r, trend), positives, negatives, capped, reach };
}

/** Rakip özeti (ilk 10). */
export function competitorSummary(record) {
  const c = (record && record.comp) || {};
  const n = c.n || 0;
  const lvl = difficultyLevel(record ? record.difficulty : null);
  const strength = lvl.index <= 1 ? { key: 'low', label: 'DÜŞÜK' } : lvl.index === 2 ? { key: 'mid', label: 'ORTA' } : lvl.index === 3 ? { key: 'high', label: 'YÜKSEK' } : lvl.index === 4 ? { key: 'extreme', label: 'AŞIRI' } : { key: 'na', label: '—' };
  return {
    n, strength, weak: c.weak ?? 0, stale: c.stale ?? 0, lowRated: c.lowRated ?? 0,
    titleMatches: c.titleMatches ?? 0, big: c.big ?? 0, avgScore: c.avgScore ?? null,
    sumInstalls: c.sumInstalls ?? null, medianInstalls: c.medianInstalls ?? null,
    iap: c.iap ?? 0, ads: c.ads ?? 0, paid: c.paid ?? 0,
    monetized: Number.isFinite(c.monetized) ? c.monetized : null,
    engagement: Number.isFinite(c.engagement) ? c.engagement : null
  };
}

/** Varsayılan sıralama: karar sınıfı, sonra fırsat puanı, sonra ad. */
export function compareByVerdict(a, b) {
  const va = VERDICT_ORDER[a.decision ? a.decision.verdict : 'PENDING'] ?? 9;
  const vb = VERDICT_ORDER[b.decision ? b.decision.verdict : 'PENDING'] ?? 9;
  if (va !== vb) return va - vb;
  const oa = Number.isFinite(a.opportunity) ? a.opportunity : -1;
  const ob = Number.isFinite(b.opportunity) ? b.opportunity : -1;
  if (oa !== ob) return ob - oa;
  return String(a.k).localeCompare(String(b.k));
}

/**
 * Niş kararı: üyelerin (karar verilmiş kayıtlar) en iyi 5'inin ortalama fırsatı üzerinden,
 * aynı talep koruma kurallarıyla.
 */
export function getNicheVerdict(niche, members) {
  const usable = (members || []).filter((m) => m && Number.isFinite(m.opportunity) && m.demand > 0);
  const sorted = usable.slice().sort((a, b) => b.opportunity - a.opportunity);
  const top = sorted.slice(0, 5);
  const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  const topOpp = mean(top.map((m) => m.opportunity));
  const topDemand = mean(top.map((m) => m.demand));
  const topDiff = mean(top.map((m) => m.difficulty).filter(Number.isFinite));
  let verdict = verdictFromScore(topOpp);
  if (topOpp !== null) {
    if (topDemand < GUARDS.veryLowDemand) verdict = capVerdict(verdict, 'WATCH');
    else if (topDemand < GUARDS.lowDemand) verdict = capVerdict(verdict, 'BUILD');
  }
  const counts = { GOLD: 0, BUILD: 0, WATCH: 0, WEAK: 0, SKIP: 0, PENDING: 0 };
  for (const m of members || []) counts[(m.decision && m.decision.verdict) || 'PENDING']++;
  const useful = counts.GOLD + counts.BUILD + counts.WATCH;
  // trend: yeterli geçmişi olan üyelerin ortalama değişimi
  const deltas = usable.map((m) => m.decision && m.decision.trend).filter((t) => t && t.dir !== 'new').map((t) => t.delta);
  let trend = { dir: 'new', label: 'YENİ', arrow: '•', delta: null };
  if (deltas.length && deltas.length >= Math.ceil(usable.length / 2)) {
    const d = Math.round(mean(deltas));
    trend = d >= GUARDS.risingDelta ? { dir: 'rising', label: 'YÜKSELİYOR', arrow: '↑', delta: d } : d <= -GUARDS.risingDelta ? { dir: 'falling', label: 'DÜŞÜYOR', arrow: '↓', delta: d } : { dir: 'stable', label: 'SABİT', arrow: '→', delta: d };
  }
  const best = sorted[0] || null;
  // niş erişim puanı: en iyi 5 kelimenin erişim puanlarının ortalaması
  const reachScores = top.map((m) => (m.decision && m.decision.reach && Number.isFinite(m.decision.reach.score) ? m.decision.reach.score : null)).filter((x) => x !== null);
  const topReach = reachScores.length ? Math.round(mean(reachScores)) : null;
  const dl = demandLevel(topDemand);
  const cl = difficultyLevel(topDiff);
  const reason = topOpp === null
    ? 'Henüz puanlanmış kelime yok.'
    : `En iyi ${top.length} kelimenin ortalama fırsatı ${Math.round(topOpp)}, talep ${dl.label.toLowerCase()}, rekabet ${cl.label.toLowerCase()}.`;
  return {
    verdict, label: VERDICT_META[verdict].title, reason,
    topOpportunity: topOpp === null ? null : Math.round(topOpp),
    demand: { value: topDemand === null ? null : Math.round(topDemand), ...dl },
    competition: { value: topDiff === null ? null : Math.round(topDiff), ...cl },
    reach: { value: topReach, ...reachLevel(topReach) },
    trend, counts, useful, best, total: (members || []).length
  };
}
