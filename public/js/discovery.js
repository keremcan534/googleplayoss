/*
 * Keşif skoru — "Play bu uygulamayı aramanın dışında da gösterir mi?" (HİPOTEZ, geri testi yok)
 *
 * Neden var: radar önerilerinden Ekim 2026'da yayınlanan 12 uygulamada karar sınıfı erken trafiği ayırmadı
 * (10'u GOLD idi, biri trafik aldı) ve trafik alan uygulamanın gösterimlerinin neredeyse tamamı aramadan değil,
 * Play'in keşif yüzeylerinden (öneriler, "benzer uygulamalar", kategori listeleri) geldi. Yeni bir uygulamanın
 * ilk haftalarda arama geçmişi olmadığından "ilk 10'a girebilir miyim" sorusu erken dönemde karşılık vermiyor
 * olabilir. Bu modül o gözlemden türeyen hipotezleri beş sinyale çevirip ağırlıklı toplar:
 *
 *   skor = 100 · Σ w·s      öncül w = keşif .35 · rakip boşluğu .25 · görsel kanca .15 · giriş bandı .15 · yapılabilirlik .10
 *
 *   KEŞİF (H1, H4)  sıra ağırlıklı tür ağırlığı .50 (GENRE_TIERS) · yükleme / talep oranı .25 · benzer devler .25
 *                    (kelimenin ve tohumunun ilk 10'unda baskın türden 1M+ ve 10M+ uygulama sayısı: devlerin yanı öneri
 *                    satırıdır, ceza değil. Pazar geneli tür sayımı kullanılmadı: taranan uygulamalar tohum listesini
 *                    yansıtıyor, Play kataloğunu değil — TR'de Araçlar'da Basit eğlence'den çok 1M+ uygulama var.)
 *   BOŞLUK (H3)     reklam + uygulama içi satın alma baskısı .45 · ortalama puan .20 · yeni değerlendirmelerdeki
 *                    reklam / ödeme duvarı / içerik bitti şikâyetleri .35 (yalnızca yeterli değerlendirme örneği varsa)
 *   GÖRSEL (H2)     tür tabanı ± kelime sözlüğü (boyama, sırala, piksel… artı; zamanlayıcı, hesap, kelime… eksi);
 *                    elle (ya da bir dil modeliyle) girilmiş değer varsa o (data.discoveryModel.visual)
 *   GİRİŞ BANDI     girebilirlik / 100 (enterpayoff.js). Ağırlığı bilerek düşük.
 *   YAPILABİLİRLİK  politika / marka / yanlış pazar işaretleri ve ağır yapım kelimeleri (çevrimiçi, çok oyunculu…)
 *
 * Ağırlıklar ve alt eşikler ELLE seçildi; tek bir başarı gözlemine dayanıyorlar ve hiçbir sınıf oranı göstermezler.
 * En az 20 etiketli uygulama (her sınıftan en az 4) birikmeden değiştirilmez: src/calibrate-discovery.js.
 * Karar sınıfının (GOLD…SKIP) yerine geçmez; kararı ve onun geri test kalibrasyonunu değiştirmez.
 *
 * Saf ESM, Node API'si yok (tarayıcı ve Node ortak).
 */
import { PARAMS as EP } from './enterpayoff.js';
import { normalizeFor } from './lang.js';
import { CATEGORY_LABELS } from './pack/lexicon.js';

export const MODEL_VERSION = 'discovery-prior-v1';
export const SIGNALS = Object.freeze(['discovery', 'gap', 'visual', 'band', 'feasibility']);
/** Öncül ağırlıklar (Fabrika önerisi, 2026-10-20). Kalibrasyon config/discovery.json üzerinden değiştirir. */
export const PRIOR_WEIGHTS = Object.freeze({ discovery: 0.35, gap: 0.25, visual: 0.15, band: 0.15, feasibility: 0.10 });
export const SIGNAL_TR = Object.freeze({ discovery: 'Keşif potansiyeli', gap: 'Rakip boşluğu', visual: 'Görsel kanca', band: 'Giriş bandı', feasibility: 'Yapılabilirlik' });

