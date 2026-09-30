/*
 * Proje ve Yayın Paketi modeli.
 *
 * Bir proje üç yoldan doğar: fırsattan, fikirden ya da mevcut projeden (elle, GitHub reposu,
 * kısa açıklama). Anahtar kelime keşfi proje oluşturmak için hiçbir zaman gerekmez; paket
 * üretimi ürünün kendisinden başlar ve kelimeleri ürüne uydurur, ürünü kelimeye değil.
 *
 * Her kalemin durumu: MISSING · GENERATING · READY · NEEDS_REVIEW · APPROVED.
 * Onaylanmış ya da elle düzenlenmiş kalemler yeniden üretimde ezilmez.
 */
import { analyzeProduct, keywordRelevance, conceptOfToken } from './product.js';
import { evaluateCandidate, choosePositioning, competitorPositioning, hasYear } from './keywords.js';
import {
  generateTitles, generateShorts, generateLong, generateReleaseNotes, suggestCategory, suggestTags,
  lintField, fieldStatus, LIMITS
} from './aso.js';
import { buildChecks, dataSafetyDraft, privacyPolicy, ratingPrep } from './compliance.js';
import { brandDirection, featureGraphicPlan, screenshotPlan, promoVideoPlan, socialVideoPlans, socialCopy, SPECS } from './marketing.js';
import { normalizeFor } from '../lang.js';

export const STATUS = { MISSING: 'MISSING', GENERATING: 'GENERATING', READY: 'READY', NEEDS_REVIEW: 'NEEDS_REVIEW', APPROVED: 'APPROVED' };
export const STATUS_LABEL = { MISSING: 'EKSİK', GENERATING: 'ÜRETİLİYOR', READY: 'HAZIR', NEEDS_REVIEW: 'GÖZDEN GEÇİR', APPROVED: 'ONAYLANDI' };
const STATUS_VALUE = { APPROVED: 1, READY: 0.8, NEEDS_REVIEW: 0.4, GENERATING: 0, MISSING: 0 };

export const STAGES = [
  { id: 'analyze', label: 'Ürünü analiz et', en: 'ANALYZE PRODUCT' },
  { id: 'genre', label: 'Tür ve çekirdek kanca', en: 'IDENTIFY GENRE / CORE HOOK' },
  { id: 'discover', label: 'İlgili arama kelimelerini bul', en: 'DISCOVER RELEVANT SEARCH TERMS' },
  { id: 'positioning', label: 'Konumlandırma', en: 'POSITIONING' },
  { id: 'aso', label: 'ASO', en: 'ASO' },
  { id: 'metadata', label: 'Mağaza meta verisi', en: 'STORE METADATA' },
  { id: 'icon', label: 'İkon', en: 'ICON' },
  { id: 'logo', label: 'Logo', en: 'LOGO' },
  { id: 'featureGraphic', label: 'Tanıtım görseli', en: 'FEATURE GRAPHIC' },
  { id: 'screenshotPlan', label: 'Ekran görüntüsü planı', en: 'SCREENSHOT PLAN' },
  { id: 'screenshotAssets', label: 'Ekran görüntüsü dosyaları', en: 'SCREENSHOT ASSETS' },
  { id: 'promo', label: 'Tanıtım videosu planı', en: 'PROMO VIDEO PLAN' },
  { id: 'social', label: 'Sosyal video planı', en: 'SOCIAL VIDEO PLAN' },
  { id: 'privacy', label: 'Gizlilik / Data Safety', en: 'PRIVACY / DATA SAFETY CHECKLIST' },
  { id: 'releaseNotes', label: 'Sürüm notları', en: 'RELEASE NOTES' },
  { id: 'final', label: 'Son yayın kontrolü', en: 'FINAL RELEASE CHECKLIST' }
];

/** required: Play'e göndermek için şart. weight: hazırlık yüzdesindeki ağırlık. */
export const GROUPS = [
  { id: 'branding', label: 'MARKA', items: [
    { id: 'icon', label: 'Uygulama ikonu', required: true },
    { id: 'logo', label: 'Logo' },
    { id: 'brand', label: 'Marka yönü' }
  ] },
  { id: 'assets', label: 'GOOGLE PLAY GÖRSELLERİ', items: [
    { id: 'featureGraphic', label: 'Tanıtım görseli (1024×500)', required: true },
    { id: 'screenshots', label: 'Ekran görüntüleri', required: true },
    { id: 'captions', label: 'Ekran görüntüsü başlıkları' },
    { id: 'promoVideo', label: 'Tanıtım videosu' }
  ] },
  { id: 'aso', label: 'ASO', items: [
    { id: 'candidates', label: 'Aday kelimeler', weight: 2 },
    { id: 'primary', label: 'Birincil kelime', weight: 2 },
    { id: 'secondary', label: 'İkincil küme' },
    { id: 'competitors', label: 'Rakip konumlandırması' },
    { id: 'title', label: 'Uygulama adı', required: true },
    { id: 'short', label: 'Kısa açıklama', required: true },
    { id: 'full', label: 'Uzun açıklama', required: true }
  ] },
  { id: 'release', label: 'YAYIN', items: [
    { id: 'category', label: 'Kategori', required: true },
    { id: 'tags', label: 'Etiketler' },
    { id: 'releaseNotes', label: 'Sürüm notları' },
    { id: 'privacy', label: 'Gizlilik politikası', required: true },
    { id: 'dataSafety', label: 'Data Safety', required: true },
    { id: 'contentRating', label: 'İçerik derecelendirme', required: true },
    { id: 'build', label: 'Derleme / AAB', required: true }
  ] },
  { id: 'marketing', label: 'PAZARLAMA', items: [
    { id: 'video6', label: '6 sn video konsepti' },
    { id: 'video10', label: '10 sn video konsepti' },
    { id: 'video15', label: '15 sn video konsepti' },
    { id: 'socialCopy', label: 'Shorts / Reels / TikTok metni' }
  ] }
];
export const ITEMS = GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id, weight: it.weight || (it.required ? 3 : 1) })));
const ITEM = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

