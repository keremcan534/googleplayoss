/*
 * Play Fırsat Radarı — karar odaklı arayüz.
 * Bağımlılık yok. Karar mantığı public/js/verdict.js içinde (sunum katmanı, skorları değiştirmez).
 */
import {
  getOpportunityVerdict, getNicheVerdict, competitorSummary, compareByVerdict,
  demandLevel, difficultyLevel, opportunityLevel, marketLevel, reachLevel, fmtInstalls,
  VERDICT_META, VERDICT_ORDER, GUARDS
} from './js/verdict.js';
import { langOf, tokensFor } from './js/lang.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('tr-TR');
const DAY = 86400000;
const VIEWS = ['overview', 'opportunities', 'niches', 'ranking', 'live', 'saved', 'analyst', 'help'];
const OPPORTUNITY_VERDICTS = ['GOLD', 'BUILD', 'WATCH'];
/** "Gerçekçi" eşiği: kararı BUILD+ olan VE erişim puanı bunun üstünde olanlar. */
const REALISTIC_REACH = 65;
/** İlk 10 örtüşmesi bu oranın üstündeyse iki kelime aynı pazardır. */
const VARIANT_OVERLAP = 0.6;
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
/** Aktif pazarın dili (kökleme ve harf kuralları için). */
const marketLang = () => (state.data && state.data.market && state.data.market.lang) || 'en';
/** Metni aktif pazarın diline göre köklenmiş parçalara ayırır. */
const stemmed = (s, lang = marketLang()) => {
  const L = langOf(lang);
  return tokensFor(s, L.code).map(L.stem);
};

