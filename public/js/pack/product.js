/*
 * Ürün analizi: mevcut bir oyunun/uygulamanın metinlerinden (ad, açıklama, README,
 * mekanikler, ekran notları, mağaza verisi, repo dosya adları) tür, çekirdek kanca,
 * olgular, özellikler ve arama tohumları çıkarır. Saf fonksiyonlar.
 *
 * Amaç oyunu bir anahtar kelimeye göre yeniden tasarlamak DEĞİL; var olan ürün için
 * en güçlü DOĞRU konumlandırmayı bulmaktır. Bu yüzden her kavramın kanıtı saklanır
 * ve iddia niteliğindeki kavramlar (çevrimdışı, çok oyunculu, gerçekçi...) ancak
 * üründe karşılığı varsa kullanılır.
 */
import { CONCEPTS, GENRES, GENERIC_GENRE, GAME_WORDS, DEV_WORDS, TRADEMARKS, SDKS, genreById } from './lexicon.js';
import { normalizeFor, stemEn, stemTr, langOf } from '../lang.js';

/** Kaynak ağırlıkları: kullanıcının kendi yazdığı açıklama README'den daha güçlü kanıttır. */
export const SOURCE_WEIGHTS = {
  keyword: 2, name: 3, storeTitle: 3, storeShort: 2.5, description: 2, mechanics: 2, genreHint: 2,
  screens: 1.5, storeFull: 1.5, readme: 1, files: 0.6
};
export const SOURCE_LABELS = {
  keyword: 'fırsat kelimesi', name: 'proje adı', storeTitle: 'mağaza başlığı', storeShort: 'mağaza kısa açıklaması',
  description: 'açıklama', mechanics: 'mekanikler', genreHint: 'tür notu', screens: 'ekran notları',
  storeFull: 'mağaza açıklaması', readme: 'README', files: 'repo dosya adları', genre: 'tür sözlüğü',
  autocomplete: 'Play otomatik tamamlama', manifest: 'AndroidManifest', sdk: 'SDK tespiti', user: 'kullanıcı'
};

/** Türün kendiliğinden ima ettiği kavramlar (iddia değil, konunun kendisi). */
export const GENRE_IMPLIES = {
  truck_sim: ['truck', 'simulator', 'driving', 'cargo'], bus_sim: ['bus', 'simulator', 'driving', 'passenger'],
  racing: ['racing', 'car', 'driving'], car_driving: ['car', 'driving', 'simulator'], flight_sim: ['airplane', 'simulator'],
  train_sim: ['train', 'simulator'], farming: ['farm', 'simulator'], tycoon: ['tycoon'], cooking: ['cooking'],
  puzzle: ['puzzle'], word: ['word', 'puzzle'], trivia: ['trivia'], card: ['card'], board: ['board'], shooter: ['shooter'],
  horror: ['horror'], survival: ['survival'], runner: ['runner', 'arcade'], tower_defense: ['tower_defense', 'strategy'],
  rpg: ['rpg'], strategy: ['strategy'], sports: ['sports'], fishing_hunting: [], kids_edu: ['kids', 'education'],
  app_calculator: ['calculator'], app_finance: ['finance'], app_productivity: ['habit'], app_fitness: ['fitness'],
  app_religious: ['religious'], app_photo: ['photo'], app_music: ['music'], app_utility: ['utility'],
  app_language: ['language', 'education'], app_recipe: ['recipe', 'cooking'], game_generic: [], app_generic: []
};

/* ---------------- dil tespiti ---------------- */
const TR_HINTS = new Set(['ve', 'bir', 'bu', 'için', 'ile', 'da', 'de', 'çok', 'olan', 'daha', 'gibi', 'ne', 'mi', 'sen', 'her', 'oyun', 'oyunu']);
const EN_HINTS = new Set(['the', 'and', 'to', 'of', 'in', 'for', 'with', 'is', 'on', 'your', 'you', 'an', 'it', 'this', 'that', 'are', 'game']);