export const MARKETS = { 'us-en': { locale: 'en-US', gl: 'us', hl: 'en', label: 'Global (ABD / İngilizce)' }, 'tr-tr': { locale: 'tr-TR', gl: 'tr', hl: 'tr', label: 'Türkiye (Türkçe)' } };

/* ---------------- proje ---------------- */

function uid() {
  const r = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `p_${r.replace(/-/g, '').slice(0, 16)}`;
}

function emptyItems() {
  return Object.fromEntries(ITEMS.map((it) => [it.id, { status: STATUS.MISSING, value: null, note: '', edited: false, updatedAt: null }]));
}

/**
 * @param {{name, market, origin:'opportunity'|'idea'|'import', inputs?:object}} p
 */
export function createProject(p, now = new Date().toISOString()) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Proje adı gerekli.');
  return {
    v: 1,
    id: p.id || uid(),
    name,
    market: MARKETS[p.market] ? p.market : 'us-en',
    origin: p.origin || 'idea',
    createdAt: now,
    updatedAt: now,
    inputs: { description: '', readme: '', mechanics: '', screenNotes: '', genreId: '', seedKeyword: '', store: { title: '', short: '', full: '' }, facts: {}, build: {}, ...(p.inputs || {}) },
    pack: { generatedAt: null, analysis: null, positioning: null, candidates: [], discovery: null, stages: {}, items: emptyItems() }
  };
}

/** Eski kayıtları güncel şemaya taşır; eksik kalemleri ekler. */
export function normalizeProject(p) {
  const base = createProject({ name: p.name || 'Proje', market: p.market, origin: p.origin, id: p.id, inputs: p.inputs }, p.createdAt);
  const out = { ...base, ...p, inputs: { ...base.inputs, ...(p.inputs || {}) }, pack: { ...base.pack, ...(p.pack || {}) } };
  out.pack.items = { ...emptyItems(), ...((p.pack && p.pack.items) || {}) };
  for (const it of Object.values(out.pack.items)) if (it.status === STATUS.GENERATING) it.status = it.value ? STATUS.NEEDS_REVIEW : STATUS.MISSING;
  return out;
}

/* ---------------- hazırlık ---------------- */

/**
 * @returns {{pct:number, approved:number, total:number, blockers:Array<{id,label,status,why}>, byGroup:object}}
 */
export function readiness(project) {
  const items = project.pack.items;
  let sum = 0;
  let total = 0;
  let approved = 0;
  const blockers = [];
  const byGroup = {};
  for (const it of ITEMS) {
    const st = (items[it.id] || {}).status || STATUS.MISSING;
    sum += it.weight * STATUS_VALUE[st];
    total += it.weight;
    if (st === STATUS.APPROVED) approved++;
    const g = byGroup[it.group] || (byGroup[it.group] = { done: 0, n: 0 });
    g.n++;
    if (st === STATUS.APPROVED || st === STATUS.READY) g.done++;
    if (it.required && st !== STATUS.APPROVED && st !== STATUS.READY) {
      blockers.push({ id: it.id, label: it.label, status: st, why: (items[it.id] && items[it.id].note) || '' });
    }
  }
  const b = items.build && items.build.value;
  if (b && b.checks) for (const c of b.checks) if (c.level === 'error') blockers.push({ id: 'build', label: 'Derleme', status: 'ERROR', why: c.msg });
  return { pct: Math.round((100 * sum) / total), approved, total: ITEMS.length, blockers, byGroup };
}

/* ---------------- kalem yardımcıları ---------------- */

function locked(item) { return item.status === STATUS.APPROVED || item.edited; }

function put(project, id, value, status, note = '', now = new Date().toISOString()) {
  const it = project.pack.items[id];
  if (locked(it)) { it.fresh = value; return; } // onaylı/elle düzenlenmiş: sadece yeni öneriyi yanına koy
  it.value = value;
  it.status = status;
  it.note = note;
  it.updatedAt = now;
  delete it.fresh;
}

