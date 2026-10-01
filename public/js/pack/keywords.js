/*
 * Konumlandırma: analiz edilmiş aday kelimelerden birincil kelime, ikincil küme ve
 * rakip konumlandırması çıkarır. Mevcut fırsat/rekabet sistemi (verdict.js) aynen kullanılır;
 * üstüne "ürünle uyum" kapısı eklenir:
 *   birincil — kelimenin her parçası üründe karşılık bulmalı (uyum = 1)
 *   ikincil  — uyum ≥ 0.67, karşılıksız iddia yok
 *   her ikisi — marka adı yok, talep var, SKIP değil
 */
import { getOpportunityVerdict } from '../verdict.js';
import { keywordRelevance } from './product.js';
import { CONCEPTS } from './lexicon.js';
import { normalizeFor, langOf } from '../lang.js';

export const PRIMARY_MIN_REL = 1;
export const SECONDARY_MIN_REL = 1;
/** Kısmi uyum: gösterilir ama mağaza metinlerinde kullanılmaz. */
export const PARTIAL_MIN_REL = 0.67;
const VERDICT_RANK = { GOLD: 5, BUILD: 4, WATCH: 3, WEAK: 2, SKIP: 0, PENDING: 0 };
const OVERLAP = 0.6;

/** Aday kaydını (veri seti ya da canlı analiz) karar ve uyumla zenginleştirir. */
export function evaluateCandidate(record, analysis, meta = {}) {
  const analyzed = !!record && ['ok', 'partial', 'no-demand'].includes(record.st);
  const appsMap = meta.appsMap || (meta.apps && meta.apps.length ? Object.fromEntries(meta.apps.filter(Boolean).map((a) => [a.id, a])) : null);
  const decision = analyzed ? getOpportunityVerdict(record, { ctx: meta.ctx || null, appsMap: appsMap || undefined }) : null;
  const rel = keywordRelevance(record ? record.k : meta.k, analysis);
  return {
    k: record ? record.k : meta.k,
    source: meta.source || 'autocomplete',
    from: meta.from || null,
    analyzed,
    st: record ? record.st : 'pending',
    demand: record ? record.demand ?? null : null,
    difficulty: record ? record.difficulty ?? null : null,
    opportunity: record ? record.opportunity ?? null : null,
    market: record ? record.market ?? null : null,
    comp: record ? record.comp || null : null,
    pop: record ? record.pop || null : null,
    top: record ? record.top || [] : [],
    apps: meta.apps || null,
    verdict: decision ? decision.verdict : 'PENDING',
    reason: decision ? decision.reason : 'Henüz analiz edilmedi.',
    reach: decision && decision.reach && decision.reach.has ? decision.reach.score : null,
    enter: decision && decision.axes ? decision.axes.enter.score : null,
    payoff: decision && decision.axes ? decision.axes.payoff.level : null,
    rel,
    lang: analysis.lang
  };
}

/** Kelime, ilk 3'teki büyük bir rakibin adıysa (navigasyonel arama) o uygulamanın başlığı. */
export function navigationalApp(c) {
  const lang = c.lang || 'en';
  const k = normalizeFor(c.k, lang);
  if (k.split(' ').length < 3) return null;
  for (const a of (c.apps || []).slice(0, 3)) {
    if (!a || !a.title || (a.real || a.installs || 0) < 1e7) continue;
    const full = normalizeFor(a.title, lang);
    const head = normalizeFor(String(a.title).split(/\s[:\-–|]\s|:\s|\s-\s/)[0], lang);
    if (full === k || head === k) return a.title;
  }
  return null;
}

/**
 * Sıralama puanı: karar sınıfı önce, sonra girebilirlik (geri testte yeni girenlerin başarısını sıralayan tek ölçü),
 * sonra küçük ağırlıkla fırsat ve talep (talep arama hacmi değildir; yalnızca eşitlik bozucu).
 */
export function positionScore(c) {
  const enter = Number.isFinite(c.enter) ? c.enter : 30;
  return VERDICT_RANK[c.verdict] * 100 + 0.6 * enter + 0.2 * (c.opportunity || 0) + 0.2 * (c.demand || 0);
}

function overlap(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);
  if (A.size < 5 || B.size < 5) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

export const hasYear = (rel) => (rel.units || []).some((u) => /^(19|20)\d\d$/.test(u.token));

