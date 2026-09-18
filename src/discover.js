// Aday anahtar kelime üretimi: başlık n-gram'ları, tohum ön ekleri, geçerlilik filtresi.
import { tokens, ngrams, normalize, langOf } from './util.js';

const MAX_KEYWORD_LEN = 60;
const MAX_TOKENS = 7;

export function isValidKeyword(raw, lang = 'en') {
  const s = normalize(raw, lang);
  if (!s || s.length < 2 || s.length > MAX_KEYWORD_LEN) return false;
  if (s.split(' ').length > MAX_TOKENS) return false;
  if (!/\p{L}/u.test(s)) return false; // en az bir harf
  return true;
}

/**
 * Uygulama başlıklarından aday kelimeler.
 * "Offline Games - No Wifi Games" → "offline games", "no wifi games", "wifi games" ...
 * Tek kelimeler için eşik daha yüksek (marka gürültüsünü azaltmak için).
 */
export function candidatesFromTitles(titles, opts = {}) {
  const { minFreq = 2, maxN = 3, lang = 'en' } = opts;
  const L = langOf(lang);
  const freq = new Map();
  for (const title of titles || []) {
    const parts = String(title || '').split(/[-–—:|,()[\]!.•·/&+]+/);
    const seenInTitle = new Set();
    for (const part of parts) {
      const t = tokens(part, L.code);
      for (const g of ngrams(t, 1, maxN)) {
        if (g.length === 1 && (g[0].length < 4 || L.stopwords.has(g[0]) || /^\d+$/.test(g[0]))) continue;
        if (L.edgeStopwords.has(g[0]) || L.edgeStopwords.has(g[g.length - 1])) continue;
        if (g.every((w) => L.stopwords.has(w))) continue;
        if (g.some((w) => w.length === 1 && !/\d/.test(w))) continue;
        const key = g.join(' ');
        if (seenInTitle.has(key)) continue;
        seenInTitle.add(key);
        freq.set(key, (freq.get(key) || 0) + 1);
      }
    }
  }
  return [...freq.entries()]
    .filter(([k, c]) => c >= (k.includes(' ') ? minFreq : minFreq + 1))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, hits]) => ({ k, hits }));
}

/** Bir tohum için sorgulanacak ön ekler: "seed", "seed " ve "seed a".."seed z". */
export function seedPrefixes(seed, letters = 'abcdefghijklmnopqrstuvwxyz', lang = 'en') {
  const s = normalize(seed, lang);
  return [s, s + ' ', ...[...letters].map((l) => `${s} ${l}`)];
}
