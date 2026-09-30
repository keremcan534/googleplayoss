/*
 * ASO metinleri: başlık, kısa açıklama, uzun açıklama, sürüm notları, kategori ve etiket önerisi.
 *
 * Kurallar:
 *   - Karakter sınırları Play Console'unkiyle aynı (başlık 30, kısa 80, uzun 4000, sürüm notu 500).
 *   - Play meta veri politikası: başlıkta/kısa açıklamada performans, sıralama, fiyat ya da
 *     promosyon ifadesi ("best", "#1", "free", "new", "sale"), emoji, tekrar eden özel karakter,
 *     marka dışı TAMAMEN BÜYÜK HARF yok. Başka markaların adı hiçbir alanda yok.
 *   - Ürünün yapmadığı hiçbir şey yazılmaz: iddia kavramları (çevrimdışı, çok oyunculu...)
 *     yalnızca olgu destekliyorsa metne girer; aksi hâlde denetim hata verir.
 */
import { normalizeFor, stemTokens, langOf } from '../lang.js';
import { CONCEPTS, CATEGORY_LABELS, genreById } from './lexicon.js';
import { scanText, conceptSupported, trademarkOf } from './product.js';

export const LIMITS = { title: 30, short: 80, full: 4000, releaseNotes: 500 };

const BANNED = {
  en: [
    [/\bfree\b/i, '"free" (fiyat/promosyon)'], [/\bbest\b/i, '"best" (performans iddiası)'], [/#\s*1\b|\bno\.?\s*1\b|\bnumber one\b/i, '"#1" (sıralama iddiası)'],
    [/\btop\b/i, '"top" (sıralama iddiası)'], [/\bnew\b/i, '"new" (yanıltıcı olabilir)'], [/\bhot\b/i, '"hot"'], [/\bsale\b|\bdiscount\b|\b\d+%\s*off\b/i, 'indirim/promosyon'],
    [/\bgame of the year\b|\baward/i, 'ödül iddiası'], [/\bmillion(s)? (of )?(players|downloads)\b/i, 'indirme sayısı iddiası'], [/\bdownload now\b|\binstall now\b/i, 'eylem çağrısı ("download now")'],
    [/\bupdated?\b/i, '"updated"']
  ],
  tr: [
    [/\bücretsiz\b|\bbedava\b/i, '"ücretsiz/bedava" (fiyat/promosyon)'], [/\ben iyi\b/i, '"en iyi" (performans iddiası)'], [/#\s*1\b|\b1 numara\b|\bbir numara\b/i, '"1 numara" (sıralama iddiası)'],
    [/\byeni\b/i, '"yeni" (yanıltıcı olabilir)'], [/\bindirim\b|\bkampanya\b|\bfırsat\b/i, 'indirim/promosyon'], [/\bpopüler\b|\ben çok indirilen\b/i, 'popülerlik iddiası'],
    [/\bhemen indir\b|\bşimdi indir\b/i, 'eylem çağrısı ("hemen indir")'], [/\bödüllü\b/i, 'ödül iddiası'], [/\bmilyon(larca)? (oyuncu|indirme)\b/i, 'indirme sayısı iddiası'],
    [/\bgüncellendi\b/i, '"güncellendi"']
  ]
};
const EMOJI = /\p{Extended_Pictographic}/u;
const REPEAT_SPECIAL = /([!?*★☆.$€#_~-])\1{1,}/u;

/* ---------------- yardımcılar ---------------- */

export function charLen(s) { return [...String(s || '')].length; }

function upperFirst(s, lang) {
  const t = String(s || '');
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-US') + t.slice(1);
}
function lowerFirst(s, lang) {
  const t = String(s || '');
  if (!t || /^[A-ZÇĞİÖŞÜ]{2}/.test(t)) return t;
  return t.charAt(0).toLocaleLowerCase(lang === 'tr' ? 'tr-TR' : 'en-US') + t.slice(1);
}
const SMALL_EN = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'in', 'on', 'to', 'with', 'or', 'vs']);
export function titleCase(s, lang) {
  return String(s || '').split(' ').map((w, i) => (lang === 'en' && i > 0 && SMALL_EN.has(w) ? w : upperFirst(w, lang))).join(' ');
}
function article(word) { return /^[aeiou]/i.test(word) && !/^(uni|use|eu|one)/i.test(word) ? 'an' : 'a'; }
/** İngilizce: son kelimeyi tekile çevir ("truck games" → "truck game"). */
export function singularEn(phrase) {
  const w = phrase.split(' ');
  const last = w[w.length - 1];
  if (/ies$/.test(last) && last.length > 4) w[w.length - 1] = `${last.slice(0, -3)}y`;
  else if (/(ss|us|is)$/.test(last)) { /* değişmez */ } else if (/s$/.test(last) && last.length > 3) w[w.length - 1] = last.slice(0, -1);
  return w.join(' ');
}

/** Metinde anahtar kelime öbeği kaç kez geçiyor (köklenmiş, sıralı eşleşme). */
export function countPhrase(text, phrase, lang) {
  const t = stemTokens(text, lang);
  const p = stemTokens(phrase, lang);
  if (!p.length) return 0;
  let n = 0;
  for (let i = 0; i + p.length <= t.length; i++) {
    if (p.every((x, j) => t[i + j] === x)) { n++; i += p.length - 1; }
  }
  return n;
}
export function containsPhrase(text, phrase, lang) { return countPhrase(text, phrase, lang) > 0; }

/* ---------------- denetim ---------------- */

/**
 * @param {'title'|'short'|'full'|'releaseNotes'} field
 * @param {string} text
 * @param {{lang:string, analysis?:object, brand?:string, primary?:string}} ctx
 * @returns {Array<{level:'error'|'warn', msg:string}>}
 */
export function lintField(field, text, ctx = {}) {
  const lang = ctx.lang || (ctx.analysis && ctx.analysis.lang) || 'en';
  const out = [];
  const s = String(text || '');
  const len = charLen(s);
  if (!s.trim()) { out.push({ level: 'error', msg: 'Boş.' }); return out; }
  if (len > LIMITS[field]) out.push({ level: 'error', msg: `${len}/${LIMITS[field]} karakter — sınırı aşıyor.` });
  const strict = field === 'title' || field === 'short';
  if (strict) {
    for (const [re, label] of BANNED[lang] || BANNED.en) if (re.test(s)) out.push({ level: 'error', msg: `Play meta veri politikası: ${label} ${field === 'title' ? 'başlıkta' : 'kısa açıklamada'} kullanılamaz.` });
    // İngilizce ifadeler Türkçe metinde de yasak
    if (lang === 'tr') for (const [re, label] of BANNED.en.slice(0, 4)) if (re.test(s)) out.push({ level: 'error', msg: `Play meta veri politikası: ${label} kullanılamaz.` });
    if (EMOJI.test(s)) out.push({ level: 'error', msg: 'Emoji kullanılamaz.' });
    if (REPEAT_SPECIAL.test(s)) out.push({ level: 'error', msg: 'Tekrar eden özel karakter ("!!", "★★") kullanılamaz.' });
    const caps = s.split(/\s+/).filter((w) => w.length >= 3 && /\p{L}/u.test(w) && w === w.toLocaleUpperCase('tr-TR') && w !== w.toLocaleLowerCase('tr-TR'));
    const brandWords = new Set(String(ctx.brand || '').split(/\s+/));
    if (caps.some((w) => !brandWords.has(w))) out.push({ level: 'warn', msg: `Tamamen büyük harf (${caps.join(', ')}): marka adının parçası değilse kullanma.` });
  }
  if (field === 'title' && /[|•]/.test(s)) out.push({ level: 'warn', msg: 'Başlıkta ayraç yığını ("|", "•") anahtar kelime doldurma gibi görünür.' });
  const tm = trademarkOf(s, lang);
  const ownBrand = ctx.brand && trademarkOf(ctx.brand, lang) === tm;
  if (tm && !ownBrand) out.push({ level: 'error', msg: `Başka bir markanın adı ("${tm}"): Play meta veri politikası ihlali.` });

  // karşılıksız iddia
  if (ctx.analysis) {
    for (const [id] of scanText(s, { lang }).concepts) {
      if (!CONCEPTS[id] || CONCEPTS[id].kind !== 'claim') continue;
      const sup = conceptSupported(id, ctx.analysis);
      if (!sup.ok) out.push({ level: 'error', msg: `Doğrulanmamış iddia: "${CONCEPTS[id][lang][0]}" — ${sup.why}. Ürün bunu yapıyorsa Ürün sekmesinde onayla.` });
    }
  }
  // anahtar kelime doldurma
  if (ctx.primary && field === 'full') {
    const n = countPhrase(s, ctx.primary, lang);
    if (n > 5) out.push({ level: 'warn', msg: `Birincil kelime ${n} kez geçiyor: doldurma sayılabilir, 2-4 kez yeterli.` });
    if (n === 0) out.push({ level: 'warn', msg: 'Birincil kelime uzun açıklamada hiç geçmiyor.' });
  }
  if (field === 'full') {
    const freq = new Map();
    for (const t of stemTokens(s, lang)) if (t.length > 3 && !langOf(lang).stopwords.has(t)) freq.set(t, (freq.get(t) || 0) + 1);
    const words = stemTokens(s, lang).length;
    for (const [t, n] of freq) if (n >= 8 && n / words > 0.04) out.push({ level: 'warn', msg: `"${t}" ${n} kez tekrarlanıyor (%${Math.round((100 * n) / words)}).` });
  }
  return out;
}

export function fieldStatus(issues) {
  if (issues.some((i) => i.level === 'error')) return 'error';
  if (issues.length) return 'warn';
  return 'ok';
}

/* ---------------- başlık ---------------- */

/**
 * Başlık seçenekleri: marka + birincil kelime, marka + tür, yalnız marka.
 * @returns {Array<{text, len, covers:string[], issues}>} en iyi ilk sırada
 */
export function generateTitles(name, analysis, positioning) {
  const lang = analysis.lang;
  const brand = String(name || '').trim() || 'App';
  const primary = positioning && positioning.primary ? positioning.primary.k : null;
  const secondary = ((positioning && positioning.secondary) || []).map((c) => c.k);
  const g = genreById(analysis.genre.id);
  const opts = [];
  const push = (text, covers) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || opts.some((o) => o.text === t)) return;
    opts.push({ text: t, len: charLen(t), covers, issues: lintField('title', t, { lang, analysis, brand }) });
  };
  const phrases = [primary, ...secondary].filter(Boolean);
  const L = langOf(lang);
  for (const k of phrases) {
    if (containsPhrase(brand, k, lang)) { push(brand, [k]); continue; }
    // "truck simulator games" sığmazsa "Truck Simulator": oyun/uygulama gibi dolgu kelimeleri başlıkta gerekmez
    const core = k.split(' ').filter((t) => !L.stopwords.has(t) && !L.stopwords.has(L.stem(t))).join(' ');
    for (const variant of [...new Set([k, core])].filter(Boolean)) {
      for (const sep of [': ', ' - ']) {
        const t = `${brand}${sep}${titleCase(variant, lang)}`;
        if (charLen(t) <= LIMITS.title) push(t, [k]);
      }
    }
  }
  const label = titleCase(g.label[lang].split(' / ')[0], lang);
  if (charLen(`${brand}: ${label}`) <= LIMITS.title) push(`${brand}: ${label}`, []);
  push(brand, []);
  const score = (o) => (fieldStatus(o.issues) === 'error' ? -100 : 0) + (o.len <= LIMITS.title ? 0 : -50) + 10 * o.covers.length + (o.covers[0] === primary ? 5 : 0) - (o.text.includes(' - ') ? 1 : 0);
  return opts.sort((a, b) => score(b) - score(a));
}

