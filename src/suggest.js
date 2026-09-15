// Play Store otomatik tamamlama — google-play-scraper'ın kullandığı uç noktanın dayanıklı sürümü.
// (Kütüphane, hiç öneri dönmeyen ön eklerde null.map hatası veriyor; burada boş liste dönüyoruz.)

const ENDPOINT = 'https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=IJ4APc&f.sid=-697906427155521722&bl=boq_playuiserver_20190903.08_p0&authuser&soc-app=121&soc-platform=1&soc-device=1&_reqid=1065213';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * @param {string} term ön ek
 * @param {{lang?:string, country?:string}} opts
 * @returns {Promise<string[]>} öneriler (ham metin, sırayla)
 */
export async function fetchSuggest(term, opts = {}) {
  const { lang = 'en', country = 'us' } = opts;
  const url = `${ENDPOINT}&hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(country)}`;
  const inner = JSON.stringify([[null, [term], [10], [2], 4]]);
  const body = `f.req=${encodeURIComponent(JSON.stringify([[['IJ4APc', inner]]]))}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body
  });
  if (!res.ok) {
    const err = new Error(`suggest HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return parseSuggestResponse(text);
}

/** batchexecute yanıtını çözer; beklenmedik biçimde boş liste döner. */
export function parseSuggestResponse(text) {
  const start = text.indexOf('[');
  if (start < 0) return [];
  let outer;
  try {
    outer = JSON.parse(text.slice(start));
  } catch {
    return [];
  }
  const frame = Array.isArray(outer) ? outer.find((x) => Array.isArray(x) && x[0] === 'wrb.fr' && x[1] === 'IJ4APc') : null;
  if (!frame || typeof frame[2] !== 'string') return [];
  let data;
  try {
    data = JSON.parse(frame[2]);
  } catch {
    return [];
  }
  const list = data && Array.isArray(data[0]) ? data[0][0] : null;
  if (!Array.isArray(list)) return [];
  return list.map((s) => (Array.isArray(s) ? s[0] : null)).filter((t) => typeof t === 'string' && t.trim());
}
