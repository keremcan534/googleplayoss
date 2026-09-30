// GET /api/listing?id=com.example.game&gl=us&hl=en → yayındaki uygulamanın mağaza meta verisi
// "Mevcut projeyi içe aktar" akışı için: başlık, kısa/uzun açıklama, kategori ve olgular (reklam, satın alma).
import gplay from 'google-play-scraper';
import { getQuery, sendJson, handleOptions, memoryCache } from '../src/http.js';

const cache = memoryCache(300);
const PKG = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;

export function packageFrom(input) {
  const s = String(input || '').trim();
  const m = s.match(/[?&]id=([\w.]+)/);
  const id = m ? m[1] : s;
  return PKG.test(id) && id.length <= 150 ? id : null;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const q = getQuery(req);
  const id = packageFrom(q.id);
  const gl = String(q.gl || 'us').toLowerCase();
  const hl = String(q.hl || 'en').toLowerCase();
  if (!id) return sendJson(res, 400, { ok: false, error: 'id paket adı ya da Play bağlantısı olmalı (ör. com.firma.oyun)' });
  if (!/^[a-z]{2}$/.test(gl) || !/^[a-z]{2,3}(-[a-z]{2})?$/i.test(hl)) return sendJson(res, 400, { ok: false, error: 'gl/hl geçersiz' });
  const key = `${gl}:${hl}:${id}`;
  const hit = cache.get(key);
  if (hit) return sendJson(res, 200, { ok: true, cached: true, listing: hit }, 21600);
  try {
    const a = await gplay.app({ appId: id, lang: hl, country: gl });
    const listing = {
      id: a.appId, title: a.title || '', short: a.summary || '', full: a.description || '',
      genreId: a.genreId || null, developer: a.developer || '', developerEmail: a.developerEmail || null,
      privacyPolicy: a.privacyPolicy || null, version: a.version || null, installs: a.maxInstalls || a.minInstalls || 0,
      score: Number.isFinite(a.score) ? Math.round(a.score * 100) / 100 : null, ratings: a.ratings || 0,
      adSupported: typeof a.adSupported === 'boolean' ? a.adSupported : null, offersIAP: typeof a.offersIAP === 'boolean' ? a.offersIAP : null,
      video: a.video || null, released: a.released || null, updated: a.updated ? new Date(a.updated).toISOString() : null,
      country: gl, lang: hl
    };
    cache.set(key, listing, 6 * 3600 * 1000);
    sendJson(res, 200, { ok: true, listing }, 21600);
  } catch (err) {
    const notFound = err && (err.status === 404 || /404|not found/i.test(err.message || ''));
    sendJson(res, notFound ? 404 : 502, { ok: false, error: notFound ? 'Bu paket adıyla bu pazarda yayında uygulama bulunamadı.' : `Play Store yanıt vermedi: ${err.message}` });
  }
}
