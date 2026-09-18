/*
 * Dile duyarlı metin işleme — tarayıcı ve tarayıcı betiği (crawler) ortak kullanır.
 * Bağımlılık yok, saf fonksiyonlar.
 *
 * Neden gerekli: kökleme ve dolgu kelimeleri İngilizceye göre yazılmıştı.
 * Türkçe pazarda bu iki hataya yol açıyordu:
 *   1) "İSTANBUL".toLowerCase() → "i" + birleşen nokta (U+0307) → kelime ikiye bölünüyordu
 *      ve "IŞIK" → "işik" oluyordu (Türkçe'de "ışık" olmalı).
 *   2) "oyunlar" ile "oyun" eşleşmiyordu → uygulama başlıklarında kelime hiç bulunamıyor,
 *      zorluk olduğundan düşük, fırsat olduğundan yüksek görünüyordu.
 */

/* ---------------- büyük/küçük harf ve normalizasyon ---------------- */

/** Metni karşılaştırma için normalize eder. lang='tr' iken Türkçe harf kuralları uygulanır. */
export function normalizeFor(s, lang = 'en') {
  let t = String(s ?? '');
  if (lang === 'tr') {
    // Türkçe: I → ı, İ → i. (toLocaleLowerCase yerine açık eşleme; ortam bağımsız.)
    t = t.replace(/I/g, 'ı').replace(/İ/g, 'i');
  } else {
    // Diğer diller: noktalı büyük İ küçültülürken birleşen nokta üretmesin.
    t = t.replace(/İ/g, 'i');
  }
  return t
    .toLowerCase()
    .normalize('NFKC')
    .replace(/̇/g, '')          // artakalan birleşen nokta
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokensFor(s, lang = 'en') {
  return normalizeFor(s, lang).split(' ').filter(Boolean);
}

/* ---------------- kökleme ---------------- */

/** İngilizce kaba çoğul kökleme: games → game, stories → story. */
export function stemEn(t) {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

// Türkçe ekler, uzundan kısaya. Amaç dilbilimsel doğruluk değil, tutarlı eşleşme:
// "oyunlar", "oyunları", "oyunu" hepsi aynı köke insin.
// Not: 'da/de/ta/te/ya/ye/na/ne' (bulunma/yönelme) listede YOK — bunlar aynı zamanda
// yaygın kelime sonlarıdır ("harita", "nokta") ve atılınca kökler tutarsız kalıyordu.
const TR_SUFFIXES = [
  'lerinin', 'larının', 'lerini', 'larını', 'sının', 'sinin', 'lerin', 'ların',
  'sını', 'sini', 'ndan', 'nden', 'leri', 'ları',
  'tan', 'ten', 'dan', 'den', 'lar', 'ler',
  'nın', 'nin', 'nun', 'nün',
  'ın', 'in', 'un', 'ün', 'sı', 'si', 'su', 'sü', 'yı', 'yi', 'yu', 'yü',
  'a', 'e', 'ı', 'i', 'u', 'ü'
].sort((a, b) => b.length - a.length);

/*
 * Ünlü düşmesi: "vakit" → "vakti", "resim" → "resmi". Ek alınca kökün son ünlüsü
 * düştüğü için "vakitleri" ile "vakti" farklı köke iniyordu. Yüksek frekanslı
 * (uygulama başlıklarında geçen) kelimeler için çıplak hâli düşmüş hâle eşleriz,
 * böylece iki yazım aynı köke gelir.
 */
const TR_VOWEL_DROP = {
  vakit: 'vakt', resim: 'resm', isim: 'ism', şehir: 'şehr', akıl: 'akl', fikir: 'fikr',
  karın: 'karn', ağız: 'ağz', burun: 'burn', oğul: 'oğl', beyin: 'beyn', göğüs: 'göğs',
  gönül: 'gönl', boyun: 'boyn', omuz: 'omz', sabır: 'sabr', ilim: 'ilm', hüküm: 'hükm',
  nakit: 'nakt', kayıt: 'kayd', devir: 'devr', kabir: 'kabr', asıl: 'asl', nesil: 'nesl',
  şükür: 'şükr', ömür: 'ömr', emir: 'emr', sır: 'sırr', metin: 'metn'
};

/** Türkçe hafif kökleme: en fazla iki ek atar, kök en az 3 harf kalır. */
export function stemTr(t) {
  let w = TR_VOWEL_DROP[t] || t;
  for (let pass = 0; pass < 2; pass++) {
    let cut = false;
    for (const suf of TR_SUFFIXES) {
      if (w.length > suf.length + 2 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length);
        cut = true;
        break;
      }
    }
    if (!cut) break;
    if (TR_VOWEL_DROP[w]) { w = TR_VOWEL_DROP[w]; break; }
  }
  return w;
}

/* ---------------- kelime listeleri ---------------- */

/** Niş gruplamada tek başına anlam taşımayan kelimeler. */
const STOP_EN = [
  'game', 'games', 'app', 'apps', 'for', 'free', 'the', 'and', 'of', 'to', 'a', 'an', 'in', 'with',
  'best', 'top', 'new', 'my', 'me', 'on', 'no', 'your', 'you', 'by', 'vs', 'or', 'all', 'it', 'is',
  'pro', 'hd', 'ii', 'iii', 'from', 'at', 'as', 'be', 'this', 'that', 'plus', 'lite', 'ultimate',
  'edition', 'mobile', 'android', 'version'
];
const STOP_TR = [
  'oyun', 'oyunu', 'oyunlar', 'oyunları', 'uygulama', 'uygulamalar', 'uygulaması',
  've', 'ile', 'için', 'bir', 'bu', 'şu', 'en', 'çok', 'gibi', 'olan', 'daha', 'ama',
  'ücretsiz', 'bedava', 'indir', 'indirme', 'yeni', 'iyi', 'güzel', 'nasıl', 'ne', 'mi',
  'android', 'mobil', 'telefon', 'türkçe', 'program', 'programı', 'site', 'sitesi'
];

/** N-gram'ın kenarında bulunması anlamsız kelimeler. */
const EDGE_EN = ['for', 'and', 'the', 'of', 'to', 'a', 'an', 'in', 'with', 'by', 'or', 'on', 'at', 'as', 'from', 'vs', 'is', 'it', 'be', 'your', 'my'];
const EDGE_TR = ['ve', 'ile', 'için', 'bir', 'bu', 'şu', 'en', 'çok', 'gibi', 'daha', 'ama', 'mi', 'ne', 'de', 'da'];

/**
 * Başlık eşleşmesinde yok sayılan ticari dolgu kelimeleri.
 * Hiçbir uygulama başlığına "free"/"ücretsiz" yazmaz; bu kelimeler eşleşmeyi
 * yapay olarak sıfıra çekip zorluğu düşürüyordu.
 * "offline"/"çevrimdışı" burada YOK: onlar gerçekten başlıklarda geçen ayırt edici kelimelerdir.
 */
const FILLER_EN = [
  'free', 'app', 'apps', 'android', 'apk', 'download', 'downloads', 'install',
  'best', 'top', 'new', 'pro', 'google', 'play', 'store', 'mobile', 'phone', 'version'
];
const FILLER_TR = [
  'ücretsiz', 'bedava', 'uygulama', 'uygulamalar', 'uygulaması', 'indir', 'indirme',
  'android', 'apk', 'en', 'iyi', 'yeni', 'pro', 'google', 'play', 'mobil', 'telefon', 'sürüm', 'program'
];

function setOf(words, stem) {
  const s = new Set();
  for (const w of words) { s.add(w); s.add(stem(w)); }
  return s;
}

const EN = {
  code: 'en',
  stem: stemEn,
  stopwords: setOf(STOP_EN, stemEn),
  edgeStopwords: setOf(EDGE_EN, stemEn),
  titleFiller: setOf(FILLER_EN, stemEn)
};
const TR = {
  code: 'tr',
  stem: stemTr,
  stopwords: setOf(STOP_TR, stemTr),
  edgeStopwords: setOf(EDGE_TR, stemTr),
  titleFiller: setOf(FILLER_TR, stemTr)
};

export const LANGS = { en: EN, tr: TR };

/** Dil paketi. Bilinmeyen dil → İngilizce kuralları. */
export function langOf(lang) {
  const code = String(lang || 'en').toLowerCase().slice(0, 2);
  return LANGS[code] || EN;
}

/** Kelimeyi dile göre köklenmiş parçalara ayırır. */
export function stemTokens(s, lang = 'en') {
  const L = langOf(lang);
  return tokensFor(s, L.code).map(L.stem);
}
