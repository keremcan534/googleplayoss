// Rakip şikâyetleri: bir uygulamanın en yeni değerlendirmelerinde reklam / ödeme duvarı / içerik bitti
// şikâyetlerinin sıklığı. "Rakip boşluğu" sinyali (public/js/discovery.js) bunu kullanır.
// Saf fonksiyonlar; ağ çağrısı run.js'teki bütçeli tarama aşamasındadır.

/**
 * Şikâyet sınıfları. Yalnızca 1-3 yıldızlı değerlendirmeler sayılır: "harika, reklam yok!" gibi
 * övgüler reklam kelimesi geçtiği için şikâyet sayılmasın. Türkiye pazarında İngilizce yorumlar da
 * olduğundan iki dilin kalıpları birlikte uygulanır.
 */
export const COMPLAINTS = Object.freeze({
  ads: [
    /\b(ads?|adverts?|advertis\w*|commercials?|pop ?ups?)\b/,
    /reklam/
  ],
  pay: [
    /\b(pay ?walls?|subscri\w*|premium|vip|pay(ing)? to (play|unlock|win|continue|use)|paid|in ?app purchases?|purchases?|money grab|cash grab|greedy|expensive|charg(e|ed|es|ing)|free trial)\b/,
    /(abonelik|abone ol|ücretli|paralı|pahalı|premium|vip|satın al|para (istiyor|ödemeden|ödemek|ödeyerek|verip|vermeden))/
  ],
  content: [
    /\b(no (new|more) (levels?|pictures?|images?|puzzles?|content|stages?)|(ran|run|running) out of|not enough (levels?|pictures?|images?|puzzles?|content)|same (levels?|pictures?|puzzles?)|repetitive|boring|(finished|beat|completed) all|need more (levels?|pictures?|puzzles?))\b/,
    /(yeni (bölüm|seviye|level|resim|içerik) (yok|gelmiyor|eklenmiyor)|(bölüm|seviye|level)(ler|lar)? bitti|hep aynı|sıkıcı|tekrar ediyor|içerik az|daha fazla (bölüm|seviye|resim))/
  ]
});
export const COMPLAINT_KINDS = Object.freeze(Object.keys(COMPLAINTS));

const norm = (s) => String(s || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

/** Tek bir değerlendirmenin şikâyet sınıfları (1-3 yıldız değilse boş). */
export function complaintKinds(review) {
  if (!review || !(review.score <= 3)) return [];
  const t = norm(review.text);
  if (!t) return [];
  return COMPLAINT_KINDS.filter((k) => COMPLAINTS[k].some((re) => re.test(t)));
}

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Değerlendirme örnekleminin özeti: her sınıfın şikâyet oranı (şikâyet eden yorum / örneklem).
 * @returns {{n:number, neg:number, any:number, ads:number, pay:number, content:number}|null}
 */
export function summarizeReviews(reviews) {
  const list = (reviews || []).filter((x) => x && Number.isFinite(x.score));
  if (!list.length) return null;
  const hit = { ads: 0, pay: 0, content: 0 };
  let neg = 0, any = 0;
  for (const rv of list) {
    if (rv.score <= 3) neg++;
    const kinds = complaintKinds(rv);
    if (kinds.length) any++;
    for (const k of kinds) hit[k]++;
  }
  const n = list.length;
  return { n, neg: r2(neg / n), any: r2(any / n), ads: r2(hit.ads / n), pay: r2(hit.pay / n), content: r2(hit.content / n) };
}

/**
 * Hangi uygulamaların değerlendirmeleri çekilsin? Kelimelerin ilk 3'ünde en sık görünen uygulamalar önce:
 * tek bir çağrı, o uygulamanın lider olduğu bütün kelimelerin şikâyet ölçüsünü doldurur.
 * @param {Array} records kelime kayıtları
 * @param {object} cache {appId: {t}} önbellek
 * @param {{now:number, ttlMs:number, limit:number, apps?:object}} o
 */
export function pickReviewTargets(records, cache, { now = Date.now(), ttlMs, limit = 60, apps = {} } = {}) {
  const freq = new Map();
  for (const r of records || []) {
    if (!(r && (r.st === 'ok' || r.st === 'partial')) || !Array.isArray(r.top)) continue;
    for (const id of r.top.slice(0, 3)) freq.set(id, (freq.get(id) || 0) + 1);
  }
  return [...freq.entries()]
    .filter(([id]) => { const c = cache && cache[id]; return !(c && now - c.t < ttlMs) && !(apps[id] && apps[id].missing); })
    .sort((a, b) => b[1] - a[1] || ((apps[b[0]] && apps[b[0]].real) || 0) - ((apps[a[0]] && apps[a[0]].real) || 0) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}