export const PARAMS = Object.freeze({
  parts: Object.freeze({
    discovery: Object.freeze({ genre: 0.5, ratio: 0.25, density: 0.25 }),
    gap: Object.freeze({ pressure: 0.45, rating: 0.2, complaints: 0.35 })
  }),
  // log10(ilk 10 toplam yükleme / talep puanı). Ekim 2026 veri setinde p10 ≈ 5,7 · medyan ≈ 7,1 · p90 ≈ 8,1 (iki pazar)
  ratioLo: 5.5,
  ratioHi: 8.0,
  bigInstalls: 1_000_000,
  megaInstalls: 10_000_000,
  densityFull: 15,          // (1M+ sayısı + 10M+ sayısı), kelime + tohum ilk 10'u birlikte (en fazla 20 uygulama), bu değerde tam puan
  ratingTop: 4.7,           // ortalama puan bunun üstündeyse boşluk yok…
  ratingSpan: 0.8,          // …3,9 ve altında tam boşluk
  minRatings: 50,
  complaintFull: 0.30,      // yeni değerlendirmelerin %30'u şikâyetse tam puan (örnek: yoğun reklamlı sıralama oyunları %22-36)
  minReviewSample: 20,      // bundan az değerlendirmesi çekilmiş uygulama sayılmaz
  minReviewed: 2,           // ilk 5'te en az bu kadar uygulamanın örneği yoksa şikâyet bileşeni kullanılmaz
  reviewTopN: 5,
  visualTerm: 0.25,         // görsel / araç kelimesi başına ± (tek sefer)
  heavyBuild: 0.6,          // ağır yapım kelimesi yapılabilirliği bununla çarpar
  titleMash: 0.5            // tür kelimesi iki kez geçen öbek (başlık parçası) bununla çarpar
});

/* ------------------------------------------------------------------ tür öncülleri */

const tier = (w, ids) => ids.map((id) => [id, w]);
/**
 * Türün keşif ağırlığı (0-1). Öncül: büyük, görsel, gündelik oyun kategorileri yüksek; araç / verimlilik /
 * yaşam / eğitim yardımcıları düşük (Fabrika gözlemi: bu kategorilerdeki uygulamalar neredeyse hiç gösterim almadı).
 * Listede olmayan oyun türleri 0,6, diğer kategoriler 0,2.
 */
export const GENRE_TIERS = Object.freeze(Object.fromEntries([
  ...tier(1.0, ['GAME_CASUAL', 'GAME_PUZZLE', 'GAME_SIMULATION', 'GAME_ARCADE']),
  ...tier(0.8, ['ART_AND_DESIGN', 'GAME_RACING', 'GAME_ACTION', 'GAME_BOARD']),
  ...tier(0.6, ['GAME_CARD', 'GAME_WORD', 'GAME_ADVENTURE', 'GAME_ROLE_PLAYING', 'GAME_STRATEGY', 'GAME_SPORTS', 'GAME_MUSIC',
    'GAME_TRIVIA', 'GAME_EDUCATIONAL', 'GAME_CASINO', 'PERSONALIZATION', 'ENTERTAINMENT', 'COMICS']),
  ...tier(0.4, ['PHOTOGRAPHY', 'MUSIC_AND_AUDIO', 'VIDEO_PLAYERS', 'HEALTH_AND_FITNESS', 'BEAUTY', 'PARENTING'])
]));
export function genreWeight(g) {
  if (!g) return null;
  if (g in GENRE_TIERS) return GENRE_TIERS[g];
  return /^GAME_/.test(g) ? 0.6 : 0.2;
}

/** Türün görsel tabanı: çıktısı küçük resimde iyi görünen türler yüksek, metin ağırlıklı türler ve araçlar düşük. */
export const VISUAL_BASE = Object.freeze({
  GAME_CASUAL: 0.7, GAME_PUZZLE: 0.7, GAME_SIMULATION: 0.7, GAME_ARCADE: 0.7, GAME_RACING: 0.7, ART_AND_DESIGN: 0.7,
  GAME_ACTION: 0.6, PERSONALIZATION: 0.6, GAME_BOARD: 0.55, PHOTOGRAPHY: 0.5, COMICS: 0.5,
  GAME_EDUCATIONAL: 0.45, ENTERTAINMENT: 0.45, GAME_WORD: 0.3, GAME_TRIVIA: 0.3, EDUCATION: 0.25
});
const visualBase = (g) => (!g ? null : g in VISUAL_BASE ? VISUAL_BASE[g] : /^GAME_/.test(g) ? 0.5 : 0.15);

export function genreLabel(g) {
  if (!g) return 'bilinmeyen tür';
  const l = CATEGORY_LABELS[g];
  return l ? l.tr : g;
}

/* ------------------------------------------------------------------ kelime sözlükleri */

