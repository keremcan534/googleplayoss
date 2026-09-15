// GET /api/suggest?q=offline%20g&gl=us&hl=en → Play Store otomatik tamamlama önerileri
import { createStore } from '../src/store.js';
import { getQuery, sendJson, handleOptions, parseMarketQuery, memoryCache } from '../src/http.js';

const cache = memoryCache(1000);

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseMarketQuery(getQuery(req));
  if (q.error) return sendJson(res, 400, { ok: false, error: q.error });
  const key = `${q.country}:${q.lang}:${q.term}`;
  const hit = cache.get(key);
  if (hit) return sendJson(res, 200, { ok: true, cached: true, ...hit }, 3600);
  try {
    const store = createStore({ country: q.country, lang: q.lang, throttleMs: 0, concurrency: 4, budget: { suggest: 1 } });
    const suggestions = await store.suggest(q.term);
    const body = { term: q.term, country: q.country, lang: q.lang, suggestions };
    cache.set(key, body, 6 * 3600 * 1000);
    sendJson(res, 200, { ok: true, ...body }, 3600);
  } catch (err) {
    sendJson(res, 502, { ok: false, error: `Play Store yanıt vermedi: ${err.message}` });
  }
}