function textStatus(issues, claims = []) {
  const s = fieldStatus(issues);
  if (s !== 'ok') return STATUS.NEEDS_REVIEW;
  if (claims.some((c) => !c.verified)) return STATUS.NEEDS_REVIEW;
  return STATUS.READY;
}

export function setStatus(project, id, status) {
  const it = project.pack.items[id];
  if (!it || !STATUS[status]) return project;
  it.status = status;
  it.updatedAt = new Date().toISOString();
  project.updatedAt = it.updatedAt;
  return project;
}

/** Elle düzenleme: metin alanlarını yeniden denetler. */
export function editText(project, id, text) {
  const it = project.pack.items[id];
  const lang = project.pack.analysis ? project.pack.analysis.lang : 'en';
  const field = { title: 'title', short: 'short', full: 'full', releaseNotes: 'releaseNotes' }[id];
  const primary = project.pack.positioning && project.pack.positioning.primary ? project.pack.positioning.primary.k : null;
  const issues = field ? lintField(field, text, { lang, analysis: project.pack.analysis, brand: project.name, primary }) : [];
  it.value = { ...(it.value || {}), text, issues, len: [...text].length };
  it.edited = true;
  it.status = fieldStatus(issues) === 'ok' ? STATUS.READY : STATUS.NEEDS_REVIEW;
  it.note = issues.map((x) => x.msg).join(' ');
  it.updatedAt = new Date().toISOString();
  project.updatedAt = it.updatedAt;
  return project;
}

/** Düzenlemeyi geri al: kalem bir sonraki üretimde yeniden yazılabilir. */
export function unlock(project, id) {
  const it = project.pack.items[id];
  it.edited = false;
  if (it.status === STATUS.APPROVED) it.status = STATUS.NEEDS_REVIEW;
  if (it.fresh) { it.value = it.fresh; delete it.fresh; }
  return project;
}

/* ---------------- keşif ---------------- */

/** Canlı analiz yanıtını veri seti kaydı biçimine çevirir. */
export function liveToRecord(res) {
  const apps = (res.apps || []).filter(Boolean);
  return {
    k: res.k, st: res.status === 'no-demand' ? 'no-demand' : res.partial ? 'partial' : 'ok',
    demand: res.demand ?? 0, pop: res.pop || null, difficulty: res.difficulty ?? null, market: res.market ?? null,
    opportunity: res.opportunity ?? null, comp: res.comp || null, top: apps.map((a) => a.id), at: res.analyzedAt || null, src: 'live', apps
  };
}

/**
 * Ürün tohumlarından aday kelimeler: veri seti + otomatik tamamlama + (varsa) canlı analiz.
 * Hepsi mevcut fırsat/rekabet sisteminden (getOpportunityVerdict) geçer.
 * @param {{analysis, dataset?:{keywords, apps}, suggest?:(q)=>Promise<string[]>, analyze?:(k)=>Promise<object>,
 *   maxSuggest?:number, maxLive?:number, onProgress?:(msg)=>void}} ctx
 */
export async function discoverCandidates(ctx) {
  const { analysis } = ctx;
  const lang = analysis.lang;
  const progress = ctx.onProgress || (() => {});
  const pool = new Map();
  const stats = { seeds: analysis.seeds.length, dataset: 0, suggest: 0, suggestCalls: 0, live: 0, liveFailed: 0, rejected: 0 };
  const recs = new Map(((ctx.dataset && ctx.dataset.keywords) || []).map((r) => [r.k, r]));
  const add = (k, source, from) => {
    const n = normalizeFor(k, lang);
    if (!n || pool.has(n)) return false;
    const rel = keywordRelevance(n, analysis);
    if (rel.score < 0.67 || rel.trademark || hasYear(rel)) { stats.rejected++; return false; }
    pool.set(n, { k: n, source, from, record: recs.get(n) || null, rel: rel.score });
    return true;
  };
  for (const s of analysis.seeds) if (s.role === 'candidate') add(s.k, s.sources.includes('keyword') ? 'opportunity' : 'seed', null);

  // 1) veri seti: ürünün kavramlarından en az birini içeren analiz edilmiş kayıtlar
  const productConcepts = new Set(Object.keys(analysis.concepts || {}));
  for (const r of recs.values()) {
    if (!['ok', 'partial', 'no-demand'].includes(r.st)) continue;
    const toks = normalizeFor(r.k, lang).split(' ');
    if (!toks.some((t) => productConcepts.has(conceptOfToken(t)))) continue;
    if (add(r.k, 'dataset', null)) stats.dataset++;
  }
  // 2) otomatik tamamlama: Play'in gerçekten önerdiği kelimeler
  if (ctx.suggest) {
    const prefixes = analysis.seeds.slice().sort((a, b) => b.weight - a.weight).slice(0, ctx.maxSuggest ?? 8);
    for (const s of prefixes) {
      progress(`Otomatik tamamlama: "${s.k}"`);
      stats.suggestCalls++;
      let list = [];
      try { list = await ctx.suggest(s.k); } catch { list = []; }
      for (const q of list || []) if (add(q, 'autocomplete', s.k)) stats.suggest++;
    }
  }
  // 3) ölçülmemiş adaylar için canlı analiz
  if (ctx.analyze) {
    const todo = [...pool.values()].filter((c) => !c.record || !['ok', 'partial', 'no-demand'].includes(c.record.st))
      .sort((a, b) => b.rel - a.rel || (a.source === 'seed' ? -1 : 1) || a.k.length - b.k.length)
      .slice(0, ctx.maxLive ?? 8);
    let done = 0;
    const worker = async () => {
      while (todo.length) {
        const c = todo.shift();
        progress(`Talep ve rekabet ölçülüyor (${++done}): "${c.k}"`);
        try {
          const res = await ctx.analyze(c.k);
          if (res) { c.record = liveToRecord(res); stats.live++; }
        } catch { stats.liveFailed++; }
      }
    };
    await Promise.all([worker(), worker()]);
  }
  const appsMap = (ctx.dataset && ctx.dataset.apps) || {};
  const candidates = [...pool.values()].map((c) => {
    const ev = evaluateCandidate(c.record, analysis, { k: c.k, source: c.source, from: c.from, apps: c.record && c.record.apps ? c.record.apps : null });
    if (!ev.apps && ev.top.length) ev.apps = ev.top.map((id) => appsMap[id]).filter(Boolean);
    return ev;
  });
  return { candidates, stats };
}