/** Metnin dilini kaba biçimde tahmin eder: 'tr' | 'en' | null. */
export function detectLang(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  const trChars = (t.match(/[çğıöşü]/g) || []).length;
  let tr = trChars * 0.4;
  let en = 0;
  for (const w of t.split(/[^\p{L}]+/u)) {
    if (TR_HINTS.has(w)) tr++;
    if (EN_HINTS.has(w)) en++;
  }
  if (tr === 0 && en === 0) return null;
  return tr > en ? 'tr' : 'en';
}

/* ---------------- kavram dizini ---------------- */
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  const single = new Map();
  const phrases = [];
  for (const [id, c] of Object.entries(CONCEPTS)) {
    for (const lang of ['en', 'tr']) {
      for (const w of c[lang] || []) {
        const n = normalizeFor(w, lang);
        if (!n) continue;
        if (n.includes(' ')) phrases.push({ phrase: n, id });
        else {
          const key = `${lang}:${langOf(lang).stem(n)}`;
          if (!single.has(key)) single.set(key, new Set());
          single.get(key).add(id);
        }
      }
    }
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);
  INDEX = { single, phrases };
  return INDEX;
}

/** Tek kelimenin kavramı (her iki dilin köklemesiyle dener). */
export function conceptOfToken(token) {
  const { single } = index();
  const a = single.get(`en:${stemEn(token)}`);
  if (a && a.size) return [...a][0];
  const b = single.get(`tr:${stemTr(token)}`);
  if (b && b.size) return [...b][0];
  return null;
}

/**
 * Metni tarar: kavram sayıları ve profil kökleri.
 * devFilter: README ve dosya adları için geliştirici kelimelerini ele.
 */
export function scanText(text, opts = {}) {
  const { lang = detectLang(text) || 'en', devFilter = false } = opts;
  const { single, phrases } = index();
  let work = ` ${normalizeFor(text, lang)} `;
  const concepts = new Map();
  const bump = (id, token) => {
    const e = concepts.get(id) || { count: 0, tokens: new Set() };
    e.count++;
    e.tokens.add(token);
    concepts.set(id, e);
  };
  for (const p of phrases) {
    const needle = ` ${p.phrase} `;
    let idx = work.indexOf(needle);
    while (idx >= 0) {
      bump(p.id, p.phrase);
      work = `${work.slice(0, idx)} ${work.slice(idx + needle.length - 1)}`;
      idx = work.indexOf(needle);
    }
  }
  const stems = new Set();
  for (const tok of work.trim().split(' ')) {
    if (!tok || tok.length < 2) continue;
    if (devFilter && DEV_WORDS.has(tok)) continue;
    if (DEV_WORDS.has(tok) && tok.length <= 3) continue;
    const se = stemEn(tok);
    const st = stemTr(tok);
    stems.add(se); stems.add(st); stems.add(tok);
    const hit = single.get(`en:${se}`) || single.get(`tr:${st}`);
    if (hit) for (const id of hit) bump(id, tok);
  }
  return { lang, concepts, stems };
}

/* ---------------- kaynak toplama ---------------- */
function asText(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v.filter(Boolean).join('. ');
  return String(v);
}

/** Projenin tüm metin kaynakları (ağırlık ve dil bilgisiyle). */
export function collectSources(project) {
  const i = (project && project.inputs) || {};
  const out = [];
  const push = (source, text, devFilter = false) => {
    const t = asText(text).trim();
    if (!t) return;
    out.push({ source, text: t, devFilter, lang: detectLang(t), weight: SOURCE_WEIGHTS[source] || 1 });
  };
  push('keyword', i.seedKeyword);
  push('name', project && project.name);
  push('description', i.description);
  push('mechanics', i.mechanics);
  push('genreHint', i.genreHint);
  push('screens', i.screenNotes);
  const store = i.store || {};
  push('storeTitle', store.title);
  push('storeShort', store.short);
  push('storeFull', store.full);
  const repo = i.repo || {};
  push('readme', repo.readme, true);
  push('files', (repo.mechanicTokens || []).join(' '), true);
  if (repo.description) push('description', repo.description);
  return out;
}

