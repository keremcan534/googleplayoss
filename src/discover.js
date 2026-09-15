// Aday anahtar kelime üretimi: başlık n-gram'ları, tohum ön ekleri, geçerlilik filtresi.
import { tokens, ngrams, normalize, STOPWORDS, EDGE_STOPWORDS } from './util.js';

const MAX_KEYWORD_LEN = 60;
const MAX_TOKENS = 7;

export function isValidKeyword(raw) {
  const s = normalize(raw);
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
  const { minFreq = 2, maxN = 3 } = opts;
  const freq = new Map();
  for (const title of titles || []) {
    const parts = String(title || '').split(/[-–—:|,()[\]!.•·/&+]+/);
    const seenInTitle = new Set();
    for (const part of parts) {
      const t = tokens(part);
      for (const g of ngrams(t, 1, maxN)) {
        if (g.length === 1 && (g[0].length < 4 || STOPWORDS.has(g[0]) || /^\d+$/.test(g[0]))) continue;
        if (EDGE_STOPWORDS.has(g[0]) || EDGE_STOPWORDS.has(g[g.length - 1])) continue;
        if (g.every((w) => STOPWORDS.has(w))) continue;
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
export function seedPrefixes(seed, letters = 'abcdefghijklmnopqrstuvwxyz') {
  const s = normalize(seed);
  return [s, s + ' ', ...[...letters].map((l) => `${s} ${l}`)];
}
