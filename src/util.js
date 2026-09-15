// Küçük, bağımlılıksız yardımcılar.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Metni karşılaştırma için normalize eder: küçük harf, noktalama yok, tek boşluk. */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s) {
  return normalize(s).split(' ').filter(Boolean);
}

/** Kaba İngilizce çoğul kökleme: games → game, puzzles → puzzle, stories → story. */
export function stem(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** Niş gruplamada tek başına anlam taşımayan kelimeler. */
export const STOPWORDS = new Set([
  'game', 'games', 'app', 'apps', 'for', 'free', 'the', 'and', 'of', 'to', 'a', 'an', 'in', 'with',
  'best', 'top', 'new', 'my', 'me', 'on', 'no', 'your', 'you', 'by', 'vs', 'or', 'all', 'it', 'is',
  'pro', 'hd', 'ii', 'iii', 'from', 'at', 'as', 'be', 'this', 'that', 'plus', 'lite', 'ultimate',
  'edition', 'mobile', 'android', 'version'
]);

/** N-gram'ların kenarında olması anlamsız kelimeler ("for", "and" ile başlayan/biten aday olmasın). */
export const EDGE_STOPWORDS = new Set(['for', 'and', 'the', 'of', 'to', 'a', 'an', 'in', 'with', 'by', 'or', 'on', 'at', 'as', 'from', 'vs', 'is', 'it', 'be', 'your', 'my']);

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

/** "Nov 15, 2012" → "2012-11-15"; zaten ISO ise olduğu gibi. */
export function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now - t) / DAY_MS;
}
