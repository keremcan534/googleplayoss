// Yayınlanan pazar dosyasına eklenen türetilmiş alanlar (tarayıcı ve yeniden puanlama ortak kullanır).
import { flagHintsFor } from './hints.js';
import { buildCohorts } from '../public/js/sim.js';

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
  return data;
}