/* ---------------- kısa açıklama ---------------- */

export function generateShorts(name, analysis, positioning) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const primary = positioning && positioning.primary ? positioning.primary.k : null;
  const secondary = ((positioning && positioning.secondary) || []).map((c) => c.k);
  const f = analysis.facts || {};
  const base = [];
  if (analysis.hook && analysis.hook.source === 'storeShort') base.push(analysis.hook.text);
  base.push(g.short[lang]);
  if (analysis.hook && analysis.hook.source === 'description') base.push(analysis.hook.text);
  const offlineTail = f.offline && f.offline.value === true ? (lang === 'tr' ? ' İnternetsiz oyna.' : ' Play offline.') : '';
  const cands = [];
  for (const b of base) {
    cands.push(b);
    if (offlineTail && g.game) cands.push(b.replace(/\s*$/, '') + offlineTail);
  }
  if (primary) {
    const P = upperFirst(primary, lang);
    const loop = g.loop[lang];
    cands.push(`${P}: ${lowerFirst(loop, lang)}`);
    if (offlineTail && g.game) cands.push(`${P}: ${lowerFirst(loop, lang)}${offlineTail}`);
    cands.push(`${P}. ${g.short[lang]}`);
  }
  const seen = new Set();
  const opts = [];
  for (const c of cands) {
    const t = c.replace(/\s+/g, ' ').trim();
    if (seen.has(t)) continue;
    seen.add(t);
    const covers = [primary, ...secondary].filter((k) => k && containsPhrase(t, k, lang));
    opts.push({ text: t, len: charLen(t), covers, issues: lintField('short', t, { lang, analysis, brand: name }) });
  }
  const score = (o) => (fieldStatus(o.issues) === 'error' ? -100 : 0) + (o.len <= LIMITS.short ? 0 : -60) + (primary && o.covers.includes(primary) ? 12 : 0) + 3 * o.covers.length + (o.text.includes(offlineTail.trim()) && offlineTail ? 2 : 0) + Math.min(o.len, 80) / 20;
  return opts.sort((a, b) => score(b) - score(a));
}