/* ---------------- özellik çıkarma ---------------- */
const FEATURE_HEADING = /(features?|özellik|gameplay|oynanış|highlights|what'?s inside|neler var|içerik|mechanics|mekanik)/i;
const DEV_LINE = /^(install|clone|run|build|open|download the|npm|yarn|git |cd |unity|godot|requirements?|license|contribut|kurulum|yükle|çalıştır|derle|lisans)/i;

function cleanMd(s) {
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.;:,-]+$/, '')
    .trim();
}

/** Markdown/düz metinden özellik satırları çıkarır. */
export function extractFeatureLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const inSection = [];
  const anywhere = [];
  let heading = '';
  for (const raw of lines) {
    const m = raw.match(/^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/);
    if (!m) {
      // başlık: markdown "#" satırı ya da ":" ile biten kısa satır
      if (/^\s{0,3}#{1,6}\s+/.test(raw) || (/:\s*$/.test(raw) && raw.trim().length < 60)) heading = raw;
      continue;
    }
    const item = cleanMd(m[1]);
    if (item.length < 8 || item.length > 140 || /https?:|www\./i.test(item) || DEV_LINE.test(item)) continue;
    if (FEATURE_HEADING.test(heading)) inSection.push(item);
    else anywhere.push(item);
  }
  if (inSection.length) return inSection;
  return anywhere.filter((x) => scanText(x).concepts.size > 0);
}

/** Düz açıklamadan cümleleri ayırır. */
export function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map(cleanMd)
    .filter((s) => s.length >= 12 && s.length <= 180);
}

/* ---------------- ana analiz ---------------- */

/**
 * @param {object} project { name, market, inputs: { description, readme, mechanics, screenNotes,
 *   genreHint, genreId, seedKeyword, store:{title,short,full}, repo:{readme, mechanicTokens, sdks, permissions, ...}, facts:{} } }
 * @returns analiz nesnesi (bkz. dönüş)
 */
export function analyzeProduct(project) {
  const lang = marketLang(project && project.market);
  const sources = collectSources(project);
  const concepts = {};
  const tokenSet = new Set();
  let gameness = 0;
  const gameWords = new Set([...GAME_WORDS.en, ...GAME_WORDS.tr]);

  for (const src of sources) {
    const scan = scanText(src.text, { lang: src.lang || lang, devFilter: src.devFilter });
    for (const s of scan.stems) tokenSet.add(s);
    for (const [id, e] of scan.concepts) {
      const c = concepts[id] || { score: 0, mentions: 0, sources: {}, tokens: [] };
      c.mentions += e.count;
      // tekrarı sönümle: aynı kaynakta 1 + log2(sayı)
      c.score += src.weight * (1 + Math.log2(e.count));
      c.sources[src.source] = (c.sources[src.source] || 0) + e.count;
      for (const t of e.tokens) if (!c.tokens.includes(t) && c.tokens.length < 6) c.tokens.push(t);
      concepts[id] = c;
    }
    for (const w of normalizeFor(src.text, src.lang || lang).split(' ')) if (gameWords.has(w)) gameness += src.devFilter ? 0.3 : 1;
  }
  const repo = (project && project.inputs && project.inputs.repo) || {};
  if (['unity', 'godot', 'unreal'].includes(repo.engine)) gameness += 3;

  const genre = classifyGenre(concepts, gameness, project && project.inputs);
  const accountText = sources.some((s) => ACCOUNT_WORDS.test(s.text));
  const facts = deriveFacts(concepts, project, { accountText });
  const features = deriveFeatures(sources, concepts, lang, genre, facts);
  const hook = deriveHook(sources, lang, genre);
  const analysis = { lang, genre, concepts, tokens: [...tokenSet], facts, features, hook, gameness: round1(gameness),
    sourceSummary: sources.map((s) => ({ source: s.source, lang: s.lang, chars: s.text.length })) };
  analysis.seeds = deriveSeeds(analysis, project);
  return analysis;
}