/** Başka bir şirketin ürünü / markası: adı meta veride kullanılamaz, arayan çoğu zaman o ürünü istiyor. Belirsiz kelimeler yok ("dodge", "mini", "gacha"). */
const BRANDS = ['bmw', 'mercedes', 'benz', 'audi', 'porsche', 'ferrari', 'lamborghini', 'bugatti', 'tesla', 'toyota', 'honda', 'nissan',
  'hyundai', 'kia', 'ford', 'chevrolet', 'chevy', 'jeep', 'volvo', 'scania', 'iveco', 'daf', 'kenworth', 'peterbilt', 'freightliner', 'renault',
  'fiat', 'opel', 'volkswagen', 'vw', 'skoda', 'mazda', 'subaru', 'mitsubishi', 'suzuki', 'yamaha', 'kawasaki', 'ducati', 'harley',
  'john deere', 'new holland', 'massey', 'fendt', 'caterpillar', 'komatsu', 'jcb', 'liebherr',
  'block blast', 'hill climb', 'candy crush', 'subway surfers', 'temple run', 'angry birds', 'clash royale', 'royal match', 'homescapes',
  'gardenscapes', 'township', 'coin master', 'monopoly', 'uno', 'scrabble', 'wordle', 'tetris', 'pac man', 'euro truck', 'ets2',
  'american truck', 'bussid', 'talking tom', 'hello neighbor', 'poppy playtime', 'huggy wuggy', 'skibidi', 'fnaf', 'five nights',
  'sakura school', 'avakin', 'bitlife', 'efootball', 'ludo king', 'stumble guys', 'geometry dash', 'fruit ninja', 'cut the rope',
  'plants vs zombies', 'pvz', 'bloons', 'hay day', 'farmville', 'simcity', 'the sims'];
/** ABD pazarı dışındaki ülke ve bölge adları (flags.js WRONG_GEO'nun kapsamadıkları dahil). Eyalet ya da kişi adı olabilenler yok ("georgia", "jordan"). */
const GEO_EN = ['afghanistan', 'albania', 'algeria', 'argentina', 'armenia', 'australia', 'austria', 'azerbaijan', 'bahrain', 'bangladesh',
  'belarus', 'belgium', 'bolivia', 'bosnia', 'brazil', 'brasil', 'bulgaria', 'cambodia', 'cameroon', 'canada', 'chile', 'china', 'colombia',
  'croatia', 'cuba', 'czech', 'denmark', 'ecuador', 'egypt', 'england', 'estonia', 'ethiopia', 'finland', 'france', 'germany', 'ghana',
  'greece', 'guatemala', 'haiti', 'honduras', 'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel', 'italy',
  'jamaica', 'japan', 'kazakhstan', 'kenya', 'korea', 'kuwait', 'laos', 'latvia', 'lebanon', 'libya', 'lithuania', 'malaysia', 'mexico',
  'mongolia', 'morocco', 'mozambique', 'myanmar', 'nepal', 'netherlands', 'nigeria', 'norway', 'oman', 'pakistan', 'panama', 'paraguay',
  'peru', 'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia', 'rwanda', 'saudi', 'scotland', 'senegal', 'serbia', 'singapore',
  'slovakia', 'slovenia', 'somalia', 'spain', 'sri lanka', 'sudan', 'sweden', 'switzerland', 'syria', 'taiwan', 'tanzania', 'thailand',
  'tunisia', 'uganda', 'ukraine', 'uae', 'dubai', 'uruguay', 'uzbekistan', 'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe',
  'europe', 'asia', 'africa', 'balkan', 'wala', 'wali'];

