/*
 * Play Fırsat Radarı — karar odaklı arayüz.
 * Bağımlılık yok. Karar mantığı public/js/verdict.js içinde (sunum katmanı, skorları değiştirmez).
 */
import {
  getOpportunityVerdict, getNicheVerdict, competitorSummary, compareByVerdict,
  demandLevel, difficultyLevel, opportunityLevel, marketLevel,
  VERDICT_META, VERDICT_ORDER
} from './js/verdict.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('tr-TR');
const DAY = 86400000;
const VIEWS = ['overview', 'opportunities', 'niches', 'live', 'saved', 'analyst', 'help'];
const OPPORTUNITY_VERDICTS = ['GOLD', 'BUILD', 'WATCH'];
/** "Fırsat" sayılan kayıt: WATCH ve üstü karar almış olanlar. */
const isOpportunity = (r) => OPPORTUNITY_VERDICTS.includes(r.dv);
/** Son 7 günde bulunmuş ve fırsat sayılan kayıt. */
const isNewOpportunity = (r) => r.decision.isNew && isOpportunity(r);

const fmtInt = (n) => (Number.isFinite(n) ? nf.format(n) : '–');
const fmtShort = (n) => {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} Mr`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} B`;
  return String(n);
};
const fmtDate = (iso) => { const t = iso ? new Date(iso) : null; return t && !Number.isNaN(t.getTime()) ? t.toLocaleDateString('tr-TR') : '–'; };
const fmtDateTime = (iso) => { const t = iso ? new Date(iso) : null; return t && !Number.isNaN(t.getTime()) ? t.toLocaleString('tr-TR') : '–'; };
const fmtRel = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return '–';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24);
  return d === 1 ? 'dün' : `${d} gün önce`;
};
const num = (v) => (Number.isFinite(v) ? v : null);
const toks = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const stem = (t) => (t.length > 4 && t.endsWith('ies') ? `${t.slice(0, -3)}y` : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

const SRC_LABEL = { seed: 'Tohum', suggest: 'Öneri', letter: 'Öneri (harf)', variant: 'Varyant', chart: 'Liste', title: 'Başlık', live: 'Canlı' };
const ST_LABEL = { ok: 'Analiz edildi', partial: 'Eksik veri', pending: 'Bekliyor', error: 'Hata', 'no-demand': 'Talep yok' };
const TIPS = {
  opportunity: 'Fırsat: talep ve rekabetin birleşimi. √(talep × (100 − zorluk)); zayıf, düşük puanlı ve bayat rakipler küçük bonus verir.',
  demand: 'Talep: Google Play otomatik tamamlamadan türetilen göreli arama ilgisi. Gerçek arama hacmi değildir.',
  difficulty: 'Rekabet: ilk 10 uygulamanın gücü. Yükleme sayısı, değerlendirme, puan, başlık eşleşmesi ve güncellik.',
  market: 'Pazar: ilk 10 uygulamanın toplam yüklemesi. Büyük pazar çok talep, küçük pazar keşfedilmemiş alan demek olabilir.',
  trend: 'Trend: fırsat puanının önceki taramalara göre değişimi. Yeterli geçmiş yoksa YENİ yazar, trend uydurulmaz.'
};

const state = {
  view: 'overview',
  index: null, marketId: null, data: null,
  records: [], byKey: new Map(),
  counts: { GOLD: 0, BUILD: 0, WATCH: 0, WEAK: 0, SKIP: 0, PENDING: 0 },
  quick: 'all', q: '', sort: 'verdict', shown: 60, niche: null,
  adv: { minOpp: 0, minDemand: 0, maxDiff: 100, status: 'analyzed', src: '' },
  analyst: { q: '', status: 'analyzed', src: '', minOpp: 0, minDemand: 0, maxDiff: 100, sort: { key: 'opportunity', dir: -1 }, shown: 100 },
  stars: loadStars(), drawerKey: null, drawerNiche: null, live: false, liveChecked: false, liveResult: null,
  apiBase: (localStorage.getItem('apiBase') || '').trim(),
  nicheCache: null
};

function loadStars() {
  try { return new Set(JSON.parse(localStorage.getItem('stars') || '[]')); } catch { return new Set(); }
}
function saveStars() {
  try { localStorage.setItem('stars', JSON.stringify([...state.stars])); } catch { /* özel pencere */ }
}

/* ============================ veri ============================ */
async function loadJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

function enrich(record) {
  const decision = getOpportunityVerdict(record);
  const c = record.comp || {};
  return {
    ...record,
    decision,
    dv: decision.verdict,
    verdictOrder: VERDICT_ORDER[decision.verdict] ?? 9,
    trendDelta: decision.trend.dir === 'new' ? null : decision.trend.delta,
    titleMatches: num(c.titleMatches),
    weak: num(c.weak),
    avgScore: num(c.avgScore),
    tk: toks(record.k).map(stem)
  };
}

function rebuild() {
  const list = (state.data?.keywords || []).map(enrich);
  state.records = list;
  state.byKey = new Map(list.map((r) => [r.k, r]));
  const counts = { GOLD: 0, BUILD: 0, WATCH: 0, WEAK: 0, SKIP: 0, PENDING: 0 };
  for (const r of list) counts[r.dv]++;
  state.counts = counts;
  state.nicheCache = null;
}

/* ============================ küçük bileşenler ============================ */
const info = (key) => (TIPS[key] ? `<span class="info" data-tip="${esc(TIPS[key])}" role="button" tabindex="0" aria-label="Açıklama">?</span>` : '');

function vbadge(verdict, extraClass = '') {
  const meta = VERDICT_META[verdict] || VERDICT_META.PENDING;
  const icon = verdict === 'GOLD' ? '★ ' : '';
  return `<span class="vbadge v-${verdict.toLowerCase()} ${extraClass}">${icon}${meta.label}</span>`;
}

/** Tek metrik kutusu: değer + seviye etiketi. */
function metric(label, value, lvl, opts = {}) {
  const { invert = false, tip = null, display = null } = opts;
  const cls = `m${invert ? ' inv' : ''} l-${lvl.key}`;
  return `<div class="${cls}"><span>${label}${tip ? ' ' + info(tip) : ''}</span><b>${display ?? (Number.isFinite(value) ? value : '–')}</b><i>${lvl.label}</i></div>`;
}

function trendMetric(trend) {
  const arrow = trend.dir === 'new' ? '•' : trend.arrow;
  const label = trend.dir === 'new' ? 'YENİ' : trend.label;
  const delta = trend.dir === 'new' || !Number.isFinite(trend.delta) ? '' : ` ${trend.delta > 0 ? '+' : ''}${trend.delta}`;
  return `<div class="m l-${trend.dir}"><span>Trend ${info('trend')}</span><b>${arrow}${delta}</b><i>${label}</i></div>`;
}

function tags(r) {
  const out = [];
  if (state.stars.has(r.k)) out.push('<span class="tag t-star">★ kayıtlı</span>');
  if (r.decision.isNew) out.push('<span class="tag t-new">yeni</span>');
  if (r.decision.trend.dir === 'rising') out.push('<span class="tag t-rising">yükseliyor</span>');
  if (r.decision.trend.dir === 'falling') out.push('<span class="tag t-falling">düşüyor</span>');
  if (r.st === 'partial') out.push('<span class="tag">eksik veri</span>');
  if (r.st === 'pending') out.push('<span class="tag">analiz bekliyor</span>');
  return out.join('');
}

/** Ana fırsat kartı (masaüstünde tek satır, mobilde yığın). */
function oppCard(r) {
  const d = r.decision;
  const dl = demandLevel(r.demand);
  const cl = difficultyLevel(r.difficulty);
  const ol = opportunityLevel(r.opportunity);
  const starred = state.stars.has(r.k);
  return `<article class="opp v-${d.verdict.toLowerCase()}" data-k="${esc(r.k)}">
    <div class="opp-verdict">${vbadge(d.verdict)}</div>
    <div class="opp-main">
      <div class="opp-head"><h3>${esc(r.k)}</h3>${tags(r)}</div>
      <p class="opp-reason">${esc(d.reason)}</p>
    </div>
    <div class="opp-score" title="Fırsat puanı"><b>${Number.isFinite(r.opportunity) ? r.opportunity : '–'}</b><span>${ol.label}</span></div>
    <div class="opp-metrics">
      ${metric('Talep', r.demand, dl, { tip: 'demand' })}
      ${metric('Rekabet', r.difficulty, cl, { invert: true, tip: 'difficulty' })}
      ${trendMetric(d.trend)}
    </div>
    <div class="opp-actions">
      <button class="icon-btn details-btn" data-details="${esc(r.k)}">Detay</button>
      <button class="icon-btn star-btn ${starred ? 'on' : ''}" data-star="${esc(r.k)}" aria-label="${starred ? 'Kayıttan çıkar' : 'Kaydet'}" aria-pressed="${starred}">${starred ? '★' : '☆'}</button>
    </div>
  </article>`;
}

function renderList(el, rows, emptyHtml) {
  if (!rows.length) { el.innerHTML = emptyHtml || '<div class="empty">Sonuç yok.</div>'; return; }
  el.innerHTML = rows.map(oppCard).join('');
}

function signalList(items, kind) {
  if (!items.length) return '';
  const mark = kind === 'pos' ? '✓' : '!';
  return `<ul class="signals ${kind}">${items.map((t) => `<li><b>${mark}</b><span>${esc(t)}</span></li>`).join('')}</ul>`;
}

function sparkline(hist) {
  const pts = (hist || []).filter((h) => Array.isArray(h) && Number.isFinite(h[3]));
  if (pts.length < 2) return '<p class="mini">Grafik için en az iki farklı günün taraması gerekir.</p>';
  const w = 260; const h = 46; const step = w / (pts.length - 1);
  const line = pts.map((p, i) => `${(i * step).toFixed(1)},${(h - (p[3] / 100) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Fırsat puanı geçmişi">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${line}"/>
  </svg><p class="mini">${esc(pts[0][0])} → ${esc(pts[pts.length - 1][0])} arası fırsat puanı</p>`;
}

function playUrl(id, market) {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=${encodeURIComponent(market?.lang || 'en')}&gl=${encodeURIComponent(market?.country || 'us')}`;
}

/* ============================ detay içeriği ============================ */
/** Çekmece ve canlı analiz aynı detay gövdesini kullanır. */
function detailBody(r, opts = {}) {
  const market = opts.market || state.data?.market || { country: 'us', lang: 'en' };
  const appsList = opts.apps || (r.top || []).map((id) => state.data?.apps?.[id]).filter(Boolean);
  const d = r.decision;
  const cs = competitorSummary(r);
  const c = r.comp || {};
  const kwt = toks(r.k).map(stem);
  const pop = r.pop;
  const popText = pop && pop.minPrefix
    ? `<code>${esc(r.k.slice(0, pop.minPrefix))}</code> yazıldığında ${pop.mode === 'ext' ? `<em>${esc(pop.via || '')}</em> öneriliyor (kelimenin kendisi değil, uzantısı)` : 'kelimenin kendisi öneriliyor'}; öneri listesinde ${pop.pos}. sırada, ${pop.minPrefix}/${pop.len} harf.`
    : 'Otomatik tamamlamada ne kelimenin kendisi ne de uzantısı görünüyor.';
  const related = (state.records || [])
    .filter((x) => x.k !== r.k && x.demand > 0 && ((r.seed && x.seed === r.seed) || x.seed === r.k || (r.seed && x.k === r.seed)))
    .sort(compareByVerdict).slice(0, 10);

  const compRows = [
    ['Güç', cs.strength.label],
    ['Zayıf uygulama', `${cs.weak} / ${cs.n || 10}`],
    ['Bayat (1+ yıl)', `${cs.stale} / ${cs.n || 10}`],
    ['Düşük puan (<4.0)', `${cs.lowRated} / ${cs.n || 10}`],
    ['Başlıkta kelime', `${cs.titleMatches} / ${cs.n || 10}`],
    ['Dev (10M+)', `${cs.big} / ${cs.n || 10}`]
  ];

  return `
  <div class="sec">
    <div class="hero-top">
      ${vbadge(d.verdict, 'lg')}
      <div class="hero-score">${Number.isFinite(r.opportunity) ? r.opportunity : '–'}<small> / 100</small></div>
      <div><div class="hero-title">${esc(opportunityLevel(r.opportunity).label)} fırsat</div><div class="mini">${esc(d.label)}</div></div>
    </div>
    <p class="hero-reason">${esc(d.reason)}</p>
    ${d.capped && d.capped.length ? `<p class="mini">Karar düzeltmesi: ${d.capped.map(esc).join('; ')}.</p>` : ''}
    <div class="hero-metrics">
      ${metric('Talep', r.demand, demandLevel(r.demand), { tip: 'demand' })}
      ${metric('Rekabet', r.difficulty, difficultyLevel(r.difficulty), { invert: true, tip: 'difficulty' })}
      ${metric('Pazar', r.market, marketLevel(r.market), { tip: 'market' })}
      ${trendMetric(d.trend)}
    </div>
  </div>

  ${d.positives.length ? `<div class="sec"><h4>Neden iyi</h4>${signalList(d.positives, 'pos')}</div>` : ''}
  ${d.negatives.length ? `<div class="sec"><h4>Riskler</h4>${signalList(d.negatives, 'neg')}</div>` : ''}

  <div class="sec">
    <h4>Talep kanıtı</h4>
    <p class="small">${popText}</p>
  </div>

  <div class="sec">
    <h4>İlk 10 rekabet özeti</h4>
    <div class="comp-grid">${compRows.map(([l, v]) => `<div class="fact"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
    <p class="mini" style="margin-top:8px">Ortalama puan ${cs.avgScore ?? '–'} · medyan yükleme ${fmtShort(cs.medianInstalls)} · ilk 10 toplam ${fmtShort(cs.sumInstalls)}</p>
  </div>

  <div class="sec">
    <h4>Trend geçmişi</h4>
    ${sparkline(r.hist)}
  </div>

  ${appsList.length ? `<div class="sec"><h4>Rakipler (arama sırasına göre)</h4>
    <details class="raw"${appsList.length <= 10 ? ' open' : ''}><summary>${appsList.length} rakibi göster / gizle</summary>
    <table class="apps"><thead><tr><th>#</th><th>Uygulama</th><th class="num">Yükleme</th><th class="num">Puan</th><th class="num">Değerl.</th><th>Güncelleme</th></tr></thead><tbody>
    ${appsList.map((a, i) => {
      const match = kwt.length && kwt.every((t) => toks(a.title).map(stem).includes(t));
      const isWeak = Number.isFinite(a.real) && a.real < 100000;
      return `<tr class="${isWeak ? 'weak' : ''}"><td class="mini">${i + 1}</td>
        <td class="t"><a href="${playUrl(a.id, market)}" target="_blank" rel="noopener">${esc(a.title)}</a>${match ? ' <span class="tag">başlıkta</span>' : ''}
        <div class="mini">${esc(a.dev || '')}${a.genre ? ` · ${esc(a.genre)}` : ''}${a.ads ? ' · reklam' : ''}${a.iap ? ' · IAP' : ''}${a.free === false ? ' · ücretli' : ''}</div></td>
        <td class="num">${fmtShort(a.real)}</td><td class="num">${a.score ?? '–'}</td><td class="num">${fmtShort(a.ratings)}</td><td class="num">${fmtDate(a.updated)}</td></tr>`;
    }).join('')}
    </tbody></table></details></div>` : ''}

  ${related.length ? `<div class="sec"><h4>İlgili kelimeler</h4><div class="kw-chips">${related.map((x) => `<button class="kw-chip" data-details="${esc(x.k)}">${esc(x.k)} <span class="o">${x.opportunity ?? '–'}</span></button>`).join('')}</div></div>` : ''}
  ${(r.variants || []).length ? `<div class="sec"><h4>Otomatik tamamlama varyantları</h4><div class="kw-chips">${r.variants.slice(0, 14).map((v) => `<button class="kw-chip" data-live="${esc(v)}">${esc(v)}</button>`).join('')}</div></div>` : ''}

  <div class="sec">
    <h4>Ham veriler</h4>
    <details class="raw"><summary>Tüm metrikleri göster</summary>
      <div class="facts">
        <div class="fact"><b>${r.opportunity ?? '–'}</b><span>Fırsat</span></div>
        <div class="fact"><b>${r.demand ?? '–'}</b><span>Talep</span></div>
        <div class="fact"><b>${r.difficulty ?? '–'}</b><span>Zorluk</span></div>
        <div class="fact"><b>${r.market ?? '–'}</b><span>Pazar</span></div>
        <div class="fact"><b>${c.titleMatches ?? '–'}/${c.n ?? '–'}</b><span>Başlıkta kelime</span></div>
        <div class="fact"><b>${c.weak ?? '–'}</b><span>Zayıf (&lt;100K)</span></div>
        <div class="fact"><b>${c.lowRated ?? '–'}</b><span>Düşük puan</span></div>
        <div class="fact"><b>${c.stale ?? '–'}</b><span>Bayat (1+ yıl)</span></div>
        <div class="fact"><b>${c.big ?? '–'}</b><span>Dev (10M+)</span></div>
        <div class="fact"><b>${c.avgScore ?? '–'}</b><span>Ort. puan</span></div>
        <div class="fact"><b>${fmtShort(c.sumInstalls)}</b><span>Toplam yükleme</span></div>
        <div class="fact"><b>${fmtShort(c.medianInstalls)}</b><span>Medyan yükleme</span></div>
        <div class="fact"><b>${c.ads ?? '–'}</b><span>Reklamlı</span></div>
        <div class="fact"><b>${c.iap ?? '–'}</b><span>IAP</span></div>
        <div class="fact"><b>${esc(SRC_LABEL[r.src] || r.src || '–')}</b><span>Kaynak</span></div>
        <div class="fact"><b>${esc(ST_LABEL[r.st] || r.st || '–')}</b><span>Durum</span></div>
        <div class="fact"><b>${fmtDate(r.first)}</b><span>Bulundu</span></div>
        <div class="fact"><b>${r.hits ?? '–'}</b><span>Bulunma sayısı</span></div>
      </div>
      <p class="mini" style="margin-top:8px">${r.seed ? `Tohum: ${esc(r.seed)} · ` : ''}Son analiz: ${fmtDateTime(r.at || r.analyzedAt)}</p>
    </details>
  </div>`;
}

/* ============================ çekmece ============================ */
function openDrawer(key) {
  const r = state.byKey.get(key) || (state.liveResult && state.liveResult.k === key ? state.liveResult : null);
  if (!r) return;
  state.drawerKey = key;
  $('#drawerTitle').textContent = r.k;
  const m = state.data?.market;
  $('#drawerSub').textContent = `${SRC_LABEL[r.src] || r.src || 'kayıt'}${r.seed ? ` · tohum: ${r.seed}` : ''}${m ? ` · ${m.country.toUpperCase()}/${m.lang}` : ''} · bulundu ${fmtDate(r.first)}`;
  $('#drawerBody').innerHTML = detailBody(r);
  $('#drawer').hidden = false;
  $('#drawerBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#drawerClose').focus();
}
function closeDrawer() {
  state.drawerKey = null;
  $('#drawer').hidden = true;
  $('#drawerBackdrop').hidden = true;
  document.body.style.overflow = '';
}

/* ============================ filtre + sıralama ============================ */
function matchesQuick(r, quick) {
  switch (quick) {
    case 'all': return r.dv !== 'PENDING';
    case 'GOLD': return r.dv === 'GOLD';
    case 'BUILD': return r.dv === 'GOLD' || r.dv === 'BUILD';
    case 'WATCH': return r.dv === 'WATCH';
    case 'new': return isNewOpportunity(r);
    case 'rising': return r.decision.trend.dir === 'rising';
    case 'saved': return state.stars.has(r.k);
    default: return true;
  }
}

function inNiche(r, niche) {
  if (!niche) return true;
  if (niche.type === 'seed') return r.seed === niche.name || r.k === niche.name;
  return r.tk.includes(niche.name);
}

function filterQuick() {
  const q = state.q.trim().toLowerCase();
  const a = state.adv;
  return state.records.filter((r) => {
    if (!matchesQuick(r, state.quick)) return false;
    if (q && !r.k.includes(q)) return false;
    if (!inNiche(r, state.niche)) return false;
    if (a.src && r.src !== a.src) return false;
    if (a.minOpp > 0 && !(r.opportunity >= a.minOpp)) return false;
    if (a.minDemand > 0 && !(r.demand >= a.minDemand)) return false;
    if (a.maxDiff < 100 && !(r.difficulty <= a.maxDiff)) return false;
    return true;
  });
}

const SORTERS = {
  verdict: compareByVerdict,
  newest: (a, b) => String(b.first || '').localeCompare(String(a.first || '')) || compareByVerdict(a, b),
  demand: (a, b) => (b.demand ?? -1) - (a.demand ?? -1) || compareByVerdict(a, b),
  easy: (a, b) => (a.difficulty ?? 999) - (b.difficulty ?? 999) || compareByVerdict(a, b),
  rising: (a, b) => (b.trendDelta ?? -999) - (a.trendDelta ?? -999) || compareByVerdict(a, b),
  market: (a, b) => (b.market ?? -1) - (a.market ?? -1) || compareByVerdict(a, b)
};

function sortRows(rows, key) {
  return rows.slice().sort(SORTERS[key] || compareByVerdict);
}

/* ============================ görünüm: genel bakış ============================ */
function renderOverview() {
  const d = state.data;
  if (!d) return;
  const c = state.counts;
  const analyzed = state.records.filter((r) => r.dv !== 'PENDING');
  const best = Math.max(0, ...analyzed.map((r) => (Number.isFinite(r.opportunity) ? r.opportunity : 0)));
  const newOpps = state.records.filter(isNewOpportunity);
  const rising = state.records.filter((r) => r.decision.trend.dir === 'rising');
  const cells = [
    ['s-gold', c.GOLD, 'GOLD', 'GOLD'],
    ['s-build', c.BUILD, 'BUILD', 'BUILD'],
    ['s-watch', c.WATCH, 'WATCH', 'WATCH'],
    ['', c.WEAK, 'WEAK', null],
    ['s-skip', c.SKIP, 'SKIP', null],
    ['', best || '–', 'En iyi skor', null],
    ['', newOpps.length ? `+${newOpps.length}` : '0', 'Yeni fırsat (7g)', 'new'],
    ['', fmtRel(d.generatedAt), 'Son tarama', null]
  ];
  $('#summary').innerHTML = cells.map(([cls, v, l, quick]) => {
    const body = `<b>${typeof v === 'number' ? fmtInt(v) : esc(String(v))}</b><span>${esc(l)}</span>`;
    return quick
      ? `<button class="sum ${cls}" data-quick="${quick}" title="${esc(l)} listesine git">${body}</button>`
      : `<div class="sum ${cls}">${body}</div>`;
  }).join('');
  const s = d.stats || {};
  $('#summarySub').textContent = `${fmtInt(s.keywords)} kelime evreninde ${fmtInt(analyzed.length)} tanesi puanlandı, ${fmtInt(s.pending)} tanesi sırada. ${fmtInt((d.niches || []).length)} niş, ${fmtInt(s.apps)} rakip uygulama. ${fmtInt(s.runs)} tarama koşusu.`;

  // en iyi fırsatlar
  const ranked = sortRows(analyzed.filter((r) => r.demand > 0), 'verdict');
  const top = ranked.filter((r) => ['GOLD', 'BUILD'].includes(r.dv)).slice(0, 8);
  if (top.length) {
    renderList($('#topOpps'), top);
  } else {
    const fallback = ranked.slice(0, 5);
    $('#topOpps').innerHTML = `<div class="empty"><strong>Şu anda GOLD veya BUILD fırsat yok.</strong>Tarama büyüdükçe burası dolacak. Şimdilik en güçlü adaylar aşağıda.</div>
      <p class="fallback-note">En iyi mevcut adaylar</p><div class="opp-list">${fallback.map(oppCard).join('')}</div>`;
  }

  renderList($('#newOpps'), sortRows(newOpps, 'verdict').slice(0, 6),
    '<div class="empty">Son 7 günde yeni fırsat bulunmadı.</div>');
  renderList($('#risingOpps'), sortRows(rising, 'rising').slice(0, 6),
    '<div class="empty"><strong>Henüz yükselen kelime yok.</strong>Bir kelimenin trendi ikinci kez ölçüldükten sonra oluşur; tarayıcı önce bekleyen kelimeleri işler, eski analizleri periyodik olarak yeniler.</div>');
}

/* ============================ görünüm: fırsatlar ============================ */
function renderQuickFilters() {
  const c = state.counts;
  const savedCount = state.records.filter((r) => state.stars.has(r.k)).length;
  const defs = [
    ['all', 'Tümü', c.GOLD + c.BUILD + c.WATCH + c.WEAK + c.SKIP, ''],
    ['GOLD', '★ GOLD', c.GOLD, 'c-gold'],
    ['BUILD', 'BUILD', c.GOLD + c.BUILD, 'c-build'],
    ['WATCH', 'WATCH', c.WATCH, 'c-watch'],
    ['new', 'Yeni', state.records.filter(isNewOpportunity).length, ''],
    ['rising', 'Yükselen', state.records.filter((r) => r.decision.trend.dir === 'rising').length, ''],
    ['saved', '★ Kayıtlı', savedCount, '']
  ];
  $('#quickFilters').innerHTML = defs.map(([key, label, n, cls]) =>
    `<button class="chip ${cls} ${state.quick === key ? 'on' : ''}" data-quick="${key}" aria-pressed="${state.quick === key}">${esc(label)}<span class="n">${fmtInt(n)}</span></button>`).join('');
  const badge = $('#savedCount');
  badge.textContent = fmtInt(state.stars.size);
  badge.hidden = state.stars.size === 0;
}

function renderAdvanced() {
  const a = state.adv;
  $('#advanced').innerHTML = `<div class="controls">
    <label class="field range">Min. fırsat <input type="range" data-adv="minOpp" min="0" max="100" value="${a.minOpp}"><output>${a.minOpp}</output></label>
    <label class="field range">Min. talep <input type="range" data-adv="minDemand" min="0" max="100" value="${a.minDemand}"><output>${a.minDemand}</output></label>
    <label class="field range">Maks. rekabet <input type="range" data-adv="maxDiff" min="0" max="100" value="${a.maxDiff}"><output>${a.maxDiff}</output></label>
    <select data-adv="src" aria-label="Kaynak">
      ${[['', 'Tüm kaynaklar'], ['seed', 'Tohum'], ['suggest', 'Otomatik tamamlama'], ['letter', 'Otomatik tamamlama (harf)'], ['variant', 'Varyant'], ['chart', 'Liste başlıkları'], ['title', 'Arama başlıkları']]
        .map(([v, l]) => `<option value="${v}" ${a.src === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <button class="ghost" data-adv-reset>Sıfırla</button>
    <span class="muted small">Sayısal filtrelerin tamamı Analist Modu'nda da var.</span>
  </div>`;
}

function renderOpportunities(reset = true) {
  if (reset) state.shown = 60;
  renderQuickFilters();
  const rows = sortRows(filterQuick(), state.sort);
  const shown = rows.slice(0, state.shown);
  const el = $('#cards');

  if (!rows.length) {
    if (state.quick === 'GOLD') {
      const alt = sortRows(state.records.filter((r) => r.dv === 'BUILD' || r.dv === 'WATCH'), 'verdict').slice(0, 6);
      el.innerHTML = `<div class="empty"><strong>Şu anda GOLD fırsat yok.</strong>GOLD için 70+ fırsat puanı ve yeterli talep gerekir.</div>
        ${alt.length ? `<p class="fallback-note">En iyi mevcut adaylar</p><div class="opp-list">${alt.map(oppCard).join('')}</div>` : ''}`;
    } else if (state.quick === 'saved') {
      el.innerHTML = '<div class="empty"><strong>Henüz kaydedilmiş fırsat yok.</strong>Kartlardaki ☆ düğmesine basarak buraya ekle.</div>';
    } else if (state.quick === 'rising') {
      el.innerHTML = '<div class="empty"><strong>Yükselen kelime yok.</strong>Trend ancak bir kelime ikinci kez ölçüldüğünde hesaplanır; tarayıcı eski analizleri periyodik olarak yeniler. Eksik geçmiş için veri uydurulmaz.</div>';
    } else {
      el.innerHTML = '<div class="empty"><strong>Filtrelere uyan kelime yok.</strong>Aramayı temizle veya filtreleri gevşet.</div>';
    }
  } else {
    el.innerHTML = shown.map(oppCard).join('');
  }
  $('#countInfo').textContent = rows.length ? `${fmtInt(shown.length)} / ${fmtInt(rows.length)} fırsat` : '';
  $('#more').hidden = state.shown >= rows.length;
  const chip = $('#nicheChip');
  if (state.niche) {
    chip.innerHTML = `Niş filtresi: <strong>${esc(state.niche.name)}</strong> <button class="kw-chip" data-clear-niche>kaldır ✕</button>`;
  } else chip.innerHTML = '';
}

/* ============================ görünüm: kaydedilenler ============================ */
function renderSaved() {
  const rows = sortRows(state.records.filter((r) => state.stars.has(r.k)), 'verdict');
  renderList($('#savedList'), rows, '<div class="empty"><strong>Henüz kaydedilmiş fırsat yok.</strong>Herhangi bir karttaki ☆ düğmesine bas; burada birikirler ve tarayıcında saklanır.</div>');
}

/* ============================ görünüm: nişler ============================ */
function nicheMembers(niche) {
  return state.records.filter((r) => inNiche(r, niche));
}
function buildNicheCards() {
  if (state.nicheCache) return state.nicheCache;
  const list = (state.data?.niches || []).map((n) => {
    const members = nicheMembers(n);
    return { ...n, members, nv: getNicheVerdict(n, members) };
  });
  list.sort((a, b) => (VERDICT_ORDER[a.nv.verdict] - VERDICT_ORDER[b.nv.verdict]) || (b.score - a.score));
  state.nicheCache = list;
  return list;
}

function renderNiches() {
  const q = $('#nicheQ').value.trim().toLowerCase();
  const type = $('#nicheType').value;
  const minVerdict = $('#nicheVerdict').value;
  const cap = minVerdict ? VERDICT_ORDER[minVerdict] : 9;
  const list = buildNicheCards().filter((n) =>
    (!type || n.type === type) &&
    VERDICT_ORDER[n.nv.verdict] <= cap &&
    (!q || n.name.includes(q) || (n.keywords || []).some((k) => k.includes(q))));
  const el = $('#niches');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><strong>Bu filtrelere uyan niş yok.</strong>Nişler, en az üç talepli kelime aynı grupta buluştuğunda oluşur.</div>';
    return;
  }
  el.innerHTML = list.map((n) => {
    const nv = n.nv;
    const best = nv.best;
    return `<article class="niche v-${nv.verdict.toLowerCase()}">
      <div class="niche-head">
        <div>${vbadge(nv.verdict)}<h3 style="margin-top:7px">${esc(n.name)}</h3>
          <div class="mini">${n.type === 'seed' ? 'tohum grubu' : 'ortak kelime'} · ${fmtInt(nv.useful)} işe yarar kelime / ${fmtInt(n.count)}</div></div>
        <div style="text-align:right"><div class="niche-score">${fmtInt(n.score)}</div><div class="mini">niş skoru</div></div>
      </div>
      ${best ? `<div class="niche-best">En iyi: <strong>${esc(best.k)}</strong> — ${best.opportunity ?? '–'}</div>` : ''}
      <div class="opp-metrics">
        ${metric('Talep', nv.demand.value, nv.demand, { tip: 'demand' })}
        ${metric('Rekabet', nv.competition.value, nv.competition, { invert: true, tip: 'difficulty' })}
        ${trendMetric(nv.trend)}
      </div>
      <p class="mini">${esc(nv.reason)}</p>
      <div><button class="ghost" data-niche="${esc(n.name)}" data-niche-type="${esc(n.type)}">Nişi aç →</button></div>
    </article>`;
  }).join('');
}

/* ============================ görünüm: analist modu ============================ */
function filterAnalyst() {
  const a = state.analyst;
  const q = a.q.trim().toLowerCase();
  return state.records.filter((r) => {
    if (a.status === 'analyzed' && !(r.st === 'ok' || r.st === 'partial')) return false;
    if (a.status === 'demand' && !(r.demand > 0)) return false;
    if (a.status === 'no-demand' && r.st !== 'no-demand') return false;
    if (a.status === 'pending' && !['pending', 'error'].includes(r.st)) return false;
    if (a.src && r.src !== a.src) return false;
    if (q && !r.k.includes(q)) return false;
    if (!inNiche(r, state.niche)) return false;
    if (a.minOpp > 0 && !(r.opportunity >= a.minOpp)) return false;
    if (a.minDemand > 0 && !(r.demand >= a.minDemand)) return false;
    if (a.maxDiff < 100 && !(r.difficulty <= a.maxDiff)) return false;
    return true;
  });
}

function analystRows() {
  const { key, dir } = state.analyst.sort;
  return filterAnalyst().sort((a, b) => {
    const va = a[key]; const vb = b[key];
    const na = va === null || va === undefined;
    const nb = vb === null || vb === undefined;
    if (na && nb) return a.k.localeCompare(b.k);
    if (na) return 1;
    if (nb) return -1;
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * (va - vb) || a.k.localeCompare(b.k);
  });
}

function bar(v, invert = false) {
  if (!Number.isFinite(v)) return '<span class="muted">–</span>';
  const x = invert ? 100 - v : v;
  const c = x >= 60 ? 'var(--good)' : x >= 40 ? 'var(--mid)' : 'var(--bad)';
  return `<span class="bar"><i style="--w:${v}%;--c:${c}"></i><b>${v}</b></span>`;
}

function renderAnalyst(reset = true) {
  if (reset) state.analyst.shown = 100;
  const rows = analystRows();
  const shown = rows.slice(0, state.analyst.shown);
  $$('#kwTable th[data-sort]').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === state.analyst.sort.key));
  const tbody = $('#kwTable tbody');
  tbody.innerHTML = shown.length ? shown.map((r) => {
    const starred = state.stars.has(r.k);
    const t = r.decision.trend;
    const trend = t.dir === 'new' ? '<span class="muted">yeni</span>'
      : t.delta > 0 ? `<span class="up">▲ ${t.delta}</span>`
      : t.delta < 0 ? `<span class="down">▼ ${-t.delta}</span>` : '<span class="muted">0</span>';
    return `<tr>
      <td class="star-col"><button class="star ${starred ? 'on' : ''}" data-star="${esc(r.k)}" aria-label="Kaydet">${starred ? '★' : '☆'}</button></td>
      <td>${vbadge(r.dv)}</td>
      <td class="kw">${esc(r.k)} ${r.st !== 'ok' ? `<span class="tag">${esc(ST_LABEL[r.st] || r.st)}</span>` : ''}</td>
      <td class="num">${bar(r.opportunity)}</td>
      <td class="num">${bar(r.demand)}</td>
      <td class="num">${bar(r.difficulty, true)}</td>
      <td class="num">${r.market ?? '–'}</td>
      <td class="num">${r.titleMatches === null ? '–' : `${r.titleMatches}/${r.comp.n}`}</td>
      <td class="num">${r.weak ?? '–'}</td>
      <td class="num">${r.avgScore ?? '–'}</td>
      <td class="num">${trend}</td>
      <td class="num muted">${fmtDate(r.first)}</td>
      <td><button class="icon-btn" data-details="${esc(r.k)}">Detay</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="13" class="empty">Filtrelere uyan kelime yok.</td></tr>';
  $('#aCountInfo').textContent = `${fmtInt(shown.length)} / ${fmtInt(rows.length)} kelime${state.niche ? ` · niş: ${state.niche.name}` : ''}`;
  $('#aMore').hidden = state.analyst.shown >= rows.length;
}

function exportCsv() {
  const rows = analystRows();
  const cols = ['kelime', 'karar', 'gerekce', 'firsat', 'firsat_seviye', 'talep', 'talep_seviye', 'zorluk', 'zorluk_seviye', 'pazar', 'trend', 'trend_degisim', 'baslikta', 'rakip_sayisi', 'zayif', 'dusuk_puan', 'bayat', 'dev', 'ort_puan', 'toplam_yukleme', 'kaynak', 'tohum', 'bulundu', 'son_analiz', 'ilk_10'];
  const lines = [cols.join(';')];
  for (const r of rows) {
    const c = r.comp || {};
    const d = r.decision;
    const apps = (r.top || []).map((id) => state.data?.apps?.[id]?.title).filter(Boolean).join(' | ');
    const vals = [r.k, d.verdict, d.reason, r.opportunity, opportunityLevel(r.opportunity).label, r.demand, demandLevel(r.demand).label,
      r.difficulty, difficultyLevel(r.difficulty).label, r.market, d.trend.dir === 'new' ? 'YENİ' : d.trend.label, r.trendDelta,
      c.titleMatches, c.n, c.weak, c.lowRated, c.stale, c.big, c.avgScore, c.sumInstalls,
      SRC_LABEL[r.src] || r.src, r.seed, r.first, r.at, apps];
    lines.push(vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
  }
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `play-firsatlar-${state.marketId}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============================ görünüm: canlı analiz ============================ */
function apiUrl(path) {
  const base = state.apiBase ? `${state.apiBase.replace(/\/+$/, '')}/` : './';
  return base + path;
}
async function detectLive() {
  try {
    const r = await fetch(apiUrl('api/health'), { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    state.live = !!(j && j.ok);
  } catch { state.live = false; }
  $('#liveBtn').disabled = !state.live;
  $('#liveStatus').innerHTML = state.live
    ? `Hazır${state.apiBase ? ` · API: ${esc(state.apiBase)}` : ''}. Kelimeyi yaz, karar birkaç saniyede gelir.`
    : 'Canlı analiz bu dağıtımda kapalı: GitHub Pages statiktir. Vercel dağıtımının adresini aşağıdaki API ayarına yaz ya da yerelde <code>npm run serve</code> ile çalıştır.';
}

async function runLive(term, marketStr) {
  const [gl, hl] = (marketStr || 'us:en').split(':');
  const out = $('#liveResult');
  out.innerHTML = '<div class="verdict-hero v-pending"><p class="muted">Analiz ediliyor: otomatik tamamlama ikili araması, arama sonuçları ve ilk 10 uygulamanın detayları çekiliyor…</p></div>';
  try {
    const r = await fetch(apiUrl(`api/analyze?q=${encodeURIComponent(term)}&gl=${gl}&hl=${hl}`));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const res = j.result;
    const rec = {
      ...res,
      st: res.status === 'no-demand' ? 'no-demand' : res.partial ? 'partial' : 'ok',
      at: res.analyzedAt, src: 'live', first: null, hist: []
    };
    rec.decision = getOpportunityVerdict(rec);
    rec.dv = rec.decision.verdict;
    state.liveResult = rec;
    const d = rec.decision;
    out.innerHTML = `<div class="verdict-hero v-${d.verdict.toLowerCase()}">
      ${detailBody(rec, { market: { country: gl, lang: hl }, apps: res.apps || [] })}
      <p class="mini" style="margin-top:14px">${esc(rec.k)} · ${gl.toUpperCase()}/${hl} · ${j.cached ? 'önbellekten' : 'canlı ölçüm'} · ${fmtDateTime(res.analyzedAt)}</p>
    </div>`;
  } catch (err) {
    out.innerHTML = `<div class="verdict-hero v-skip"><h3>Analiz başarısız</h3><p class="muted">${esc(err.message)}</p></div>`;
  }
}

/* ============================ gezinme ============================ */
function showView(name) {
  if (!VIEWS.includes(name)) name = 'overview';
  state.view = name;
  $$('.nav-btn').forEach((b) => {
    const on = b.dataset.view === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  $$('main .view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  if (location.hash.replace('#', '') !== name) history.replaceState(null, '', `#${name}`);
  if (name === 'overview') renderOverview();
  if (name === 'opportunities') renderOpportunities();
  if (name === 'niches') renderNiches();
  if (name === 'saved') renderSaved();
  if (name === 'analyst') renderAnalyst();
  if (name === 'live' && !state.liveChecked) { state.liveChecked = true; detectLive(); }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function refreshCurrent() {
  if (state.view === 'overview') renderOverview();
  else if (state.view === 'opportunities') renderOpportunities(false);
  else if (state.view === 'saved') renderSaved();
  else if (state.view === 'analyst') renderAnalyst(false);
  else if (state.view === 'niches') renderNiches();
  renderQuickFilters();
}

function toggleStar(key) {
  if (state.stars.has(key)) state.stars.delete(key); else state.stars.add(key);
  saveStars();
  refreshCurrent();
}

function openNiche(name, type) {
  state.niche = { name, type };
  state.quick = 'all';
  state.q = '';
  $('#q').value = '';
  state.sort = 'verdict';
  $('#sort').value = 'verdict';
  showView('opportunities');
}

/* ============================ olaylar ============================ */
function bind() {
  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-view-link]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.viewLink)));

  $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderOpportunities(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderOpportunities(); });
  $('#more').addEventListener('click', () => { state.shown += 60; renderOpportunities(false); });
  $('#advToggle').addEventListener('click', (e) => {
    const box = $('#advanced');
    box.hidden = !box.hidden;
    e.target.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) renderAdvanced();
  });
  $('#advanced').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.adv) return;
    const key = t.dataset.adv;
    state.adv[key] = t.type === 'range' ? Number(t.value) : t.value;
    if (t.type === 'range' && t.nextElementSibling) t.nextElementSibling.value = t.value;
    renderOpportunities();
  });
  $('#advanced').addEventListener('click', (e) => {
    if (!e.target.closest('[data-adv-reset]')) return;
    state.adv = { minOpp: 0, minDemand: 0, maxDiff: 100, status: 'analyzed', src: '' };
    renderAdvanced();
    renderOpportunities();
  });

  $('#nicheQ').addEventListener('input', renderNiches);
  $('#nicheType').addEventListener('change', renderNiches);
  $('#nicheVerdict').addEventListener('change', renderNiches);

  // analist modu
  $('#aq').addEventListener('input', (e) => { state.analyst.q = e.target.value; renderAnalyst(); });
  $('#aStatus').addEventListener('change', (e) => { state.analyst.status = e.target.value; renderAnalyst(); });
  $('#aSrc').addEventListener('change', (e) => { state.analyst.src = e.target.value; renderAnalyst(); });
  for (const [id, key, out] of [['#aMinOpp', 'minOpp', '#aMinOppV'], ['#aMinDemand', 'minDemand', '#aMinDemandV'], ['#aMaxDiff', 'maxDiff', '#aMaxDiffV']]) {
    $(id).addEventListener('input', (e) => { state.analyst[key] = Number(e.target.value); $(out).value = e.target.value; renderAnalyst(); });
  }
  $$('#kwTable th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    const s = state.analyst.sort;
    if (s.key === key) s.dir *= -1;
    else state.analyst.sort = { key, dir: ['k', 'first', 'verdictOrder'].includes(key) ? 1 : -1 };
    renderAnalyst();
  }));
  $('#aMore').addEventListener('click', () => { state.analyst.shown += 100; renderAnalyst(false); });
  $('#exportCsv').addEventListener('click', exportCsv);

  // canlı analiz
  $('#liveForm').addEventListener('submit', (e) => { e.preventDefault(); runLive($('#liveQ').value.trim(), $('#liveMarket').value); });
  $('#apiBase').value = state.apiBase;
  $('#saveApi').addEventListener('click', () => {
    state.apiBase = $('#apiBase').value.trim();
    try { localStorage.setItem('apiBase', state.apiBase); } catch { /* yoksay */ }
    detectLive();
  });

  $('#market').addEventListener('change', (e) => switchMarket(e.target.value));
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.drawerKey) closeDrawer();
  });

  // tek delege: yıldız, detay, niş, hızlı filtre, tooltip
  document.body.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { toggleStar(star.dataset.star); return; }

    const det = e.target.closest('[data-details]');
    if (det) { openDrawer(det.dataset.details); return; }

    const quick = e.target.closest('[data-quick]');
    if (quick) {
      state.quick = quick.dataset.quick;
      if (state.view !== 'opportunities') showView('opportunities'); else renderOpportunities();
      return;
    }

    const ni = e.target.closest('[data-niche]');
    if (ni) { openNiche(ni.dataset.niche, ni.dataset.nicheType); return; }

    if (e.target.closest('[data-clear-niche]')) { state.niche = null; renderOpportunities(); return; }

    const lv = e.target.closest('[data-live]');
    if (lv) {
      const k = lv.dataset.live;
      const existing = state.byKey.get(k);
      if (existing && existing.dv !== 'PENDING') { closeDrawer(); openDrawer(k); return; }
      closeDrawer();
      showView('live');
      $('#liveQ').value = k;
      if (state.data?.market) $('#liveMarket').value = `${state.data.market.country}:${state.data.market.lang}`;
      if (state.live) runLive(k, $('#liveMarket').value);
      return;
    }

    // açıklama balonu kart tıklamasından önce değerlendirilir
    const tip = e.target.closest('.info');
    $$('.info.show-tip').forEach((el) => { if (el !== tip) el.classList.remove('show-tip'); });
    if (tip) { tip.classList.toggle('show-tip'); return; }

    // kartın boş bir yerine tıklamak detayı açar (düğmeler ve bağlantılar hariç)
    const card = e.target.closest('.opp[data-k]');
    if (card && !e.target.closest('button, a, .info')) openDrawer(card.dataset.k);
  });
  document.body.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('info')) {
      e.preventDefault();
      e.target.classList.toggle('show-tip');
    }
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#', '');
    if (VIEWS.includes(h) && h !== state.view) showView(h);
  });
}

