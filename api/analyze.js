// GET /api/analyze?q=offline%20rpg&gl=us&hl=en → tek kelime için canlı talep + rekabet + fırsat analizi
import { createStore } from '../src/store.js';
import { analyzeKeyword } from '../src/analyze.js';
import { normalize } from '../src/util.js';
import { getQuery, sendJson, handleOptions, parseMarketQuery, memoryCache } from '../src/http.js';

const cache = memoryCache(300);
const TOP_N = 10;

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseMarketQuery(getQuery(req), { minLen: 2 });
  if (q.error) return sendJson(res, 400, { ok: false, error: q.error });
  const keyword = normalize(q.term);
  if (!keyword) return sendJson(res, 400, { ok: false, error: 'Geçersiz kelime' });
  const key = `${q.country}:${q.lang}:${keyword}`;
  const hit = cache.get(key);
  if (hit) return sendJson(res, 200, { ok: true, cached: true, result: hit }, 21600);

  const store = createStore({
    country: q.country,
    lang: q.lang,
    throttleMs: 40,
    concurrency: 5,
    maxRetries: 1,
    budget: { suggest: 14, search: 1, app: TOP_N }
  });
  try {
    const res0 = await analyzeKeyword(keyword, {
      getSuggest: (p) => store.suggest(p),
      search: (t) => store.search(t, 20),
      getApp: async (id) => {
        const a = await store.app(id);
        return a && !a.missing ? a : null;
      },
      topN: TOP_N,
      appConcurrency: 5
    });
    const result = {
      k: keyword,
      country: q.country,
      lang: q.lang,
      status: res0.status,
      demand: res0.demand ?? 0,
      pop: res0.pop || null,
      difficulty: res0.difficulty ?? null,
      market: res0.market ?? null,
      opportunity: res0.opportunity ?? null,
      verdict: res0.verdict || (res0.status === 'no-demand' ? 'talep-yok' : 'eksik'),
      comp: res0.comp || null,
      variants: res0.variants || [],
      results: (res0.results || []).slice(0, 20),
      apps: (res0.apps || []).filter(Boolean),
      partial: !!res0.partial,
      analyzedAt: new Date().toISOString()
    };
    cache.set(key, result, 6 * 3600 * 1000);
    sendJson(res, 200, { ok: true, result }, 21600);
  } catch (err) {
    sendJson(res, 502, { ok: false, error: `Analiz başarısız: ${err.message}` });
  }
}
