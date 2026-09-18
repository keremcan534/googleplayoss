// Anahtar kelimeleri "niş"lere gruplar: ortak kelime (ör. "offline", "kids", "tracker") veya tohum.
import { tokens, mean, round, langOf } from './util.js';

function groupScore(opps, count) {
  const top = opps.slice().sort((a, b) => b - a).slice(0, 5);
  return Math.round(mean(top) * Math.min(2, 1 + Math.log10(Math.max(1, count))));
}

/**
 * @param {Array} keywords analiz edilmiş kayıtlar ({k, demand, difficulty, opportunity, seed})
 * @param {{minCount?:number, max?:number}} opts
 */
export function buildNiches(keywords, opts = {}) {
  const { minCount = 3, max = 250, lang = 'en' } = opts;
  const L = langOf(lang);
  const usable = keywords.filter((r) => r && r.demand > 0 && Number.isFinite(r.opportunity));
  const byToken = new Map();
  const bySeed = new Map();
  const surfaceOf = new Map(); // kök → { yüzey biçimi: sayı }

  for (const r of usable) {
    const seen = new Set();
    for (const raw of tokens(r.k, L.code)) {
      const t = L.stem(raw);
      if (L.stopwords.has(raw) || L.stopwords.has(t) || t.length < 3 || /^\d+$/.test(t) || seen.has(t)) continue;
      seen.add(t);
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(r);
      if (!surfaceOf.has(t)) surfaceOf.set(t, new Map());
      const sm = surfaceOf.get(t);
      sm.set(raw, (sm.get(raw) || 0) + 1);
    }
    if (r.seed && r.seed !== r.k) {
      if (!bySeed.has(r.seed)) bySeed.set(r.seed, []);
      bySeed.get(r.seed).push(r);
    }
  }

  const out = [];
  const push = (name, type, members, surfaces) => {
    if (members.length < minCount) return;
    // Kök ("hesaplam") kullanıcıya gösterilmez; grubun en sık geçen gerçek yazımı ("hesaplama") gösterilir.
    let label = name;
    if (surfaces && surfaces.size) {
      let best = -1;
      for (const [word, n] of surfaces) {
        if (n > best || (n === best && word.length < label.length)) { best = n; label = word; }
      }
    }
    const sorted = members.slice().sort((a, b) => b.opportunity - a.opportunity);
    const opps = sorted.map((m) => m.opportunity);
    out.push({
      name,
      label,
      type,
      count: members.length,
      score: groupScore(opps, members.length),
      avgOpportunity: round(mean(opps), 1),
      maxOpportunity: Math.max(...opps),
      avgDemand: round(mean(members.map((m) => m.demand)), 1),
      avgDifficulty: round(mean(members.map((m) => m.difficulty)), 1),
      keywords: sorted.slice(0, 12).map((m) => m.k)
    });
  };
  for (const [t, members] of byToken) push(t, 'token', members, surfaceOf.get(t));
  for (const [s, members] of bySeed) push(s, 'seed', members, null);

  out.sort((a, b) => b.score - a.score || b.count - a.count);
  return out.slice(0, max);
}