/* ---------------- uzun açıklama ---------------- */

const T = {
  en: { features: 'FEATURES', why: 'WHY PLAY', offline: 'Play offline, no internet connection needed', noAds: 'No ads', noIap: 'No in-app purchases',
    lookGame: (a, k, n, loop) => `Looking for ${a} ${k}? In ${n}, you ${loop}`, lookApp: (a, k, n) => `Looking for ${a} ${k}? ${n} keeps it simple.`,
    feedback: 'Questions or ideas? Reach us through the developer contact on this page.' },
  tr: { features: 'ÖZELLİKLER', why: 'NEDEN', offline: 'İnternetsiz oynanabilir', noAds: 'Reklam yok', noIap: 'Uygulama içi satın alma yok',
    lookGame: (_a, k, n, loop) => `${upperFirst(k, 'tr')} arıyorsan ${n} tam sana göre: ${loop}`, lookApp: (_a, k, n) => `${upperFirst(k, 'tr')} arıyorsan ${n} işini sade ve hızlı görür.`,
    feedback: 'Soru ya da önerin varsa bu sayfadaki geliştirici iletişim adresinden yaz.' }
};

/**
 * @returns {{text, len, claims:Array<{claim, basis, verified:boolean}>, keywordCounts:object, issues}}
 */