function round1(x) { return Math.round(x * 10) / 10; }

export function marketLang(market) {
  const m = String(market || 'us-en');
  return m.split('-')[1] === 'tr' ? 'tr' : 'en';
}

/** Tür sınıflandırma: kavram puanlarından. Kullanıcının seçtiği tür her zaman kazanır. */
export function classifyGenre(concepts, gameness = 0, inputs = {}) {
  if (inputs && inputs.genreId) {
    const g = genreById(inputs.genreId);
    return { id: g.id, label: g.label, category: g.category, game: g.game, confidence: 1, source: 'user', scores: [], evidence: GENRE_IMPLIES[g.id] || [] };
  }
  const scored = GENRES.map((g) => {
    let s = 0;
    const ev = [];
    for (const [cid, w] of Object.entries(g.triggers)) {
      const c = concepts[cid];
      if (c && c.score > 0) { s += w * Math.log2(1 + c.score); ev.push(cid); }
    }
    if (gameness >= 1) s *= g.game ? 1.3 : 0.6;
    else if (gameness === 0) s *= g.game ? 0.8 : 1.2;
    return { id: g.id, score: round1(s), evidence: ev };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1] || { score: 0 };
  if (!top || top.score < 1.5) {
    const g = gameness >= 1 ? GENERIC_GENRE.game : GENERIC_GENRE.app;
    return { id: g.id, label: g.label, category: g.category, game: g.game, confidence: 0.2, source: 'fallback', scores: scored.slice(0, 3), evidence: [] };
  }
  const g = genreById(top.id);
  const confidence = Math.round(100 * (top.score / (top.score + second.score))) / 100;
  return { id: g.id, label: g.label, category: g.category, game: g.game, confidence, source: 'text', scores: scored.slice(0, 3), evidence: top.evidence };
}

function fact(value, source, confidence, note) {
  return { value, source, confidence, note: note || '' };
}

const ACCOUNT_WORDS = /\b(log ?in|sign ?in|sign ?up|create an account|user account|register)\b|giriş yap|hesap oluştur|üye ol|kayıt ol/i;

/** Olgular: ürün hakkında iddia edilebilecek/edilemeyecek şeyler. Kullanıcının beyanı her zaman kazanır. */
export function deriveFacts(concepts, project, extra = {}) {
  const i = (project && project.inputs) || {};
  const repo = i.repo || {};
  const has = (id) => concepts[id] && concepts[id].score > 0;
  const perms = new Set(repo.permissions || []);
  const sdks = new Set(repo.sdks || []);
  const repoScanned = !!(repo.scanned);
  const f = {};

  // çevrimdışı
  if (has('offline')) f.offline = fact(true, 'text', 'medium', 'Metinde çevrimdışı/internetsiz ifadesi var.');
  else if (repoScanned && repo.manifestFound && !perms.has('android.permission.INTERNET')) f.offline = fact(true, 'manifest', 'high', 'AndroidManifest\'te INTERNET izni yok.');
  else f.offline = fact(null, 'unknown', 'none', 'Ürün internetsiz çalışıyor mu, belirt.');

  const adSdk = SDKS.filter((s) => s.ads && sdks.has(s.id)).map((s) => s.label);
  if (adSdk.length) f.ads = fact(true, 'sdk', 'high', `Reklam SDK'sı: ${adSdk.join(', ')}`);
  else if (repoScanned) f.ads = fact(false, 'sdk', 'medium', 'Repoda reklam SDK\'sı bulunamadı.');
  else f.ads = fact(null, 'unknown', 'none', 'Uygulamada reklam var mı, belirt.');

  const billing = sdks.has('billing') || perms.has('com.android.vending.BILLING');
  if (billing) f.iap = fact(true, 'sdk', 'high', 'Uygulama içi satın alma kütüphanesi ya da izni var.');
  else if (repoScanned) f.iap = fact(false, 'sdk', 'medium', 'Repoda satın alma kütüphanesi bulunamadı.');
  else f.iap = fact(null, 'unknown', 'none', 'Uygulama içi satın alma var mı, belirt.');

  f.adId = fact(perms.has('com.google.android.gms.permission.AD_ID') || SDKS.some((s) => s.adId && sdks.has(s.id)) ? true : (repoScanned ? false : null),
    repoScanned ? 'manifest' : 'unknown', repoScanned ? 'medium' : 'none', 'Reklam kimliği (AD_ID) kullanımı.');
  f.account = sdks.has('auth')
    ? fact(true, 'sdk', 'high', 'Hesap/giriş kütüphanesi tespit edildi.')
    : extra.accountText ? fact(true, 'text', 'medium', 'Metinde giriş/hesap oluşturma geçiyor.')
    : fact(repoScanned ? false : null, repoScanned ? 'sdk' : 'unknown', repoScanned ? 'medium' : 'none', 'Kullanıcı hesabı oluşturuluyor mu?');
  f.multiplayer = has('multiplayer') ? fact(true, 'text', 'medium', 'Metinde çok oyunculu/online ifadesi var.') : fact(null, 'unknown', 'none', '');
  f.kids = has('kids') ? fact(true, 'text', 'medium', 'Metinde çocuk hedef kitlesi geçiyor.') : fact(null, 'unknown', 'none', '');
  for (const id of ['threeD', 'realistic', 'physics', 'open_world']) {
    f[id] = has(id) ? fact(true, 'text', 'medium', '') : fact(null, 'unknown', 'none', '');
  }
  // kullanıcı beyanı her şeyi ezer
  for (const [k, v] of Object.entries(i.facts || {})) {
    if (v === true || v === false) f[k] = fact(v, 'user', 'high', 'Kullanıcı beyanı');
  }
  return f;
}

/** Olguya göre iddia kavramı kullanılabilir mi? */
const CLAIM_FACT = { offline: 'offline', multiplayer: 'multiplayer', kids: 'kids', threeD: 'threeD', realistic: 'realistic', physics: 'physics', open_world: 'open_world' };

export function conceptSupported(conceptId, analysis) {
  const kind = CONCEPTS[conceptId] && CONCEPTS[conceptId].kind;
  const factKey = CLAIM_FACT[conceptId];
  if (factKey && analysis.facts && analysis.facts[factKey]) {
    const v = analysis.facts[factKey].value;
    if (v === false) return { ok: false, why: 'kullanıcı bu iddiayı reddetti' };
    if (v === true) return { ok: true, why: analysis.facts[factKey].source === 'user' ? 'kullanıcı beyanı' : 'üründe kanıt var' };
  }
  const c = analysis.concepts && analysis.concepts[conceptId];
  if (c && c.score > 0) return { ok: true, why: `kanıt: ${Object.keys(c.sources).map((s) => SOURCE_LABELS[s] || s).join(', ')}` };
  if (kind !== 'claim' && (GENRE_IMPLIES[analysis.genre.id] || []).includes(conceptId) && analysis.genre.confidence >= 0.45) {
    return { ok: true, why: 'türün kendisi' };
  }
  return { ok: false, why: kind === 'claim' ? 'iddia: ürün metninde karşılığı yok' : 'ürünle ilgisi görünmüyor' };
}

/** Özellikler: aynı dildeki gerçek metin satırları + kanıtı güçlü kavramlardan yerelleştirilmiş cümleler. Uydurma yok. */
export function deriveFeatures(sources, concepts, lang, genre, facts) {
  const out = [];
  const seen = new Set();
  const add = (text, source, from, concept) => {
    const key = normalizeFor(text, lang);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ text, source, from, concept: concept || null });
  };
  for (const src of sources) {
    if (!['description', 'mechanics', 'readme', 'storeFull', 'screens'].includes(src.source)) continue;
    if (src.lang && src.lang !== lang) continue;
    const lines = src.source === 'readme' || /^\s*[-*•]/m.test(src.text) ? extractFeatureLines(src.text) : sentencesOf(src.text).slice(1);
    for (const l of lines.slice(0, 8)) add(l, src.source, 'text');
  }
  const covered = new Set();
  for (const f of out) for (const [id] of scanText(f.text, { lang }).concepts) covered.add(id);
  const strong = Object.entries(concepts)
    .filter(([id, c]) => CONCEPTS[id] && CONCEPTS[id].feature && c.score >= 2 && !covered.has(id))
    .sort((a, b) => b[1].score - a[1].score);
  for (const [id] of strong) {
    const kind = CONCEPTS[id].kind;
    if (kind === 'claim') {
      const k = CLAIM_FACT[id];
      if (k && facts[k] && facts[k].value !== true) continue;
    }
    add(CONCEPTS[id].feature[lang], 'concept', 'concept', id);
  }
  // kullanıcı beyanıyla doğrulanan iddialar
  for (const [k, id] of [['offline', 'offline'], ['multiplayer', 'multiplayer']]) {
    if (facts[k] && facts[k].value === true && !covered.has(id) && CONCEPTS[id].feature) add(CONCEPTS[id].feature[lang], 'fact', 'concept', id);
  }
  return out.slice(0, 8);
}