/** Aday neden dışlandı? null → uygun. */
export function exclusionReason(c, minRel) {
  if (c.rel.trademark) return `Marka adı ("${c.rel.trademark}"): Play meta veri politikası başka markaların adını anahtar kelime olarak kullanmayı yasaklar.`;
  if (hasYear(c.rel)) return 'Yıl içeriyor: oyunun o yılın sürümü olduğunu ima eder, ürünle ilgisi yok.';
  const nav = navigationalApp(c);
  if (nav) return `Rakip uygulamanın adı ("${nav}"): bu aramayı yapan o uygulamayı arıyor.`;
  if (c.rel.intentMismatch) return `Arama niyeti farklı: ${c.rel.intent === 'app' ? 'kelime uygulama arıyor, ürün bir oyun' : 'kelime oyun arıyor, ürün bir uygulama'}.`;
  if (c.rel.offSubject && c.rel.offSubject.length) return `Başka bir ürünün konusu: ${c.rel.offSubject.map((t) => `"${t}"`).join(', ')}.`;
  if (!c.rel.anchored) return 'Ürünün çekirdeğine dayanmıyor: yalnızca yan bir özellik eşleşiyor.';
  if (c.rel.unsupportedClaims.length) return `Karşılıksız iddia: ${c.rel.unsupportedClaims.join(', ')}. Ürün bunu yapmıyorsa bu kelimeyle konumlanmak yanıltıcı olur.`;
  if (!c.analyzed) return 'Talep ve rekabeti ölçülmedi.';
  if (c.st === 'no-demand' || !(c.demand > 0)) return 'Otomatik tamamlamada talep kanıtı yok.';
  if (c.verdict === 'SKIP') return `Karar SKIP: ${c.reason}`;
  if (c.rel.score < minRel) return `Ürünle uyum düşük (${Math.round(c.rel.score * 100)}%): ${c.rel.reasons.join('; ')}`;
  return null;
}

/**
 * @param {Array} candidates evaluateCandidate çıktıları
 * @returns {{primary, secondary:Array, alternatives:Array, excluded:Array, warnings:string[]}}
 */
export function choosePositioning(candidates) {
  const excluded = [];
  const primaryPool = [];
  const secondaryPool = [];
  const partialPool = [];
  for (const c of candidates) {
    const why = exclusionReason(c, PARTIAL_MIN_REL);
    if (why) { excluded.push({ k: c.k, why }); continue; }
    if (exclusionReason(c, SECONDARY_MIN_REL)) { partialPool.push(c); continue; }
    secondaryPool.push(c);
    if (!exclusionReason(c, PRIMARY_MIN_REL)) primaryPool.push(c);
  }
  const byScore = (a, b) => positionScore(b) - positionScore(a) || a.k.localeCompare(b.k);
  primaryPool.sort(byScore);
  secondaryPool.sort(byScore);
  partialPool.sort(byScore);
  const warnings = [];
  const primary = primaryPool[0] || null;
  if (!primary) {
    warnings.push(partialPool.length
      ? 'Ürünle tam uyumlu ve talebi olan kelime bulunamadı; kısmi uyumlu adaylar aşağıda (metinlerde kullanılmaz). Açıklamaya ürünün gerçekten yaptığı şeyleri ekleyip paketi yeniden üret.'
      : 'Uygun kelime bulunamadı. Açıklamayı zenginleştir ya da canlı analizi aç.');
  } else if (['WEAK'].includes(primary.verdict)) {
    warnings.push(`En iyi uyumlu kelime bile zayıf (${primary.verdict}). Bu pazarda organik trafik sınırlı olabilir; ikincil kelimelere ve mağaza görsellerine ağırlık ver.`);
  }
  const chosen = primary ? [primary] : [];
  const secondary = [];
  for (const c of secondaryPool) {
    if (primary && c.k === primary.k) continue;
    if ([...chosen, ...secondary].some((x) => overlap(x.top, c.top) >= OVERLAP)) continue;
    secondary.push(c);
    if (secondary.length >= 5) break;
  }
  const alternatives = primaryPool.filter((c) => c !== primary && !secondary.includes(c)).slice(0, 3);
  const partial = partialPool.filter((c) => !secondary.includes(c)).slice(0, 5).map((c) => ({ ...c, partialWhy: exclusionReason(c, SECONDARY_MIN_REL) }));
  return { primary, secondary, alternatives, partial, excluded, warnings };
}

/* ---------------- rakip konumlandırması ---------------- */

const DAY = 86400000;
const daysSince = (iso, now) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? (now - t) / DAY : null; };
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

/**
 * Birincil kelimenin ilk 10'u üzerinden rakip özeti ve DOĞRU farklılaşma açıları.
 * Açılar yalnızca ürün olgularıyla desteklenirse önerilir; bilinmeyen olgu soru olarak kalır.
 * @param {object} candidate birincil aday (apps listesi ya da top id'leri)
 * @param {object} analysis ürün analizi
 * @param {object} appsMap id → uygulama (veri seti)
 */
