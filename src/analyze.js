// Tek bir anahtar kelimenin uçtan uca analizi.
// Hem 7/24 tarayıcı (önbellekli) hem de canlı API (önbelleksiz) bu fonksiyonu kullanır.
import { measureDemand, demandScore } from './demand.js';
import { scoreCompetition, opportunityScore, verdict } from './score.js';
import { pLimit } from './util.js';

/**
 * @param {string} keyword normalize edilmiş kelime
 * @param {object} deps
 * @param {(prefix:string)=>Promise<string[]>} deps.getSuggest  BudgetError fırlatabilir
 * @param {(term:string)=>Promise<Array>} deps.search           BudgetError fırlatabilir (yayılır)
 * @param {(id:string)=>Promise<object|null>} deps.getApp       BudgetError fırlatabilir (yutulur → eksik)
 * @param {number} [deps.topN=10]
 * @param {number|null} [deps.knownPrefix] kelimeyi tetiklediği bilinen ön ek uzunluğu
 * @param {object|null} [deps.skipDemand] taze talep ölçümü varsa {minPrefix,pos,len} — yeniden ölçülmez
 * @param {number} [deps.appConcurrency=2]
 */
export async function analyzeKeyword(keyword, deps) {
  const { getSuggest, search, getApp, topN = 10, knownPrefix = null, skipDemand = null, appConcurrency = 2 } = deps;
  const out = { k: keyword, status: 'ok', variants: [], variantsPrefixLen: null, skippedDemand: false };

  // 1) Talep (otomatik tamamlama)
  let pop;
  if (skipDemand && skipDemand.minPrefix) {
    pop = skipDemand;
    out.skippedDemand = true;
  } else {
    const m = await measureDemand(keyword, getSuggest, { knownPrefix });
    if (m.status === 'budget') return { ...out, status: 'budget' };
    out.variants = m.variants || [];
    out.variantsPrefixLen = m.variantsPrefixLen || null;
    if (m.status === 'none') {
      return { ...out, status: 'no-demand', demand: 0, pop: null };
    }
    pop = { minPrefix: m.minPrefix, pos: m.pos, len: m.len };
    if (m.status === 'ok-partial') out.demandPartial = true;
  }
  out.pop = pop;
  out.demand = demandScore(pop);

  // 2) Arama sonuçları (rakipler)
  const results = await search(keyword);
  out.results = results;
  out.titles = results.map((r) => r.title);

  // 3) İlk N uygulamanın detayları
  const top = results.slice(0, topN);
  const limit = pLimit(appConcurrency);
  const apps = await Promise.all(top.map((r) => limit(async () => {
    try {
      return await getApp(r.id);
    } catch (err) {
      if (err && err.budget) return null;
      throw err;
    }
  })));
  out.apps = apps;
  const present = apps.filter(Boolean);
  const { difficulty, market, comp } = scoreCompetition(keyword, present, { topN });
  out.difficulty = difficulty;
  out.market = market;
  out.comp = comp;
  out.opportunity = opportunityScore(out.demand, difficulty, comp);
  out.verdict = verdict(out.opportunity, out.demand);
  out.top = top.map((r) => r.id);
  out.partial = present.length < Math.min(topN, top.length) || present.length === 0;
  return out;
}