/** Çekirdek kanca: mağaza kısa açıklaması > açıklamanın ilk cümlesi > tür şablonu. */
export function deriveHook(sources, lang, genre) {
  const store = sources.find((s) => s.source === 'storeShort' && (!s.lang || s.lang === lang));
  if (store) return { text: store.text, source: 'storeShort' };
  const desc = sources.find((s) => s.source === 'description' && (!s.lang || s.lang === lang));
  if (desc) {
    const first = sentencesOf(desc.text)[0];
    if (first && first.length >= 20 && first.length <= 140 && scanText(first, { lang }).concepts.size) return { text: first, source: 'description' };
  }
  const g = genreById(genre.id);
  return { text: g.hook[lang], source: 'genre' };
}

/* ---------------- tohumlar ---------------- */

/** Arama tohumları: tür sözlüğü + kanıtlı kavram birleşimleri + ürün metni öbekleri + fırsat kelimesi. */
export function deriveSeeds(analysis, project) {
  const lang = analysis.lang;
  const L = langOf(lang);
  const g = genreById(analysis.genre.id);
  const seeds = new Map();
  /*
   * role: 'candidate' — doğrudan aday (tür sözlüğü, fırsat kelimesi)
   *       'prefix'    — sadece otomatik tamamlamaya sorulacak ön ek; gerçek aday Play'in
   *                     döndürdüğü öneridir. Türetilmiş öbekler ("tır dağ") doğal olmayabilir,
   *                     talebi Play'in önerileri doğrular.
   */
  const add = (k, w, source, role = 'prefix') => {
    const n = normalizeFor(k, lang);
    if (!n || n.length < 3 || n.split(' ').length > 5) return;
    const e = seeds.get(n) || { k: n, weight: 0, sources: [], role };
    e.weight += w;
    if (role === 'candidate') e.role = 'candidate';
    if (!e.sources.includes(source)) e.sources.push(source);
    seeds.set(n, e);
  };
  const i = (project && project.inputs) || {};
  if (i.seedKeyword) add(i.seedKeyword, 5, 'keyword', 'candidate');
  for (const q of g.search[lang] || []) add(q, 3, 'genre', 'candidate');

  const subjectId = Object.entries(g.triggers).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    .find((id) => CONCEPTS[id] && CONCEPTS[id].seed && CONCEPTS[id].kind === 'subject');
  const subj = subjectId && CONCEPTS[subjectId].seed ? CONCEPTS[subjectId].seed[lang] : null;
  const head = (g.search[lang] || [])[0];
  for (const [id, c] of Object.entries(analysis.concepts)) {
    const con = CONCEPTS[id];
    if (!con || !con.seed || !con.seed[lang] || id === subjectId || c.score < 1) continue;
    if (!conceptSupported(id, analysis).ok) continue;
    const mod = con.seed[lang];
    const w = 1.5 + Math.min(1.5, c.score / 4);
    if (lang === 'en' && subj) {
      if (con.kind === 'claim') add(`${mod} ${subj} game`, w, 'concept');
      else { add(`${mod} ${subj}`, w, 'concept'); add(`${subj} ${mod}`, w * 0.8, 'concept'); }
    } else if (lang === 'tr' && head) {
      if (con.kind === 'claim') add(`${mod} ${head}`, w, 'concept');
      else if (subj) add(`${subj} ${mod}`, w * 0.8, 'concept');
    }
  }
  // ürün metninden aynı dildeki 2-3 kelimelik öbekler
  const grams = new Map();
  for (const src of collectSources(project)) {
    if (src.lang !== lang) continue; // dili belirsiz ya da farklı metinden öbek çıkarılmaz
    if (['keyword', 'files', 'name'].includes(src.source)) continue;
    const toks = normalizeFor(src.text, lang).split(' ').filter(Boolean);
    for (let n = 2; n <= 3; n++) {
      for (let k = 0; k + n <= toks.length; k++) {
        const g2 = toks.slice(k, k + n);
        if (g2.some((t) => DEV_WORDS.has(t) || /^\d+$/.test(t))) continue;
        if (L.edgeStopwords.has(g2[0]) || L.edgeStopwords.has(g2[n - 1]) || L.stopwords.has(g2[0])) continue;
        const cons = g2.map(conceptOfToken).filter(Boolean);
        if (!cons.length) continue;
        const key = g2.join(' ');
        const e = grams.get(key) || { n: 0, w: 0, source: src.source };
        e.n++; e.w += src.weight;
        grams.set(key, e);
      }
    }
  }
  for (const [k, e] of [...grams.entries()].sort((a, b) => b[1].w - a[1].w).slice(0, 8)) add(k, 1 + e.w / 2, e.source);
  // tanımlayıcı proje adı: yalnızca pazar dilinde bir kavram kelimesi içeriyorsa ("Cargo Truck Driver")
  if (project && project.name && nameHasLangConcept(project.name, lang)) add(project.name, 1.5, 'name');

  return [...seeds.values()]
    .filter((s) => !trademarkOf(s.k, lang))
    .sort((a, b) => b.weight - a.weight || a.k.localeCompare(b.k))
    .slice(0, 14)
    .map((s) => ({ ...s, weight: round1(s.weight) }));
}

