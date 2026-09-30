/*
 * Projeler görünümü: üç giriş yolu (fırsattan, fikirden, mevcut projeyi içe aktar),
 * Yayın Paketi boru hattı, kalem durumları, hazırlık yüzdesi, ZIP dışa/içe aktarım.
 * Tüm veriler tarayıcıda (IndexedDB) kalır.
 */
import * as db from './db.js';
import {
  createProject, normalizeProject, generatePack, readiness, editText, setStatus, unlock, exportFiles, importFiles,
  STAGES, GROUPS, ITEMS, STATUS, STATUS_LABEL, MARKETS
} from './pack.js';
import { createRenderer, readUpload, flattenToJpeg } from './render.js';
import { zipStore, unzip, imageInfo, validateImage } from './binary.js';
import { fetchRepo, parseRepoUrl } from './repo.js';
import { GENRES } from './lexicon.js';
import { LIMITS, charLen } from './aso.js';
import { SPECS } from './marketing.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmtDate = (iso) => { const t = iso ? new Date(iso) : null; return t && !Number.isNaN(t.getTime()) ? t.toLocaleString('tr-TR') : '–'; };

const TABS = [
  { id: 'pack', label: 'Paket' }, { id: 'product', label: 'Ürün bilgisi' }, { id: 'store', label: 'Mağaza metinleri' },
  { id: 'assets', label: 'Görseller' }, { id: 'release', label: 'Yayın uyumu' }, { id: 'marketing', label: 'Pazarlama' }
];
const ITEM_TAB = {
  icon: 'assets', logo: 'assets', brand: 'assets', featureGraphic: 'assets', screenshots: 'assets', captions: 'assets',
  promoVideo: 'marketing', video6: 'marketing', video10: 'marketing', video15: 'marketing', socialCopy: 'marketing',
  candidates: 'store', primary: 'store', secondary: 'store', competitors: 'store', title: 'store', short: 'store', full: 'store',
  category: 'store', tags: 'store', releaseNotes: 'store', privacy: 'release', dataSafety: 'release', contentRating: 'release', build: 'release'
};
const ORIGIN_LABEL = { opportunity: 'Fırsattan', idea: 'Fikirden', import: 'İçe aktarıldı' };
const FACTS = [
  ['offline', 'İnternetsiz çalışıyor'], ['ads', 'Reklam var'], ['iap', 'Uygulama içi satın alma var'],
  ['multiplayer', 'Çok oyunculu / online'], ['account', 'Kullanıcı hesabı oluşturuluyor'], ['kids', '13 yaş altına yönelik']
];

let bridge = null;
const ps = { list: [], project: null, tab: 'pack', busy: false, stage: {}, urls: new Map(), form: null, importMode: 'manual', ghToken: '', msg: '', prefill: null };

/* ---------------- dış arayüz ---------------- */

export function initProjects(b) {
  bridge = b;
  const root = $('#projectsRoot');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);
}

/** app.js'den: "#projects", "#projects/<id>", "#projects/<id>/<tab>" */
export async function renderProjects(sub = '') {
  const [id, tab] = String(sub || '').split('/');
  if (id) {
    if (!ps.project || ps.project.id !== id) {
      const p = await db.getProject(id);
      if (!p) { go(''); return; }
      revokeUrls();
      ps.project = normalizeProject(p);
      ps.stage = {};
    }
    ps.tab = TABS.some((t) => t.id === tab) ? tab : 'pack';
    await drawProject();
  } else {
    ps.project = null;
    ps.list = (await db.listProjects()).map(normalizeProject);
    drawList();
  }
}

/** Fırsat çekmecesinden: formu doldurup Projeler'i açar. */
export function startFromOpportunity(keyword, marketId) {
  ps.form = 'opportunity';
  ps.prefill = { keyword, market: MARKETS[marketId] ? marketId : 'us-en' };
  go('');
}

function go(sub) {
  const h = `#projects${sub ? `/${sub}` : ''}`;
  if (location.hash !== h) location.hash = h;
  else renderProjects(sub);
}

/* ---------------- liste ---------------- */