export function generateLong(name, analysis, positioning) {
  const lang = analysis.lang;
  const t = T[lang];
  const g = genreById(analysis.genre.id);
  const f = analysis.facts || {};
  const primary = positioning && positioning.primary ? positioning.primary.k : null;
  const secondary = ((positioning && positioning.secondary) || []).map((c) => c.k);
  const claims = [];
  const lines = [];
  lines.push(analysis.hook.text);
  lines.push('');
  if (primary) {
    const k = lang === 'en' ? singularEn(primary) : primary;
    lines.push(g.game ? t.lookGame(article(k), k, name, lowerFirst(g.loop[lang], lang)) : t.lookApp(article(k), k, name));
    lines.push('');
  }
  const bullets = analysis.features.map((x) => x.text);
  const hasCovered = (re) => bullets.some((b) => re.test(normalizeFor(b, lang)));
  if (f.offline && f.offline.value === true) {
    if (!hasCovered(/offline|internet|çevrimdışı|internetsiz/)) bullets.push(t.offline);
    claims.push({ claim: t.offline, basis: f.offline.note || f.offline.source, verified: f.offline.source === 'user' });
  }
  if (f.ads && f.ads.value === false) {
    bullets.push(t.noAds);
    claims.push({ claim: t.noAds, basis: f.ads.note || f.ads.source, verified: f.ads.source === 'user' });
  }
  if (f.iap && f.iap.value === false) {
    bullets.push(t.noIap);
    claims.push({ claim: t.noIap, basis: f.iap.note || f.iap.source, verified: f.iap.source === 'user' });
  }
  if (f.multiplayer && f.multiplayer.value === true) claims.push({ claim: 'multiplayer', basis: f.multiplayer.note, verified: f.multiplayer.source === 'user' });
  if (bullets.length) {
    lines.push(t.features);
    for (const b of bullets.slice(0, 10)) lines.push(`• ${b.replace(/[.]$/, '')}`);
    lines.push('');
  }
  lines.push(g.cta[lang]);
  lines.push('');
  lines.push(t.feedback);
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (charLen(text) > LIMITS.full) text = [...text].slice(0, LIMITS.full).join('');
  const keywordCounts = {};
  for (const k of [primary, ...secondary].filter(Boolean)) keywordCounts[k] = countPhrase(text, k, lang);
  return { text, len: charLen(text), claims, keywordCounts, issues: lintField('full', text, { lang, analysis, brand: name, primary }) };
}