export function competitorPositioning(candidate, analysis, appsMap = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  if (!candidate) return null;
  const apps = (candidate.apps && candidate.apps.length ? candidate.apps : (candidate.top || []).map((id) => appsMap[id]))
    .filter(Boolean).slice(0, 10);
  if (!apps.length) return { keyword: candidate.k, n: 0, angles: [], titleWords: [], apps: [] };
  const lang = analysis.lang;
  const L = langOf(lang);
  const installs = apps.map((a) => a.real || a.installs || 0);
  const sum = installs.reduce((s, x) => s + x, 0);
  const rated = apps.filter((a) => Number.isFinite(a.score) && (a.ratings || 0) >= 50);
  const avgRating = rated.length ? Math.round(100 * rated.reduce((s, a) => s + a.score, 0) / rated.length) / 100 : null;
  const ads = apps.filter((a) => a.ads).length;
  const iap = apps.filter((a) => a.iap).length;
  const stale = apps.filter((a) => { const d = daysSince(a.updated, now); return d !== null && d > 365; }).length;
  const recent = apps.filter((a) => { const d = daysSince(a.released, now); return d !== null && d <= 730; }).length;
  const leader = apps.slice().sort((a, b) => (b.real || 0) - (a.real || 0))[0];
  const leaderShare = sum > 0 ? Math.round(100 * (leader.real || 0) / sum) : null;

  // rakip başlıklarında en çok geçen kelimeler
  const words = new Map();
  for (const a of apps) {
    const seen = new Set();
    for (const t of normalizeFor(a.title, lang).split(' ')) {
      if (t.length < 3 || L.stopwords.has(t) || L.titleFiller.has(t) || /^\d+$/.test(t) || seen.has(t)) continue;
      seen.add(t);
      words.set(t, (words.get(t) || 0) + 1);
    }
  }
  const titleWords = [...words.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([w, n]) => ({ w, n }));
  const titleHas = (conceptId) => apps.filter((a) => {
    const t = ` ${normalizeFor(a.title, lang)} `;
    return (CONCEPTS[conceptId][lang] || []).some((w) => t.includes(` ${normalizeFor(w, lang)} `) || t.includes(` ${normalizeFor(w, lang)}`));
  }).length;

  const f = analysis.facts || {};
  const angles = [];
  const n = apps.length;
  if (f.offline && f.offline.value === true) {
    const k = titleHas('offline');
    if (k <= 2) angles.push({ text: `Çevrimdışı oynanabilirliği öne çıkar: ilk 10'da başlığında bunu söyleyen yalnızca ${k} uygulama var.`, basis: 'Ürün olgusu: çevrimdışı çalışıyor.' });
  }
  if (f.ads && f.ads.value === false && ads >= Math.ceil(n / 2)) {
    angles.push({ text: `Rakiplerin ${ads}/${n}'i reklamlı. Ürününde reklam yoksa bunu kısa açıklamada açıkça söyle.`, basis: `Olgu kaynağı: ${f.ads.source === 'user' ? 'senin beyanın' : 'repo taraması'} — yayından önce doğrula.` });
  } else if (f.ads && f.ads.value === null && ads >= Math.ceil(n / 2)) {
    angles.push({ text: `Rakiplerin ${ads}/${n}'i reklamlı. Senin oyununda reklam yoksa bu güçlü bir fark olur; Ürün sekmesinde "reklam" olgusunu belirt.`, basis: 'Olgu bilinmiyor.' });
  }
  if (f.iap && f.iap.value === false && iap >= Math.ceil(n * 0.6)) {
    angles.push({ text: `Rakiplerin ${iap}/${n}'inde uygulama içi satın alma var. Satın alma yoksa "satın alma olmadan" vurgusu yapabilirsin.`, basis: 'Doğrulanmış olgu gerekir.' });
  }
  if (stale >= 3) angles.push({ text: `${stale} rakip bir yılı aşkın süredir güncellenmiyor. Düzenli güncelleme planın varsa sürüm notlarında bunu görünür kıl.`, basis: 'Rakip güncelleme tarihleri.' });
  if (avgRating !== null && avgRating < 4.2) angles.push({ text: `Rakiplerin ortalama puanı ${avgRating}. Düşük puanlı rakiplerin yorumlarındaki şikayetleri incele; çözdüğün bir sorun varsa açıklamanın başına koy.`, basis: 'Rakip puanları.' });
  if (leaderShare !== null && leaderShare >= 70) angles.push({ text: `Yüklemelerin %${leaderShare}'i liderde ("${leader.title}"). Başlıkta liderin kalıbını kopyalama; farkını ilk cümlede söyle.`, basis: 'Lider payı.' });
  // üründe olup rakip başlıklarında olmayan özellik kavramları
  for (const [id, c] of Object.entries(analysis.concepts || {})) {
    const con = CONCEPTS[id];
    if (!con || !con.feature || c.score < 2 || con.kind === 'claim') continue;
    if (titleHas(id) === 0) {
      angles.push({ text: `Üründe "${con.feature[lang]}" var, ilk 10'daki hiçbir başlıkta yok. İkincil vurgu olarak kullan.`, basis: `Kanıt: ${Object.keys(c.sources).join(', ')}` });
      if (angles.length >= 7) break;
    }
  }
  return {
    keyword: candidate.k, n,
    leader: leader ? { title: leader.title, installs: leader.real || 0, score: leader.score ?? null } : null,
    leaderShare, medianInstalls: median(installs), avgRating, ads, iap, stale, recent,
    titleWords, angles,
    apps: apps.map((a) => ({ id: a.id, title: a.title, dev: a.dev, real: a.real || 0, score: a.score ?? null, updated: a.updated || null, ads: !!a.ads, iap: !!a.iap }))
  };
}