function marketOptions(sel) {
  return Object.entries(MARKETS).map(([id, m]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
}
function genreOptions(sel) {
  const byFamily = {};
  for (const g of GENRES) (byFamily[g.game ? 'Oyun' : 'Uygulama'] ||= []).push(g);
  return `<option value="">Otomatik (metinden)</option>${Object.entries(byFamily).map(([f, gs]) =>
    `<optgroup label="${f}">${gs.map((g) => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${esc(g.label.tr)}</option>`).join('')}</optgroup>`).join('')}`;
}

function drawList() {
  const root = $('#projectsRoot');
  const defMarket = (ps.prefill && ps.prefill.market) || (MARKETS[bridge.currentMarket()] ? bridge.currentMarket() : 'us-en');
  root.innerHTML = `
    <div class="pj-intro">
      <h2>Projeler</h2>
      <p class="muted">Anahtar kelime keşfi şart değil. Oyununu ya da uygulamanı nerede geliştirdiysen geliştir; burada proje oluştur,
      <b>Yayın Paketi</b>'ni üret, eksikleri tamamla ve Play Console'a yüklenecek her şeyi ZIP olarak indir.</p>
      ${db.storage.persistent ? '' : '<p class="pj-warn">Bu tarayıcıda IndexedDB kullanılamıyor: projeler sayfayı kapatınca kaybolur. ZIP olarak dışa aktar.</p>'}
    </div>
    <div class="pj-entry">
      ${entryCard('opportunity', 'Fırsattan oluştur', 'Radar\'da bulduğun bir kelimeyle başla. Ürün henüz yoksa fikrini de ekleyebilirsin.')}
      ${entryCard('idea', 'Fikirden oluştur', 'Aklındaki oyunu ya da uygulamayı birkaç cümleyle anlat.')}
      ${entryCard('import', 'Mevcut projeyi içe aktar', 'Elle, GitHub reposundan, kısa açıklamadan, Play\'deki uygulamadan ya da ZIP\'ten.', true)}
    </div>
    <div id="pjForm">${ps.form ? formHtml(ps.form, defMarket) : ''}</div>
    ${ps.msg ? `<p class="pj-msg" role="status">${ps.msg}</p>` : ''}
    <div class="block-head" style="margin-top:26px"><h2>Projelerin</h2><span class="muted small">${ps.list.length} proje · bu tarayıcıda saklanır</span></div>
    <div class="pj-list">${ps.list.length ? ps.list.map(projectCard).join('') : '<div class="empty">Henüz proje yok. Yukarıdaki üç yoldan biriyle başla.</div>'}</div>`;
  if (ps.form) { const f = $('#pjForm input:not([type=hidden]), #pjForm textarea'); if (f) f.focus(); }
}

function entryCard(id, title, text, primary) {
  return `<button class="pj-entry-card${ps.form === id ? ' on' : ''}${primary ? ' primary' : ''}" data-form="${id}" type="button">
    <b>${esc(title)}</b><span>${esc(text)}</span></button>`;
}

function projectCard(p) {
  const r = readiness(p);
  const m = MARKETS[p.market] || {};
  return `<a class="pj-card" href="#projects/${esc(p.id)}">
    <div class="pj-card-main"><b>${esc(p.name)}</b>
      <span class="muted small">${esc(m.label || p.market)} · ${esc(ORIGIN_LABEL[p.origin] || p.origin)} · güncellendi ${esc(fmtDate(p.updatedAt))}</span></div>
    <div class="pj-card-ready"><span class="small muted">Hazırlık</span><b>%${r.pct}</b><div class="bar"><i style="width:${r.pct}%"></i></div>
      <span class="small ${r.blockers.length ? 'bad' : 'good'}">${r.blockers.length ? `${r.blockers.length} engel` : 'engel yok'}</span></div>
  </a>`;
}

function formHtml(kind, market) {
  const common = (nameReq = true, namePh = 'Ör. Road Haul') => `
    <label class="fld"><span>Proje adı${nameReq ? '' : ' (boşsa repodan)'}</span><input name="name" type="text" maxlength="60" ${nameReq ? 'required' : ''} placeholder="${esc(namePh)}"></label>
    <label class="fld"><span>Pazar</span><select name="market">${marketOptions(market)}</select></label>`;
  if (kind === 'opportunity') {
    const opts = bridge.opportunityKeywords();
    const k = ps.prefill && ps.prefill.keyword ? ps.prefill.keyword : '';
    return `<form class="pj-form" data-create="opportunity">
      <h3>Fırsattan proje</h3>
      <label class="fld"><span>Fırsat kelimesi</span><input name="keyword" type="text" list="pjOppList" required value="${esc(k)}" placeholder="Ör. truck simulator"></label>
      <datalist id="pjOppList">${opts.map((o) => `<option value="${esc(o.k)}">${esc(o.v)}</option>`).join('')}</datalist>
      ${common()}
      <label class="fld wide"><span>Ürün fikri (isteğe bağlı, ama konumlandırmayı çok iyileştirir)</span><textarea name="description" rows="3" placeholder="Oyunda ne yapılıyor? Hangi özellikler gerçekten var?"></textarea></label>
      <div class="pj-form-foot"><button type="submit">Projeyi oluştur</button><button type="button" class="ghost" data-form="">Vazgeç</button></div>
    </form>`;
  }
  if (kind === 'idea') {
    return `<form class="pj-form" data-create="idea">
      <h3>Fikirden proje</h3>
      ${common()}
      <label class="fld wide"><span>Fikrin</span><textarea name="description" rows="4" required minlength="10" placeholder="Ör. Tır şoförü olarak şehirler arasında yük taşıyorsun. Dorseni bağla, dağ yollarında dikkatli sür, garajda tırını geliştir."></textarea></label>
      <label class="fld"><span>Tür</span><select name="genreId">${genreOptions('')}</select></label>
      <div class="pj-form-foot"><button type="submit">Projeyi oluştur</button><button type="button" class="ghost" data-form="">Vazgeç</button></div>
    </form>`;
  }
  const modes = [['manual', 'Elle'], ['github', 'GitHub reposu'], ['short', 'Kısa açıklama'], ['play', 'Play\'deki uygulama'], ['zip', 'ZIP / fastlane']];
  const seg = `<div class="seg" role="tablist">${modes.map(([id, l]) => `<button type="button" role="tab" aria-selected="${ps.importMode === id}" class="${ps.importMode === id ? 'on' : ''}" data-import-mode="${id}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (ps.importMode === 'manual') {
    body = `${common()}
      <label class="fld wide"><span>Açıklama (oyunda/uygulamada gerçekten ne var?)</span><textarea name="description" rows="4" placeholder="Oynanış, modlar, özellikler…"></textarea></label>
      <label class="fld wide"><span>Mekanikler / özellik listesi (isteğe bağlı, satır satır)</span><textarea name="mechanics" rows="3" placeholder="- Dorse bağlama\n- Gece sürüşü"></textarea></label>
      <details class="fld wide"><summary>Mevcut mağaza metinleri (varsa)</summary>
        <label class="fld wide"><span>Başlık</span><input name="storeTitle" type="text" maxlength="50"></label>
        <label class="fld wide"><span>Kısa açıklama</span><input name="storeShort" type="text" maxlength="120"></label>
        <label class="fld wide"><span>Uzun açıklama</span><textarea name="storeFull" rows="4"></textarea></label>
      </details>
      <label class="fld"><span>Tür</span><select name="genreId">${genreOptions('')}</select></label>`;
  } else if (ps.importMode === 'github') {
    body = `<label class="fld wide"><span>Repo adresi</span><input name="repo" type="text" required placeholder="https://github.com/kullanici/oyun"></label>
      ${common(false, 'Repo adı kullanılır')}
      <label class="fld wide"><span>Erişim anahtarı (yalnızca özel repo için)</span><input name="token" type="password" autocomplete="off" placeholder="github_pat_…" value="${esc(ps.ghToken)}"></label>
      <p class="muted small wide">README, AndroidManifest, Gradle/Unity/Godot ayarları ve betik adları okunur. Anahtar kaydedilmez, yalnızca bu oturumda bellekte tutulur ve sadece api.github.com'a gönderilir.</p>`;
  } else if (ps.importMode === 'short') {
    body = `${common()}
      <label class="fld wide"><span>Tek cümlelik açıklama</span><input name="description" type="text" required minlength="10" maxlength="200" placeholder="Ör. Dağ yollarında ağır yük taşıdığın tır simülatörü."></label>`;
  } else if (ps.importMode === 'play') {
    body = `<label class="fld wide"><span>Paket adı ya da Play bağlantısı</span><input name="pkg" type="text" required placeholder="com.firma.oyun ya da https://play.google.com/store/apps/details?id=…"></label>
      <label class="fld"><span>Pazar</span><select name="market">${marketOptions(market)}</select></label>
      <p class="muted small wide">Yayındaki uygulamanın başlık, kısa/uzun açıklama, reklam ve satın alma beyanı alınır. Canlı API (Vercel) gerekir.</p>`;
  } else {
    body = `<label class="fld wide"><span>ZIP dosyası</span><input name="zip" type="file" accept=".zip,application/zip" required></label>
      <p class="muted small wide">Bu araçtan indirdiğin paket (project.json) tam geri yüklenir; yalnızca fastlane meta verisi olan bir ZIP'ten mevcut mağaza metinleriyle yeni proje oluşturulur.</p>`;
  }
  return `<form class="pj-form" data-create="import-${ps.importMode}">
    <h3>Mevcut projeyi içe aktar</h3>${seg}${body}
    <p class="pj-progress muted small" id="pjProgress" aria-live="polite"></p>
    <div class="pj-form-foot"><button type="submit">${ps.importMode === 'zip' ? 'İçe aktar' : 'Projeyi oluştur'}</button><button type="button" class="ghost" data-form="">Vazgeç</button></div>
  </form>`;
}

async function createFrom(kind, form) {
  const f = Object.fromEntries(new FormData(form).entries());
  const progress = (t) => { const el = $('#pjProgress'); if (el) el.textContent = t; };
  let project;
  if (kind === 'opportunity') {
    project = createProject({ name: f.name, market: f.market, origin: 'opportunity', inputs: { seedKeyword: f.keyword.trim(), description: f.description || '' } });
  } else if (kind === 'idea') {
    project = createProject({ name: f.name, market: f.market, origin: 'idea', inputs: { description: f.description, genreId: f.genreId || '' } });
  } else if (kind === 'import-manual') {
    project = createProject({ name: f.name, market: f.market, origin: 'import', inputs: {
      description: f.description || '', mechanics: f.mechanics || '', genreId: f.genreId || '',
      store: { title: f.storeTitle || '', short: f.storeShort || '', full: f.storeFull || '' } } });
  } else if (kind === 'import-short') {
    project = createProject({ name: f.name, market: f.market, origin: 'import', inputs: { description: f.description } });
  } else if (kind === 'import-github') {
    if (!parseRepoUrl(f.repo)) throw new Error('GitHub adresi anlaşılamadı. Örnek: https://github.com/kullanici/oyun');
    ps.ghToken = f.token || '';
    const repo = await fetchRepo(f.repo, { token: ps.ghToken || null, onProgress: progress });
    const name = (f.name || '').trim() || repo.name || parseRepoUrl(f.repo).repo;
    project = createProject({ name, market: f.market, origin: 'import', inputs: { repo } });
    progress('');
  } else if (kind === 'import-play') {
    const m = MARKETS[f.market] || MARKETS['us-en'];
    progress('Play Store\'dan meta veri alınıyor…');
    const r = await fetch(bridge.apiUrl(`api/listing?id=${encodeURIComponent(f.pkg.trim())}&gl=${m.gl}&hl=${m.hl}`));
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!j.ok) throw new Error(j.error || 'Canlı API yanıt vermedi. GitHub Pages\'te Canlı Analiz sekmesinden Vercel adresini gir.');
    const L = j.listing;
    const facts = {};
    if (L.adSupported !== null) facts.ads = L.adSupported;
    if (L.offersIAP !== null) facts.iap = L.offersIAP;
    project = createProject({ name: L.title.split(/\s[:\-–|]\s|:\s/)[0].trim() || L.title, market: f.market, origin: 'import', inputs: {
      store: { title: L.title, short: L.short, full: L.full }, facts, privacyUrl: L.privacyPolicy || '', contactEmail: L.developerEmail || '',
      developerName: L.developer || '', promoUrl: L.video || '', build: { packageName: L.id }, listing: { installs: L.installs, score: L.score, version: L.version, updated: L.updated } } });
    progress('');
  } else if (kind === 'import-zip') {
    const file = form.querySelector('input[type=file]').files[0];
    if (!file) throw new Error('ZIP seç.');
    project = await importZip(file, progress);
  }
  await db.putProject(project);
  ps.form = null;
  ps.prefill = null;
  go(project.id);
}

async function importZip(file, progress) {
  progress('ZIP okunuyor…');
  const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
  const { project: p0, kind } = importFiles(entries);
  let project = p0;
  if (kind === 'project') {
    const existing = await db.getProject(project.id);
    if (existing && !confirm(`"${existing.name}" bu tarayıcıda zaten var. Üzerine yazılsın mı? (Hayır: kopya olarak içe aktarılır)`)) {
      // kopya: yeni proje kimliği ve yeni varlık kimlikleri
      const fresh = createProject({ name: `${project.name} (kopya)`, market: project.market });
      let json = JSON.stringify(project).split(project.id).join(fresh.id);
      const map = new Map();
      for (const id of new Set(json.match(/a_[A-Za-z0-9]{6,}/g) || [])) {
        const nid = `a_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
        map.set(id, nid);
      }
      for (const [a, b] of map) json = json.split(`"${a}"`).join(`"${b}"`);
      project = normalizeProject({ ...JSON.parse(json), name: fresh.name });
      await restoreAssets(entries, project.id, (id) => map.get(id), progress);
    } else {
      if (existing) await db.deleteProject(existing.id);
      await restoreAssets(entries, project.id, (id) => id, progress);
    }
  }
  progress('');
  return project;
}

async function restoreAssets(entries, projectId, mapId, progress) {
  const list = entries.filter((e) => /publish-pack\/assets\/(a_[A-Za-z0-9]+)\.(png|jpg)$/.test(e.path));
  let n = 0;
  for (const e of list) {
    const id = mapId(e.path.match(/assets\/(a_[A-Za-z0-9]+)\./)[1]);
    if (!id) continue;
    progress(`Görseller geri yükleniyor (${++n}/${list.length})`);
    const info = imageInfo(e.data);
    await db.putAsset({ id, projectId, kind: 'import', type: info.type || 'image/png', bytes: e.data, w: info.width, h: info.height });
  }
}

/* ---------------- proje sayfası ---------------- */

function stale(p) {
  return p.pack.generatedAt && p.inputsChangedAt && p.inputsChangedAt > p.pack.generatedAt;
}

async function drawProject() {
  const p = ps.project;
  const root = $('#projectsRoot');
  const r = readiness(p);
  const m = MARKETS[p.market] || {};
  root.innerHTML = `
    <div class="pj-top">
      <a class="link-btn" href="#projects">← Projeler</a>
      <div class="pj-title">
        <div><h2>${esc(p.name)}</h2>
          <p class="muted small">${esc(m.label || p.market)} · ${esc(ORIGIN_LABEL[p.origin] || p.origin)} · oluşturuldu ${esc(fmtDate(p.createdAt))}${p.pack.generatedAt ? ` · paket ${esc(fmtDate(p.pack.generatedAt))}` : ''}</p></div>
        <div class="pj-ready" aria-label="Yayın hazırlığı">
          <span>YAYIN HAZIRLIĞI</span><b id="pjPct">%${r.pct}</b>
          <div class="bar lg"><i style="width:${r.pct}%"></i></div>
          <span class="small muted">${r.approved}/${r.total} onaylı · ${r.blockers.length} engel</span>
        </div>
      </div>
      <div class="pj-actions">
        <button id="pjGenerate" data-generate ${ps.busy ? 'disabled' : ''}>${ps.busy ? 'Üretiliyor…' : p.pack.generatedAt ? 'YAYIN PAKETİNİ YENİDEN ÜRET' : 'YAYIN PAKETİ ÜRET'}</button>
        <button class="ghost" data-export ${ps.busy ? 'disabled' : ''}>ZIP indir</button>
        <button class="ghost danger" data-delete>Sil</button>
      </div>
      ${stale(p) ? '<p class="pj-warn">Ürün bilgisi paket üretildikten sonra değişti. Paketi yeniden üret; onayladığın ve elle düzenlediğin kalemler korunur.</p>' : ''}
      ${!p.pack.generatedAt ? '<p class="pj-hint">Paket üretimi ürününden başlar: analiz → tür ve kanca → ürünle uyumlu arama kelimeleri → konumlandırma → mağaza metinleri → görseller → uyumluluk. Kelimeye göre ürünü değiştirmez; ürüne en uygun doğru konumlandırmayı bulur.</p>' : ''}
    </div>
    <ol class="pipeline" id="pjPipeline">${pipelineHtml(p)}</ol>
    <nav class="pj-tabs" role="tablist">${TABS.map((t) => `<a role="tab" aria-selected="${ps.tab === t.id}" class="${ps.tab === t.id ? 'on' : ''}" href="#projects/${esc(p.id)}/${t.id}">${esc(t.label)}</a>`).join('')}</nav>
    <div class="pj-tab" id="pjTab">${await tabHtml(p)}</div>`;
}

function pipelineHtml(p) {
  return STAGES.map((s, i) => {
    const st = (ps.stage[s.id] && ps.stage[s.id].status) || (p.pack.stages[s.id] && p.pack.stages[s.id].status) || 'idle';
    const msg = (ps.stage[s.id] && ps.stage[s.id].msg) || (p.pack.stages[s.id] && p.pack.stages[s.id].msg) || '';
    return `<li class="stage s-${st}" title="${esc(s.en)}"><span class="stage-n">${i + 1}</span><div><b>${esc(s.label)}</b><span class="stage-en">${esc(s.en)}</span>${msg ? `<span class="stage-msg">${esc(msg)}</span>` : ''}</div></li>`;
  }).join('');
}

function badge(status) {
  return `<span class="st st-${status}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function itemActions(id, it) {
  const out = [];
  if (it.status === STATUS.READY || it.status === STATUS.NEEDS_REVIEW) out.push(`<button class="mini-btn ok" data-approve="${id}">Onayla</button>`);
  if (it.status === STATUS.APPROVED) out.push(`<button class="mini-btn" data-review="${id}">Onayı kaldır</button>`);
  if (it.edited) out.push(`<button class="mini-btn" data-unlock="${id}" title="Elle düzenlemeyi bırak; sonraki üretim bu kalemi yeniden yazabilir">Otomatiğe dön</button>`);
  return out.join('');
}

async function tabHtml(p) {
  switch (ps.tab) {
    case 'product': return tabProduct(p);
    case 'store': return tabStore(p);
    case 'assets': return tabAssets(p);
    case 'release': return tabRelease(p);
    case 'marketing': return tabMarketing(p);
    default: return tabPack(p);
  }
}

/* ---------- Paket ---------- */

function tabPack(p) {
  const r = readiness(p);
  const it = p.pack.items;
  const blockers = r.blockers.length ? `<div class="pj-blockers"><h3>Yayın engelleri</h3><ul>${r.blockers.map((b) =>
    `<li><a href="#projects/${esc(p.id)}/${ITEM_TAB[b.id] || 'pack'}">${esc(b.label)}</a> — ${b.status === 'ERROR' ? '<b class="bad">HATA</b>' : badge(b.status)}${b.why ? ` <span class="muted">${esc(b.why)}</span>` : ''}</li>`).join('')}</ul></div>` : '<p class="pj-ok">Zorunlu kalemlerin hepsi hazır. Son kontrol için her kalemi gözden geçirip onayla.</p>';
  return `${blockers}
    <div class="pj-groups">${GROUPS.map((g) => `<section class="pj-group"><h3>${esc(g.label)} <span class="muted small">${r.byGroup[g.id].done}/${r.byGroup[g.id].n}</span></h3>
      <ul>${g.items.map((x) => {
        const s = it[x.id];
        return `<li class="pj-item" data-item="${x.id}">
          <div class="pj-item-main"><a href="#projects/${esc(p.id)}/${ITEM_TAB[x.id]}">${esc(x.label)}</a>${x.required ? '<span class="req" title="Play\'e göndermek için zorunlu">zorunlu</span>' : ''}
            ${s.note ? `<p class="muted small">${esc(s.note)}</p>` : ''}${summaryOf(x.id, s)}</div>
          <div class="pj-item-side">${badge(s.status)}${itemActions(x.id, s)}</div></li>`;
      }).join('')}</ul></section>`).join('')}</div>`;
}

function summaryOf(id, s) {
  const v = s.value;
  if (!v) return '';
  const line = (t) => `<p class="pj-sum">${esc(t)}</p>`;
  switch (id) {
    case 'title': case 'short': return line(v.text);
    case 'full': return line(`${v.len} karakter`);
    case 'primary': return line(`${v.k} · ${v.verdict} · talep ${v.demand ?? '–'} · fırsat ${v.opportunity ?? '–'}`);
    case 'secondary': return v.length ? line(v.map((c) => c.k).join(', ')) : '';
    case 'candidates': return line(`${v.n} aday, ${v.analyzed} ölçülmüş`);
    case 'competitors': return v.n ? line(`İlk ${v.n}: lider ${v.leader ? v.leader.title : '–'} · ${v.angles.length} farklılaşma açısı`) : '';
    case 'category': return line(v.label);
    case 'tags': return line(v.tags.join(', '));
    case 'icon': case 'logo': case 'featureGraphic': return v.assetId ? line(`${v.source === 'upload' ? 'Yüklenen dosya' : 'Taslak'} · ${v.w}×${v.h}`) : '';
    case 'screenshots': return v.framed && v.framed.length ? line(`${v.framed.length} görüntü`) : '';
    case 'captions': return line(v.slides.map((x) => x.caption).join(' · '));
    case 'privacy': return line(v.url || 'Taslak hazır, bağlantı yok');
    case 'build': return line(v.checks.filter((c) => c.level === 'ok').length + '/' + v.checks.length + ' kontrol tamam');
    default: return '';
  }
}

/* ---------- Ürün bilgisi ---------- */

function tabProduct(p) {
  const i = p.inputs;
  const a = p.pack.analysis;
  const repo = i.repo;
  const factSel = (k) => {
    const v = i.facts && k in i.facts ? String(i.facts[k]) : '';
    const auto = a && a.facts[k] && a.facts[k].source !== 'user' && a.facts[k].value !== null ? ` (tespit: ${a.facts[k].value ? 'evet' : 'hayır'})` : '';
    return `<select data-fact="${k}"><option value=""${v === '' ? ' selected' : ''}>Bilinmiyor / otomatik${esc(auto)}</option><option value="true"${v === 'true' ? ' selected' : ''}>Evet</option><option value="false"${v === 'false' ? ' selected' : ''}>Hayır</option></select>`;
  };
  const ta = (name, label, val, rows = 3, ph = '') => `<label class="fld wide"><span>${esc(label)}</span><textarea data-input="${name}" rows="${rows}" placeholder="${esc(ph)}">${esc(val || '')}</textarea></label>`;
  const inp = (name, label, val, type = 'text', ph = '') => `<label class="fld"><span>${esc(label)}</span><input data-input="${name}" type="${type}" value="${esc(val ?? '')}" placeholder="${esc(ph)}"></label>`;
  return `<div class="pj-cols">
    <div>
      <h3>Ürün</h3>
      <div class="pj-fields">
        ${inp('name', 'Proje adı', p.name)}
        <label class="fld"><span>Pazar</span><select data-input="market">${marketOptions(p.market)}</select></label>
        <label class="fld"><span>Tür</span><select data-input="genreId">${genreOptions(i.genreId)}</select></label>
        ${inp('seedKeyword', 'Fırsat kelimesi (isteğe bağlı)', i.seedKeyword)}
        ${ta('description', 'Açıklama — oyunda gerçekten ne var?', i.description, 4)}
        ${ta('mechanics', 'Mekanikler / özellik listesi', i.mechanics, 3, '- Dorse bağlama')}
        ${ta('screenNotes', 'Ekranlarda ne görünüyor?', i.screenNotes, 2, 'Garaj ekranı, harita, gece sürüşü…')}
        ${ta('readme', 'README / tasarım notu (yapıştır)', i.readme, 3)}
      </div>
      <h3>Olgular <span class="muted small">— mağaza metnine yalnızca doğrulanan iddialar girer</span></h3>
      <div class="pj-facts">${FACTS.map(([k, l]) => `<label class="fld"><span>${esc(l)}</span>${factSel(k)}</label>`).join('')}</div>
      <details class="pj-more"><summary>Mevcut mağaza metinleri</summary>
        <div class="pj-fields">
          ${inp('store.title', 'Başlık', i.store && i.store.title)}
          ${inp('store.short', 'Kısa açıklama', i.store && i.store.short)}
          ${ta('store.full', 'Uzun açıklama', i.store && i.store.full, 4)}
        </div>
      </details>
    </div>
    <div>
      ${repo ? repoCard(repo) : '<div class="pj-card-lite"><h3>GitHub reposu</h3><p class="muted small">Repo bağlarsan README, manifest, SDK\'lar, hedef API ve sürüm otomatik okunur.</p><div class="controls"><input id="pjRepoUrl" type="text" placeholder="https://github.com/kullanici/oyun"><button class="ghost" data-attach-repo>Repo bağla</button></div><p id="pjProgress" class="muted small"></p></div>'}
      ${a ? analysisCard(a) : '<p class="muted">Analiz, paket üretilince burada görünür.</p>'}
    </div>
  </div>`;
}

function repoCard(r) {
  return `<div class="pj-card-lite"><h3>Repo ${r.url ? `<a class="small" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace('https://github.com/', ''))}</a>` : ''}</h3>
    <dl class="kv">
      <dt>Motor</dt><dd>${esc(r.engine || '–')}</dd>
      <dt>Paket</dt><dd>${esc(r.packageName || '–')}</dd>
      <dt>Sürüm</dt><dd>${esc(r.versionName || '–')} (${esc(r.versionCode ?? '–')})</dd>
      <dt>Hedef / min API</dt><dd>${esc(r.targetSdkAuto ? 'otomatik' : r.targetSdk ?? '–')} / ${esc(r.minSdk ?? '–')}</dd>
      <dt>SDK'lar</dt><dd>${esc((r.sdks || []).join(', ') || 'bulunamadı')}</dd>
      <dt>İzinler</dt><dd>${esc((r.permissions || []).map((x) => x.replace(/^.*\./, '')).join(', ') || '–')}</dd>
      <dt>Betik ipuçları</dt><dd>${esc((r.mechanicTokens || []).slice(0, 14).join(', ') || '–')}</dd>
    </dl>
    ${r.url ? `<div class="controls"><button class="ghost" data-rescan>Repoyu yeniden tara</button></div><p id="pjProgress" class="muted small"></p>` : ''}</div>`;
}

function analysisCard(a) {
  const concepts = Object.entries(a.concepts).sort((x, y) => y[1].score - x[1].score).slice(0, 14);
  return `<div class="pj-card-lite"><h3>Analiz</h3>
    <dl class="kv">
      <dt>Tür</dt><dd>${esc(a.genre.label[a.lang] || a.genre.label.en)} <span class="muted small">(${a.genre.source === 'user' ? 'senin seçimin' : `güven %${Math.round(a.genre.confidence * 100)}`})</span></dd>
      <dt>Kanca</dt><dd>${esc(a.hook.text)}</dd>
      <dt>Kavramlar</dt><dd>${concepts.map(([id, c]) => `<span class="tag" title="${esc(Object.keys(c.sources).join(', '))}">${esc(id)} ${Math.round(c.score * 10) / 10}</span>`).join(' ')}</dd>
      <dt>Özellikler</dt><dd><ul class="plain">${a.features.map((f) => `<li>${esc(f.text)} <span class="muted small">(${esc(f.source)})</span></li>`).join('')}</ul></dd>
      <dt>Tohumlar</dt><dd>${a.seeds.map((s) => `<span class="tag ${s.role === 'candidate' ? 't-new' : ''}" title="${s.role === 'candidate' ? 'doğrudan aday' : 'otomatik tamamlama ön eki'}">${esc(s.k)}</span>`).join(' ')}</dd>
    </dl></div>`;
}

/* ---------- Mağaza metinleri ---------- */

function textEditor(p, id, label, limit, rows) {
  const it = p.pack.items[id];
  const v = it.value || {};
  const text = v.text || '';
  const issues = v.issues || [];
  return `<div class="pj-editor" id="ed-${id}">
    <div class="pj-editor-head"><b>${esc(label)}</b>${badge(it.status)}<span class="count${charLen(text) > limit ? ' bad' : ''}" data-count="${id}">${charLen(text)}/${limit}</span>${itemActions(id, it)}</div>
    ${rows === 1 ? `<input type="text" data-text="${id}" value="${esc(text)}" maxlength="${limit + 40}">` : `<textarea data-text="${id}" rows="${rows}">${esc(text)}</textarea>`}
    ${issues.length ? `<ul class="issues">${issues.map((x) => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}</ul>` : ''}
    ${v.options && v.options.length > 1 ? `<div class="kw-chips">${v.options.map((o) => `<button type="button" class="kw-chip" data-use="${id}" data-val="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
    ${it.fresh ? `<p class="muted small">Yeni üretimde farklı bir öneri çıktı: “${esc(it.fresh.text || '')}” <button class="mini-btn" data-unlock="${id}">Bunu kullan</button></p>` : ''}
    ${v.claims && v.claims.length ? `<ul class="issues">${v.claims.map((c) => `<li class="${c.verified ? 'ok' : 'warn'}">İddia: “${esc(c.claim)}” — ${c.verified ? 'senin beyanın' : `doğrula (${esc(c.basis)})`}</li>`).join('')}</ul>` : ''}
    ${v.keywordCounts ? `<p class="muted small">Kelime geçişi: ${Object.entries(v.keywordCounts).map(([k, n]) => `${esc(k)} ×${n}`).join(' · ')}</p>` : ''}
  </div>`;
}

function tabStore(p) {
  const pos = p.pack.positioning;
  const it = p.pack.items;
  if (!p.pack.generatedAt) return '<p class="muted">Önce Yayın Paketi\'ni üret.</p>';
  const vb = (v) => `<span class="vbadge v-${String(v).toLowerCase()}">${esc(v)}</span>`;
  const cand = (c) => `<li>${vb(c.verdict)} <b>${esc(c.k)}</b> <span class="muted small">talep ${c.demand ?? '–'} · fırsat ${c.opportunity ?? '–'}${c.rel !== undefined ? ` · uyum %${Math.round((c.rel.score ?? c.rel) * 100)}` : ''}</span></li>`;
  const cp = it.competitors.value;
  const disc = p.pack.discovery;
  return `<div class="pj-cols">
    <div>
      <h3>Konumlandırma ${badge(it.primary.status)} ${itemActions('primary', it.primary)}</h3>
      ${pos && pos.primary ? `<div class="pj-primary">${vb(pos.primary.verdict)} <b>${esc(pos.primary.k)}</b><p class="muted small">${esc(pos.primary.reason)}</p></div>` : '<p class="pj-warn">Birincil kelime yok.</p>'}
      ${(pos && pos.warnings || []).map((w) => `<p class="pj-warn">${esc(w)}</p>`).join('')}
      <h4>İkincil küme ${itemActions('secondary', it.secondary)}</h4>
      <ul class="plain">${(pos && pos.secondary || []).map(cand).join('') || '<li class="muted">—</li>'}</ul>
      ${(pos && pos.alternatives || []).length ? `<h4>Alternatif birincil adaylar</h4><ul class="plain">${pos.alternatives.map(cand).join('')}</ul>` : ''}
      ${(pos && pos.partial || []).length ? `<h4>Kısmi uyumlu <span class="muted small">— metinlerde kullanılmaz</span></h4><ul class="plain">${pos.partial.map((c) => `${cand(c).replace('</li>', '')}<br><span class="muted small">${esc(c.partialWhy || '')}</span></li>`).join('')}</ul>` : ''}
      ${disc ? `<p class="muted small">Keşif: ${disc.seeds} tohum → ${disc.dataset} veri setinden, ${disc.suggest} otomatik tamamlamadan aday; ${disc.live} canlı ölçüm${disc.liveFailed ? `, ${disc.liveFailed} başarısız` : ''}; ${disc.rejected} ürünle uyumsuz öneri elendi.</p>` : ''}
      ${(pos && pos.excluded || []).length ? `<details class="pj-more"><summary>Elenen adaylar (${pos.excluded.length})</summary><ul class="plain small">${pos.excluded.map((e) => `<li><b>${esc(e.k)}</b> — ${esc(e.why)}</li>`).join('')}</ul></details>` : ''}
      <h3>Rakip konumlandırması ${badge(it.competitors.status)} ${itemActions('competitors', it.competitors)}</h3>
      ${cp && cp.n ? `<p class="muted small">İlk ${cp.n} · lider “${esc(cp.leader.title)}” (%${cp.leaderShare ?? '–'}) · ortalama puan ${cp.avgRating ?? '–'} · reklamlı ${cp.ads}/${cp.n} · satın almalı ${cp.iap}/${cp.n} · 1 yıldır güncellenmeyen ${cp.stale}</p>
        <p class="small">Başlıklarda sık: ${cp.titleWords.map((w) => `<span class="tag">${esc(w.w)} ×${w.n}</span>`).join(' ')}</p>
        <ul class="angles">${cp.angles.map((x) => `<li>${esc(x.text)} <span class="muted small">${esc(x.basis)}</span></li>`).join('') || '<li class="muted">Olgularla desteklenen farklılaşma açısı bulunamadı. Ürün bilgisi sekmesinde olguları belirt.</li>'}</ul>` : '<p class="muted">Rakip verisi yok.</p>'}
    </div>
    <div>
      ${textEditor(p, 'title', 'Uygulama adı', LIMITS.title, 1)}
      ${textEditor(p, 'short', 'Kısa açıklama', LIMITS.short, 2)}
      ${textEditor(p, 'full', 'Uzun açıklama', LIMITS.full, 14)}
      ${textEditor(p, 'releaseNotes', 'Sürüm notları', LIMITS.releaseNotes, 5)}
      <div class="pj-editor"><div class="pj-editor-head"><b>Kategori</b>${badge(it.category.status)}${itemActions('category', it.category)}</div>
        ${it.category.value ? `<p>${esc(it.category.value.label)} <span class="muted small">${esc(it.category.value.id)} · ${esc(it.category.value.basis)}</span></p>` : ''}</div>
      <div class="pj-editor"><div class="pj-editor-head"><b>Etiketler</b>${badge(it.tags.status)}${itemActions('tags', it.tags)}</div>
        ${it.tags.value ? `<p>${it.tags.value.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</p><p class="muted small">${esc(it.tags.value.note)}</p>` : ''}</div>
    </div>
  </div>`;
}

/* ---------- Görseller ---------- */

function assetUrl(id) {
  if (!id) return null;
  return ps.urls.get(id) || null;
}
async function preloadUrls(ids) {
  for (const id of ids) {
    if (!id || ps.urls.has(id)) continue;
    const a = await db.getAsset(id);
    if (a) ps.urls.set(id, URL.createObjectURL(new Blob([a.bytes], { type: a.type })));
  }
}
function revokeUrls() {
  for (const u of ps.urls.values()) URL.revokeObjectURL(u);
  ps.urls.clear();
}

function assetBox(p, id, label, spec, accept) {
  const it = p.pack.items[id];
  const v = it.value || {};
  const up = p.inputs.uploads && p.inputs.uploads[id];
  const url = assetUrl(v.assetId);
  const issues = v.issues || [];
  const brief = v.brief;
  return `<section class="pj-asset" id="as-${id}">
    <div class="pj-editor-head"><b>${esc(label)}</b>${badge(it.status)}${itemActions(id, it)}</div>
    <div class="pj-asset-body">
      <div class="pj-preview ${id}">${url ? `<img src="${url}" alt="${esc(label)}">` : '<span class="muted small">Henüz yok</span>'}</div>
      <div class="pj-asset-info">
        <p class="muted small">${esc(spec)}</p>
        ${v.assetId ? `<p class="small">${v.source === 'upload' ? 'Yüklenen dosya' : 'Otomatik taslak'} · ${v.w}×${v.h}${v.size ? ` · ${Math.round(v.size / 1024)} KB` : ''}</p>` : ''}
        ${issues.length ? `<ul class="issues">${issues.map((x) => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}</ul>` : ''}
        <label class="upload"><input type="file" accept="${accept}" data-upload="${id}"><span>${up ? 'Dosyayı değiştir' : 'Kendi dosyanı yükle'}</span></label>
        ${up ? `<button class="mini-btn" data-remove-upload="${id}">Yüklemeyi kaldır, taslağa dön</button>` : ''}
        ${brief && brief.icon && id === 'icon' ? `<details class="pj-more"><summary>İkon brifi</summary><p>${esc(brief.icon.concept)}</p><ul class="plain small">${brief.icon.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p class="small">Renkler: ${brief.palette.map((c) => `<span class="swatch" style="background:${esc(c)}"></span>${esc(c)}`).join(' ')} · ${esc(brief.mood)}</p></details>` : ''}
        ${brief && brief.logo && id === 'logo' ? `<details class="pj-more"><summary>Logo brifi</summary><p>${esc(brief.logo.concept)}</p><p class="muted small">${esc(brief.logo.use)}</p></details>` : ''}
        ${brief && brief.rules && id === 'featureGraphic' ? `<details class="pj-more"><summary>Tanıtım görseli brifi</summary><p>${esc(brief.headline)} — ${esc(brief.tagline || '')}</p><p class="small muted">${esc(brief.background)}</p><ul class="plain small">${brief.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
      </div>
    </div></section>`;
}

async function tabAssets(p) {
  const it = p.pack.items;
  const plan = it.captions.value;
  const screens = p.inputs.screens || [];
  const framed = (it.screenshots.value && it.screenshots.value.framed) || [];
  await preloadUrls([it.icon.value && it.icon.value.assetId, it.logo.value && it.logo.value.assetId, it.featureGraphic.value && it.featureGraphic.value.assetId,
    ...screens.map((s) => s.assetId), ...framed.map((f) => f.assetId)]);
  const brand = it.brand.value;
  return `
    ${brand ? `<div class="pj-brand"><b>Marka yönü</b> ${badge(it.brand.status)} ${itemActions('brand', it.brand)}
      <span>${brand.palette.map((c) => `<span class="swatch" style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}</span>
      <span class="muted small">${esc(brand.mood)} · renk kaynağı: ${esc(brand.paletteSource)}</span></div>` : ''}
    <div class="pj-assets">
      ${assetBox(p, 'icon', 'Uygulama ikonu', `${SPECS.icon.w}×${SPECS.icon.h} · ${SPECS.icon.format} · en fazla 1 MB`, 'image/png')}
      ${assetBox(p, 'featureGraphic', 'Tanıtım görseli', `${SPECS.featureGraphic.w}×${SPECS.featureGraphic.h} · ${SPECS.featureGraphic.format}`, 'image/png,image/jpeg')}
      ${assetBox(p, 'logo', 'Logo', 'Serbest boyut; tanıtım görseli ve video sonu kartı için', 'image/png,image/jpeg')}
    </div>
    <section class="pj-shots">
      <div class="pj-editor-head"><b>Ekran görüntüleri</b>${badge(it.screenshots.status)}${itemActions('screenshots', it.screenshots)}
        <span class="muted small">${plan ? `${plan.orientation === 'landscape' ? 'Yatay' : 'Dikey'} ${plan.size.w}×${plan.size.h}` : ''}</span></div>
      ${it.screenshots.note ? `<p class="muted small">${esc(it.screenshots.note)}</p>` : ''}
      <div class="controls">
        <label class="upload"><input type="file" accept="image/png,image/jpeg" multiple data-upload="screens"><span>Oyundan ekran görüntüsü yükle (en fazla 8)</span></label>
        <label class="field"><input type="checkbox" data-input="frameScreens" ${p.inputs.frameScreens !== false ? 'checked' : ''}> Başlık ve çerçeve ekle</label>
        <label class="field">Yön <select data-input="orientation"><option value="">Otomatik</option><option value="landscape"${p.inputs.orientation === 'landscape' ? ' selected' : ''}>Yatay</option><option value="portrait"${p.inputs.orientation === 'portrait' ? ' selected' : ''}>Dikey</option></select></label>
        ${screens.length ? '<button class="ghost" data-regen-assets>Görselleri yeniden üret</button>' : ''}
      </div>
      ${screens.length ? `<ol class="pj-raw">${screens.map((s, i) => `<li><img src="${assetUrl(s.assetId) || ''}" alt="Ham görüntü ${i + 1}">
        <input type="text" data-caption="${i}" value="${esc(s.caption || (plan && plan.slides[i] ? plan.slides[i].caption : ''))}" placeholder="Başlık" maxlength="40">
        <span class="muted small">${s.w}×${s.h}</span><button class="mini-btn" data-remove-screen="${i}">Kaldır</button></li>`).join('')}</ol>` : ''}
      ${framed.length ? `<h4>Play'e gidecek görüntüler</h4><div class="pj-framed">${framed.map((f) => `<figure><img src="${assetUrl(f.assetId) || ''}" alt="${esc(f.caption)}"><figcaption class="small">${f.w}×${f.h}${f.issues && f.issues.length ? ` · ${esc(f.issues.map((x) => x.msg).join(' '))}` : ''}</figcaption></figure>`).join('')}</div>` : ''}
      ${plan ? `<h4>Çekim planı ${badge(it.captions.status)} ${itemActions('captions', it.captions)}</h4><ol class="pj-plan">${plan.slides.map((s) => `<li><b>${esc(s.caption)}</b><span class="muted small">${esc(s.capture)} · ${esc(s.basis)}</span></li>`).join('')}</ol>
        <ul class="plain small muted">${plan.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

/* ---------- Yayın uyumu ---------- */

function tabRelease(p) {
  const it = p.pack.items;
  const i = p.inputs;
  const pp = it.privacy.value;
  const ds = it.dataSafety.value;
  const cr = it.contentRating.value;
  const bc = it.build.value;
  const b = i.build || {};
  const inp = (name, label, val, type = 'text', ph = '') => `<label class="fld"><span>${esc(label)}</span><input data-input="${name}" type="${type}" value="${esc(val ?? '')}" placeholder="${esc(ph)}"></label>`;
  return `<div class="pj-cols">
    <div>
      <section class="pj-editor"><div class="pj-editor-head"><b>Gizlilik politikası</b>${badge(it.privacy.status)}${itemActions('privacy', it.privacy)}</div>
        <div class="pj-fields">
          ${inp('privacyUrl', 'Politika adresi (https)', i.privacyUrl, 'url', 'https://…/privacy')}
          ${inp('developerName', 'Geliştirici adı', i.developerName)}
          ${inp('contactEmail', 'İletişim e-postası', i.contactEmail, 'email')}
        </div>
        ${pp ? `<p class="muted small">${esc(it.privacy.note)}</p><details class="pj-more"><summary>Politika taslağı (hukuki tavsiye değildir)</summary><textarea readonly rows="12" class="mono">${esc(pp.draft)}</textarea><button class="mini-btn" data-copy="privacyDraft">Kopyala</button></details>` : ''}
      </section>
      <section class="pj-editor"><div class="pj-editor-head"><b>Data Safety taslağı</b>${badge(it.dataSafety.status)}${itemActions('dataSafety', it.dataSafety)}</div>
        ${ds ? `<p class="muted small">Kaynak: ${esc(ds.confidence)} · ${ds.collects === true ? 'veri toplanıyor' : ds.collects === false ? 'toplanan veri bulunamadı' : 'bilinmiyor'}</p>
          ${ds.byType.length ? `<table class="apps"><thead><tr><th>Veri türü</th><th>Kaynak</th><th>Paylaşım</th></tr></thead><tbody>${ds.byType.map((t) => `<tr><td>${esc(t.type)}</td><td>${esc(t.sdks.join(', '))}</td><td>${t.shared ? 'üçüncü tarafla' : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
          <ul class="plain">${ds.declarations.map((d) => `<li>${esc(d.q)} → <b>${esc(d.answer)}</b> <span class="muted small">${esc(d.basis || '')}</span></li>`).join('')}</ul>
          ${ds.questions.length ? `<ul class="issues">${ds.questions.map((q) => `<li class="warn">${esc(q)}</li>`).join('')}</ul>` : ''}` : '<p class="muted">Paket üretilince hazırlanır.</p>'}
        <p class="muted small">Repo taranmadıysa kullandığın SDK'ları işaretle:</p>
        <div class="pj-sdks">${['admob', 'unity_ads', 'applovin', 'ironsource', 'meta', 'firebase_analytics', 'crashlytics', 'unity_analytics', 'gameanalytics', 'appsflyer', 'adjust', 'fcm', 'billing', 'play_games', 'auth'].map((id) =>
          `<label class="field"><input type="checkbox" data-sdk="${id}" ${(i.sdksManual || []).includes(id) ? 'checked' : ''}${(i.repo && (i.repo.sdks || []).includes(id)) ? ' checked disabled title="Repoda bulundu"' : ''}> ${esc(id)}</label>`).join('')}</div>
      </section>
    </div>
    <div>
      <section class="pj-editor"><div class="pj-editor-head"><b>İçerik derecelendirme (IARC) hazırlığı</b>${badge(it.contentRating.status)}${itemActions('contentRating', it.contentRating)}</div>
        ${cr ? `<p class="muted small">${esc(cr.note)}</p><ul class="plain">${cr.signals.map((s) => `<li class="pj-q"><span>${esc(s.question)}${s.detected ? ` <span class="tag t-falling" title="${esc(s.evidence.join(', '))}">metinde işaret var</span>` : ''}</span>
          <select data-rating="${s.id}"><option value="">Yanıtla</option><option value="no"${s.answer === 'no' ? ' selected' : ''}>Hayır</option><option value="yes"${s.answer === 'yes' ? ' selected' : ''}>Evet</option></select></li>`).join('')}</ul>` : '<p class="muted">Paket üretilince hazırlanır.</p>'}
      </section>
      <section class="pj-editor"><div class="pj-editor-head"><b>Derleme / AAB</b>${badge(it.build.status)}${itemActions('build', it.build)}</div>
        ${bc ? `<ul class="checks">${bc.checks.map((c) => `<li class="c-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>` : ''}
        <div class="pj-fields">
          ${inp('build.packageName', 'Paket adı', b.packageName || (i.repo && i.repo.packageName) || '', 'text', 'com.firma.oyun')}
          ${inp('build.targetSdk', 'Hedef API', b.targetSdk ?? (i.repo && i.repo.targetSdk) ?? '', 'number')}
          ${inp('build.versionCode', 'versionCode', b.versionCode ?? (i.repo && i.repo.versionCode) ?? '', 'number')}
          ${inp('build.versionName', 'versionName', b.versionName || (i.repo && i.repo.versionName) || '')}
        </div>
        <div class="pj-checks">
          <label class="field"><input type="checkbox" data-input="build.aab" ${b.aab ? 'checked' : ''}> Release AAB hazır</label>
          <label class="field"><input type="checkbox" data-input="build.signed" ${b.signed ? 'checked' : ''}> Yükleme anahtarıyla imzalı</label>
          <label class="field"><input type="checkbox" data-input="build.testingDone" ${b.testingDone ? 'checked' : ''}> Kapalı test şartı tamam (ya da kuruluş hesabı)</label>
        </div>
        <p class="muted small">Değişiklikler "Son yayın kontrolü" aşamasında yeniden değerlendirilir: <button class="mini-btn" data-regen-stage="final">Şimdi kontrol et</button></p>
      </section>
    </div>
  </div>`;
}

/* ---------- Pazarlama ---------- */

function tabMarketing(p) {
  const it = p.pack.items;
  const pv = it.promoVideo.value;
  const sc = it.socialCopy.value;
  const video = (id) => {
    const v = it[id].value;
    if (!v) return '';
    return `<section class="pj-editor"><div class="pj-editor-head"><b>${esc(v.name)}</b><span class="muted small">${v.format}</span>${badge(it[id].status)}${itemActions(id, it[id])}</div>
      <table class="apps"><thead><tr><th>sn</th><th>Görüntü</th><th>Ekran metni</th></tr></thead><tbody>${v.shots.map((s) => `<tr><td>${esc(s.t)}</td><td>${esc(s.visual)}</td><td>${esc(s.text)}</td></tr>`).join('')}</tbody></table></section>`;
  };
  if (!p.pack.generatedAt) return '<p class="muted">Önce Yayın Paketi\'ni üret.</p>';
  return `<div class="pj-cols">
    <div>
      <section class="pj-editor"><div class="pj-editor-head"><b>Tanıtım videosu</b>${badge(it.promoVideo.status)}${itemActions('promoVideo', it.promoVideo)}</div>
        <label class="fld wide"><span>YouTube bağlantısı</span><input data-input="promoUrl" type="url" value="${esc(p.inputs.promoUrl || '')}" placeholder="https://www.youtube.com/watch?v=…"></label>
        ${pv && pv.plan ? `<p class="muted small">${esc(pv.plan.length)}</p><ol class="pj-plan">${pv.plan.beats.map((x) => `<li><b>${esc(x.t)}</b><span>${esc(x.what)}</span></li>`).join('')}</ol><ul class="plain small muted">${pv.plan.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      </section>
      ${video('video6')}${video('video10')}${video('video15')}
    </div>
    <div>
      <section class="pj-editor"><div class="pj-editor-head"><b>Shorts / Reels / TikTok</b>${badge(it.socialCopy.status)}${itemActions('socialCopy', it.socialCopy)}</div>
        ${sc ? `<h4>YouTube Shorts</h4><pre class="copy">${esc(sc.shorts.title)}\n\n${esc(sc.shorts.description)}</pre>
          <h4>Instagram Reels</h4><pre class="copy">${esc(sc.reels.caption)}</pre>
          <h4>TikTok</h4><pre class="copy">${esc(sc.tiktok.caption)}</pre>` : ''}
      </section>
    </div>
  </div>`;
}

/* ---------------- olaylar ---------------- */

async function saveProject(p, inputsChanged = false) {
  const now = new Date().toISOString();
  p.updatedAt = now;
  if (inputsChanged) p.inputsChangedAt = now;
  await db.putProject(p);
}

async function refresh(scrollKeep = true) {
  const y = window.scrollY;
  await drawProject();
  if (scrollKeep) window.scrollTo({ top: y });
}

function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ||= {};
  o[keys[keys.length - 1]] = val;
}

async function onClick(e) {
  const t = e.target.closest('[data-form],[data-import-mode],[data-generate],[data-export],[data-delete],[data-approve],[data-review],[data-unlock],[data-use],[data-remove-upload],[data-remove-screen],[data-regen-assets],[data-regen-stage],[data-copy],[data-attach-repo],[data-rescan]');
  if (!t) return;
  const p = ps.project;
  if (t.dataset.form !== undefined) {
    ps.form = t.dataset.form && ps.form !== t.dataset.form ? t.dataset.form : null;
    ps.msg = '';
    drawList();
    return;
  }
  if (t.dataset.importMode) { ps.importMode = t.dataset.importMode; $('#pjForm').innerHTML = formHtml('import', $('#pjForm select[name=market]')?.value || 'us-en'); return; }
  if (!p) return;
  if (t.dataset.generate !== undefined) return runGenerate();
  if (t.dataset.regenAssets !== undefined) return runGenerate(['icon', 'logo', 'featureGraphic', 'screenshotPlan', 'screenshotAssets', 'final']);
  if (t.dataset.regenStage) return runGenerate([t.dataset.regenStage]);
  if (t.dataset.export !== undefined) return runExport();
  if (t.dataset.delete !== undefined) {
    if (!confirm(`"${p.name}" ve tüm görselleri bu tarayıcıdan silinsin mi? Geri alınamaz.`)) return;
    await db.deleteProject(p.id);
    revokeUrls();
    ps.project = null;
    go('');
    return;
  }
  if (t.dataset.approve) { setStatus(p, t.dataset.approve, STATUS.APPROVED); await saveProject(p); return refresh(); }
  if (t.dataset.review) { setStatus(p, t.dataset.review, STATUS.NEEDS_REVIEW); await saveProject(p); return refresh(); }
  if (t.dataset.unlock) { unlock(p, t.dataset.unlock); await saveProject(p); return refresh(); }
  if (t.dataset.use) { editText(p, t.dataset.use, t.dataset.val); await saveProject(p); return refresh(); }
  if (t.dataset.removeUpload) {
    const up = p.inputs.uploads && p.inputs.uploads[t.dataset.removeUpload];
    if (up) { delete p.inputs.uploads[t.dataset.removeUpload]; await db.deleteAssets([up.assetId]); }
    await saveProject(p, true);
    return runGenerate([t.dataset.removeUpload === 'icon' ? 'icon' : t.dataset.removeUpload, 'final']);
  }
  if (t.dataset.removeScreen !== undefined) {
    const [s] = p.inputs.screens.splice(Number(t.dataset.removeScreen), 1);
    if (s) await db.deleteAssets([s.assetId]);
    await saveProject(p, true);
    return runGenerate(['featureGraphic', 'screenshotAssets', 'final']);
  }
  if (t.dataset.copy === 'privacyDraft') {
    try { await navigator.clipboard.writeText(p.pack.items.privacy.value.draft); t.textContent = 'Kopyalandı'; } catch { t.textContent = 'Kopyalanamadı'; }
    return;
  }
  if (t.dataset.attachRepo !== undefined || t.dataset.rescan !== undefined) {
    const url = t.dataset.rescan !== undefined ? p.inputs.repo.url : $('#pjRepoUrl').value;
    const prog = (m) => { const el = $('#pjProgress'); if (el) el.textContent = m; };
    try {
      p.inputs.repo = await fetchRepo(url, { token: ps.ghToken || null, onProgress: prog });
      await saveProject(p, true);
      await refresh();
    } catch (err) { prog(err.message); }
  }
}

async function onChange(e) {
  const t = e.target;
  const p = ps.project;
  if (!p) return;
  if (t.dataset.text) { editText(p, t.dataset.text, t.value); await saveProject(p); return refresh(); }
  if (t.dataset.input) {
    const key = t.dataset.input;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.type === 'number') v = t.value === '' ? null : Number(t.value);
    if (key === 'name') { if (!String(v).trim()) return; p.name = String(v).trim(); }
    else if (key === 'market') p.market = MARKETS[v] ? v : p.market;
    else setPath(p.inputs, key, v);
    await saveProject(p, true);
    if (['name', 'market', 'orientation', 'frameScreens'].includes(key) || key.startsWith('build.')) return refresh();
    return;
  }
  if (t.dataset.fact) {
    p.inputs.facts ||= {};
    if (t.value === '') delete p.inputs.facts[t.dataset.fact]; else p.inputs.facts[t.dataset.fact] = t.value === 'true';
    await saveProject(p, true);
    return refresh();
  }
  if (t.dataset.sdk) {
    const set = new Set(p.inputs.sdksManual || []);
    if (t.checked) set.add(t.dataset.sdk); else set.delete(t.dataset.sdk);
    p.inputs.sdksManual = [...set];
    await saveProject(p, true);
    return;
  }
  if (t.dataset.rating) {
    p.inputs.rating ||= {};
    if (t.value) p.inputs.rating[t.dataset.rating] = t.value; else delete p.inputs.rating[t.dataset.rating];
    await saveProject(p, true);
    return runGenerate(['privacy', 'final']);
  }
  if (t.dataset.caption !== undefined) {
    p.inputs.screens[Number(t.dataset.caption)].caption = t.value.trim();
    await saveProject(p, true);
    return;
  }
  if (t.dataset.upload) return handleUpload(t.dataset.upload, t.files);
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.text) {
    const lim = LIMITS[t.dataset.text];
    const el = $(`[data-count="${t.dataset.text}"]`);
    if (el && lim) { const n = charLen(t.value); el.textContent = `${n}/${lim}`; el.classList.toggle('bad', n > lim); }
  }
}

async function onSubmit(e) {
  const form = e.target.closest('form[data-create]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await createFrom(form.dataset.create, form);
  } catch (err) {
    const el = $('#pjProgress') || form.querySelector('.pj-form-foot');
    if (el) el.insertAdjacentHTML('beforebegin', `<p class="pj-warn">${esc(err.message)}</p>`);
    btn.disabled = false;
  }
}

async function handleUpload(kind, files) {
  const p = ps.project;
  if (!files || !files.length) return;
  if (kind === 'screens') {
    p.inputs.screens ||= [];
    for (const f of [...files].slice(0, 8 - p.inputs.screens.length)) {
      const r = await readUpload(f, 'screenshot');
      if (!r.info.type) continue;
      const id = await db.putAsset({ projectId: p.id, kind: 'raw', type: r.type, bytes: r.bytes, w: r.w, h: r.h, name: r.name });
      p.inputs.screens.push({ assetId: id, w: r.w, h: r.h, name: r.name, caption: '' });
    }
    await saveProject(p, true);
    return runGenerate(['featureGraphic', 'screenshotPlan', 'screenshotAssets', 'final']);
  }
  const check = kind === 'logo' ? null : kind;
  let r = await readUpload(files[0], check || 'screenshot');
  if (!r.info.type) { alert('PNG ya da JPEG seç.'); return; }
  if (kind === 'featureGraphic' && r.info.alpha) {
    // alfalı PNG'yi Play'in kabul ettiği alfasız JPEG'e çevir
    const flat = await flattenToJpeg(r.bytes, r.type);
    r = { ...r, ...flat, info: imageInfo(flat.bytes) };
  }
  const issues = check ? validateImage(check, r.info, r.bytes.length) : [];
  const old = p.inputs.uploads && p.inputs.uploads[kind];
  const id = await db.putAsset({ projectId: p.id, kind, type: r.type, bytes: r.bytes, w: r.w, h: r.h, name: r.name });
  if (old) await db.deleteAssets([old.assetId]);
  p.inputs.uploads ||= {};
  p.inputs.uploads[kind] = { assetId: id, w: r.w, h: r.h, type: r.type, size: r.bytes.length, issues };
  await saveProject(p, true);
  return runGenerate([kind, 'final']);
}

function referenced(p) {
  const ids = new Set();
  for (const s of p.inputs.screens || []) ids.add(s.assetId);
  for (const u of Object.values(p.inputs.uploads || {})) ids.add(u.assetId);
  for (const id of ['icon', 'logo', 'featureGraphic']) {
    const it = p.pack.items[id];
    if (it.value && it.value.assetId) ids.add(it.value.assetId);
    if (it.fresh && it.fresh.assetId) ids.add(it.fresh.assetId);
  }
  const sv = p.pack.items.screenshots;
  for (const f of (sv.value && sv.value.framed) || []) ids.add(f.assetId);
  for (const f of (sv.fresh && sv.fresh.framed) || []) ids.add(f.assetId);
  ids.delete(undefined);
  return ids;
}

async function apiLive() {
  try { return await bridge.isLive(); } catch { return false; }
}

async function runGenerate(only) {
  const p = ps.project;
  if (!p || ps.busy) return;
  // ilk tam üretimden önce kısmi çalıştırma: analiz ve marka önce gelir
  if (only && !p.pack.analysis) only = ['analyze', 'genre', 'icon', ...only];
  ps.busy = true;
  ps.stage = {};
  await refresh();
  const m = MARKETS[p.market] || MARKETS['us-en'];
  let dataset = null;
  try { dataset = await bridge.getMarketData(p.market); } catch { dataset = null; }
  const live = !only || only.includes('discover') ? await apiLive() : false;
  const getJson = async (path) => { const r = await fetch(bridge.apiUrl(path)); const j = await r.json(); if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
  const ctx = {
    only,
    dataset,
    suggest: live ? async (q) => (await getJson(`api/suggest?q=${encodeURIComponent(q)}&gl=${m.gl}&hl=${m.hl}`)).suggestions : null,
    analyze: live ? async (k) => (await getJson(`api/analyze?q=${encodeURIComponent(k)}&gl=${m.gl}&hl=${m.hl}`)).result : null,
    render: createRenderer({ putAsset: db.putAsset, getAsset: db.getAsset }),
    onStage: (id, status, msg) => {
      ps.stage[id] = { status, msg };
      const el = $('#pjPipeline');
      if (el) el.innerHTML = pipelineHtml(p);
    }
  };
  const before = await db.projectAssetIds(p.id);
  try {
    await generatePack(p, ctx);
    if (!live && (!only || only.includes('discover'))) {
      p.pack.stages.discover.msg += ' · canlı API kapalı: yalnızca günlük tarama verisi kullanıldı';
    }
  } finally {
    const keep = referenced(p);
    const orphan = before.filter((id) => !keep.has(id));
    await db.deleteAssets(orphan);
    for (const id of orphan) { const u = ps.urls.get(id); if (u) { URL.revokeObjectURL(u); ps.urls.delete(id); } }
    p.inputsChangedAt = null;
    await saveProject(p);
    ps.busy = false;
    ps.stage = {};
    await refresh();
  }
}

async function runExport() {
  const p = ps.project;
  const btn = $('[data-export]');
  if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanıyor…'; }
  try {
    const files = await exportFiles(p, async (id) => db.getAsset(id));
    for (const id of referenced(p)) {
      const a = await db.getAsset(id);
      if (a) files.push({ path: `publish-pack/assets/${id}.${a.type === 'image/jpeg' ? 'jpg' : 'png'}`, data: a.bytes });
    }
    const zip = zipStore(files);
    const slug = p.name.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'proje';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    a.download = `${slug}-publish-pack.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'ZIP indir'; }
  }
}