/* ============================ başlatma ============================ */
function notice(html) {
  const n = $('#notice');
  n.innerHTML = html;
  n.hidden = false;
}

async function switchMarket(id) {
  state.marketId = id;
  try { localStorage.setItem('market', id); } catch { /* yoksay */ }
  try {
    state.data = await loadJson(`./data/${encodeURIComponent(id)}.json`);
  } catch (err) {
    notice(`Pazar verisi yüklenemedi: ${esc(err.message)}`);
    return;
  }
  rebuild();
  const m = state.data.market;
  if (m) $('#liveMarket').value = `${m.country}:${m.lang}`;
  $('#footInfo').textContent = `Son tarama: ${fmtDateTime(state.data.generatedAt)} · pazar ${m ? `${m.country.toUpperCase()}/${m.lang}` : id}`;
  closeDrawer();
  showView(state.view);
}

async function init() {
  bind();
  try {
    state.index = await loadJson('./data/index.json');
  } catch {
    notice('Henüz veri yok. İlk taramayı çalıştır: yerelde <code>npm run crawl</code>, ya da GitHub\'da <strong>Actions → crawl → Run workflow</strong>. Tarama günlük olarak otomatik da çalışır.');
    return;
  }
  const markets = state.index.markets || [];
  if (!markets.length) { notice('Henüz hiçbir pazar taranmamış.'); return; }
  $('#market').innerHTML = markets.map((m) =>
    `<option value="${esc(m.id)}">${esc(m.country.toUpperCase())} / ${esc(m.lang)} · ${fmtInt(m.analyzed)} analiz</option>`).join('');
  let saved = null;
  try { saved = localStorage.getItem('market'); } catch { /* yoksay */ }
  const first = markets.some((m) => m.id === saved) ? saved : markets[0].id;
  $('#market').value = first;
  const hash = location.hash.replace('#', '');
  if (VIEWS.includes(hash)) state.view = hash;
  await switchMarket(first);
}

init();