/** Ad, pazar dilindeki bir kavram kelimesini aynen içeriyor mu? */
function nameHasLangConcept(name, lang) {
  const toks = new Set(normalizeFor(name, lang).split(' '));
  for (const c of Object.values(CONCEPTS)) {
    for (const w of c[lang] || []) if (!w.includes(' ') && toks.has(normalizeFor(w, lang))) return true;
  }
  return false;
}

/* ---------------- ürünle uyum ---------------- */

const INTENT = {
  app: { en: new Set(['app', 'apps', 'application', 'applications']), tr: new Set(['uygulama', 'uygulaması', 'uygulamalar', 'uygulamaları', 'uygulamasi']) },
  game: { en: new Set(['game', 'games']), tr: new Set(['oyun', 'oyunu', 'oyunlar', 'oyunları', 'oyunlari']) }
};

/** Ürünün çekirdeği: türün tetikleyicileri, türün ima ettikleri ve kanıtı güçlü konu/mekanik kavramları. */
export function anchorConcepts(analysis) {
  const g = genreById(analysis.genre.id);
  const set = new Set([...Object.keys(g.triggers || {}), ...(GENRE_IMPLIES[g.id] || [])]);
  for (const [id, c] of Object.entries(analysis.concepts || {})) {
    const k = CONCEPTS[id] && CONCEPTS[id].kind;
    if ((k === 'subject' || k === 'mechanic') && c.score >= 2) set.add(id);
  }
  return set;
}

