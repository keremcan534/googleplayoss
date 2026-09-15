// Vercel fonksiyonları ve yerel sunucu için platformdan bağımsız küçük HTTP yardımcıları.
export function getQuery(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return Object.fromEntries(url.searchParams.entries());
}

export function sendJson(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (cacheSeconds > 0 && status === 200) {
    res.setHeader('Cache-Control', `public, s-maxage=${cacheSeconds}, max-age=60, stale-while-revalidate=86400`);
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(body));
}

export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }
  return false;
}

/** ?q=&gl=&hl= parametrelerini doğrular; hata varsa {error} döner. */
export function parseMarketQuery(q, opts = {}) {
  const { minLen = 1, maxLen = 60 } = opts;
  const term = String(q.q || q.term || '').trim();
  const country = String(q.gl || q.country || 'us').toLowerCase();
  const lang = String(q.hl || q.lang || 'en').toLowerCase();
  if (term.length < minLen || term.length > maxLen) return { error: `q parametresi ${minLen}-${maxLen} karakter olmalı` };
  if (!/^[a-z]{2}$/.test(country)) return { error: 'gl iki harfli ülke kodu olmalı (ör. us, tr)' };
  if (!/^[a-z]{2,3}(-[a-z]{2})?$/i.test(lang)) return { error: 'hl dil kodu olmalı (ör. en, tr)' };
  return { term, country, lang };
}

/** Basit bellek içi TTL önbelleği (ılık fonksiyon örneği içinde tekrar sorguları hızlandırır). */
export function memoryCache(maxEntries = 500) {
  const map = new Map();
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (Date.now() > e.exp) { map.delete(key); return undefined; }
      return e.value;
    },
    set(key, value, ttlMs) {
      if (map.size >= maxEntries) map.delete(map.keys().next().value);
      map.set(key, { value, exp: Date.now() + ttlMs });
    }
  };
}