/* ---------------- boru hattı ---------------- */

const STAGE_ITEMS = {
  discover: ['candidates'], positioning: ['primary', 'secondary', 'competitors'], aso: ['title', 'short', 'full'],
  metadata: ['category', 'tags'], icon: ['brand', 'icon'], logo: ['logo'], featureGraphic: ['featureGraphic'],
  screenshotPlan: ['captions'], screenshotAssets: ['screenshots'], promo: ['promoVideo'],
  social: ['video6', 'video10', 'video15', 'socialCopy'], privacy: ['privacy', 'dataSafety', 'contentRating'],
  releaseNotes: ['releaseNotes'], final: ['build']
};

/**
 * Yayın paketini üretir. Proje yerinde güncellenir ve döndürülür.
 * @param {object} project
 * @param {{dataset?, suggest?, analyze?, render?:{icon, logo, featureGraphic, screenshots}, onStage?:(id,state,msg)=>void,
 *   maxLive?:number, maxSuggest?:number, only?:string[]}} ctx
 */
export async function generatePack(project, ctx = {}) {
  const pack = project.pack;
  const onStage = ctx.onStage || (() => {});
  const stamp = () => new Date().toISOString();
  const run = async (id, fn) => {
    if (ctx.only && !ctx.only.includes(id)) return;
    pack.stages[id] = { status: 'running', at: stamp(), msg: '' };
    for (const itemId of STAGE_ITEMS[id] || []) if (!locked(pack.items[itemId])) pack.items[itemId].status = STATUS.GENERATING;
    onStage(id, 'running', '');
    try {
      const msg = (await fn()) || '';
      pack.stages[id] = { status: 'done', at: stamp(), msg };
      onStage(id, 'done', msg);
    } catch (err) {
      pack.stages[id] = { status: 'error', at: stamp(), msg: err.message };
      for (const itemId of STAGE_ITEMS[id] || []) {
        const it = pack.items[itemId];
        if (it.status === STATUS.GENERATING) { it.status = it.value ? STATUS.NEEDS_REVIEW : STATUS.MISSING; it.note = `Hata: ${err.message}`; }
      }
      onStage(id, 'error', err.message);
    }
  };
  const A = () => pack.analysis;
  const lang = () => A().lang;

  await run('analyze', () => {
    pack.analysis = analyzeProduct(project);
    const a = A();
    const srcs = a.sourceSummary.filter((s) => s.chars > 0).map((s) => s.source);
    return `${srcs.length} kaynak, ${Object.keys(a.concepts).length} kavram, ${a.features.length} özellik`;
  });
  await run('genre', () => {
    const a = A();
    return `${a.genre.label[lang()] || a.genre.label.en} (${a.genre.source === 'user' ? 'senin seçimin' : `güven %${Math.round(a.genre.confidence * 100)}`}) · kanca: ${a.hook.text}`;
  });
  await run('discover', async () => {
    const { candidates, stats } = await discoverCandidates({ analysis: A(), dataset: ctx.dataset, suggest: ctx.suggest, analyze: ctx.analyze, maxLive: ctx.maxLive, maxSuggest: ctx.maxSuggest, onProgress: (m) => onStage('discover', 'running', m) });
    pack.candidates = candidates;
    pack.discovery = { ...stats, at: stamp() };
    const analyzed = candidates.filter((c) => c.analyzed).length;
    put(project, 'candidates', { n: candidates.length, analyzed, stats },
      analyzed ? STATUS.READY : candidates.length ? STATUS.NEEDS_REVIEW : STATUS.MISSING,
      analyzed ? '' : candidates.length ? 'Adaylar bulundu ama talep/rekabet ölçülemedi. Canlı analiz (Vercel API) açıkken yeniden üret.' : 'Ürünle uyumlu aday bulunamadı. Açıklamayı zenginleştir.');
    return `${candidates.length} aday (${stats.dataset} veri setinden, ${stats.suggest} otomatik tamamlamadan, ${stats.live} canlı ölçüm), ${analyzed} ölçülmüş`;
  });
  await run('positioning', () => {
    const pos = choosePositioning(pack.candidates || []);
    pack.positioning = { primary: pos.primary, secondary: pos.secondary, alternatives: pos.alternatives, partial: pos.partial, excluded: pos.excluded.slice(0, 40), warnings: pos.warnings };
    const p = pos.primary;
    put(project, 'primary', p ? { k: p.k, verdict: p.verdict, reason: p.reason, demand: p.demand, difficulty: p.difficulty, opportunity: p.opportunity, reach: p.reach, rel: p.rel.score } : null,
      p ? (['GOLD', 'BUILD'].includes(p.verdict) ? STATUS.READY : STATUS.NEEDS_REVIEW) : STATUS.MISSING, pos.warnings.join(' '));
    put(project, 'secondary', pos.secondary.map((c) => ({ k: c.k, verdict: c.verdict, demand: c.demand, opportunity: c.opportunity, rel: c.rel.score })),
      pos.secondary.length ? STATUS.READY : STATUS.NEEDS_REVIEW, pos.secondary.length ? '' : 'Ayrı pazarlarda ikincil kelime bulunamadı.');
    const cp = competitorPositioning(p, A(), (ctx.dataset && ctx.dataset.apps) || {});
    put(project, 'competitors', cp, cp && cp.n ? STATUS.READY : STATUS.MISSING, cp && cp.n ? '' : 'Birincil kelimenin rakip listesi yok.');
    return p ? `Birincil: "${p.k}" (${p.verdict}), ${pos.secondary.length} ikincil` : 'Birincil kelime seçilemedi';
  });
  const positioning = () => ({ primary: pack.positioning && pack.positioning.primary, secondary: (pack.positioning && pack.positioning.secondary) || [] });
  await run('aso', () => {
    const titles = generateTitles(project.name, A(), positioning());
    const shorts = generateShorts(project.name, A(), positioning());
    const full = generateLong(project.name, A(), positioning());
    const t0 = titles[0];
    const s0 = shorts[0];
    put(project, 'title', { text: t0.text, len: t0.len, issues: t0.issues, options: titles.slice(0, 5).map((o) => o.text) }, textStatus(t0.issues), t0.issues.map((x) => x.msg).join(' '));
    put(project, 'short', { text: s0.text, len: s0.len, issues: s0.issues, options: shorts.slice(0, 5).map((o) => o.text) }, textStatus(s0.issues), s0.issues.map((x) => x.msg).join(' '));
    const unverified = full.claims.filter((c) => !c.verified);
    put(project, 'full', full, textStatus(full.issues, full.claims),
      [...full.issues.map((x) => x.msg), ...unverified.map((c) => `Doğrula: "${c.claim}" (${c.basis}).`)].join(' '));
    return `Başlık: "${t0.text}"`;
  });
  await run('metadata', () => {
    const cat = suggestCategory(A());
    put(project, 'category', cat, A().genre.source === 'user' || A().genre.confidence >= 0.6 ? STATUS.READY : STATUS.NEEDS_REVIEW,
      A().genre.confidence >= 0.6 || A().genre.source === 'user' ? '' : 'Tür tahmini zayıf: kategoriyi doğrula ya da Ürün sekmesinde türü seç.');
    put(project, 'tags', { tags: suggestTags(A()), note: 'Play Console etiket listesinden en yakınlarını seç (en fazla 5).' }, STATUS.READY);
    const t = pack.items.title.value;
    const s = pack.items.short.value;
    return `${cat.label} · başlık ${t ? t.len : 0}/${LIMITS.title} · kısa ${s ? s.len : 0}/${LIMITS.short}`;
  });
  await run('icon', async () => {
    const brand = brandDirection(project, A());
    put(project, 'brand', brand, STATUS.READY);
    return assetStage(project, 'icon', ctx.render && ctx.render.icon, brand);
  });
  await run('logo', async () => assetStage(project, 'logo', ctx.render && ctx.render.logo, pack.items.brand.value || brandDirection(project, A())));
  await run('featureGraphic', async () => assetStage(project, 'featureGraphic', ctx.render && ctx.render.featureGraphic, featureGraphicPlan(project, A(), { tagline: shortTagline(project) })));
  await run('screenshotPlan', () => {
    const plan = screenshotPlan(project, A());
    put(project, 'captions', plan, STATUS.READY);
    return `${plan.slides.length} kare, ${plan.orientation === 'landscape' ? 'yatay' : 'dikey'} ${plan.size.w}×${plan.size.h}`;
  });
  await run('screenshotAssets', async () => {
    const shots = project.inputs.screens || [];
    const plan = pack.items.captions.value;
    if (!shots.length) {
      put(project, 'screenshots', { framed: [], plan }, STATUS.MISSING, 'Oyundan gerçek ekran görüntülerini yükle; başlıklar plana göre eklenir.');
      return 'Ekran görüntüsü yüklenmedi';
    }
    if (!ctx.render || !ctx.render.screenshots) {
      put(project, 'screenshots', { framed: [], raw: shots.length, plan }, STATUS.NEEDS_REVIEW, 'Görüntüler yüklendi; çerçeveleme tarayıcıda yapılır.');
      return `${shots.length} ham görüntü`;
    }
    const framed = await ctx.render.screenshots(project, plan);
    const ok = framed.filter((f) => !f.issues || !f.issues.some((x) => x.level === 'error'));
    put(project, 'screenshots', { framed, plan }, ok.length >= SPECS.screenshot.count[0] ? STATUS.READY : STATUS.NEEDS_REVIEW,
      ok.length >= SPECS.screenshot.count[0] ? (ok.length < 4 ? 'Öne çıkarılma için en az 4 görüntü önerilir.' : '') : `En az ${SPECS.screenshot.count[0]} geçerli görüntü gerekir.`);
    return `${framed.length} görüntü hazırlandı`;
  });
  await run('promo', () => {
    const plan = promoVideoPlan(project, A());
    const url = project.inputs.promoUrl || '';
    const valid = /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{6,}/.test(url);
    put(project, 'promoVideo', { plan, url: valid ? url : '' }, valid ? STATUS.READY : STATUS.MISSING, valid ? '' : 'İsteğe bağlı: videoyu YouTube\'a yükleyip bağlantısını Ürün sekmesine ekle.');
    return valid ? 'Video bağlantısı var' : 'Plan hazır, video bağlantısı yok';
  });
  await run('social', () => {
    const plans = socialVideoPlans(project, A());
    for (const p of plans) put(project, p.id, p, STATUS.READY);
    put(project, 'socialCopy', socialCopy(project, A(), positioning()), STATUS.READY);
    return `${plans.length} kısa video konsepti`;
  });
  await run('privacy', () => {
    const ds = dataSafetyDraft(project, A());
    const pp = privacyPolicy(project, A(), ds);
    const rp = ratingPrep(project, A());
    put(project, 'privacy', pp, pp.status === 'provided' ? STATUS.READY : STATUS.NEEDS_REVIEW,
      pp.status === 'provided' ? '' : `Politika metni taslak olarak hazır; herkese açık bir HTTPS adreste yayımlayıp bağlantısını ekle.${pp.missing.length ? ` Eksik: ${pp.missing.join(', ')}.` : ''}`);
    put(project, 'dataSafety', ds, STATUS.NEEDS_REVIEW, 'Taslak: Play Console → Uygulama içeriği → Veri güvenliği formunu bu listeyle doldur ve SDK sağlayıcılarının güncel rehberiyle doğrula.');
    put(project, 'contentRating', rp, rp.unanswered ? STATUS.NEEDS_REVIEW : STATUS.READY, rp.unanswered ? `${rp.unanswered} IARC sorusu yanıtsız.` : '');
    return `${ds.byType.length} veri türü, ${ds.sdks.length} SDK, ${rp.signals.filter((s) => s.detected).length} derecelendirme sinyali`;
  });
  await run('releaseNotes', () => {
    const rn = generateReleaseNotes(project.name, A(), project);
    put(project, 'releaseNotes', rn, textStatus(rn.issues), rn.issues.map((x) => x.msg).join(' '));
    return `${rn.len}/${LIMITS.releaseNotes} karakter`;
  });
  await run('final', () => {
    const bc = buildChecks(project);
    const errors = bc.checks.filter((c) => c.level === 'error').length;
    const todo = bc.checks.filter((c) => c.level === 'todo').length;
    const note = [errors ? `${errors} hata (aşağıda).` : '', todo ? `${todo} yapılacak: ${bc.checks.filter((c) => c.level === 'todo').map((c) => ({ package: 'paket adı', target: 'hedef API', versionCode: 'versionCode', aab: 'AAB', signing: 'imza', testing: 'kapalı test' }[c.id] || c.id)).join(', ')}.` : ''].filter(Boolean).join(' ');
    put(project, 'build', bc, errors || todo ? STATUS.NEEDS_REVIEW : STATUS.READY, note);
    const r = readiness(project);
    return `Hazırlık %${r.pct} · ${r.blockers.length} engel`;
  });
  pack.generatedAt = stamp();
  project.updatedAt = pack.generatedAt;
  return project;
}