// İngilizce: tam kelime (normalizeFor çıktısı üzerinde). Türkçe: kelime başı + ek ("boyama", "renkli", "arabalar").
const enRe = (terms) => new RegExp(`\\b(${terms.join('|')})\\b`, 'g');
const trRe = (terms) => new RegExp(`(?:^| )(${terms.join('|')})[^ ]*`, 'g');
const LEX = {
  visualPos: {
    en: enRe(['colou?r', 'colou?rs', 'colou?ring', 'paint', 'painting', 'diamonds?', 'jewels?', 'gems?', 'pixel', 'art', 'mosaic', 'cross stitch',
      'glitter', 'sand', 'sort', 'sorting', 'merge', 'match', 'jigsaw', 'blast', 'candy', 'fruits?', 'cakes?', 'dress up', 'makeover', 'decor',
      'decorat\\w*', 'design', 'garden', 'aquarium', 'fish', 'truck', 'trucks', 'bus', 'cars?', 'parking', 'simulator', 'farm', 'cooking',
      'tiles?', 'blocks?', 'yarn', 'wool', 'knit\\w*', 'screws?', 'bolts?', 'hexa']),
    tr: trRe(['boya', 'renk', 'elmas', 'mücevher', 'piksel', 'sanat', 'mozaik', 'yapboz', 'eşleş', 'birleştir', 'sırala', 'şeker', 'meyve',
      'pasta', 'giydir', 'makyaj', 'dekor', 'tasarım', 'bahçe', 'akvaryum', 'balık', 'tır', 'kamyon', 'otobüs', 'araba', 'park', 'simülat',
      'simulat', 'çiftlik', 'blok', 'yün', 'örgü', 'vida'])
  },
  visualNeg: {
    en: enRe(['timers?', 'calculators?', 'widgets?', 'alarms?', 'clocks?', 'countdown', 'spirit level', 'bubble level', 'converters?',
      'scanners?', 'pdf', 'notes?', 'notepad', 'todo', 'to do', 'reminders?', 'trackers?', 'counters?', 'planners?', 'vpn', 'cleaner',
      'battery', 'flashlight', 'compass', 'translat\\w*', 'dictionary', 'words?', 'text', 'quiz', 'trivia', 'crossword', 'sign language',
      'alphabet', 'pomodoro', 'focus', 'habits?', 'budget', 'expenses?', 'password', 'qr', 'barcode', 'keyboard', 'ringtones?', 'sms']),
    tr: trRe(['zamanlayıcı', 'hesap makinesi', 'hesaplama', 'widget', 'alarm', 'saat', 'geri sayım', 'su terazi', 'dönüştürücü', 'tarayıcı',
      'pdf', 'not defteri', 'notlar', 'ajanda', 'hatırlatıcı', 'takip', 'sayaç', 'planlayıcı', 'vpn', 'temizleyici', 'pil(?= |$)', 'fener',
      'pusula', 'çeviri', 'çevirmen', 'sözlük', 'kelime', 'metin', 'bilgi yarışması', 'işaret dili', 'alfabe', 'pomodoro', 'odak',
      'alışkanlık', 'bütçe', 'harcama', 'şifre', 'qr', 'barkod', 'klavye', 'zil sesi', 'sms'])
  },
  // Otomatik bir fabrikanın çevrimdışı ve ücretsiz bir sürümünü inandırıcı biçimde çıkaramayacağı işler
  heavy: {
    en: enRe(['online', 'multiplayer', 'multi player', 'pvp', 'mmo\\w*', 'open world', 'battle royale', 'real time', 'realtime', 'ar',
      'augmented', 'vr', 'virtual reality', 'ai', 'chat ?bot', 'chat', 'video call', 'gps', 'bluetooth', 'nfc', 'bank\\w*', 'crypto\\w*',
      'bitcoin', 'iptv', 'tv remote']),
    tr: trRe(['online', 'çevrimiçi', 'çok oyunculu', 'açık dünya', 'canlı', 'yapay zeka', 'sohbet', 'görüntülü', 'gps', 'bluetooth', 'nfc',
      'banka', 'kripto', 'bitcoin', 'iptv', 'tv kumanda'])
  },
  // Yapılabilirlik sözlükleri. flags.js'teki doğrulanmış kurallara (karar sınıfını sınırlar) DOKUNMAZ, yalnızca bu skoru
  // etkiler: Ekim 2026'da keşif kısa listesinin başında flags.js'in yakalamadığı marka, platform, ülke ve yetişkin
  // aramaları vardı ("truck simulator x bmw", "simulator games pc", "truck simulator zimbabwe", "puzzle games girls hot").
  brand: {
    en: enRe(BRANDS),
    tr: trRe([...BRANDS, 'tofaş'])
  },
  platform: {
    // "steam" (buharlı tren), "controller" (hava trafik kontrolörü), "mac" (mac and cheese), "youtuber" (simülasyon teması) bilerek yok
    en: enRe(['pc', 'ps4', 'ps5', 'playstation', 'xbox', 'nintendo', 'console', 'youtube', 'tiktok', 'twitch', 'iphone', 'ipad', 'ios',
      'macbook', 'windows', 'chromebook']),
    tr: trRe(['pc(?= |$)', 'bilgisayar', 'ps4', 'ps5', 'playstation', 'xbox', 'steam', 'nintendo', 'konsol', 'youtube', 'tiktok', 'iphone', 'ios(?= |$)'])
  },
  // pazarın kendi ülkesi listede yok (ABD: usa / america; TR: türkiye). Sıfatlar ("korean", "japanese") bilerek yok:
  // çoğu zaman bir tema ("korean cooking"), başka bir pazar değil.
  geo: {
    en: enRe(GEO_EN),
    tr: trRe(['almanya', 'amerika', 'amerikan', 'avrupa', 'rusya', 'japonya', 'çin(?= |$)', 'kore(?= |$)', 'hindistan', 'brezilya', 'ingiltere',
      'fransa', 'italya', 'ispanya', 'kanada', 'meksika', 'arabistan', 'katar', 'dubai', 'mısır', 'irak', 'iran(?= |$)', 'suriye', 'kazakistan',
      'özbekistan', 'ukrayna', 'polonya', 'hollanda', 'afrika', 'asya', 'endonezya', 'pakistan',
      ...GEO_EN.filter((g) => !['sudan', 'wala', 'wali'].includes(g))]) // "sudan" Türkçede "su-dan"
  },
  adult: {
    en: enRe(['sexy', 'sex', 'nude', 'naked', 'nsfw', 'erotic', 'xxx', 'porn\\w*', 'hentai', 'hot girls?', 'hot women', 'hot babes?', 'girls? hot', 'women hot']),
    tr: trRe(['seksi', 'seks(?= |$)', 'çıplak', 'erotik', 'porno', 'ateşli kız', 'kızlar ateşli']) // "seksen" eşleşmez
  }
};
function termsIn(k, kind, lang) {
  const re = LEX[kind][lang === 'tr' ? 'tr' : 'en'];
  re.lastIndex = 0;
  return [...new Set([...k.matchAll(re)].map((m) => m[1]))];
}

