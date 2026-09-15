// Talep (arama hacmi) tahmini: Google Play otomatik tamamlama davranışından.
//
// Fikir: Bir kelime ne kadar kısa bir ön ekle (prefix) önerilmeye başlıyorsa
// o kadar çok aranıyordur. "off" yazınca "offline games" çıkıyorsa bu çok
// güçlü bir taleptir; ancak tamamını yazınca çıkıyorsa zayıftır.
// Ön ek uzunluğu üzerinde ikili arama yaparak en kısa tetikleyici ön eki buluruz.
//
// Not: Otomatik tamamlama en fazla 5 öneri döndürür. "block puzzle" gibi çok
// popüler baş terimlerde 5 yuva da uzun varyantlarla dolar ve kelimenin kendisi
// listede görünmez. Bu yüzden iki eşleşme modu vardır:
//   exact: kelimenin kendisi öneriliyor
//   ext:   kelimeyle (kelime sınırında) başlayan bir öneri var ("block puzzle games")

import { clamp, normalize } from './util.js';

/** Öneri listesinde kelimeyi (veya uzantısını) arar. */
export function matchIn(list, k) {
  if (!Array.isArray(list)) return null;
  const exact = list.indexOf(k);
  if (exact >= 0) return { mode: 'exact', pos: exact + 1, via: k };
  const i = list.findIndex((s) => s.startsWith(`${k} `));
  return i >= 0 ? { mode: 'ext', pos: i + 1, via: list[i] } : null;
}

/**
 * @param {string} keyword normalize edilmiş anahtar kelime
 * @param {(prefix:string)=>Promise<string[]>} getSuggest ön ek → öneri listesi (normalize)
 * @param {{knownPrefix?:number}} opts daha önce bu kelimeyi tetiklediği bilinen ön ek uzunluğu
 * @returns {Promise<{status:'ok'|'ok-partial'|'none'|'budget', minPrefix?:number, pos?:number, mode?:string, via?:string, len:number, variants:string[], variantsPrefixLen?:number}>}
 */
export async function measureDemand(keyword, getSuggest, opts = {}) {
  const k = normalize(keyword);
  const len = k.length;
  const cache = new Map();
  let budgetHit = false;

  async function suggestAt(L) {
    const prefix = k.slice(0, L);
    if (cache.has(prefix)) return cache.get(prefix);
    try {
      const list = await getSuggest(prefix);
      cache.set(prefix, list);
      return list;
    } catch (err) {
      if (err && err.budget) { budgetHit = true; return null; }
      throw err;
    }
  }

  const hits = async (L) => {
    const list = await suggestAt(L);
    return list === null ? null : matchIn(list, k) !== null;
  };

  // 1) Tam metin bile öneri listesinde değilse: ölçülebilir talep yok.
  //    (Bu çağrının döndürdüğü öneriler yine de değerli adaylardır → variants)
  let hi = null;
  if (opts.knownPrefix && opts.knownPrefix >= 1 && opts.knownPrefix <= len) {
    const h = await hits(opts.knownPrefix);
    if (h === null) return { status: 'budget', len, variants: [] };
    if (h) hi = opts.knownPrefix;
  }
  let variants = [];
  if (hi === null) {
    const full = await suggestAt(len);
    if (full === null) return { status: 'budget', len, variants: [] };
    variants = full.filter((s) => s !== k);
    if (!matchIn(full, k)) return { status: 'none', len, variants, variantsPrefixLen: len };
    hi = len;
  }

  // 2) [1, hi] aralığında en kısa tetikleyici ön eki ikili arama ile bul.
  let lo = 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const h = await hits(mid);
    if (h === null) { budgetHit = true; break; }
    if (h) hi = mid; else lo = mid + 1;
  }
  const list = cache.get(k.slice(0, hi)) || [];
  const m = matchIn(list, k) || { mode: 'exact', pos: 1, via: k };
  const useFull = variants.length > 0;
  return {
    status: budgetHit ? 'ok-partial' : 'ok',
    minPrefix: hi,
    pos: m.pos,
    mode: m.mode,
    via: m.via,
    len,
    variants: useFull ? variants : list.filter((s) => s !== k),
    variantsPrefixLen: useFull ? len : hi
  };
}

/** Ön ek ölçümünden 0-100 arası talep puanı. Uzantı modu (kelimenin kendisi önerilmiyor) %10 iskontolu. */
export function demandScore({ minPrefix, len, pos, mode }) {
  if (!minPrefix || !len) return 0;
  const popAbs = clamp(1 - (minPrefix - 1) / 12, 0, 1); // 1 harfte çıkıyorsa 1, 13+ harf gerekiyorsa 0
  const popRel = len > 1 ? clamp(1 - (minPrefix - 1) / (len - 1), 0, 1) : 1;
  const posScore = clamp(1 - ((pos || 1) - 1) / 4, 0, 1); // öneri listesindeki sıra (1-5)
  const raw = 0.55 * popAbs + 0.25 * popRel + 0.20 * posScore;
  return Math.round(100 * raw * (mode === 'ext' ? 0.9 : 1));
}