function shortTagline(project) {
  const s = project.pack.items.short && project.pack.items.short.value;
  if (!s || !s.text) return null;
  const first = s.text.split(/[.:!?]/)[0].trim();
  return first.length <= 42 ? first : null;
}

/** Görsel aşaması: yüklenmiş dosya her zaman kazanır; yoksa tarayıcıda taslak üretilir. */
async function assetStage(project, id, renderer, brief) {
  const it = project.pack.items[id];
  const upload = project.inputs.uploads && project.inputs.uploads[id];
  if (upload && upload.assetId) {
    const status = upload.issues && upload.issues.some((x) => x.level === 'error') ? STATUS.NEEDS_REVIEW : STATUS.READY;
    put(project, id, { ...upload, source: 'upload', brief }, status, status === STATUS.READY ? '' : upload.issues.map((x) => x.msg).join(' '));
    return 'Yüklenen dosya kullanıldı';
  }
  if (!renderer) {
    put(project, id, { brief, source: null }, STATUS.MISSING, 'Taslak tarayıcıda üretilir ya da kendi dosyanı yükle.');
    return 'Brif hazır';
  }
  if (locked(it)) return 'Onaylı dosya korundu';
  const asset = await renderer(project, brief);
  put(project, id, { ...asset, source: 'draft', brief }, STATUS.NEEDS_REVIEW, 'Otomatik taslak (ad, renk ve ekran görüntüsünden). Gözden geçir; oyunun gerçek görseliyle yaptığın bir dosya varsa yükle.');
  return `Taslak ${asset.w}×${asset.h}`;
}

