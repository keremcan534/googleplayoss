// Fabrika sonuçları → etiket → keşif skoru ağırlıkları (geri besleme döngüsü). Saf fonksiyonlar.
//
// Fabrika her uygulama için Play Console'dan (ilk 28 gün) gösterim, ziyaretçi, yükleme dokunuşu ve edinme sayısını,
// rank izleyicisinden de arama sıralarını gönderir. Kurallar Fabrika'nın 2026-10-20 isteğinden:
//   başarılı = 28 günde edinme ≥ 20 · zayıf = 28 günde gösterim < 50 · arada kalan = orta (uyuma girmez)
//   uygulamanın KENDİ adıyla yapılan aramadaki sıra başarı sayılmaz (marka araması, trafik getirmez)
//   en az 20 etiketli uygulama (her sınıftan en az 4) olmadan ağırlık değişmez.
import { tokensFor, normalizeFor } from '../public/js/lang.js';
import { SIGNALS, PRIOR_WEIGHTS } from '../public/js/discovery.js';

const DAY = 86400000;
export const LABEL_RULES = Object.freeze({ windowDays: 28, successAcquisitions: 20, weakImpressions: 50 });
export const FIT = Object.freeze({ minLabels: 20, minPerClass: 4, shrink: 40 });

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Bir uygulamanın etiketi. Başarı edinme biriktikçe kesinleşir; "zayıf" ve "orta" ancak 28 günlük pencere
 * dolunca kesinleşir (yoksa 'pending', eğilim lean'de).
 * @param {{published:string, asOf?:string, impressions?:number, acquisitions?:number}} o
 * @returns {{label:'success'|'weak'|'mid'|'pending', final:boolean, days:number|null, lean?:string, why:string}}
 */
export function labelOutcome(o, now = Date.now(), R = LABEL_RULES) {
  const pub = Date.parse((o && o.published) || '');
  const asOf = Date.parse((o && o.asOf) || '') || now;
  const days = Number.isFinite(pub) ? Math.floor((asOf - pub) / DAY) : null;
  const acq = num(o && o.acquisitions);
  const imp = num(o && o.impressions);
  if (acq !== null && acq >= R.successAcquisitions) return { label: 'success', final: true, days, why: `${acq} edinme ≥ ${R.successAcquisitions}` };
  if (imp === null) return { label: 'pending', final: false, days, why: 'veri yok' };
  const complete = days !== null && days >= R.windowDays;
  const lean = imp < R.weakImpressions ? 'weak' : 'mid';
  const why = lean === 'weak' ? `${imp} gösterim < ${R.weakImpressions}` : `${imp} gösterim, ${acq ?? 0} edinme`;
  if (complete) return { label: lean, final: true, days, why };
  return { label: 'pending', final: false, days, lean, why: `${why}; ${days ?? '?'}/${R.windowDays} gün` };
}

/**
 * Sorgu uygulamanın kendi adı mı? Ad = brand alanı, yoksa başlığın ":", "-", "|" öncesi. Sorgu adın bütün
 * kelimelerini içeriyorsa (ya da başlığın kendisiyse) marka aramasıdır.
 * "Gem Art: Color by Number" → "gem art", "gem art color" kendi adı; "color by number" değil.
 */
export function isOwnTitleQuery(query, o, lang = 'en') {
  const title = (o && o.title) || (o && o.name) || '';
  const brand = (o && o.brand) || title.split(/\s[-–—|]\s|[:|]/)[0];
  const q = tokensFor(query, lang);
  const b = tokensFor(brand, lang);
  if (!q.length) return false;
  if (normalizeFor(query, lang) === normalizeFor(title, lang)) return true;
  return b.length > 0 && b.every((t) => q.includes(t));
}

/** Marka araması dışındaki sıralar ve en iyisi (bilgi amaçlı; etiket edinme ve gösterimden gelir). */
export function genericRanks(o, lang = 'en') {
  const list = ((o && o.ranks) || []).filter((x) => x && x.q && !isOwnTitleQuery(x.q, o, lang));
  const pos = list.map((x) => num(x.pos)).filter((p) => p !== null && p > 0);
  return { ranks: list, best: pos.length ? Math.min(...pos) : null, own: ((o && o.ranks) || []).length - list.length };
}

/** Mann-Whitney AUC: başarılıların skoru zayıflardan yüksek olma olasılığı (eşitlik yarım). Veri yoksa null. */
export function auc(pos, neg) {
  const P = (pos || []).filter(Number.isFinite), N = (neg || []).filter(Number.isFinite);
  if (!P.length || !N.length) return null;
  let s = 0;
  for (const p of P) for (const n of N) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (P.length * N.length);
}

/**
 * Ağırlık önerisi. Kapı kapalıysa öncül döner. Açıksa her sinyalin ayırma gücü (AUC − 0,5, negatifse 0) veri
 * ağırlığıdır ve öncüle doğru büzülür: w = (1 − λ)·öncül + λ·veri, λ = n / (n + 40). 20 uygulamada λ ≈ 0,33:
 * veri ağırlıkları ancak üçte bir oranında yansır; tek bir şanslı uygulama ağırlıkları devirmez.
 * @param {Array<{label:string, signals:object, score?:number}>} rows yalnızca kesinleşmiş success / weak satırları kullanılır
 */
export function proposeWeights(rows, prior = PRIOR_WEIGHTS, cfg = {}) {
  const F = { ...FIT, ...cfg };
  const pos = rows.filter((r) => r.label === 'success');
  const neg = rows.filter((r) => r.label === 'weak');
  const n = pos.length + neg.length;
  const aucs = Object.fromEntries(SIGNALS.map((s) => [s, auc(pos.map((r) => r.signals[s]), neg.map((r) => r.signals[s]))]));
  const scoreAuc = auc(pos.map((r) => r.score), neg.map((r) => r.score));
  const missing = [];
  if (n < F.minLabels) missing.push(`${F.minLabels - n} etiket daha`);
  if (pos.length < F.minPerClass) missing.push(`${F.minPerClass - pos.length} başarılı daha`);
  if (neg.length < F.minPerClass) missing.push(`${F.minPerClass - neg.length} zayıf daha`);
  const base = { n, success: pos.length, weak: neg.length, aucs, scoreAuc };
  if (missing.length) return { ...base, open: false, reason: `Kapı kapalı: ${missing.join(', ')} gerekiyor.`, weights: { ...prior } };
  const raw = Object.fromEntries(SIGNALS.map((s) => [s, Math.max(0, (aucs[s] ?? 0.5) - 0.5)]));
  const rawSum = SIGNALS.reduce((t, s) => t + raw[s], 0);
  if (!(rawSum > 0)) return { ...base, open: true, reason: 'Hiçbir sinyal başarılıları zayıflardan ayırmıyor: öncül korundu.', weights: { ...prior } };
  const lambda = n / (n + F.shrink);
  const w = Object.fromEntries(SIGNALS.map((s) => [s, (1 - lambda) * prior[s] + lambda * (raw[s] / rawSum)]));
  return { ...base, open: true, lambda: Math.round(lambda * 100) / 100, reason: `${n} etiketli uygulama, λ = ${lambda.toFixed(2)}.`, weights: roundWeights(w) };
}

/** İki basamağa yuvarlar, toplamı tam 1 yapar (fark en büyük ağırlığa). */
export function roundWeights(w) {
  const out = Object.fromEntries(SIGNALS.map((s) => [s, Math.round(w[s] * 100) / 100]));
  const diff = Math.round((1 - SIGNALS.reduce((t, s) => t + out[s], 0)) * 100) / 100;
  if (diff) { const top = SIGNALS.slice().sort((a, b) => out[b] - out[a])[0]; out[top] = Math.round((out[top] + diff) * 100) / 100; }
  return out;
}

/** Fabrika'nın seçtiği andaki ilk 10 (ileriye dönük kayıttan): seçim tarihinde ya da öncesindeki en son ölçüm. */
export function serpAt(historyRows, k, date) {
  if (!date) return null;
  let best = null;
  for (const row of historyRows || []) if (row && row.d <= date && row.serp && Array.isArray(row.serp[k]) && (!best || row.d >= best.d)) best = row;
  return best ? { d: best.d, top: best.serp[k] } : null;
}
