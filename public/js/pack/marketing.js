/*
 * Görsel ve pazarlama planları: marka yönü, ikon/logo/tanıtım görseli brifleri,
 * ekran görüntüsü planı, tanıtım videosu ve kısa video (6/10/15 sn) konseptleri, sosyal metinler.
 *
 * Her plan yalnızca üründe kanıtı olan özellikleri kullanır (analysis.features ve
 * conceptSupported). Çekim talimatları "oyundan gerçek görüntü" ister; sahte oynanış yok.
 */
import { CONCEPTS, genreById } from './lexicon.js';
import { conceptSupported } from './product.js';
import { charLen } from './aso.js';

export const SPECS = {
  icon: { w: 512, h: 512, format: 'PNG (32-bit, alfa olabilir)', maxBytes: 1024 * 1024 },
  featureGraphic: { w: 1024, h: 500, format: 'JPEG ya da 24-bit PNG (alfa yok)', maxBytes: 15 * 1024 * 1024 },
  screenshot: { min: 320, max: 3840, ratio: 2, count: [2, 8], format: 'JPEG ya da 24-bit PNG (alfa yok)', maxBytes: 8 * 1024 * 1024 },
  promo: { note: 'YouTube bağlantısı; herkese açık ya da liste dışı, reklamsız (para kazanma kapalı), yaş kısıtlaması yok.' }
};

function supportedCaptionConcepts(analysis) {
  return Object.entries(analysis.concepts || {})
    .filter(([id]) => CONCEPTS[id] && CONCEPTS[id].caption && conceptSupported(id, analysis).ok)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([id]) => id);
}

/* ---------------- marka ---------------- */

export function brandDirection(project, analysis) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const i = project.inputs || {};
  const palette = (i.brand && i.brand.palette && i.brand.palette.length === 3) ? i.brand.palette : g.palette;
  return {
    name: project.name,
    palette, paletteSource: palette === g.palette ? 'tür' : 'senin seçimin',
    mood: g.mood[lang],
    icon: {
      concept: g.icon[lang],
      rules: lang === 'tr'
        ? ['512×512, tek ve net bir nesne; 48 px\'e küçüldüğünde okunmalı', 'Metin, sıralama rozeti ("#1", "YENİ", "ÜCRETSİZ") ve fiyat bilgisi yok', 'Kenarlara yakın ayrıntı koyma: Play ikonu yuvarlak/yuvarlatılmış kareyle maskeler', 'Oyundaki gerçek araç/karakterle tutarlı olsun']
        : ['512×512, one clear object; must read at 48 px', 'No text, ranking badges ("#1", "NEW", "FREE") or pricing', 'Keep detail away from the edges: Play masks icons to a rounded shape', 'Match the real vehicle/character in the game']
    },
    logo: {
      concept: lang === 'tr' ? `"${project.name}" yazısı, kalın ve yatay; ikonla aynı renkler` : `"${project.name}" wordmark, bold and horizontal, same colors as the icon`,
      use: lang === 'tr' ? 'Tanıtım görseli, video sonu kartı ve açılış ekranı için' : 'For the feature graphic, video end card and splash screen'
    }
  };
}

/* ---------------- tanıtım görseli ---------------- */

export function featureGraphicPlan(project, analysis, aso) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const tagline = (aso && aso.tagline) || g.caption[lang];
  return {
    size: `${SPECS.featureGraphic.w}×${SPECS.featureGraphic.h}`,
    headline: project.name,
    tagline,
    background: lang === 'tr' ? 'Oyundan en güçlü ekran görüntüsü (ekran görüntüleri yüklendiyse ilki kullanılır)' : 'Strongest in-game shot (first uploaded screenshot is used)',
    rules: lang === 'tr'
      ? ['Önemli öğeleri ortadaki güvenli alanda tut: Play bazı yüzeylerde kenarları kırpar', 'Başlık metni kısa olsun; ikonun ve oyun adının tekrarı gereksiz', 'Alfa (şeffaflık) yok']
      : ['Keep key elements in the central safe area: Play crops edges on some surfaces', 'Keep text short', 'No alpha channel']
  };
}

