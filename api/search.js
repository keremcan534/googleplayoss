// GET /api/search?q=offline%20games&gl=us&hl=en&num=20 → arama sonuçları (ilk sayfa)
import { createStore } from '../src/store.js';
import { getQuery, sendJson, handleOptions, parseMarketQuery, memoryCache } from '../src/http.js';

const cache = memoryCache(500);

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const raw = getQuery(req);
  const q = parseMarketQuery(raw, { minLen: 2 });
  if (q.error) return sendJson(res, 400, { ok: false, error: q.error });
  const num = Math.min(30, Math.max(5, Number(raw.num) || 20));
  const key = `${q.country}:${q.lang}:${num}:${q.term}`;
  const hit = cache.get(key);
  if (hit) return sendJson(res, 200, { ok: true, cached: true, ...hit }, 3600);
  try {
    const store = createStore({ country: q.country, lang: q.lang, throttleMs: 0, concurrency: 4, budget: { search: 1 } });
    const results = await store.search(q.term, num);
    const body = { term: q.term, country: q.country, lang: q.lang, results };
    cache.set(key, body, 6 * 3600 * 1000);
    sendJson(res, 200, { ok: true, ...body }, 3600);
  } catch (err) {
    sendJson(res, 502, { ok: false, error: `Play Store yanıt vermedi: ${err.message}` });
  }
}