/**
 * Yapılabilirlik: flags.js işaretleri. Değer = işaretlerin en düşüğü. Politika riski (0) skoru değiştirmez ama
 * kaydı "engelli" yapar: kısa liste onu önermez.
 */
/** Yapılabilirlik sözlüklerinin değerleri (flags.js işaretleriyle aynı ölçek); yetişkin araması engeller. */
export const FEASIBILITY_TERMS = Object.freeze({ brand: 0.2, platform: 0.3, geo: 0.4 });
const TERM_TR = { brand: 'marka', platform: 'başka platform', geo: 'başka ülke / pazar' };

export const FEASIBILITY_FLAGS = Object.freeze({
  regulated: 0, realMoney: 0,
  brandTr: 0.2, ip: 0.2, ipSuffix: 0.2, likeX: 0.2, agencyNav: 0.2,
  navDev: 0.3, rarePrefix: 0.3,
  wrongGeo: 0.4, wrongGeoAz: 0.4,
  singleDev: 0.6,
  seasonal: 0.7, yearStamped: 0.7
});

/* ------------------------------------------------------------------ yardımcılar */

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const pct = (x) => (Number.isFinite(x) ? Math.round(100 * x) : null);
const fmt = (n) => (!Number.isFinite(n) ? '–' : n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} milyar` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} milyon` : n >= 1e3 ? `${Math.round(n / 1e3)} bin` : String(Math.round(n)));
const W10 = (i) => EP.rankWeights[i] ?? 0;

/** Bileşenlerin ağırlıklı ortalaması; değeri olmayan bileşen atlanır, ağırlıklar yeniden ölçeklenir. */
function blend(parts, weights) {
  let s = 0, w = 0;
  for (const [k, v] of Object.entries(parts)) if (Number.isFinite(v)) { s += weights[k] * v; w += weights[k]; }
  return w ? s / w : null;
}
function rankMean(apps, f) {
  let s = 0, w = 0;
  apps.forEach((a, i) => { const v = f(a); if (Number.isFinite(v)) { s += W10(i) * v; w += W10(i); } });
  return w ? s / w : null;
}
/** Sıra ağırlıklı en baskın tür. */
export function dominantGenre(apps) {
  const m = new Map();
  apps.forEach((a, i) => { if (a.genre) m.set(a.genre, (m.get(a.genre) || 0) + W10(i)); });
  let best = null, bw = -1;
  for (const [g, w] of m) if (w > bw) { best = g; bw = w; }
  return best;
}

/** Ağırlıkları doğrular ve toplamı 1'e ölçekler; geçersizse öncüle döner. */
export function normWeights(w) {
  const src = w && typeof w === 'object' ? w : PRIOR_WEIGHTS;
  const out = {};
  let sum = 0;
  for (const s of SIGNALS) { const v = Number(src[s]); if (!Number.isFinite(v) || v < 0) return { ...PRIOR_WEIGHTS }; out[s] = v; sum += v; }
  if (!(sum > 0)) return { ...PRIOR_WEIGHTS };
  for (const s of SIGNALS) out[s] = out[s] / sum;
  return out;
}

/* ------------------------------------------------------------------ sinyaller */

