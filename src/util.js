// Küçük, bağımlılıksız yardımcılar.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Dile duyarlı metin işleme tarayıcı arayüzüyle ortaktır: public/js/lang.js
export { langOf, LANGS, stemTokens } from '../public/js/lang.js';
import { normalizeFor, tokensFor, langOf as langPack } from '../public/js/lang.js';

/** Metni karşılaştırma için normalize eder. lang verilirse o dilin harf kuralları uygulanır. */
export function normalize(s, lang = 'en') {
  return normalizeFor(s, lang);
}

export function tokens(s, lang = 'en') {
  return tokensFor(s, lang);
}

/** Dile göre kökleme (varsayılan İngilizce). */
export function stem(t, lang = 'en') {
  return langPack(lang).stem(t);
}

/** Niş gruplamada tek başına anlam taşımayan kelimeler (varsayılan İngilizce). */
export const STOPWORDS = langPack('en').stopwords;

/** N-gram'ların kenarında olması anlamsız kelimeler. */
export const EDGE_STOPWORDS = langPack('en').edgeStopwords;

export function ngrams(arr, min = 1, max = 3) {
  const out = [];
  for (let n = min; n <= max; n++) {
    for (let i = 0; i + n <= arr.length; i++) out.push(arr.slice(i, i + n));
  }
  return out;
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export function round(x, digits = 0) {
  if (!Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function todayISO(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Basit eşzamanlılık sınırlayıcı: pLimit(2)(fn) aynı anda en fazla 2 fn çalıştırır. */
export function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

/**
 * Git dostu JSON: üst seviye dizilerde her eleman, nesnelerde her giriş ayrı satırda.
 * Böylece günlük commit'lerde sadece değişen satırlar diff'e düşer.
 */
export function stringifyLines(obj) {
  const lines = ['{'];
  const keys = Object.keys(obj);
  keys.forEach((key, idx) => {
    const val = obj[key];
    const comma = idx < keys.length - 1 ? ',' : '';
    if (Array.isArray(val)) {
      if (!val.length) { lines.push(`${JSON.stringify(key)}: []${comma}`); return; }
      lines.push(`${JSON.stringify(key)}: [`);
      val.forEach((item, i) => lines.push(JSON.stringify(item) + (i < val.length - 1 ? ',' : '')));
      lines.push(`]${comma}`);
    } else if (val && typeof val === 'object') {
      const entries = Object.keys(val);
      if (!entries.length) { lines.push(`${JSON.stringify(key)}: {}${comma}`); return; }
      lines.push(`${JSON.stringify(key)}: {`);
      entries.forEach((k, i) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(val[k])}` + (i < entries.length - 1 ? ',' : '')));
      lines.push(`}${comma}`);
    } else {
      lines.push(`${JSON.stringify(key)}: ${JSON.stringify(val)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

/*
 * Play Store yayın tarihi yerelleştirilmiş gelir: İngilizce "Nov 15, 2012",
 * Türkçe "15 Kas 2012". JavaScript'in Date ayrıştırıcısı ikincisini anlamaz ve
 * null döndürürdü; bu yüzden Türkçe pazarda uygulamaların yaşı ve "son 2 yılda
 * ilk 10'a girenler" ölçüsü kör kalıyordu (tarihi okunabilen uygulama %17).
 * Önce yerel ayrıştırıcı denenir, sonra "gün ay yıl" kalıbı ay sözlüğüyle çözülür.
 */
const MONTH_WORDS = {
  // İngilizce
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // Türkçe (kısa ve uzun)
  oca: 1, ocak: 1, sub: 2, şub: 2, subat: 2, şubat: 2, mart: 3, nis: 4, nisan: 4,
  mayis: 5, mayıs: 5, haz: 6, haziran: 6, tem: 7, temmuz: 7, agu: 8, ağu: 8, agustos: 8, ağustos: 8,
  eyl: 9, eylul: 9, eylül: 9, eki: 10, ekim: 10, kas: 11, kasim: 11, kasım: 11, ara: 12, aralik: 12, aralık: 12
};

/** Yerelleştirilmiş tarih metnini ISO güne çevirir. Çözülemezse null. */
export function parseLocalizedDate(text) {
  const s = String(text).trim();
  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) return native.toISOString().slice(0, 10);
  // "15 Kas 2012" / "15 Kasım 2012" / "15 Kas, 2012"
  const m = s.match(/^(\d{1,2})\s+([\p{L}]+),?\s+(\d{4})$/u);
  if (m) {
    const month = MONTH_WORDS[m[2].toLowerCase()];
    if (month) {
      const iso = `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
      const d = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) return iso;
    }
  }
  return null;
}

/** "Nov 15, 2012" → "2012-11-15"; zaman damgası, ISO ya da yerel metin kabul eder. */
export function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null;
  return parseLocalizedDate(v);
}

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now - t) / DAY_MS;
}
