// Yayınlanan pazar dosyasına eklenen türetilmiş alanlar (tarayıcı ve yeniden puanlama ortak kullanır).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagHintsFor } from './hints.js';
import { buildCohorts } from '../public/js/sim.js';
import { buildFlagContext } from '../public/js/flags.js';
import { getOpportunityVerdict } from '../public/js/verdict.js';
import { discoveryScore, compactDiscovery, normWeights, MODEL_VERSION } from '../public/js/discovery.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DISCOVERY_CONFIG = path.join(ROOT, 'config', 'discovery.json');

/**
 * Yayınlanan dosyaya giren kompakt uygulama kaydı (tarayıcı ve yeniden puanlama aynı alanları yazar).
 * rv = data/<pazar>/reviews.json kaydı: varsa şikâyet özeti cx olarak eklenir (rakip boşluğu sinyali).
 */
export function publicApp(a, rv = null) {
  const out = {
    id: a.id, title: a.title, dev: a.dev, genre: a.genre, installs: a.installs, real: a.real,
    score: a.score, ratings: a.ratings, released: a.released, updated: a.updated,
    ads: a.ads, iap: a.iap, free: a.free, price: a.price
  };
  if (rv && rv.n) out.cx = { n: rv.n, any: rv.any, ads: rv.ads, pay: rv.pay, content: rv.content };
  return out;
}

/** config/discovery.json (yoksa öncül). Bozuk dosya taramayı durdurmaz: öncüle döner. */
export function readDiscoveryConfig(p = DISCOVERY_CONFIG) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

/**
 * @param {string} marketId 'us-en' | 'tr-tr'
 * @param {object} data yayınlanacak veri seti (yerinde güncellenir)
 * @param {string} publicDir public/data dizini (diğer pazarın dosyası için)
 */
export function decorate(marketId, data, publicDir, now = Date.now()) {
  const hints = flagHintsFor(marketId, data, publicDir);
  if (hints) data.flagHints = hints; else delete data.flagHints;
  // simülasyon kohortları: tür × eski rakip orta sırası, yeni uygulama hızları (uygulama başına bir kez)
  data.simCohorts = buildCohorts(data, now);
  const decisions = rememberVerdicts(data, now);
  annotateDiscovery(marketId, data, decisions, readDiscoveryConfig());
  return data;
}

/**
 * Keşif skoru (public/js/discovery.js, HİPOTEZ): her kelimeye kısa biçimde r.disc yazılır ve kullanılan model
 * (ağırlıklar, elle girilmiş görsel / yapılabilirlik değerleri, etiket durumu) data.discoveryModel olarak eklenir.
 * Arayüz aynı modülle yeniden hesaplar; r.disc dosyayı doğrudan okuyan araçlar (Fabrika) içindir.
 */
export function annotateDiscovery(marketId, data, decisions, cfg = {}) {
  const lang = (data.market && data.market.lang) || marketId.split('-')[1] || 'en';
  const model = {
    version: cfg.version || MODEL_VERSION,
    weights: normWeights(cfg.weights),
    weightsSource: cfg.weightsSource || 'öncül (kalibre edilmedi)',
    calibration: cfg.calibration || null,
    visual: (cfg.visual && cfg.visual[marketId]) || {},
    feasibility: (cfg.feasibility && cfg.feasibility[marketId]) || {}
  };
  data.discoveryModel = model;
  const byK = new Map((data.keywords || []).map((r) => [r.k, r]));
  for (const r of data.keywords || []) {
    const decision = decisions.get(r.k);
    const res = decision ? discoveryScore(r, data.apps, { decision, seed: r.seed ? byK.get(r.seed) : null, model, lang }) : null;
    if (res) r.disc = compactDiscovery(res); else delete r.disc;
  }
}

/**
 * Kararlılık: her kelimenin bugünkü giriş bandını kaydeder (r.vprev). Arayüz ve bir sonraki tarama bunu
 * "dünkü sonuç" olarak kullanır: puan bant sınırına 3'ten yakınsa ya da ilk 10'dan uygulama eksildiyse
 * (veri boşluğu) dünkü bant korunur. Geri testte günlük sınıf değişimini %12-14'ten %1'in altına indirdi.
 * @returns {Map<string, object>} kelime → bugünkü karar (keşif skoru aynı kararı kullanır)
 */
export function rememberVerdicts(data, now = Date.now()) {
  const ctx = buildFlagContext(data, { now });
  const memo = new Map();
  ctx.verdictOf = (k) => {
    if (!memo.has(k)) { const rec = ctx.byK.get(k); memo.set(k, rec ? getOpportunityVerdict(rec, { now, ctx: { ...ctx, verdictOf: null } }).verdict : null); }
    return memo.get(k);
  };
  const today = new Date(now).toISOString().slice(0, 10);
  const decisions = new Map();
  for (const r of data.keywords || []) {
    if (!(r.st === 'ok' || r.st === 'partial')) { delete r.vprev; continue; }
    const d = getOpportunityVerdict(r, { now, ctx, prev: r.vprev || null });
    decisions.set(r.k, d);
    if (d.axes && d.state === 'ok') r.vprev = { d: today, v: d.verdict, axes: { enter: { band: d.axes.enter.band, nApps: d.axes.enter.nApps, score: d.axes.enter.score } } };
    else delete r.vprev;
  }
  return decisions;
}