const SRC_LABEL = { seed: 'Tohum', suggest: 'Öneri', letter: 'Öneri (harf)', variant: 'Varyant', chart: 'Liste', title: 'Başlık', live: 'Canlı' };
const ST_LABEL = { ok: 'Analiz edildi', partial: 'Eksik veri', pending: 'Bekliyor', error: 'Hata', 'no-demand': 'Talep yok' };
const TIPS = {
  opportunity: 'Fırsat: talep ve rekabetin birleşimi. √(talep × (100 − zorluk)); zayıf, düşük puanlı ve bayat rakipler küçük bonus verir.',
  demand: 'Talep: Google Play otomatik tamamlamadan türetilen göreli arama ilgisi. Gerçek arama hacmi değildir.',
  difficulty: 'Rekabet: ilk 10 uygulamanın gücü. Yükleme sayısı, değerlendirme, puan, başlık eşleşmesi ve güncellik.',
  market: 'Pazar: ilk 10 uygulamanın toplam yüklemesi. Büyük pazar çok talep, küçük pazar keşfedilmemiş alan demek olabilir.',
  trend: 'Trend: fırsat puanının önceki taramalara göre değişimi. Yeterli geçmiş yoksa YENİ yazar, trend uydurulmaz.',
  reach: 'Erişim: sıralamaya girersem gerçekten indirme gelir mi? İlk 10\'un en zayıf uygulamasının yüklemesi (girmek kolay mı), orta sıradaki rakiplerin yüklemesi (girince ne alırım) ve son 2 yılda ilk 10\'a girebilmiş uygulama sayısından hesaplanır. Trafik tahmini değildir.',
  entry: 'Giriş bariyeri: ilk 10\'daki en zayıf uygulamanın yükleme sayısı. Küçükse yeni bir uygulama sıralamaya girebilir; milyonlarsa giremez.',
  midpack: 'Orta sıra: 3. sıradan sonuncuya kadarki uygulamaların medyan yüklemesi. Lideri saymaz. Ortalarda bir yere yerleşirsen komşularının durumu budur.',
  leader: 'Lider payı: ilk 10\'un toplam yüklemesinin ne kadarı bir numaradaki uygulamada. Yüksekse pazar tek uygulamanın.',
  money: 'Gelir modeli: ilk 10 uygulamanın kaçında uygulama içi satın alma, reklam ya da ücretli sürüm var. Bir alanda kimse para kazanmıyorsa sen de kazanamazsın. (Gerçek gelir verisi herkese açık değildir.)',
  engagement: 'Kullanıcı ilgisi: 1000 yüklemeye düşen değerlendirme sayısı (ilk 10 medyanı). Yükleyenlerin ne kadarı uygulamayı kullanıp puan verecek kadar benimsemiş. Conversion rate DEĞİLDİR; mağaza sayfası görüntüleri sadece uygulama sahibine açıktır.',
  newcomers: 'Yeni girenler: ilk 10\'daki uygulamalardan kaçı son 2 yılda yayınlanmış. Sıfırsa pazar yeniye kapalı demektir.'
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
  variantMap: new Map(), collapse: true,
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
    reachScore: decision.reach.has ? decision.reach.score : null,
    realistic: ['GOLD', 'BUILD'].includes(decision.verdict) && decision.reach.has && decision.reach.score >= REALISTIC_REACH,
    titleMatches: num(c.titleMatches),
    weak: num(c.weak),
    avgScore: num(c.avgScore),
    tk: stemmed(record.k)
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

function tags(r, opts = {}) {
  const out = [];
  const x = r.decision.reach;
  if (state.stars.has(r.k)) out.push('<span class="tag t-star">★ kayıtlı</span>');
  if (r.realistic) out.push('<span class="tag t-real">gerçekçi</span>');
  if (x.has && x.wall === 'hard') out.push('<span class="tag t-risk">giriş duvarı</span>');
  else if (x.has && x.wall === 'soft') out.push('<span class="tag t-risk">giriş zor</span>');
  if (x.has && x.pond === 'dead') out.push('<span class="tag t-risk">ölü gölet</span>');
  else if (x.has && x.pond === 'thin') out.push('<span class="tag t-risk">ince pazar</span>');
  const vc = opts.variants || 0;
  if (vc) out.push(`<span class="tag t-var" title="Aynı rakiplere düşen ${vc} kelime daha">+${vc} varyant</span>`);
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
  const variants = (state.variantMap.get(r.k) || []).length;
  return `<article class="opp v-${d.verdict.toLowerCase()}" data-k="${esc(r.k)}">
    <div class="opp-verdict">${vbadge(d.verdict)}</div>
    <div class="opp-main">
      <div class="opp-head"><h3>${esc(r.k)}</h3>${tags(r, { variants })}</div>
      <p class="opp-reason">${esc(d.reason)}</p>
    </div>
    <div class="opp-score" title="Fırsat puanı"><b>${Number.isFinite(r.opportunity) ? r.opportunity : '–'}</b><span>${ol.label}</span></div>
    <div class="opp-metrics">
      ${metric('Talep', r.demand, dl, { tip: 'demand' })}
      ${metric('Rekabet', r.difficulty, cl, { invert: true, tip: 'difficulty' })}
      ${metric('Erişim', r.reachScore, reachLevel(r.reachScore), { tip: 'reach' })}
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
  const lang = (opts.market && opts.market.lang) || marketLang();
  const kwt = stemmed(r.k, lang);
  const pop = r.pop;
  const popText = pop && pop.minPrefix
    ? `<code>${esc(r.k.slice(0, pop.minPrefix))}</code> yazıldığında ${pop.mode === 'ext' ? `<em>${esc(pop.via || '')}</em> öneriliyor (kelimenin kendisi değil, uzantısı)` : 'kelimenin kendisi öneriliyor'}; öneri listesinde ${pop.pos}. sırada, ${pop.minPrefix}/${pop.len} harf.`
    : 'Otomatik tamamlamada ne kelimenin kendisi ne de uzantısı görünüyor.';
  const related = (state.records || [])
    .filter((x) => x.k !== r.k && x.demand > 0 && ((r.seed && x.seed === r.seed) || x.seed === r.k || (r.seed && x.k === r.seed)))
    .sort(compareByVerdict).slice(0, 10);

  const x = d.reach;
  const variants = state.variantMap.get(r.k) || [];
  const reachBlock = x.has ? `
  <div class="sec">
    <h4>Girebilir miyim, girince ne alırım? ${info('reach')}</h4>
    <div class="hero-metrics">
      ${metric('Erişim puanı', x.score, reachLevel(x.score), { tip: 'reach' })}
      <div class="m"><span>Giriş bariyeri ${info('entry')}</span><b>${fmtInstalls(x.entry)}</b><i>${x.wall === 'hard' ? 'DUVAR' : x.wall === 'soft' ? 'ZOR' : x.wall === 'open' ? 'KOLAY' : 'NORMAL'}</i></div>
      <div class="m"><span>Orta sıra ${info('midpack')}</span><b>${fmtInstalls(x.midpack)}</b><i>${x.pond === 'dead' ? 'ÖLÜ' : x.pond === 'thin' ? 'İNCE' : x.pond === 'healthy' ? 'SAĞLAM' : 'NORMAL'}</i></div>
      <div class="m"><span>Yeni girenler ${info('newcomers')}</span><b>${x.newcomers}/${x.dated || '–'}</b><i>${x.frozen ? 'DONMUŞ' : x.newcomers >= 3 ? 'AÇIK' : 'SINIRLI'}</i></div>
      <div class="m"><span>Lider payı ${info('leader')}</span><b>${x.leaderShare === null ? '–' : `%${Math.round(x.leaderShare * 100)}`}</b><i>${x.dominated ? 'TEK HAKİM' : 'DAĞINIK'}</i></div>
    </div>
    <p class="mini" style="margin-top:8px">İlk 10'da 10 binin altında yüklemesi olan ${x.tiny ?? '–'} uygulama var${Number.isFinite(x.entry2) ? `; en zayıf ikinci uygulama ${fmtInstalls(x.entry2)} yükleme` : ''}${x.medianAgeYears !== null ? `; rakiplerin medyan yaşı ${x.medianAgeYears} yıl` : ''}.</p>
  </div>` : '';
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

  ${reachBlock}
  ${variants.length ? `<div class="sec"><h4>Aynı pazara düşen varyantlar</h4>
    <p class="mini">Bu kelimelerin arama sonuçları neredeyse aynı; ayrı fırsat değil, aynı fikrin farklı yazımı.</p>
    <div class="kw-chips">${variants.map((v) => `<button class="kw-chip" data-details="${esc(v.k)}">${esc(v.k)} <span class="o">${v.opportunity ?? '–'}</span></button>`).join('')}</div></div>` : ''}
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
    <div class="comp-grid" style="margin-top:8px">
      <div class="fact"><b>${cs.monetized === null ? '–' : `${cs.monetized}/${cs.n}`}</b><span>Gelir modeli var ${info('money')}</span></div>
      <div class="fact"><b>${cs.iap}/${cs.n}</b><span>Uygulama içi satın alma</span></div>
      <div class="fact"><b>${cs.ads}/${cs.n}</b><span>Reklamlı</span></div>
      <div class="fact"><b>${cs.engagement === null ? '–' : cs.engagement}</b><span>1000 yüklemede değerlendirme ${info('engagement')}</span></div>
    </div>
  </div>

  <div class="sec">
    <h4>Trend geçmişi</h4>
    ${sparkline(r.hist)}
  </div>

  ${appsList.length ? `<div class="sec"><h4>Rakipler (arama sırasına göre)</h4>
    <details class="raw"${appsList.length <= 10 ? ' open' : ''}><summary>${appsList.length} rakibi göster / gizle</summary>
    <table class="apps"><thead><tr><th>#</th><th>Uygulama</th><th class="num">Yükleme</th><th class="num">Puan</th><th class="num">Değerl.</th><th>Güncelleme</th></tr></thead><tbody>
    ${appsList.map((a, i) => {
      const titleTokens = stemmed(a.title, lang);
      const match = kwt.length && kwt.every((t) => titleTokens.includes(t));
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
        <div class="fact"><b>${fmtShort(c.entry)}</b><span>Giriş bariyeri</span></div>
        <div class="fact"><b>${fmtShort(c.midpack)}</b><span>Orta sıra</span></div>
        <div class="fact"><b>${c.newcomers ?? '–'}</b><span>Son 2 yılda giren</span></div>
        <div class="fact"><b>${c.leaderShare === null || c.leaderShare === undefined ? '–' : `%${Math.round(c.leaderShare * 100)}`}</b><span>Lider payı</span></div>
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
    case 'real': return r.realistic;
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
  market: (a, b) => (b.market ?? -1) - (a.market ?? -1) || compareByVerdict(a, b),
  reach: (a, b) => (b.reachScore ?? -1) - (a.reachScore ?? -1) || compareByVerdict(a, b)
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
    ['s-real', state.records.filter((r) => r.realistic).length, 'Gerçekçi', 'real'],
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
  const ranked = collapseVariants(sortRows(analyzed.filter((r) => r.demand > 0), 'verdict'));
  const realistic = sortRows(ranked.filter((r) => r.realistic), 'reach');
  const rest = ranked.filter((r) => !r.realistic && ['GOLD', 'BUILD'].includes(r.dv));
  const top = [...realistic, ...rest].slice(0, 8);
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
    ['real', '◎ Gerçekçi', state.records.filter((r) => r.realistic).length, 'c-real'],
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

/**
 * Aynı ilk 10'a düşen kelimeler tek pazardır ("tip calculator", "tip calculator free",
 * "tip calculator free android" → bir fikir). En iyi puanlıyı temsilci yapar,
 * kalanını varyant olarak altına bağlar. Analist Modu'nda katlama yapılmaz.
 */
function collapseVariants(rows) {
  const map = new Map();
  if (!state.collapse) { state.variantMap = map; return rows; }
  const out = [];
  const groups = [];
  for (const r of rows) {
    const top = r.top || [];
    if (top.length < 5) { out.push(r); continue; }
    let host = null;
    for (const g of groups) {
      let inter = 0;
      for (const id of top) if (g.set.has(id)) inter++;
      if (inter / Math.min(g.set.size, top.length) >= VARIANT_OVERLAP) { host = g; break; }
    }
    if (host) {
      const list = map.get(host.rep.k) || [];
      list.push(r);
      map.set(host.rep.k, list);
    } else {
      groups.push({ set: new Set(top), rep: r });
      out.push(r);
    }
  }
  state.variantMap = map;
  return out;
}

function renderOpportunities(reset = true) {
  if (reset) state.shown = 60;
  renderQuickFilters();
  const rows = collapseVariants(sortRows(filterQuick(), state.sort));
  const shown = rows.slice(0, state.shown);
  const el = $('#cards');

  if (!rows.length) {
    if (state.quick === 'GOLD') {
      const alt = sortRows(state.records.filter((r) => r.dv === 'BUILD' || r.dv === 'WATCH'), 'verdict').slice(0, 6);
      el.innerHTML = `<div class="empty"><strong>Şu anda GOLD fırsat yok.</strong>GOLD için 70+ fırsat puanı ve yeterli talep gerekir.</div>
        ${alt.length ? `<p class="fallback-note">En iyi mevcut adaylar</p><div class="opp-list">${alt.map(oppCard).join('')}</div>` : ''}`;
    } else if (state.quick === 'real') {
      const alt = collapseVariants(sortRows(state.records.filter((r) => ['GOLD', 'BUILD'].includes(r.dv)), 'reach')).slice(0, 6);
      el.innerHTML = `<div class="empty"><strong>Şu anda hem kararı BUILD+ hem erişimi ${REALISTIC_REACH}+ olan kelime yok.</strong>Tarama derinleştikçe çıkacak. En yakın adaylar aşağıda.</div>
        ${alt.length ? `<p class="fallback-note">Erişimi en yüksek BUILD kelimeleri</p><div class="opp-list">${alt.map(oppCard).join('')}</div>` : ''}`;
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
  const collapsed = [...state.variantMap.values()].reduce((n, v) => n + v.length, 0);
  $('#countInfo').textContent = rows.length
    ? `${fmtInt(shown.length)} / ${fmtInt(rows.length)} pazar${collapsed ? ` · ${fmtInt(collapsed)} varyant katlandı` : ''}`
    : '';
  $('#more').hidden = state.shown >= rows.length;
  const chip = $('#nicheChip');
  if (state.niche) {
    chip.innerHTML = `Niş filtresi: <strong>${esc(state.niche.label || state.niche.name)}</strong> <button class="kw-chip" data-clear-niche>kaldır ✕</button>`;
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
        <div>${vbadge(nv.verdict)}<h3 style="margin-top:7px">${esc(n.label || n.name)}</h3>
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
      <div><button class="ghost" data-niche="${esc(n.name)}" data-niche-type="${esc(n.type)}" data-niche-label="${esc(n.label || n.name)}">Nişi aç →</button></div>
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
      <td class="num">${r.reachScore ?? '–'}</td>
      <td class="num">${r.market ?? '–'}</td>
      <td class="num">${r.titleMatches === null ? '–' : `${r.titleMatches}/${r.comp.n}`}</td>
      <td class="num">${r.weak ?? '–'}</td>
      <td class="num">${r.avgScore ?? '–'}</td>
      <td class="num">${trend}</td>
      <td class="num muted">${fmtDate(r.first)}</td>
      <td><button class="icon-btn" data-details="${esc(r.k)}">Detay</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="14" class="empty">Filtrelere uyan kelime yok.</td></tr>';
  $('#aCountInfo').textContent = `${fmtInt(shown.length)} / ${fmtInt(rows.length)} kelime${state.niche ? ` · niş: ${state.niche.label || state.niche.name}` : ''}`;
  $('#aMore').hidden = state.analyst.shown >= rows.length;
}

function exportCsv() {
  const rows = analystRows();
  const cols = ['kelime', 'karar', 'gerekce', 'firsat', 'firsat_seviye', 'talep', 'talep_seviye', 'zorluk', 'zorluk_seviye',
    'erisim', 'erisim_seviye', 'giris_bariyeri', 'orta_sira', 'lider_payi', 'yeni_giren', 'ilk10_10k_alti', 'gercekci',
    'pazar', 'trend', 'trend_degisim', 'baslikta', 'rakip_sayisi', 'zayif', 'dusuk_puan', 'bayat', 'dev', 'ort_puan', 'toplam_yukleme', 'kaynak', 'tohum', 'bulundu', 'son_analiz', 'ilk_10'];
  const lines = [cols.join(';')];
  for (const r of rows) {
    const c = r.comp || {};
    const d = r.decision;
    const apps = (r.top || []).map((id) => state.data?.apps?.[id]?.title).filter(Boolean).join(' | ');
    const x = d.reach;
    const vals = [r.k, d.verdict, d.reason, r.opportunity, opportunityLevel(r.opportunity).label, r.demand, demandLevel(r.demand).label,
      r.difficulty, difficultyLevel(r.difficulty).label,
      r.reachScore, r.reachScore === null ? '' : reachLevel(r.reachScore).label, x.entry, x.midpack,
      x.leaderShare, x.newcomers, x.tiny, r.realistic ? 'evet' : 'hayır',
      r.market, d.trend.dir === 'new' ? 'YENİ' : d.trend.label, r.trendDelta,
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

/* ============================ görünüm: sıralama grafiği ============================ */
/*
 * Biçim seçimi: karşılaştırılan şey büyüklük (magnitude) ve satırlar adlandırılmış
 * kategoriler → sıralı yatay çubuk. İki farklı ölçü tek eksene bindirilmez;
 * her ölçü kendi kolonunda, kendi ölçeğinde, kolon başlığıyla doğrudan etiketli.
 * Renkler paletten (dataviz doğrulayıcısı ile onaylandı), metin asla veri rengi giymez.
 */
const RANK_METRICS = {
  reach: { label: 'Erişim', tip: 'reach', get: (r) => r.reach, fmt: (v) => String(v), desc: 'Sıralamaya girersen indirme gelir mi' },
  demand: { label: 'Talep', tip: 'demand', get: (r) => r.demand, fmt: (v) => String(v), desc: 'Otomatik tamamlamadaki arama ilgisi' },
  opportunity: { label: 'Fırsat', tip: 'opportunity', get: (r) => r.opportunity, fmt: (v) => String(v), desc: 'Talep ve rekabetin birleşimi' },
  difficulty: { label: 'Rekabet', tip: 'difficulty', get: (r) => r.difficulty, fmt: (v) => String(v), desc: 'İlk 10 uygulamanın gücü' },
  money: { label: 'Gelir modeli', tip: 'money', get: (r) => r.money, fmt: (v) => `${v}/10`, desc: 'İlk 10 uygulamanın kaçında para kazanma yolu var (satın alma, reklam, ücretli)' },
  engagement: { label: 'İlgi', tip: 'engagement', get: (r) => r.engagement, fmt: (v) => String(v), desc: '1000 yüklemeye düşen değerlendirme sayısı — kullanıcı bağlılığı göstergesi' }
};

function rankingRows() {
  const what = $('#rankWhat').value;
  if (what === 'niches') {
    return buildNicheCards().map((n) => ({
      key: n.name,
      name: n.label || n.name,
      sub: `${n.type === 'seed' ? 'tohum grubu' : 'ortak kelime'} · ${n.nv.useful}/${n.count} işe yarar kelime`,
      verdict: n.nv.verdict,
      useful: n.nv.useful,
      reach: n.nv.reach ? n.nv.reach.value : null,
      demand: n.nv.demand.value,
      opportunity: n.nv.topOpportunity,
      difficulty: n.nv.competition.value,
      money: medianOf(n.members.map((m) => m.comp && m.comp.monetized)),
      engagement: medianOf(n.members.map((m) => m.comp && m.comp.engagement)),
      note: n.nv.best ? `en iyi: ${n.nv.best.k}` : '',
      goto: { niche: n.name, type: n.type }
    }))
      // en az iki işe yarar (WATCH+) kelimesi olmayan grup niş sayılmaz
      .filter((r) => r.useful >= 2 && (Number.isFinite(r.reach) || Number.isFinite(r.demand)));
  }
  const rows = collapseVariants(sortRows(state.records.filter((r) => r.dv !== 'PENDING' && r.demand > 0), 'verdict'));
  return rows.map((r) => ({
    key: r.k,
    name: r.k,
    sub: `${SRC_LABEL[r.src] || r.src}${r.seed && r.seed !== r.k ? ` · ${r.seed}` : ''}`,
    verdict: r.dv,
    reach: r.reachScore,
    demand: r.demand,
    opportunity: r.opportunity,
    difficulty: r.difficulty,
    money: Number.isFinite(r.comp?.monetized) ? r.comp.monetized : null,
    engagement: Number.isFinite(r.comp?.engagement) ? r.comp.engagement : null,
    note: r.decision.reach.has ? `giriş ${fmtInstalls(r.decision.reach.entry)} · orta sıra ${fmtInstalls(r.decision.reach.midpack)}` : '',
    goto: { keyword: r.k }
  }));
}

function medianOf(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return Math.round(m * 100) / 100;
}

function statsOf(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
  return { n: v.length, min: v[0], max: v[v.length - 1], median: at(0.5), p75: at(0.75) };
}

function renderRanking() {
  const el = $('#rankChart');
  const primaryKey = $('#rankMetric').value;
  let secondaryKey = $('#rankSecond').value;
  if (secondaryKey === primaryKey) secondaryKey = primaryKey === 'money' ? 'reach' : 'money';
  const P = RANK_METRICS[primaryKey];
  const S = RANK_METRICS[secondaryKey];
  const count = Number($('#rankCount').value) || 20;
  const all = rankingRows();
  const withPrimary = all.filter((r) => Number.isFinite(P.get(r)));
  if (!withPrimary.length) {
    el.innerHTML = '<div class="empty"><strong>Grafik için yeterli veri yok.</strong>Tarama ilerledikçe burası dolacak.</div>';
    return;
  }
  const rows = withPrimary.slice().sort((a, b) => P.get(b) - P.get(a)).slice(0, count);
  const pStats = statsOf(withPrimary.map(P.get));
  const pMax = Math.max(...rows.map(P.get), 1);
  const sVals = rows.map(S.get).filter(Number.isFinite);
  const sMax = sVals.length ? Math.max(...sVals, 1) : 1;
  const what = $('#rankWhat').value === 'niches' ? 'niş' : 'kelime';

  el.innerHTML = `
    <figcaption class="chart-head">
      <h2>${esc(P.label)} puanına göre ilk ${rows.length} ${esc(what)}, yanında ${esc(S.label.toLowerCase())}</h2>
      <p class="chart-sub">${esc(P.desc)}. Çubuklar kendi kolonunun en yüksek değerine göre ölçekli; her değer ayrıca yazılı.</p>
      <div class="chart-legend">
        <span class="lg"><i class="sw sw-p"></i>${esc(P.label)}</span>
        <span class="lg"><i class="sw sw-s"></i>${esc(S.label)}</span>
      </div>
    </figcaption>
    <div class="chart-grid" role="table" aria-label="${esc(P.label)} sıralaması">
      <div class="ch-row ch-header" role="row">
        <span role="columnheader">${esc(what === 'niş' ? 'Niş' : 'Kelime')}</span>
        <span role="columnheader">Karar</span>
        <span role="columnheader">${esc(P.label)} ${info(P.tip)}</span>
        <span role="columnheader">${esc(S.label)} ${info(S.tip)}</span>
      </div>
      ${rows.map((r, i) => {
        const pv = P.get(r);
        const sv = S.get(r);
        return `<div class="ch-row" role="row" data-rank-key="${esc(r.key)}" tabindex="0"
          data-tip-title="${esc(r.name)}"
          data-tip-body="${esc(`${P.label} ${P.fmt(pv)} · ${S.label} ${Number.isFinite(sv) ? S.fmt(sv) : '–'}${r.note ? ` · ${r.note}` : ''}`)}">
          <span class="ch-name" role="cell"><b>${esc(r.name)}</b><i>${esc(r.sub)}</i></span>
          <span role="cell">${vbadge(r.verdict)}</span>
          <span class="ch-bar" role="cell"><i class="bar-p" style="--w:${(pv / pMax) * 100}%"></i><b>${esc(P.fmt(pv))}</b></span>
          <span class="ch-bar" role="cell">${Number.isFinite(sv) ? `<i class="bar-s" style="--w:${(sv / sMax) * 100}%"></i><b>${esc(S.fmt(sv))}</b>` : '<b class="muted">–</b>'}</span>
        </div>`;
      }).join('')}
    </div>
    <figcaption class="chart-foot">
      <span>Medyan ${esc(P.label.toLowerCase())}: <b>${esc(P.fmt(pStats.median))}</b> (${fmtInt(pStats.n)} ${esc(what)} üzerinden)</span>
      <span>P75 eşiği: <b>${esc(P.fmt(pStats.p75))}</b></span>
      <span>Yayılım: <b>${esc(P.fmt(pStats.min))} → ${esc(P.fmt(pStats.max))}</b></span>
      <span class="chart-note">Conversion rate ve CPA Play Store'un açık verisinde yok; bunlar onların ölçülebilir karşılıkları.</span>
    </figcaption>`;
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
  if (name === 'ranking') renderRanking();
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
  else if (state.view === 'ranking') renderRanking();
  renderQuickFilters();
}

function toggleStar(key) {
  if (state.stars.has(key)) state.stars.delete(key); else state.stars.add(key);
  saveStars();
  refreshCurrent();
}

function openNiche(name, type, label) {
  state.niche = { name, type, label: label || name };
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

  for (const id of ['#rankWhat', '#rankMetric', '#rankSecond', '#rankCount']) $(id).addEventListener('change', renderRanking);
  $('#rankChart').addEventListener('click', (e) => {
    const row = e.target.closest('[data-rank-key]');
    if (!row || e.target.closest('.info')) return;
    const key = row.dataset.rankKey;
    if ($('#rankWhat').value === 'niches') {
      const n = buildNicheCards().find((x) => (x.label || x.name) === key);
      if (n) openNiche(n.name, n.type, n.label || n.name);
    } else openDrawer(key);
  });
  $('#rankChart').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.dataset?.rankKey) return;
    e.target.click();
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
    if (ni) { openNiche(ni.dataset.niche, ni.dataset.nicheType, ni.dataset.nicheLabel); return; }

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
    `<option value="${esc(m.id)}">${esc(m.label || `${m.country.toUpperCase()} / ${m.lang}`)} · ${fmtInt(m.analyzed)} analiz</option>`).join('');
  let saved = null;
  try { saved = localStorage.getItem('market'); } catch { /* yoksay */ }
  const first = markets.some((m) => m.id === saved) ? saved : markets[0].id;
  $('#market').value = first;
  const hash = location.hash.replace('#', '');
  if (VIEWS.includes(hash)) state.view = hash;
  await switchMarket(first);
}

init();