export function trademarkOf(keyword, lang = 'en') {
  const k = ` ${normalizeFor(keyword, lang)} `;
  return TRADEMARKS.find((t) => k.includes(` ${normalizeFor(t, lang)} `)) || null;
}

/**
 * Bir arama kelimesinin ürüne uyumu. Kelimenin her öz parçası ürün metninde (ya da
 * türün kendisinde) karşılık bulmalı. Karşılıksız iddia (çevrimdışı vb.) ve marka adı
 * ayrıca işaretlenir.
 * @returns {{score:number, units:Array, trademark:string|null, unsupportedClaims:Array, reasons:string[]}}
 */
export function keywordRelevance(keyword, analysis) {
  const lang = analysis.lang;
  const L = langOf(lang);
  const { phrases } = index();
  let work = ` ${normalizeFor(keyword, lang)} `;
  const units = [];
  for (const p of phrases) {
    const needle = ` ${p.phrase} `;
    if (work.includes(needle)) { units.push({ token: p.phrase, concept: p.id }); work = work.replace(needle, ' '); }
  }
  for (const t of work.trim().split(' ').filter(Boolean)) {
    if (L.stopwords.has(t) || L.titleFiller.has(t) || L.stopwords.has(L.stem(t))) continue;
    units.push({ token: t, concept: conceptOfToken(t) });
  }
  const tokenSet = new Set(analysis.tokens || []);
  const reasons = [];
  for (const u of units) {
    if (u.concept) {
      const s = conceptSupported(u.concept, analysis);
      u.supported = s.ok;
      u.why = s.why;
      u.claim = CONCEPTS[u.concept].kind === 'claim';
    } else if (/^(19|20)\d\d$/.test(u.token)) {
      u.supported = false; u.why = 'yıl: ürünle ilgisi yok'; u.claim = false;
    } else {
      const ok = tokenSet.has(u.token) || tokenSet.has(stemEn(u.token)) || tokenSet.has(stemTr(u.token));
      u.supported = ok; u.why = ok ? 'ürün metninde geçiyor' : 'ürünle ilgisi görünmüyor'; u.claim = false;
    }
    if (!u.supported) reasons.push(`"${u.token}": ${u.why}`);
  }
  const trademark = trademarkOf(keyword, lang);
  if (trademark) reasons.unshift(`marka adı: "${trademark}" (Play meta veri politikası)`);
  const supported = units.filter((u) => u.supported).length;

  // arama niyeti: "... apps" uygulama, "... games" oyun arar
  const raw = normalizeFor(keyword, lang).split(' ');
  const intent = raw.some((t) => INTENT.app[lang].has(t)) ? 'app' : raw.some((t) => INTENT.game[lang].has(t)) ? 'game' : null;
  const isGame = !!(analysis.genre && analysis.genre.game);
  const intentMismatch = (intent === 'app' && isGame) || (intent === 'game' && !isGame);
  if (intentMismatch) reasons.push(intent === 'app' ? 'kelime uygulama arıyor, ürün bir oyun' : 'kelime oyun arıyor, ürün bir uygulama');
  // başka bir ürünün konusu ("car" — tır oyunu için)
  const offSubject = units.filter((u) => u.concept && !u.supported && CONCEPTS[u.concept].kind === 'subject').map((u) => u.token);
  // çekirdeğe bağlılık: yan özellik ("yağmur") tek başına kelimeyi ürüne bağlamaz
  const anchors = anchorConcepts(analysis);
  const allOk = units.length > 0 && supported === units.length;
  const anchored = units.some((u) => u.supported && u.concept && anchors.has(u.concept))
    || (allOk && !!intent && !intentMismatch && units.some((u) => u.concept && CONCEPTS[u.concept].kind === 'claim'));
  if (!anchored && units.length) reasons.push('ürünün çekirdeğine (tür, konu, ana mekanik) dayanmıyor');
  return {
    score: units.length ? Math.round((100 * supported) / units.length) / 100 : 0,
    units,
    trademark,
    unsupportedClaims: units.filter((u) => !u.supported && u.claim).map((u) => u.token),
    intent, intentMismatch, offSubject, anchored,
    reasons
  };
}