/**
 * @param {Array} apps kelimenin çözülebilen ilk 10'u (sırayla)
 * @param {object} record kelime kaydı
 * @param {Array} neighbors tohum kelimenin ilk 10'u (benzer devler sayımı için; kelimenin kendi uygulamaları tekrar sayılmaz)
 */
export function discoverySignal(apps, record, neighbors = [], P = PARAMS) {
  const genre = rankMean(apps, (a) => genreWeight(a.genre));
  const dom = dominantGenre(apps);
  const c = (record && record.comp) || {};
  const sumInstalls = Number.isFinite(c.sumInstalls) ? c.sumInstalls : apps.reduce((s, a) => s + (a.real || 0), 0);
  const demand = record && record.demand;
  const ratioRaw = demand > 0 && sumInstalls > 0 ? Math.log10(sumInstalls / demand) : null;
  const ratio = ratioRaw === null ? null : clamp01((ratioRaw - P.ratioLo) / (P.ratioHi - P.ratioLo));
  const seen = new Set();
  const pool = [...apps, ...(neighbors || [])].filter((a) => a && !a.missing && !seen.has(a.id) && seen.add(a.id));
  const same = pool.filter((a) => dom && a.genre === dom);
  const n1M = same.filter((a) => (a.real || 0) >= P.bigInstalls).length;
  const n10M = same.filter((a) => (a.real || 0) >= P.megaInstalls).length;
  const density = clamp01((n1M + n10M) / P.densityFull);
  const value = blend({ genre, ratio, density }, P.parts.discovery);
  return { value: r2(value), parts: { genre: r2(genre), ratio: r2(ratio), density: r2(density) }, genre: dom, ratioRaw: r2(ratioRaw), sumInstalls, demand: demand ?? null, n1M, n10M, pool: pool.length };
}

export function gapSignal(apps, P = PARAMS) {
  const n = apps.length;
  const both = apps.filter((a) => a.ads && a.iap).length;
  const pressure = n ? both / n : null;
  const rated = apps.filter((a) => Number.isFinite(a.score) && (a.ratings || 0) >= P.minRatings);
  const avg = rated.length ? rated.reduce((s, a) => s + a.score, 0) / rated.length : null;
  const rating = avg === null ? null : clamp01((P.ratingTop - avg) / P.ratingSpan);
  const head = apps.slice(0, P.reviewTopN);
  const reviewed = head.map((a, i) => ({ a, i })).filter(({ a }) => a.cx && a.cx.n >= P.minReviewSample);
  let complaintRate = null;
  if (reviewed.length >= P.minReviewed) {
    let s = 0, w = 0;
    for (const { a, i } of reviewed) { s += W10(i) * a.cx.any; w += W10(i); }
    complaintRate = s / w;
  }
  const complaints = complaintRate === null ? null : clamp01(complaintRate / P.complaintFull);
  const kinds = reviewed.length >= P.minReviewed
    ? Object.fromEntries(['ads', 'pay', 'content'].map((k) => [k, r2(reviewed.reduce((s, { a }) => s + (a.cx[k] || 0), 0) / reviewed.length)]))
    : null;
  const value = blend({ pressure, rating, complaints }, P.parts.gap);
  return { value: r2(value), parts: { pressure: r2(pressure), rating: r2(rating), complaints: r2(complaints) }, n, both, avgScore: r2(avg), complaintRate: r2(complaintRate), kinds, nReviewed: reviewed.length };
}

export function visualSignal(k, apps, lang = 'en', overrides = null, P = PARAMS) {
  const manual = overrides && Object.prototype.hasOwnProperty.call(overrides, k) ? Number(overrides[k]) : null;
  if (Number.isFinite(manual)) return { value: r2(clamp01(manual)), source: 'manual', base: null, pos: [], neg: [] };
  const base = rankMean(apps, (a) => visualBase(a.genre));
  const pos = termsIn(k, 'visualPos', lang);
  const neg = termsIn(k, 'visualNeg', lang);
  if (base === null) return { value: null, source: 'auto', base: null, pos, neg };
  const value = clamp01(base + (pos.length ? P.visualTerm : 0) - (neg.length ? P.visualTerm : 0));
  return { value: r2(value), source: 'auto', base: r2(base), pos, neg };
}

