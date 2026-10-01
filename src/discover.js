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
  const EN = langOf('en');
  // İngilizce olmayan pazarlarda başlıkların bir kısmı İngilizcedir: iki dilin bağlaç/dolgu
  // listeleri birlikte uygulanır ("and restore", "alarm clock for" gibi adaylar üretilmesin).
  const foreign = L.code !== 'en';
  const edge = (w) => L.edgeStopwords.has(w) || (foreign && EN.edgeStopwords.has(w));
  const stop = (w) => L.stopwords.has(w) || (foreign && EN.stopwords.has(w));
  const freq = new Map();
  for (const title of titles || []) {
    const parts = String(title || '').split(/[-–—:|,()[\]!.•·/&+]+/);
    const seenInTitle = new Set();
    for (const part of parts) {
      const ascii = /^[\x00-\x7F]*$/.test(part);
      if (foreign && ascii && tokens(part, 'en').some((w) => EN.edgeStopwords.has(w))) continue; // İngilizce başlık parçası
      const t = tokens(part, L.code);
      for (const g of ngrams(t, 1, maxN)) {
        // ASCII parçadaki "I" harfi Türkçe kuralla "ı" olur ("GIF" → "gıf"): belirsiz, aday yapılmaz
        if (foreign && L.code === 'tr' && ascii && g.some((w) => w.includes('ı'))) continue;
        if (g.length === 1 && (g[0].length < 4 || stop(g[0]) || /^\d+$/.test(g[0]))) continue;
        if (edge(g[0]) || edge(g[g.length - 1])) continue;
        if (g.every((w) => stop(w))) continue;
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