/* ---------------- ekran görüntüleri ---------------- */

/**
 * @returns {{orientation, size, slides:Array<{n, caption, capture, concept, basis}>, notes:string[]}}
 */
export function screenshotPlan(project, analysis) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const i = project.inputs || {};
  const orientation = i.orientation || (g.game && ['vehicle', 'action'].includes(g.family) ? 'landscape' : 'portrait');
  const size = orientation === 'landscape' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
  const slides = [];
  slides.push({ n: 1, caption: g.caption[lang], capture: lang === 'tr' ? 'Oyunun en çok şey anlatan anı: ana araç/karakter ve çekirdek eylem aynı karede' : 'The moment that says the most: main vehicle/character and the core action in one frame', concept: null, basis: 'Tür kancası' });
  for (const id of supportedCaptionConcepts(analysis)) {
    const c = CONCEPTS[id];
    if (slides.some((s) => s.concept === id)) continue;
    slides.push({ n: slides.length + 1, caption: c.caption[lang], capture: c.capture ? c.capture[lang] : '', concept: id, basis: conceptSupported(id, analysis).why });
    if (slides.length >= 6) break;
  }
  if (slides.length < 4) {
    for (const f of analysis.features) {
      if (slides.length >= 4) break;
      const cap = f.text.length <= 32 ? f.text : f.text.split(/[,:;–-]/)[0].trim();
      if (!cap || charLen(cap) > 36 || slides.some((s) => s.caption === cap)) continue;
      slides.push({ n: slides.length + 1, caption: cap, capture: lang === 'tr' ? `Bu özelliği gösteren gerçek oyun anı: "${f.text}"` : `A real in-game moment showing: "${f.text}"`, concept: f.concept, basis: 'Ürün metni' });
    }
  }
  const notes = lang === 'tr'
    ? ['Play en az 2, en fazla 8 ekran görüntüsü kabul eder; öne çıkarılma için en az 4 adet, en az 1080 px önerilir', 'Her görüntü gerçek oyun içinden olmalı; oyunda olmayan sahne ya da özellik gösterme', 'İlk 3 görüntü arama sonuçlarında görünür: en güçlü mesajlar başta', 'Başlıklar kısa ve okunaklı: telefonda küçük görünür']
    : ['Play accepts 2–8 screenshots; at least 4 at 1080 px or more are recommended for promotion', 'Every shot must come from the real game; never show scenes or features that are not in it', 'The first 3 appear in search results: lead with the strongest', 'Keep captions short and legible on a phone'];
  return { orientation, size, slides, notes };
}

/* ---------------- tanıtım videosu ---------------- */

export function promoVideoPlan(project, analysis) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const feats = analysis.features.slice(0, 3).map((f) => f.text);
  const tr = lang === 'tr';
  return {
    length: tr ? '30–60 sn (en fazla 2 dk önerilir)' : '30–60 s (keep under 2 min)',
    beats: [
      { t: '0–5 sn', what: tr ? `İlk saniyeden oynanış: ${g.hook.tr}` : `Gameplay from the first second: ${g.hook.en}` },
      ...feats.map((f, k) => ({ t: `${5 + k * 8}–${13 + k * 8} sn`, what: f })),
      { t: tr ? 'son 5 sn' : 'last 5 s', what: tr ? `Logo + "${g.cta.tr}"` : `Logo + "${g.cta.en}"` }
    ],
    rules: tr
      ? ['Oyun içi gerçek görüntü kullan; sinematik ara sahneyi oynanış gibi gösterme', 'YouTube\'da para kazanma kapalı, yaş kısıtlaması yok, herkese açık ya da liste dışı', 'Play videoyu sessiz başlatabilir: ilk karelerde metinle anlat']
      : ['Use real in-game footage; do not present cinematics as gameplay', 'On YouTube: monetization off, no age restriction, public or unlisted', 'Play may autoplay muted: tell the story with on-screen text']
  };
}

/* ---------------- kısa videolar ---------------- */