export function feasibilitySignal(k, flags, lang = 'en', overrides = null, P = PARAMS) {
  const reasons = [];
  let v = 1;
  for (const f of flags || []) {
    if (f.level === 'exclude' || !(f.id in FEASIBILITY_FLAGS)) continue;
    if (FEASIBILITY_FLAGS[f.id] < 1) reasons.push(f.label);
    v = Math.min(v, FEASIBILITY_FLAGS[f.id]);
  }
  for (const kind of Object.keys(FEASIBILITY_TERMS)) {
    const hit = termsIn(k, kind, lang);
    if (hit.length) { v = Math.min(v, FEASIBILITY_TERMS[kind]); reasons.push(`${TERM_TR[kind]} (${hit.join(', ')})`); }
  }
  const adult = termsIn(k, 'adult', lang);
  if (adult.length) { v = 0; reasons.push(`yetişkin içerik araması (${adult.join(', ')}): Play içerik politikası`); }
  const blocked = v === 0;
  const heavy = termsIn(k, 'heavy', lang);
  if (heavy.length) { v *= P.heavyBuild; reasons.push(`ağır yapım (${heavy.join(', ')})`); }
  // başlık parçalarından türemiş öbek: tür kelimesi iki kez ("farm games pizza wala game", "araba oyunu oyunları")
  const genreWords = k.split(' ').filter((t) => (lang === 'tr' ? /^oyun/.test(t) : /^games?$/.test(t))).length;
  if (genreWords >= 2) { v *= P.titleMash; reasons.push('başlık parçası (tür kelimesi iki kez)'); }
  const manual = overrides && Object.prototype.hasOwnProperty.call(overrides, k) ? Number(overrides[k]) : null;
  if (Number.isFinite(manual)) return { value: r2(clamp01(manual)), source: 'manual', blocked: blocked && manual === 0, reasons: ['elle girilen değer'] };
  return { value: r2(v), source: 'auto', blocked, reasons, heavy };
}

/* ------------------------------------------------------------------ skor */

/** Etiketler veri setindeki dağılıma göre (Ekim 2026, iki pazar): ≤ 44 alt beşte bir, 45-59 medyana kadar, 72+ üst onda bir. */
export const DISCOVERY_LEVELS = Object.freeze([[44, 'low', 'DÜŞÜK'], [59, 'mid', 'ORTA'], [71, 'high', 'YÜKSEK'], [100, 'vhigh', 'ÇOK YÜKSEK']]);
export function discoveryLevel(v) {
  if (!Number.isFinite(v)) return { key: 'na', label: '—', index: -1 };
  for (let i = 0; i < DISCOVERY_LEVELS.length; i++) if (v <= DISCOVERY_LEVELS[i][0]) return { key: DISCOVERY_LEVELS[i][1], label: DISCOVERY_LEVELS[i][2], index: i };
  return { key: 'vhigh', label: 'ÇOK YÜKSEK', index: 3 };
}

/**
 * Bir kelimenin keşif skoru.
 * @param {object} record kelime kaydı ({k, st, demand, comp, top[]})
 * @param {object} appsMap {id: {genre, real, score, ratings, ads, iap, cx?}}  cx = değerlendirme özeti (src/reviews.js)
 * @param {{decision:object, seed?:object, marketApps?:object, model?:object, lang?:string}} opts
 *        decision = getOpportunityVerdict() sonucu (girebilirlik ve flags.js işaretleri için);
 *        seed = tohum kelimenin kaydı (benzer devler); marketApps = tohumun uygulamalarını çözmek için veri setinin
 *        uygulama haritası (varsayılan appsMap); model = data.discoveryModel ({weights, visual, feasibility})
 * @returns {object|null} null = değerlendirilmedi (analiz yok, yapay / talepsiz kelime)
 */
