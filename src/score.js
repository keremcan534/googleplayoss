// Rekabet (zorluk) ve fırsat skorları. Saf fonksiyonlar; test edilebilir.
import { tokens, stem, clamp, median, mean, round, daysSince } from './util.js';

const log10p = (x) => Math.log10(Math.max(0, x || 0) + 1);

/** Başlık, anahtar kelimenin tüm kelimelerini (köklenmiş) içeriyor mu? */
export function titleMatches(keyword, title) {
  const kw = tokens(keyword).map(stem);
  if (!kw.length) return false;
  const tt = new Set(tokens(title).map(stem));
  return kw.every((t) => tt.has(t));
}

/**
 * Sıralı ilk N uygulamanın detaylarından rekabet ölçümleri.
 * @param {string} keyword
 * @param {Array} apps kompakt uygulama kayıtları (sıra korunmuş; eksik/missing olanlar atlanır)
 * @param {{topN?:number, now?:number}} opts
 */
export function scoreCompetition(keyword, apps, opts = {}) {
  const { topN = 10, now = Date.now() } = opts;
  const list = (apps || []).filter((a) => a && !a.missing).slice(0, topN);
  const n = list.length;
  if (!n) {
    return { difficulty: null, market: null, comp: { n: 0 } };
  }
  const strengths = list.map((a) => clamp((log10p(a.real) - 3) / 4, 0, 1)); // 1K → 0, 10M → 1
  const strength = median(strengths);
  const topStrength = Math.max(...strengths.slice(0, 3));
  const ratingsVol = median(list.map((a) => clamp((log10p(a.ratings) - 2) / 4, 0, 1))); // 100 → 0, 1M → 1
  const rated = list.filter((a) => Number.isFinite(a.score) && a.ratings >= 50);
  const avgScore = rated.length ? mean(rated.map((a) => a.score)) : null;
  const quality = avgScore === null ? 0.5 : clamp((avgScore - 3.5) / 1.3, 0, 1); // 3.5 → 0, 4.8 → 1
  const matches = list.filter((a) => titleMatches(keyword, a.title)).length;
  const titleDensity = matches / n;
  const fresh = list.filter((a) => { const d = daysSince(a.updated, now); return d !== null && d <= 180; }).length;
  const freshness = fresh / n;

  const difficulty = Math.round(100 * (
    0.30 * strength +
    0.15 * topStrength +
    0.15 * ratingsVol +
    0.15 * quality +
    0.15 * titleDensity +
    0.10 * freshness
  ));

  const weak = list.filter((a) => a.real < 100_000).length;
  const lowRated = list.filter((a) => Number.isFinite(a.score) && a.score < 4.0 && a.ratings >= 100).length;
  const stale = list.filter((a) => { const d = daysSince(a.updated, now); return d !== null && d > 365; }).length;
  const big = list.filter((a) => a.real >= 10_000_000).length;
  const sumInstalls = list.reduce((s, a) => s + (a.real || 0), 0);
  const medianInstalls = median(list.map((a) => a.real || 0));
  const market = Math.round(100 * clamp(log10p(sumInstalls) / 9, 0, 1)); // toplam 1 milyar → 100
  const ads = list.filter((a) => a.ads).length;
  const iap = list.filter((a) => a.iap).length;

  return {
    difficulty,
    market,
    comp: {
      n,
      titleMatches: matches,
      weak,
      lowRated,
      stale,
      big,
      ads,
      iap,
      avgScore: avgScore === null ? null : round(avgScore, 2),
      medianInstalls: Math.round(medianInstalls),
      sumInstalls: Math.round(sumInstalls)
    }
  };
}

/** Talep × (100 - zorluk) → fırsat. Zayıf rakipler küçük bonus verir. */
export function opportunityScore(demand, difficulty, comp = {}) {
  if (!Number.isFinite(demand) || !Number.isFinite(difficulty)) return null;
  const d = clamp(demand / 100, 0, 1);
  const e = clamp(1 - difficulty / 100, 0, 1);
  const base = Math.sqrt(d * e);
  const bonus = Math.min(0.15, 0.03 * (comp.weak || 0) + 0.02 * (comp.lowRated || 0) + 0.01 * (comp.stale || 0));
  return Math.round(100 * Math.min(1, base * (1 + bonus)));
}

export function verdict(opportunity, demand) {
  if (!Number.isFinite(demand) || demand <= 0) return 'talep-yok';
  if (!Number.isFinite(opportunity)) return 'eksik';
  if (opportunity >= 60) return 'guclu';
  if (opportunity >= 45) return 'iyi';
  if (opportunity >= 30) return 'orta';
  return 'zor';
}

export const VERDICT_LABELS = {
  guclu: 'Güçlü fırsat',
  iyi: 'İyi fırsat',
  orta: 'Orta',
  zor: 'Zor',
  eksik: 'Eksik veri',
  'talep-yok': 'Talep yok'
};
