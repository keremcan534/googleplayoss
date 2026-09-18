// google-play-scraper üzerine ince bir katman: hız sınırı, yeniden deneme, istek bütçesi.
import gplay from 'google-play-scraper';
import { fetchSuggest } from './suggest.js';
import { sleep, pLimit, normalize, toISODate, round } from './util.js';

export class BudgetError extends Error {
  constructor(kind) {
    super(`Bütçe doldu: ${kind}`);
    this.kind = kind;
    this.budget = true;
  }
}

const BACKOFF_MS = [1500, 4000, 10000];

/**
 * createStore({ country, lang, throttleMs, concurrency, budget, log })
 * Dönen nesne: suggest(term), search(term, num), app(appId), list(collection, category, num)
 * Her çağrı bütçeden düşer; bütçe bitince BudgetError fırlatır.
 */
export function createStore(opts = {}) {
  const {
    country = 'us',
    lang = 'en',
    throttleMs = 350,
    concurrency = 2,
    maxRetries = 3,
    maxConsecutiveFailures = 8,
    budget = {},
    log = () => {}
  } = opts;

  const used = { suggest: 0, search: 0, app: 0, list: 0 };
  const caps = { suggest: Infinity, search: Infinity, app: Infinity, list: Infinity, ...budget };
  const state = { used, caps, aborted: false, failures: 0, errors: 0 };
  const limit = pLimit(concurrency);

  function hasBudget(kind) {
    return !state.aborted && used[kind] < caps[kind];
  }

  async function call(kind, label, fn) {
    if (state.aborted) throw new BudgetError('aborted');
    if (used[kind] >= caps[kind]) throw new BudgetError(kind);
    used[kind]++;
    return limit(async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const result = await fn();
            state.failures = 0;
            return result;
          } catch (err) {
            if (err && err.status === 404) throw err; // kalıcı: uygulama yok
            if (attempt >= maxRetries) {
              state.failures++;
              state.errors++;
              if (state.failures >= maxConsecutiveFailures) {
                state.aborted = true;
                log(`!! ${state.failures} ardışık hata, tarama durduruluyor (${label}): ${err.message}`);
              }
              throw err;
            }
            const wait = BACKOFF_MS[attempt] + Math.random() * 500;
            log(`.. yeniden deneme ${attempt + 1}/${maxRetries} (${label}) ${err.status || ''} ${err.message} — ${Math.round(wait)}ms`);
            await sleep(wait);
          }
        }
      } finally {
        await sleep(throttleMs);
      }
    });
  }

  return {
    state,
    country,
    lang,
    hasBudget,
    suggest: (term) => call('suggest', `suggest:${term}`, async () => {
      const arr = await fetchSuggest(term, { lang, country });
      return arr.map((x) => normalize(x, lang)).filter(Boolean);
    }),
    search: (term, num = 20) => call('search', `search:${term}`, async () => {
      const arr = await gplay.search({ term, num, lang, country });
      return (arr || []).map(compactResult);
    }),
    app: (appId) => call('app', `app:${appId}`, async () => {
      try {
        const a = await gplay.app({ appId, lang, country });
        return compactApp(a);
      } catch (err) {
        if (err && err.status === 404) return { id: appId, missing: true, fetched: Date.now() };
        throw err;
      }
    }),
    list: (collection, category, num = 50) => call('list', `list:${category}`, async () => {
      const arr = await gplay.list({ collection, category, num, lang, country });
      return (arr || []).map(compactResult);
    })
  };
}

export const collections = gplay.collection;
export const categories = gplay.category;

/** Arama/liste sonucundan sadece ihtiyacımız olan alanlar. */
export function compactResult(r) {
  return {
    id: r.appId,
    title: r.title || '',
    dev: r.developer || '',
    score: Number.isFinite(r.score) ? round(r.score, 2) : null,
    free: r.free !== false
  };
}

/** Detay sayfasından kompakt uygulama kaydı (önbellekte tutulan hali). */
export function compactApp(a) {
  return {
    id: a.appId,
    title: a.title || '',
    dev: a.developer || '',
    genre: a.genreId || a.genre || null,
    installs: a.minInstalls || 0,
    real: a.maxInstalls || a.minInstalls || 0,
    score: Number.isFinite(a.score) ? round(a.score, 2) : null,
    ratings: a.ratings || 0,
    reviews: a.reviews || 0,
    released: toISODate(a.released),
    updated: toISODate(a.updated),
    ads: !!a.adSupported,
    iap: !!a.offersIAP,
    free: a.free !== false,
    price: a.price || 0,
    fetched: Date.now()
  };
}