/* ---------------- sürüm notları ---------------- */

export function generateReleaseNotes(name, analysis, project = {}) {
  const lang = analysis.lang;
  const i = project.inputs || {};
  const repo = i.repo || {};
  const version = repo.versionName ? ` ${repo.versionName}` : '';
  let text;
  if (i.changelog && String(i.changelog).trim()) {
    text = String(i.changelog).trim();
  } else {
    const head = lang === 'tr' ? `${name}${version} ilk sürüm:` : `${name}${version}, first release:`;
    const items = analysis.features.slice(0, 4).map((x) => `• ${x.text.replace(/[.]$/, '')}`);
    text = [head, ...items].join('\n');
  }
  if (charLen(text) > LIMITS.releaseNotes) text = [...text].slice(0, LIMITS.releaseNotes - 1).join('') + '…';
  return { text, len: charLen(text), issues: lintField('releaseNotes', text, { lang, analysis, brand: name }) };
}

/* ---------------- kategori ve etiketler ---------------- */

export function suggestCategory(analysis) {
  const g = genreById(analysis.genre.id);
  const lab = CATEGORY_LABELS[g.category] || { en: g.category, tr: g.category };
  return { id: g.category, label: lab[analysis.lang] || lab.en, game: g.game, basis: `Tür: ${g.label[analysis.lang]} (${analysis.genre.source === 'user' ? 'senin seçimin' : `güven %${Math.round(analysis.genre.confidence * 100)}`})` };
}

/** Etiket önerisi: Play Console etiketleri sabit bir listeden seçilir; bunlar yön gösterir. */
export function suggestTags(analysis) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const tags = [g.label[lang].split(' / ')[0]];
  const concepts = Object.entries(analysis.concepts || {})
    .filter(([id, c]) => CONCEPTS[id] && c.score >= 2 && CONCEPTS[id].kind !== 'claim' && CONCEPTS[id][lang])
    .sort((a, b) => b[1].score - a[1].score);
  for (const [id] of concepts) {
    const w = upperFirst(CONCEPTS[id][lang][0], lang);
    if (!tags.some((x) => normalizeFor(x, lang) === normalizeFor(w, lang))) tags.push(w);
    if (tags.length >= 5) break;
  }
  const f = analysis.facts || {};
  if (f.offline && f.offline.value === true && tags.length < 5) tags.push(lang === 'tr' ? 'Çevrimdışı' : 'Offline');
  return tags.slice(0, 5);
}
