/* Play Kelime Radarı — statik arayüz. Bağımlılık yok. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('tr-TR');
  const fmtInt = (n) => (n === null || n === undefined ? '–' : nf.format(n));
  const fmtShort = (n) => {
    if (n === null || n === undefined) return '–';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} Mr`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
    return String(n);
  };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('tr-TR') : '–');
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('tr-TR') : '–');
  const DAY = 86400000;

  const SRC_LABEL = { seed: 'Tohum', suggest: 'Öneri', letter: 'Öneri (harf)', variant: 'Varyant', chart: 'Liste', title: 'Başlık' };
  const VERDICT = { guclu: ['Güçlü fırsat', 'v-strong'], iyi: ['İyi fırsat', 'v-good'], orta: ['Orta', 'v-mid'], zor: ['Zor', 'v-hard'], eksik: ['Eksik veri', ''], 'talep-yok': ['Talep yok', ''] };
  const ST_LABEL = { ok: 'Analiz edildi', partial: 'Eksik veri', pending: 'Bekliyor', error: 'Hata', 'no-demand': 'Talep yok' };
  const STOP = new Set(['game', 'games', 'app', 'apps', 'for', 'free', 'the', 'and', 'of', 'to', 'a', 'an', 'in', 'with', 'best', 'top', 'new', 'my', 'me', 'on', 'no', 'your', 'you', 'by', 'vs', 'or', 'all', 'it', 'is', 'pro', 'hd']);
  const stem = (t) => (t.length > 4 && t.endsWith('ies') ? `${t.slice(0, -3)}y` : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
  const toks = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  const state = {
    index: null, marketId: null, data: null, rows: [], shown: 100,
    sort: { key: 'opportunity', dir: -1 }, stars: loadStars(), niche: null, expanded: new Set(),
    apiBase: (localStorage.getItem('apiBase') || '').trim(), live: false
  };

  function loadStars() {
    try { return new Set(JSON.parse(localStorage.getItem('stars') || '[]')); } catch { return new Set(); }
  }
  function saveStars() { localStorage.setItem('stars', JSON.stringify([...state.stars])); }

  // ---------- veri
  async function loadIndex() {
    const r = await fetch('./data/index.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`index.json ${r.status}`);
    return r.json();
  }
  async function loadMarket(id) {
    const r = await fetch(`./data/${encodeURIComponent(id)}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${id}.json ${r.status}`);
    return r.json();
  }

  function colorFor(v, invert = false) {
    const x = invert ? 100 - v : v;
    return x >= 60 ? 'var(--good)' : x >= 40 ? 'var(--mid)' : 'var(--bad)';
  }
  function bar(v, invert = false) {
    if (v === null || v === undefined) return '<span class="muted">–</span>';
    return `<span class="bar"><i style="--w:${v}%;--c:${colorFor(v, invert)}"></i><b>${v}</b></span>`;
  }
  function verdictBadge(v) {
    const [label, cls] = VERDICT[v] || ['–', ''];
    return `<span class="badge ${cls}">${label}</span>`;
  }
  function trendOf(r) {
    if (!r.hist || r.hist.length < 2 || !Number.isFinite(r.opportunity)) return null;
    const now = Date.now();
    const old = [...r.hist].reverse().find((h) => now - new Date(h[0]).getTime() >= 7 * DAY && Number.isFinite(h[3]));
    const base = old || r.hist[0];
    if (!base || !Number.isFinite(base[3]) || base[0] === r.hist[r.hist.length - 1][0]) return null;
    return r.opportunity - base[3];
  }

  // ---------- kelime tablosu
  function enrich(r) {
    const c = r.comp || {};
    return {
      ...r,
      titleMatches: c.titleMatches ?? null,
      weak: c.weak ?? null,
      avgScore: c.avgScore ?? null,
      trend: trendOf(r),
      isNew: r.first && Date.now() - new Date(r.first).getTime() <= 7 * DAY
    };
  }

  function filterRows() {
    const q = $('#q').value.trim().toLowerCase();
    const minOpp = +$('#minOpp').value;
    const minDemand = +$('#minDemand').value;
    const maxDiff = +$('#maxDiff').value;
    const status = $('#statusFilter').value;
    const src = $('#srcFilter').value;
    const onlyNew = $('#onlyNew').checked;
    const onlyStars = $('#onlyStars').checked;
    const all = (state.data?.keywords || []).map(enrich);
    return all.filter((r) => {
      if (status === 'analyzed' && !(r.st === 'ok' || r.st === 'partial')) return false;
      if (status === 'demand' && !(r.demand > 0)) return false;
      if (status === 'no-demand' && r.st !== 'no-demand') return false;
      if (src && r.src !== src) return false;
      if (q && !r.k.includes(q)) return false;
      if (onlyNew && !r.isNew) return false;
      if (onlyStars && !state.stars.has(r.k)) return false;
      if (state.niche) {
        if (state.niche.type === 'seed' && r.seed !== state.niche.name && r.k !== state.niche.name) return false;
        if (state.niche.type === 'token' && !toks(r.k).map(stem).includes(state.niche.name)) return false;
      }
      if (minOpp > 0 && !(r.opportunity >= minOpp)) return false;
      if (minDemand > 0 && !(r.demand >= minDemand)) return false;
      if (maxDiff < 100 && !(r.difficulty <= maxDiff)) return false;
      return true;
    });
  }

  function sortRows(rows) {
    const { key, dir } = state.sort;
    const val = (r) => r[key];
    return rows.sort((a, b) => {
      const va = val(a); const vb = val(b);
      const na = va === null || va === undefined; const nb = vb === null || vb === undefined;
      if (na && nb) return a.k.localeCompare(b.k);
      if (na) return 1;
      if (nb) return -1;
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * (va - vb) || a.k.localeCompare(b.k);
    });
  }

  function renderTable(reset = true) {
    if (reset) { state.rows = sortRows(filterRows()); state.shown = 100; }
    const tbody = $('#kwTable tbody');
    const rows = state.rows.slice(0, state.shown);
    $$('#kwTable th[data-sort]').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === state.sort.key));
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="empty">Sonuç yok. Filtreleri gevşetmeyi dene${state.data?.stats?.analyzed ? '' : ' — henüz analiz edilmiş kelime yok, ilk tarama çalışınca burası dolacak'}.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(rowHtml).join('');
    }
    $('#countInfo').textContent = `${rows.length} / ${state.rows.length} kelime gösteriliyor`;
    $('#more').classList.toggle('hidden', state.shown >= state.rows.length);
    $('#clearNiche').classList.toggle('hidden', !state.niche);
    if (state.niche) $('#clearNiche').textContent = `Niş filtresi: ${state.niche.name} ✕`;
  }

  function rowHtml(r) {
    const star = state.stars.has(r.k);
    const trend = r.trend === null || r.trend === undefined ? '<span class="muted">–</span>' : r.trend > 0 ? `<span class="up">▲ ${r.trend}</span>` : r.trend < 0 ? `<span class="down">▼ ${-r.trend}</span>` : '<span class="muted">0</span>';
    const statusBadge = r.st === 'ok' ? '' : `<span class="badge">${ST_LABEL[r.st] || r.st}</span>`;
    const open = state.expanded.has(r.k);
    return `<tr data-k="${esc(r.k)}">
      <td class="star-col"><button class="star ${star ? 'on' : ''}" data-star="${esc(r.k)}" title="Yıldızla">${star ? '★' : '☆'}</button></td>
      <td><span class="kw">${esc(r.k)}</span>${r.isNew ? '<span class="badge new">yeni</span>' : ''}<span class="badge" title="Kaynak">${SRC_LABEL[r.src] || r.src}</span>${statusBadge}${r.verdict && r.st !== 'no-demand' ? verdictBadge(r.verdict) : ''}</td>
      <td class="num">${bar(r.opportunity)}</td>
      <td class="num">${bar(r.demand)}</td>
      <td class="num">${bar(r.difficulty, true)}</td>
      <td class="num">${r.market ?? '–'}</td>
      <td class="num">${r.titleMatches === null ? '–' : `${r.titleMatches}/${r.comp.n}`}</td>
      <td class="num">${r.weak ?? '–'}</td>
      <td class="num">${r.avgScore ?? '–'}</td>
      <td class="num">${trend}</td>
      <td class="num muted">${fmtDate(r.first)}</td>
      <td><button class="expand" data-expand="${esc(r.k)}">${open ? '▾' : '▸'}</button></td>
    </tr>${open ? `<tr class="detail-row"><td colspan="12">${detailHtml(r, state.data.apps, state.data.market)}</td></tr>` : ''}`;
  }

  function sparkline(hist) {
    if (!hist || hist.length < 2) return '';
    const pts = hist.map((h) => h[3]).filter(Number.isFinite);
    if (pts.length < 2) return '';
    const w = 220; const h = 40; const step = w / (pts.length - 1);
    const d = pts.map((p, i) => `${(i * step).toFixed(1)},${(h - (p / 100) * h).toFixed(1)}`).join(' ');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${d}"/></svg><span class="muted">Fırsat geçmişi (${hist[0][0]} → ${hist[hist.length - 1][0]})</span>`;
  }

  function playUrl(id, market) {
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=${encodeURIComponent(market.lang)}&gl=${encodeURIComponent(market.country)}`;
  }

  /** Tablo satırı detayı ve canlı analiz kartı aynı şablonu kullanır. */
  function detailHtml(r, appsMap, market, appsList = null) {
    const c = r.comp || {};
    const apps = appsList || (r.top || []).map((id) => appsMap[id]).filter(Boolean);
    const kwt = toks(r.k).map(stem);
    const pop = r.pop;
    const popText = pop
      ? `<code>${esc(r.k.slice(0, pop.minPrefix))}</code> yazınca ${pop.mode === 'ext' ? `<em>${esc(pop.via)}</em> öneriliyor (kelimenin kendisi değil, uzantısı)` : 'kelimenin kendisi öneriliyor'} — ${pop.pos}. sırada, ${pop.minPrefix}/${pop.len} harf.`
      : 'Otomatik tamamlamada ne kendisi ne de uzantısı görünüyor.';
    const related = state.data ? state.data.keywords.filter((x) => x.k !== r.k && x.seed && (x.seed === r.seed || x.seed === r.k) && x.demand > 0).sort((a, b) => (b.opportunity ?? 0) - (a.opportunity ?? 0)).slice(0, 12) : [];
    return `<div class="detail">
      <div>
        <h4>Özet</h4>
        <p>${r.verdict ? verdictBadge(r.verdict) : ''} ${r.st === 'partial' ? '<span class="badge">eksik veri — bir sonraki taramada tamamlanır</span>' : ''}</p>
        <p><strong>Talep:</strong> ${popText}</p>
        <div class="facts">
          <div class="fact"><b>${r.opportunity ?? '–'}</b><span>Fırsat</span></div>
          <div class="fact"><b>${r.demand ?? '–'}</b><span>Talep</span></div>
          <div class="fact"><b>${r.difficulty ?? '–'}</b><span>Zorluk</span></div>
          <div class="fact"><b>${r.market ?? '–'}</b><span>Pazar</span></div>
          <div class="fact"><b>${c.titleMatches ?? '–'}/${c.n ?? '–'}</b><span>Başlıkta kelime</span></div>
          <div class="fact"><b>${c.weak ?? '–'}</b><span>Zayıf (&lt;100K)</span></div>
          <div class="fact"><b>${c.lowRated ?? '–'}</b><span>Düşük puan (&lt;4.0)</span></div>
          <div class="fact"><b>${c.stale ?? '–'}</b><span>1+ yıl güncellenmemiş</span></div>
          <div class="fact"><b>${c.big ?? '–'}</b><span>Dev (10M+)</span></div>
          <div class="fact"><b>${c.avgScore ?? '–'}</b><span>Ort. puan</span></div>
          <div class="fact"><b>${fmtShort(c.sumInstalls)}</b><span>Toplam yükleme (ilk 10)</span></div>
          <div class="fact"><b>${fmtShort(c.medianInstalls)}</b><span>Medyan yükleme</span></div>
          <div class="fact"><b>${c.ads ?? '–'}</b><span>Reklamlı uygulama</span></div>
          <div class="fact"><b>${c.iap ?? '–'}</b><span>Uygulama içi satın alma</span></div>
        </div>
        ${sparkline(r.hist)}
        <p class="muted">Kaynak: ${SRC_LABEL[r.src] || r.src || '–'}${r.seed ? ` · tohum: ${esc(r.seed)}` : ''} · son analiz: ${fmtDateTime(r.at || r.analyzedAt)}</p>
        ${related.length ? `<h4>Aynı tohumdan</h4><div class="chips">${related.map((x) => `<span class="chip" data-goto="${esc(x.k)}">${esc(x.k)} · ${x.opportunity ?? '–'}</span>`).join('')}</div>` : ''}
        ${r.variants && r.variants.length ? `<h4>İlgili öneriler</h4><div class="chips">${r.variants.map((v) => `<span class="chip" data-live="${esc(v)}">${esc(v)}</span>`).join('')}</div>` : ''}
      </div>
      <div>
        <h4>İlk ${apps.length} rakip (arama sırasına göre)</h4>
        ${apps.length ? `<table class="apps"><thead><tr><th>#</th><th>Uygulama</th><th class="num">Yükleme</th><th class="num">Puan</th><th class="num">Değerlendirme</th><th>Güncelleme</th></tr></thead><tbody>
        ${apps.map((a, i) => {
          const match = kwt.length && kwt.every((t) => toks(a.title).map(stem).includes(t));
          return `<tr><td class="muted">${i + 1}</td><td class="t"><a href="${playUrl(a.id, market)}" target="_blank" rel="noopener">${esc(a.title)}</a>${match ? ' <span class="badge" title="Başlıkta kelime geçiyor">✓</span>' : ''}<br><span class="muted">${esc(a.dev)}${a.genre ? ` · ${esc(a.genre)}` : ''}${a.ads ? ' · reklam' : ''}${a.iap ? ' · IAP' : ''}${a.free === false ? ' · ücretli' : ''}</span></td><td class="num">${fmtShort(a.real)}</td><td class="num">${a.score ?? '–'}</td><td class="num">${fmtShort(a.ratings)}</td><td>${fmtDate(a.updated)}</td></tr>`;
        }).join('')}</tbody></table>` : '<p class="muted">Rakip verisi yok.</p>'}
      </div>
    </div>`;
  }

  // ---------- nişler
  function renderNiches() {
    const q = $('#nicheQ').value.trim().toLowerCase();
    const type = $('#nicheType').value;
    const list = (state.data?.niches || []).filter((n) => (!type || n.type === type) && (!q || n.name.includes(q) || n.keywords.some((k) => k.includes(q))));
    const el = $('#niches');
    if (!list.length) { el.innerHTML = '<div class="empty">Henüz niş yok — en az 3 talepli kelime gruplandığında burada görünür.</div>'; return; }
    el.innerHTML = list.map((n) => `<div class="card">
      <header><h3>${esc(n.name)} <span class="badge">${n.type === 'seed' ? 'tohum' : 'ortak kelime'}</span></h3><span class="score" title="Niş skoru">${n.score}</span></header>
      <div class="meta">${n.count} kelime · ort. fırsat ${n.avgOpportunity} · en iyi ${n.maxOpportunity} · ort. talep ${n.avgDemand} · ort. zorluk ${n.avgDifficulty}</div>
      <div class="chips">${n.keywords.map((k) => `<span class="chip" data-goto="${esc(k)}">${esc(k)}</span>`).join('')}</div>
      <p><button class="ghost" data-niche="${esc(n.name)}" data-niche-type="${n.type}">Tüm kelimeleri tabloda göster</button></p>
    </div>`).join('');
  }

  // ---------- canlı analiz
  function apiUrl(path) {
    const base = state.apiBase ? state.apiBase.replace(/\/+$/, '') + '/' : './';
    return base + path;
  }
  async function detectLive() {
    const st = $('#liveStatus');
    try {
      const r = await fetch(apiUrl('api/health'), { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      state.live = !!(j && j.ok);
    } catch { state.live = false; }
    $('#liveBtn').disabled = !state.live;
    st.innerHTML = state.live
      ? `Canlı analiz hazır${state.apiBase ? ` (API: ${esc(state.apiBase)})` : ''}. Bir kelime yaz; talep, rakipler ve fırsat anında ölçülür (birkaç saniye sürer).`
      : 'Canlı analiz bu dağıtımda kapalı. GitHub Pages statik olduğu için API yok: projeyi Vercel\'e de dağıt ve aşağıdaki ayara Vercel adresini yaz, ya da yerelde <code>npm run serve</code> ile çalıştır.';
  }
  async function runLive(term, marketStr) {
    const [gl, hl] = (marketStr || 'us:en').split(':');
    const out = $('#liveResult');
    out.innerHTML = '<div class="result-card"><p class="muted">Analiz ediliyor… otomatik tamamlama ikili araması, arama sonuçları ve 10 uygulama detayı çekiliyor.</p></div>';
    try {
      const r = await fetch(apiUrl(`api/analyze?q=${encodeURIComponent(term)}&gl=${gl}&hl=${hl}`));
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const res = j.result;
      const rec = { ...res, st: res.status === 'no-demand' ? 'no-demand' : res.partial ? 'partial' : 'ok', at: res.analyzedAt, src: 'canlı' };
      out.innerHTML = `<div class="result-card"><h2>${esc(res.k)} <span class="muted">(${gl}/${hl})</span>${j.cached ? '<span class="badge">önbellek</span>' : ''}</h2>${detailHtml(rec, {}, { country: gl, lang: hl }, res.apps)}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="result-card"><p class="down">Hata: ${esc(err.message)}</p></div>`;
    }
  }

  // ---------- CSV
  function exportCsv() {
    const cols = ['kelime', 'firsat', 'talep', 'zorluk', 'pazar', 'karar', 'baslikta', 'zayif', 'dusuk_puan', 'bayat', 'dev', 'ort_puan', 'toplam_yukleme', 'kaynak', 'tohum', 'bulundu', 'son_analiz', 'ilk_10'];
    const lines = [cols.join(';')];
    for (const r of state.rows) {
      const c = r.comp || {};
      const apps = (r.top || []).map((id) => state.data.apps[id]?.title).filter(Boolean).join(' | ');
      const vals = [r.k, r.opportunity, r.demand, r.difficulty, r.market, (VERDICT[r.verdict] || [''])[0], c.titleMatches, c.weak, c.lowRated, c.stale, c.big, c.avgScore, c.sumInstalls, SRC_LABEL[r.src] || r.src, r.seed, r.first, r.at, apps];
      lines.push(vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
    }
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `play-kelimeler-${state.marketId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- üst bilgi
  function renderStats() {
    const d = state.data;
    if (!d) return;
    const s = d.stats || {};
    const guclu = d.keywords.filter((k) => k.verdict === 'guclu').length;
    const iyi = d.keywords.filter((k) => k.verdict === 'iyi').length;
    $('#stats').innerHTML = [
      [s.keywords, 'toplam kelime'],
      [s.analyzed, 'analiz edildi'],
      [s.withDemand, 'talebi olan'],
      [guclu, 'güçlü fırsat (60+)'],
      [iyi, 'iyi fırsat (45-59)'],
      [(d.niches || []).length, 'niş'],
      [s.pending, 'analiz bekliyor'],
      [s.runs, 'tarama koşusu']
    ].map(([v, l]) => `<div class="stat"><b>${fmtInt(v ?? 0)}</b><span>${l}</span></div>`).join('');
    $('#updated').textContent = `Son güncelleme: ${fmtDateTime(d.generatedAt)}`;
  }

  function showTab(name) {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('main .tab').forEach((s) => s.classList.toggle('hidden', s.id !== `tab-${name}`));
    if (name === 'niches') renderNiches();
    if (name === 'live' && !state.liveChecked) { state.liveChecked = true; detectLive(); }
    location.hash = name;
  }

  function gotoKeyword(k) {
    state.niche = null;
    $('#q').value = k;
    $('#statusFilter').value = 'all';
    showTab('keywords');
    state.expanded.add(k);
    renderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- olaylar
  function bind() {
    $$('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    for (const id of ['q', 'statusFilter', 'srcFilter', 'onlyNew', 'onlyStars']) $(`#${id}`).addEventListener('input', () => renderTable());
    for (const [id, out] of [['minOpp', 'minOppV'], ['minDemand', 'minDemandV'], ['maxDiff', 'maxDiffV']]) {
      $(`#${id}`).addEventListener('input', (e) => { $(`#${out}`).value = e.target.value; renderTable(); });
    }
    $$('#kwTable th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir *= -1; else state.sort = { key, dir: key === 'k' || key === 'first' ? 1 : -1 };
      renderTable();
    }));
    $('#more').addEventListener('click', () => { state.shown += 100; renderTable(false); });
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#clearNiche').addEventListener('click', () => { state.niche = null; renderTable(); });
    $('#market').addEventListener('change', (e) => switchMarket(e.target.value));
    $('#nicheQ').addEventListener('input', renderNiches);
    $('#nicheType').addEventListener('input', renderNiches);
    $('#liveForm').addEventListener('submit', (e) => { e.preventDefault(); runLive($('#liveQ').value.trim(), $('#liveMarket').value); });
    $('#apiBase').value = state.apiBase;
    $('#saveApi').addEventListener('click', () => {
      state.apiBase = $('#apiBase').value.trim();
      localStorage.setItem('apiBase', state.apiBase);
      detectLive();
    });
    document.body.addEventListener('click', (e) => {
      const star = e.target.closest('[data-star]');
      if (star) {
        const k = star.dataset.star;
        if (state.stars.has(k)) state.stars.delete(k); else state.stars.add(k);
        saveStars();
        renderTable(false);
        return;
      }
      const ex = e.target.closest('[data-expand]');
      if (ex) {
        const k = ex.dataset.expand;
        if (state.expanded.has(k)) state.expanded.delete(k); else state.expanded.add(k);
        renderTable(false);
        return;
      }
      const go = e.target.closest('[data-goto]');
      if (go) { gotoKeyword(go.dataset.goto); return; }
      const lv = e.target.closest('[data-live]');
      if (lv) {
        const k = lv.dataset.live;
        const existing = state.data?.keywords.find((x) => x.k === k);
        if (existing && existing.st === 'ok') { gotoKeyword(k); return; }
        showTab('live');
        $('#liveQ').value = k;
        if (state.data?.market) $('#liveMarket').value = `${state.data.market.country}:${state.data.market.lang}`;
        if (state.live) runLive(k, $('#liveMarket').value);
        return;
      }
      const ni = e.target.closest('[data-niche]');
      if (ni) {
        state.niche = { name: ni.dataset.niche, type: ni.dataset.nicheType };
        $('#q').value = '';
        showTab('keywords');
        renderTable();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  async function switchMarket(id) {
    state.marketId = id;
    localStorage.setItem('market', id);
    try {
      state.data = await loadMarket(id);
      state.expanded.clear();
      renderStats();
      renderTable();
      if (!$('#tab-niches').classList.contains('hidden')) renderNiches();
      const m = state.data.market;
      if (m) $('#liveMarket').value = `${m.country}:${m.lang}`;
    } catch (err) {
      notice(`Pazar verisi yüklenemedi: ${esc(err.message)}`);
    }
  }

  function notice(html) {
    const n = $('#notice');
    n.innerHTML = html;
    n.classList.remove('hidden');
  }

  async function init() {
    bind();
    try {
      state.index = await loadIndex();
    } catch {
      notice('Henüz veri yok. İlk taramayı çalıştır: yerelde <code>npm run crawl</code>, ya da GitHub\'da <strong>Actions → crawl → Run workflow</strong>. Tarama günlük olarak otomatik da çalışır.');
      $('#stats').innerHTML = '';
      renderTable();
      return;
    }
    const sel = $('#market');
    const markets = state.index.markets || [];
    sel.innerHTML = markets.map((m) => `<option value="${esc(m.id)}">${esc(m.country.toUpperCase())} / ${esc(m.lang)} · ${fmtInt(m.analyzed)} analiz</option>`).join('');
    const saved = localStorage.getItem('market');
    const first = markets.find((m) => m.id === saved) ? saved : markets[0]?.id;
    if (!first) { notice('Henüz hiçbir pazar taranmamış.'); return; }
    sel.value = first;
    await switchMarket(first);
    const hash = location.hash.replace('#', '');
    if (['keywords', 'niches', 'live', 'help'].includes(hash)) showTab(hash);
  }

  init();
})();
