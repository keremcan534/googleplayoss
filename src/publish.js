// Yayınlanan pazar dosyasına eklenen türetilmiş alanlar (tarayıcı ve yeniden puanlama ortak kullanır).
import { flagHintsFor } from './hints.js';
import { buildCohorts } from '../public/js/sim.js';
import { buildFlagContext } from '../public/js/flags.js';
import { getOpportunityVerdict } from '../public/js/verdict.js';

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
  rememberVerdicts(data, now);
  return data;
}

/**
 * Kararlılık: her kelimenin bugünkü giriş bandını kaydeder (r.vprev). Arayüz ve bir sonraki tarama bunu
 * "dünkü sonuç" olarak kullanır: puan bant sınırına 3'ten yakınsa ya da ilk 10'dan uygulama eksildiyse
 * (veri boşluğu) dünkü bant korunur. Geri testte günlük sınıf değişimini %12-14'ten %1'in altına indirdi.
 */
export function rememberVerdicts(data, now = Date.now()) {
  const ctx = buildFlagContext(data, { now });
  const memo = new Map();
  ctx.verdictOf = (k) => {
    if (!memo.has(k)) { const rec = ctx.byK.get(k); memo.set(k, rec ? getOpportunityVerdict(rec, { now, ctx: { ...ctx, verdictOf: null } }).verdict : null); }
    return memo.get(k);
  };
  const today = new Date(now).toISOString().slice(0, 10);
  for (const r of data.keywords || []) {
    if (!(r.st === 'ok' || r.st === 'partial')) { delete r.vprev; continue; }
    const d = getOpportunityVerdict(r, { now, ctx, prev: r.vprev || null });
    if (d.axes && d.state === 'ok') r.vprev = { d: today, v: d.verdict, axes: { enter: { band: d.axes.enter.band, nApps: d.axes.enter.nApps, score: d.axes.enter.score } } };
    else delete r.vprev;
  }
}