export function discoveryScore(record, appsMap, opts = {}) {
  const r = record || {};
  const d = opts.decision;
  if (!(r.st === 'ok' || r.st === 'partial') || !Array.isArray(r.top) || !r.top.length) return null;
  if (!d || d.state !== 'ok' || !d.axes || !d.axes.enter) return null;
  const apps = r.top.slice(0, 10).map((id) => appsMap && appsMap[id]).filter((a) => a && !a.missing);
  if (!apps.length) return null;
  const lang = opts.lang || 'en';
  const model = opts.model || {};
  const W = normWeights(model.weights);
  const k = normalizeFor(r.k, lang);
  const seed = opts.seed && opts.seed !== r && opts.seed.k !== r.k && Array.isArray(opts.seed.top) ? opts.seed : null;
  const pool = opts.marketApps || appsMap;
  const neighbors = seed ? seed.top.slice(0, 10).map((id) => pool && pool[id]).filter(Boolean) : [];
  const sig = {
    discovery: discoverySignal(apps, r, neighbors),
    gap: gapSignal(apps),
    visual: visualSignal(k, apps, lang, model.visual),
    band: { value: r2(clamp01(d.axes.enter.score / 100)), enter: d.axes.enter.score, verdict: d.verdict },
    feasibility: feasibilitySignal(k, d.flags, lang, model.feasibility)
  };
  let sum = 0, wsum = 0;
  for (const s of SIGNALS) if (Number.isFinite(sig[s].value)) { sum += W[s] * sig[s].value; wsum += W[s]; }
  if (!wsum) return null;
  const score = Math.round((100 * sum) / wsum);
  const contrib = SIGNALS.filter((s) => Number.isFinite(sig[s].value)).map((s) => ({ s, c: W[s] * sig[s].value, v: sig[s].value }));
  const strongest = contrib.slice().sort((a, b) => b.c - a.c)[0];
  const weakest = contrib.slice().sort((a, b) => a.v - b.v)[0];
  return {
    score,
    level: discoveryLevel(score),
    blocked: !!sig.feasibility.blocked,
    signals: sig,
    weights: W,
    version: model.version || MODEL_VERSION,
    weightsSource: model.weightsSource || 'öncül (kalibre edilmedi)',
    summary: `Keşif ${score}/100 · en güçlü: ${SIGNAL_TR[strongest.s].toLocaleLowerCase('tr-TR')} · en zayıf: ${SIGNAL_TR[weakest.s].toLocaleLowerCase('tr-TR')}${sig.feasibility.blocked ? ' · politika engeli' : ''}.`,
    reasons: explain(sig)
  };
}

/** Yayınlanan veri dosyası için kısa biçim: {s: skor, p: [keşif, boşluk, görsel, bant, yapılabilirlik] (0-100), b?: 1 engelli}. */
export function compactDiscovery(res) {
  if (!res) return null;
  const out = { s: res.score, p: SIGNALS.map((s) => pct(res.signals[s].value)) };
  if (res.blocked) out.b = 1;
  return out;
}

function explain(sig) {
  const D = sig.discovery, G = sig.gap, V = sig.visual, B = sig.band, F = sig.feasibility;
  const ratioWord = (x) => (!Number.isFinite(x) ? 'ölçülemedi' : x >= 0.66 ? 'yüksek' : x >= 0.33 ? 'orta' : 'düşük');
  const out = [];
  out.push(`${SIGNAL_TR.discovery} ${pct(D.value) ?? '–'}: ilk 10 ağırlıkla ${genreLabel(D.genre)} (tür ağırlığı ${pct(D.parts.genre) ?? '–'}/100); aramaya göre yükleme yoğunluğu ${ratioWord(D.parts.ratio)} (ilk 10 toplam ${fmt(D.sumInstalls)} yükleme, talep puanı ${D.demand ?? '–'}); kelimenin ve tohumunun ilk 10'unda aynı türden ${D.n1M} uygulama 1M+, ${D.n10M} tanesi 10M+.`);
  const cx = G.complaintRate === null
    ? 'rakip değerlendirmesi örneği henüz yok'
    : `ilk 5'teki ${G.nReviewed} rakibin yeni değerlendirmelerinin %${pct(G.complaintRate)}'i şikâyet (reklam %${pct(G.kinds.ads)}, ödeme %${pct(G.kinds.pay)}, içerik %${pct(G.kinds.content)})`;
  out.push(`${SIGNAL_TR.gap} ${pct(G.value) ?? '–'}: ilk ${G.n} uygulamanın ${G.both} tanesinde hem reklam hem uygulama içi satın alma var; ortalama puan ${G.avgScore ?? '–'}; ${cx}.`);
  out.push(V.source === 'manual'
    ? `${SIGNAL_TR.visual} ${pct(V.value)}: elle girilmiş değer.`
    : `${SIGNAL_TR.visual} ${pct(V.value) ?? '–'}: tür tabanı ${pct(V.base) ?? '–'}${V.pos.length ? `, görsel kelime (${V.pos.join(', ')})` : ''}${V.neg.length ? `, araç / metin kelimesi (${V.neg.join(', ')})` : ''}.`);
  out.push(`${SIGNAL_TR.band} ${pct(B.value)}: girebilirlik ${B.enter}/100 (${B.verdict}). Yeni bir uygulamanın ilk haftalarda arama geçmişi olmadığı için ağırlığı düşük.`);
  out.push(`${SIGNAL_TR.feasibility} ${pct(F.value)}: ${F.reasons.length ? F.reasons.join('; ') : 'engel yok'}${F.blocked ? ' — politika riski: önerilmez' : ''}.`);
  return out;
}