/* ---------------- dışa aktarım ---------------- */

/**
 * fastlane supply düzeni + belgeler + project.json.
 * @param {object} project
 * @param {(assetId:string)=>Promise<{bytes:Uint8Array, type:string}>} getAsset
 * @returns {Promise<Array<{path:string, data:string|Uint8Array}>>}
 */
export async function exportFiles(project, getAsset) {
  const loc = (MARKETS[project.market] || MARKETS['us-en']).locale;
  const base = `fastlane/metadata/android/${loc}`;
  const it = project.pack.items;
  const files = [];
  const txt = (path, s) => { if (s) files.push({ path, data: `${String(s).trim()}\n` }); };
  txt(`${base}/title.txt`, it.title.value && it.title.value.text);
  txt(`${base}/short_description.txt`, it.short.value && it.short.value.text);
  txt(`${base}/full_description.txt`, it.full.value && it.full.value.text);
  txt(`${base}/video.txt`, it.promoVideo.value && it.promoVideo.value.url);
  const vc = (it.build.value && it.build.value.info && it.build.value.info.versionCode) || null;
  txt(`${base}/changelogs/${vc || 'default'}.txt`, it.releaseNotes.value && it.releaseNotes.value.text);
  const ext = (type) => (type === 'image/jpeg' ? 'jpg' : 'png');
  const addAsset = async (assetId, path) => {
    if (!assetId || !getAsset) return;
    const a = await getAsset(assetId);
    if (a && a.bytes) files.push({ path: `${path}.${ext(a.type)}`, data: a.bytes });
  };
  if (it.icon.value) await addAsset(it.icon.value.assetId, `${base}/images/icon`);
  if (it.featureGraphic.value) await addAsset(it.featureGraphic.value.assetId, `${base}/images/featureGraphic`);
  if (it.logo.value) await addAsset(it.logo.value.assetId, 'publish-pack/brand/logo');
  const framed = (it.screenshots.value && it.screenshots.value.framed) || [];
  let n = 0;
  for (const f of framed) {
    if (f.issues && f.issues.some((x) => x.level === 'error')) continue;
    n++;
    await addAsset(f.assetId, `${base}/images/phoneScreenshots/${n}_${loc}`);
  }
  files.push({ path: 'publish-pack/README.md', data: reportMarkdown(project) });
  if (it.privacy.value) files.push({ path: 'publish-pack/privacy-policy.txt', data: it.privacy.value.draft });
  files.push({ path: 'publish-pack/project.json', data: JSON.stringify(serializable(project), null, 2) });
  return files;
}