export function socialVideoPlans(project, analysis) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const tr = lang === 'tr';
  const caps = supportedCaptionConcepts(analysis).map((id) => CONCEPTS[id]);
  const shot = (c) => (c.capture ? c.capture[lang] : c.caption[lang]);
  const s1 = caps[0] || null;
  const s2 = caps[1] || null;
  const s3 = caps[2] || null;
  const plans = [
    { id: 'video6', seconds: 6, format: '9:16', name: tr ? '6 sn — tek kanca' : '6 s — single hook',
      shots: [
        { t: '0–4', visual: s1 ? shot(s1) : (tr ? 'Çekirdek eylem, yakın plan' : 'Core action, close-up'), text: g.challenge[lang] },
        { t: '4–6', visual: tr ? 'Logo + ikon' : 'Logo + icon', text: project.name }
      ] },
    { id: 'video10', seconds: 10, format: '9:16', name: tr ? '10 sn — kanca + 2 özellik' : '10 s — hook + 2 features',
      shots: [
        { t: '0–3', visual: s1 ? shot(s1) : (tr ? 'Çekirdek eylem' : 'Core action'), text: g.challenge[lang] },
        { t: '3–6', visual: s2 ? shot(s2) : (tr ? 'İkinci özellik' : 'Second feature'), text: s2 ? s2.caption[lang] : g.caption[lang] },
        { t: '6–8', visual: s3 ? shot(s3) : (tr ? 'Başarı anı' : 'Success moment'), text: s3 ? s3.caption[lang] : '' },
        { t: '8–10', visual: tr ? 'Logo + Google Play rozeti' : 'Logo + Google Play badge', text: g.cta[lang] }
      ] },
    { id: 'video15', seconds: 15, format: '9:16', name: tr ? '15 sn — meydan okuma' : '15 s — challenge',
      shots: [
        { t: '0–2', visual: tr ? 'Zor an: başarısız olmak üzere' : 'The hard moment: about to fail', text: g.challenge[lang] },
        { t: '2–10', visual: caps.slice(0, 3).map(shot).join(' → ') || (tr ? 'Oynanış' : 'Gameplay'), text: caps.slice(0, 3).map((c) => c.caption[lang]).join(' · ') },
        { t: '10–13', visual: tr ? 'Başarı anı / sonuç ekranı' : 'Success / results screen', text: g.caption[lang] },
        { t: '13–15', visual: tr ? 'Logo + Google Play rozeti' : 'Logo + Google Play badge', text: g.cta[lang] }
      ] }
  ];
  for (const p of plans) p.shots = p.shots.filter((s) => s.visual);
  return plans;
}

/** Shorts / Reels / TikTok metinleri. Etiketler yalnızca tür ve kanıtlı kavramlardan. */
export function socialCopy(project, analysis, positioning) {
  const lang = analysis.lang;
  const g = genreById(analysis.genre.id);
  const tr = lang === 'tr';
  const primary = positioning && positioning.primary ? positioning.primary.k : null;
  const tags = new Set();
  const tagOf = (s) => `#${String(s).toLocaleLowerCase(tr ? 'tr-TR' : 'en-US').replace(/[^\p{L}\p{N}]+/gu, '')}`;
  if (primary) tags.add(tagOf(primary));
  for (const id of supportedCaptionConcepts(analysis).slice(0, 3)) if (CONCEPTS[id][lang]) tags.add(tagOf(CONCEPTS[id][lang][0]));
  tags.add(g.game ? (tr ? '#mobiloyun' : '#mobilegame') : (tr ? '#uygulama' : '#app'));
  tags.add(tagOf(project.name));
  const hash = [...tags].filter((t) => t.length > 2).slice(0, 6).join(' ');
  const shortsTitle = `${g.challenge[lang]} | ${project.name}`.slice(0, 100);
  return {
    shorts: { title: shortsTitle, description: `${g.hook[lang]}\n${g.cta[lang]} Google Play: ${project.name}\n${hash}` },
    reels: { caption: `${g.challenge[lang]}\n${g.cta[lang]}\n${hash}` },
    tiktok: { caption: `${g.challenge[lang]} ${hash}`.slice(0, 150) },
    hashtags: [...tags]
  };
}