/** Varlık baytları hariç proje. */
export function serializable(project) {
  return JSON.parse(JSON.stringify(project));
}

/** ZIP içeriğinden proje: önce project.json, yoksa fastlane meta verisinden "mevcut proje". */
export function importFiles(entries) {
  const get = (re) => entries.find((e) => re.test(e.path));
  const dec = (d) => (typeof d === 'string' ? d : new TextDecoder().decode(d));
  const pj = get(/(^|\/)project\.json$/);
  if (pj) {
    const p = JSON.parse(dec(pj.data));
    if (!p || !p.name || !p.pack) throw new Error('project.json geçersiz.');
    return { project: normalizeProject(p), kind: 'project' };
  }
  const title = get(/metadata\/android\/([\w-]+)\/title\.txt$/);
  if (!title) throw new Error('ZIP içinde project.json ya da fastlane meta verisi bulunamadı.');
  const loc = title.path.match(/android\/([\w-]+)\//)[1];
  const read = (name) => { const e = get(new RegExp(`android/${loc}/${name}$`)); return e ? dec(e.data).trim() : ''; };
  const market = /^tr/i.test(loc) ? 'tr-tr' : 'us-en';
  const t = read('title.txt');
  const project = createProject({ name: t.split(/[:\-–|]/)[0].trim() || t, market, origin: 'import', inputs: { store: { title: t, short: read('short_description.txt'), full: read('full_description.txt') } } });
  return { project, kind: 'fastlane' };
}

/* ---------------- rapor ---------------- */

export function reportMarkdown(project) {
  const r = readiness(project);
  const it = project.pack.items;
  const a = project.pack.analysis;
  const lines = [];
  lines.push(`# ${project.name} — Yayın Paketi`, '');
  lines.push(`Pazar: ${(MARKETS[project.market] || {}).label || project.market} · Hazırlık: **%${r.pct}** · Üretildi: ${project.pack.generatedAt || '—'}`, '');
  if (r.blockers.length) {
    lines.push('## Yayın engelleri', '');
    for (const b of r.blockers) lines.push(`- [ ] ${b.label} — ${STATUS_LABEL[b.status] || b.status}${b.why ? `: ${b.why}` : ''}`);
    lines.push('');
  }
  for (const g of GROUPS) {
    lines.push(`## ${g.label}`, '');
    for (const x of g.items) {
      const s = it[x.id];
      lines.push(`- ${s.status === STATUS.APPROVED ? '[x]' : '[ ]'} **${x.label}** — ${STATUS_LABEL[s.status]}${s.note ? ` · ${s.note}` : ''}`);
    }
    lines.push('');
  }
  if (a) {
    lines.push('## Ürün analizi', '', `- Tür: ${a.genre.label[a.lang] || a.genre.label.en} (${a.genre.source})`, `- Kanca: ${a.hook.text}`);
    for (const f of a.features) lines.push(`- Özellik: ${f.text}`);
    lines.push('');
  }
  const pos = project.pack.positioning;
  if (pos) {
    lines.push('## Konumlandırma', '');
    if (pos.primary) lines.push(`- Birincil: **${pos.primary.k}** — ${pos.primary.verdict}, talep ${pos.primary.demand}, fırsat ${pos.primary.opportunity} · ${pos.primary.reason}`);
    for (const c of pos.secondary || []) lines.push(`- İkincil: ${c.k} — ${c.verdict}, talep ${c.demand}`);
    for (const w of pos.warnings || []) lines.push(`- Uyarı: ${w}`);
    if ((pos.excluded || []).length) {
      lines.push('', '### Elenen adaylar', '');
      for (const e of pos.excluded.slice(0, 15)) lines.push(`- ${e.k}: ${e.why}`);
    }
    lines.push('');
  }
  const cp = it.competitors.value;
  if (cp && cp.n) {
    lines.push('## Rakipler', '', `İlk ${cp.n} · lider: ${cp.leader ? cp.leader.title : '—'} (%${cp.leaderShare ?? '—'}) · ortalama puan ${cp.avgRating ?? '—'} · reklamlı ${cp.ads}/${cp.n}`, '');
    for (const x of cp.angles) lines.push(`- ${x.text} _(${x.basis})_`);
    lines.push('');
  }
  const ds = it.dataSafety.value;
  if (ds) {
    lines.push('## Data Safety taslağı', '');
    for (const t of ds.byType) lines.push(`- ${t.type}: ${t.sdks.join(', ')}${t.shared ? ' (paylaşılır)' : ''}`);
    for (const d of ds.declarations) lines.push(`- ${d.q} → **${d.answer}**${d.basis ? ` (${d.basis})` : ''}`);
    for (const q of ds.questions) lines.push(`- [ ] ${q}`);
    lines.push('');
  }
  const cr = it.contentRating.value;
  if (cr) {
    lines.push('## İçerik derecelendirme hazırlığı', '');
    for (const s of cr.signals) lines.push(`- [${s.answer !== null ? 'x' : ' '}] ${s.label}: ${s.question}${s.detected ? ` — metinde işaret var: ${s.evidence.join(', ')}` : ''}`);
    lines.push('');
  }
  const b = it.build.value;
  if (b) {
    lines.push('## Derleme', '');
    for (const c of b.checks) lines.push(`- [${c.level === 'ok' ? 'x' : ' '}] ${c.msg}`);
    lines.push('');
  }
  const sp = it.captions.value;
  if (sp) {
    lines.push('## Ekran görüntüsü planı', '', `${sp.orientation === 'landscape' ? 'Yatay' : 'Dikey'} ${sp.size.w}×${sp.size.h}`, '');
    for (const s of sp.slides) lines.push(`${s.n}. **${s.caption}** — ${s.capture}`);
    lines.push('');
  }
  const pv = it.promoVideo.value;
  if (pv && pv.plan) {
    lines.push('## Tanıtım videosu planı', '', pv.plan.length, '');
    for (const x of pv.plan.beats) lines.push(`- ${x.t}: ${x.what}`);
    lines.push('');
  }
  for (const id of ['video6', 'video10', 'video15']) {
    const v = it[id].value;
    if (!v) continue;
    lines.push(`## ${v.name}`, '');
    for (const s of v.shots) lines.push(`- ${s.t} sn: ${s.visual}${s.text ? ` — metin: "${s.text}"` : ''}`);
    lines.push('');
  }
  const sc = it.socialCopy.value;
  if (sc) {
    lines.push('## Sosyal metinler', '', `**Shorts başlığı:** ${sc.shorts.title}`, '', '```', sc.shorts.description, '```', '', '**Reels:**', '```', sc.reels.caption, '```', '', `**TikTok:** ${sc.tiktok.caption}`, '');
  }
  return lines.join('\n');
}
