/*
 * Yanlış pozitif kapıları — doğrulanmış kurallar.
 *
 * Her kural, Ekim 2026 doğrulamasında elle denetlenmiş örneklerle ölçüldü (kesinlik notları
 * kuralın yanında). Eylemler:
 *   exclude → karar SKIP, simülasyon yok (yapay kelime)
 *   cap     → karar en fazla belirtilen sınıf (marka/navigasyonel arama, politika riski…)
 *   flag    → yalnızca uyarı rozeti
 *
 * Bağlam (ctx) bir veri setinden bir kez kurulur: buildFlagContext(data). Bağlam olmadan
 * (ör. canlı tek kelime analizi) yalnızca kelimenin kendisine bakan kurallar çalışır.
 */
import { normalizeFor, tokensFor, langOf } from './lang.js';

const DAY = 86400000;

/* ---------------- sözlükler ---------------- */

const TR_BRAND = {
  'kamu': ['edevlet', 'e devlet', 'mhrs', 'enabız', 'e nabız', 'eokul', 'e okul', 'eba', 'uyap', 'gib', 'sgk', 'ptt', 'iett', 'eshot', 'ego', 'belediye', 'belediyesi', 'büyükşehir', 'diyanet', 'ösym', 'meb', 'tkgm', 'hes kodu', 'istanbulkart', 'kentkart', 'hgs', 'ogs', 'e imza'],
  'banka': ['ziraat', 'garanti', 'akbank', 'yapı kredi', 'vakıfbank', 'halkbank', 'iş bankası', 'işbank', 'qnb', 'finansbank', 'denizbank', 'enpara', 'papara', 'ininal', 'teb', 'ing bank', 'odeabank', 'kuveyt türk', 'albaraka', 'şekerbank', 'fibabanka'],
  'operatör': ['turkcell', 'vodafone', 'türk telekom', 'telekom', 'bip', 'superonline', 'türknet'],
  'perakende': ['trendyol', 'hepsiburada', 'n11', 'getir', 'yemeksepeti', 'sahibinden', 'letgo', 'dolap', 'migros', 'a101', 'bim', 'çiçeksepeti', 'amazon', 'temu', 'shein', 'aliexpress'],
  'medya': ['trt', 'atv', 'kanal d', 'show tv', 'star tv', 'tv8', 'now tv', 'exxen', 'blutv', 'tabii', 'puhutv', 'bein', 'digiturk', 'tivibu', 'netflix', 'youtube', 'spotify', 'mynet'],
  'kulüp': ['galatasaray', 'fenerbahçe', 'beşiktaş', 'trabzonspor'],
  'marka': ['lego', 'minecraft', 'roblox', 'pubg', 'free fire', 'brawl stars', 'fortnite', 'gta', 'among us', 'subway surfers', 'toca boca', 'pokemon', 'barbie', 'hello kitty', 'paw patrol', 'spiderman', 'örümcek adam', 'marvel', 'disney', 'sonic', 'mario', 'ninjago', 'batman', 'hot wheels', 'transformers', 'peppa', 'cocomelon', 'sakura school', 'bmw', 'mercedes', 'audi', 'iveco', 'scania', 'volvo', 'renault', 'fiat', 'toyota', 'ford', 'tesla', 'john deere', 'jondere', 'new holland', 'massey', 'fendt', 'ferrari', 'lamborghini', 'porsche', 'apple', 'iphone', 'samsung', 'xiaomi', 'huawei', 'instagram', 'whatsapp', 'tiktok', 'telegram', 'facebook', 'snapchat', 'tofaş']
};
const TR_BRAND_EXCEPT = ['namaz vakitleri diyanet', 'xiaomi tema'];
/** Türkçe kelimelerde geliştirici adı kuralına girmeyecek genel kelimeler. */
const TR_GENERIC = new Set(['oyun', 'oyunu', 'oyunları', 'games', 'game', 'apps', 'app', 'studio', 'software', 'yazılım', 'mobile', 'mobil', 'labs', 'tech', 'teknoloji', 've', 'the', 'ltd', 'şti', 'inc', 'llc', 'limited', 'san', 'tic', 'bilişim', 'media', 'medya', 'hesaplama', 'takip', 'takibi', 'sorgulama', 'tarifleri', 'kitabı', 'dili', 'oyunlar', 'sınav', 'soruları', 'türk', 'türkiye', 'islami', 'dini', 'dua', 'namaz', 'vakti', 'vakitleri', 'ezan', 'yemek', 'tatlı', 'kelime', 'bulmaca', 'zeka', 'hayvan', 'araba', 'traktör', 'kamyon', 'tır', 'otobüs', 'park', 'etme', 'boyama', 'kaçış', 'savaş', 'dövüş', 'drift', 'futbol', 'sesli', 'zikir', 'tesbih', 'faiz', 'kredi', 'yaş', 'kilo', 'boy', 'tarih', 'metro', 'haritası', 'saatleri', 'rüya', 'tabiri', 'burç', 'yorumu', 'diyet', 'gif', 'yapma', 'işaret', 'sözlüğü', 'su', 'yakıt', 'oto', 'araç', 'plaka', 'okey', 'emoji', 'klavye', 'ilaç', 'hatırlatıcı', 'isim', 'rehber', 'şifre', 'wifi', 'ses', 'ölçer', 'kıble', 'bulucu', 'tansiyon', 'bebek', 'çocuk', 'altın', 'fiyatları', 'maaş', 'vergi', 'günlüğü', 'hikaye', 'sayacı', 'ehliyet']);

const TR_SEASONAL = ['ramazan', 'imsakiye', 'sahur', 'iftar', 'oruç', 'bayram', 'bayramı', 'kurban', 'kandil', 'kandili', 'mevlid', 'regaip', 'miraç', 'berat', 'kadir gecesi', 'arefe', 'hac', 'umre', 'teravih',
  'yılbaşı', 'noel', 'sevgililer', 'anneler günü', 'babalar günü', 'öğretmenler günü', 'karne', 'cumhuriyet bayramı', 'cadılar', 'halloween',
  'lgs', 'yks', 'kpss', 'ales', 'dgs', 'tyt', 'ayt', 'msü', 'ösym', 'yds', 'yökdil', 'tus', 'dus'];
const EN_SEASONAL = /\b(halloween|christmas|xmas|santa|easter|valentines?|thanksgiving|black friday|new year|ramadan|eid|diwali|holi|st patricks?|world cup|super bowl|olympics?|election|hanukkah|advent)\b/;

const REG_EN = [
  [/\breal money\b|\breal cash\b|\bwin cash\b|\bcash prize|\bearn money\b|\bmake money\b|\bwin money\b/, 'para kazandırma vaadi'],
  [/\bcasino\b|\bslots?\b|\bbetting\b|\bbet\b|\bgambl(?!.*\broguelike\b)|\bsweepstake|\blottery\b|\bjackpot\b|\bsportsbook\b/, 'kumar'],
  [/\bloans?\b(?!.*\b(calculator|calc|emi|amortization)\b)|\bpayday\b|\bcash advance\b|\binstant cash\b/, 'kredi/borç'],
  [/\bvpn\b|\bproxy\b/, 'VPN'],
  [/\bspy\b|\bstalk|\bread (?:someone|messages)|\bhack(?:s|er|ing)?\b|\bcheats?\b|\bmod apk\b|\bfree diamonds?\b|\brobux\b|\bv bucks\b|\bvbucks\b/, 'casus/hile'],
  [/\bcbd\b|\bmarijuana\b|\bweed\b|\bvape\b|\bhookup\b|\bnsfw\b|\bsexy?\b/, 'yetişkin/madde']
];
const REG_EN_CAUTION = /\bcrypto|\bbitcoin\b|\bforex\b|\btrading signal|\bnft\b/;
/**
 * Unicode'a duyarlı kelime sınırı. JS'deki \b, ı ş ğ ü ö ç harflerini kelime karakteri saymaz:
 * /\bkırıcı\b/ hiçbir zaman eşleşmez ("wifi şifre kırıcı" politika kuralından kaçıyordu).
 */
const WB = (body) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'u');
const REG_TR = [
  [WB('bahis|iddaa|kumar|casino|kazino|slot|rulet|poker|jackpot'), 'kumar/bahis'],
  [WB('acil kredi|nakit kredi|borç para|hızlı kredi|kredi notu yükseltme'), 'kredi/borç'],
  [WB('hack|hile|hilesi|kırıcı|şifre kırma|takipçi|beğeni hilesi|casus|gizli dinleme|kim baktı|mod apk|bedava elmas|elmas hilesi|arama kaydı'), 'casus/hile'],
  [/(?:tansiyon|şeker|ateş|kan şekeri) ölçer(?![\p{L}\p{N}])|parmakla.*ölç|ölçer.*parmak/u, 'tıbbi ölçüm iddiası']
];
const REG_TR_CAUTION = WB('kripto|bitcoin|forex|borsa|hisse');

/* Geri testte (Ekim 2026) eklenen anahtar-kelime kuralları — hepsi en fazla WATCH. */
const REAL_MONEY_EN = WB('cash ?out|gcash|paypal|real money|real cash|win (?:real )?(?:cash|money|prizes?)|earn (?:cash|money|rewards?|gift ?cards?)|make money|get paid|money games?|cash (?:games?|apps?|rewards?|prizes?)|(?:solitaire|bingo|bubble|word|puzzle|pool|blackout|dominoes|games?) cash|games? (?:that|to) (?:pay|earn)');
const CASH_TOKEN = WB('cash');
const MONEY_TOKEN = WB('money');
const MONEY_THEME = WB("idle|tycoon|clicker|simulator|cost money|dont cost|don't cost|free");
const GAME_TOKEN = WB('games?|solitaire|bingo|slots?|puzzles?|trivia|quiz|pool|fishing|match 3|merge|word|lounge|win|earn|prizes?|rewards?|play');
const FINANCE_UTILITY = WB('money manager|money tracker|money counter|cash register|cash flow|cash book|cashbook|cash counter|cash calculator|petty cash|money management');
const REAL_MONEY_TR = WB('para kazan\\p{L}*|gerçek para\\p{L}*|nakit ödül\\p{L}*|ödüllü oyun\\p{L}*|para veren|para ödeyen|kazandıran oyun\\p{L}*');
const AZ_GEO = /ə/u;
const AZ_WORD = WB('azerbaycan\\p{L}*|azərbaycan\\p{L}*|azeri\\p{L}*|\\p{L}{3,}(?:maq|mək)');
// polis/jandarma bilerek yok: "polis oyunları" bir oyun türü, navigasyon değil
const TR_AGENCY = WB('afad|kızılay|tcdd|nvi|nüfus müdürlüğü|yök|turkiye\\.gov');
// ekli marka adı ("minecraftta", "roblox'ta"): sözlük yalnızca tam kelimeyi tanır
const TR_IP_SUFFIX = WB("(?:minecraft|roblox|pubg|fortnite|pokemon|brawl stars|free fire|among us|toca boca|sakura school|subway surfers|gta|granny)'?\\p{L}+");

const WRONG_GEO = new Set(['india', 'indian', 'hindi', 'marathi', 'tamil', 'telugu', 'kannada', 'malayalam', 'gujarati', 'punjabi', 'bengali', 'bangla', 'urdu', 'odia', 'oriya', 'assamese', 'nepali', 'nepal', 'sinhala', 'pakistan', 'pakistani', 'bangladesh', 'flipkart', 'paytm', 'upi', 'irctc', 'aadhaar', 'aadhar', 'jio', 'meesho', 'myntra', 'swiggy', 'zomato', 'kerala', 'mumbai', 'delhi', 'tagalog', 'filipino', 'pinoy', 'indonesia', 'indonesian', 'malaysia', 'nigeria', 'naija', 'kenya', 'ghana', 'lanka', 'bhojpuri', 'rajasthani', 'haryanvi', 'islamabad', 'karachi', 'lahore', 'dhaka', 'kolkata', 'chennai', 'hyderabad', 'bangalore']);
const LIKE_X = /\b(like|similar to|alternative to|alternatives)\b/;
const IP_3P = /\b(nfl|nba|nhl|mlb|fifa|wwe|ufc|pubg|free fire|roblox|minecraft|fortnite|pokemon|disney|marvel|gta|harry potter|star wars|lego|barbie|sonic|mario|naruto|genshin|among us|toca boca|paw patrol|final fantasy|yu gi oh|call of duty|clash of clans|brawl stars|bgmi|valorant)\b/;
const TR_DOTLESS_NATIVE = /^(ışık|ışıl|ılık|ırmak|ısı|ıslak|ızgara|ıhlamur|ıspanak|ıssız|ırk|ısır)/;

/* ---------------- bağlam ---------------- */

/**
 * @param {{market?:{lang:string}, keywords:Array, apps:object}} data
 * @param {{now?:number, lang?:string}} opts
 */
export function buildFlagContext(data, opts = {}) {
  const lang = opts.lang || (data && data.market && data.market.lang) || 'en';
  const apps = (data && data.apps) || {};
  const titleDF = new Map();
  for (const a of Object.values(apps)) {
    for (const t of new Set(tokensFor(a.title, lang))) titleDF.set(t, (titleDF.get(t) || 0) + 1);
  }
  // Türkçe pazarda "noktasız İngilizce" kelimeler: tarayıcı ABD pazarının başlık sözlüğünden
  // önceden hesaplar (src/hints.js) ve veri setine koyar. Türkçe ASCII başlıklar ("Oyunlari")
  // burada kullanılamaz: "oyunları"yı İngilizce sanırdı.
  const dotlessEn = new Set(((data && data.flagHints) || {}).dotlessEn || []);
  const kwDF = new Map();
  const byK = new Map();
  for (const r of (data && data.keywords) || []) {
    byK.set(r.k, r);
    for (const t of new Set(String(r.k).split(' '))) kwDF.set(t, (kwDF.get(t) || 0) + 1);
  }
  // _tok: başlık/geliştirici token önbelleği; bağlam kopyalansa da ({...ctx}) aynı Map paylaşılır
  return { lang, apps, titleDF, kwDF, byK, dotlessEn, now: opts.now ?? Date.now(), currentYear: new Date(opts.now ?? Date.now()).getUTCFullYear(), verdictOf: null, _tok: new Map() };
}

/* ---------------- yardımcılar ---------------- */

const has = (k, phrase) => ` ${k} `.includes(` ${phrase} `);
function topApps(r, ctx) {
  if (!ctx || !Array.isArray(r.top)) return [];
  return r.top.slice(0, 10).map((id) => ctx.apps[id]).filter(Boolean);
}
function ageDays(a, now) {
  const t = a && a.released ? Date.parse(a.released) : NaN;
  return Number.isFinite(t) ? (now - t) / DAY : null;
}
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

/** Eski (son 2 yılda çıkmamış) uygulamaların 3.-10. sıradaki medyanı: yeni girenlerin kendi yüklemesi sonucu etkilemez. */
export function incumbentMidpack(r, ctx, days = 730) {
  const apps = topApps(r, ctx);
  const inc = apps.slice(2).filter((a) => { const g = ageDays(a, ctx.now); return g === null || g > days; });
  return inc.length >= 3 ? median(inc.map((a) => a.real || 0)) : null;
}

/* ---------------- kurallar ---------------- */

/**
 * @returns {Array<{id:string, level:'exclude'|'cap'|'flag', cap?:string, label:string, reason:string}>}
 */
export function detectFlags(r, ctx) {
  if (!r || !r.k) return [];
  const lang = (ctx && ctx.lang) || 'en';
  const L = langOf(lang);
  const k = normalizeFor(r.k, lang);
  const toks = k.split(' ').filter(Boolean);
  const out = [];
  const add = (id, level, label, reason, cap) => out.push({ id, level, label, reason, ...(cap ? { cap } : {}) });
  const now = (ctx && ctx.now) ?? Date.now();
  const year = ctx ? ctx.currentYear : new Date(now).getUTCFullYear();
  const isTr = lang === 'tr';

  /* --- yapay / bozuk kelimeler (kesinlik 15/15–19/19) --- */
  if (isTr && toks.some((t) => /^ğ/.test(t) || (/^ı/.test(t) && !TR_DOTLESS_NATIVE.test(t)))) {
    add('dotless', 'exclude', 'Yapay kelime', 'Otomatik tamamlamada "ı/ğ" ile açılan yapay ad alanından geldi (ör. "ıveco", "ğerçekçi"); gerçek arama değil.');
  }
  const years = toks.filter((t) => /^(19|20)\d\d$/.test(t)).map(Number);
  if (years.some((y) => y >= 2015 && y < year)) add('pastYear', 'exclude', 'Eski yıl', `Geçmiş bir yıl içeriyor (${years.join(', ')}): bu arama artık güncel değil.`);
  else if (years.some((y) => y >= year)) add('yearStamped', 'cap', 'Yıla bağlı', `Yıl içeriyor (${years.join(', ')}): talep o yılla birlikte biter.`, 'BUILD');
  if (isTr) {
    const dup = toks.length !== new Set(toks).size;
    const lead = toks[0] || '';
    // tek harfle başlayan öbek ('l park etme'); iki harfli Türkçe kelimeler (su, ev, ön, üç, qr) gerçek
    const shortLead = lead.length === 1 && !/^\d+$/.test(lead);
    if (dup || toks.length >= 6 || shortLead || has(k, 'en iyisi')) add('junk', 'exclude', 'Doğal olmayan kelime', 'Başlık parçalarından türemiş, insanların yazmadığı bir öbek (tekrarlı kelime, çok uzun ya da anlamsız başlangıç).');
  } else {
    // "board game keyboard game keyboard game": anlamlı bir kelime tekrar ediyor (game/app gibi genel kelimeler hariç)
    // bitişik tekrar ("tap tap", "bon bon") bir addır, iki aramanın birleşimi değildir
    const content = toks.filter((t, i) => t.length >= 3 && !L.stopwords.has(t) && !L.stopwords.has(L.stem(t)) && toks[i - 1] !== t);
    if (content.length !== new Set(content).size) add('junk', 'exclude', 'Doğal olmayan kelime', 'Aynı kelime iki kez geçiyor: iki aramanın birleşimi, insanların yazdığı bir sorgu değil.');
  }

  const season = isTr ? TR_SEASONAL.find((p) => has(k, p)) : (k.match(EN_SEASONAL) || [])[0];
  if (season) add('seasonal', 'cap', 'Mevsimlik', `Takvime bağlı arama ("${season}"): talep yılın kısa bir döneminde toplanır.`, 'BUILD');

  /* --- politika ve marka riski --- */
  const reg = (isTr ? REG_TR : REG_EN).find(([re]) => re.test(k));
  if (reg) add('regulated', 'cap', 'Politika riski', `Play politikasında kısıtlı alan (${reg[1]}): yayın reddi ya da kaldırılma riski yüksek.`, 'WATCH');
  else if ((isTr ? REG_TR_CAUTION : REG_EN_CAUTION).test(k)) add('finance', 'flag', 'Finans politikası', 'Kripto/borsa uygulamaları Play\'in finansal hizmetler beyanına tabidir.');
  const kl = String(r.k || '').toLocaleLowerCase(isTr ? 'tr' : 'en');
  if (isTr) {
    if (REAL_MONEY_TR.test(kl)) add('realMoney', 'cap', 'Para kazandırma', 'Para kazandırma vaadi: Play politikasında kısıtlı ve büyük yayıncıların alanı.', 'WATCH');
    if (AZ_GEO.test(kl) || AZ_WORD.test(kl)) add('wrongGeoAz', 'cap', 'Yanlış mağaza', 'Azerbaycan Türkçesi: Türkiye mağazasında ölçülen değerler o pazarı yansıtmaz.', 'WATCH');
    if (TR_AGENCY.test(kl)) add('agencyNav', 'cap', 'Kurum adı', 'Bir kamu kurumunun adı: arayan resmî uygulamayı istiyor.', 'WATCH');
  } else if (!reg && (REAL_MONEY_EN.test(kl) || (GAME_TOKEN.test(kl) && !FINANCE_UTILITY.test(kl) && (CASH_TOKEN.test(kl) || (MONEY_TOKEN.test(kl) && !MONEY_THEME.test(kl)))))) {
    add('realMoney', 'cap', 'Para kazandırma', 'Gerçek para / ödül vaadi: Play politikasında kısıtlı ve büyük yayıncıların alanı.', 'WATCH');
  }
  // ekli marka adı: sözlük ya da yayıncı adı kuralı zaten yakaladıysa tekrar eklenmez (sona bakılır)
  const ipSuffix = () => {
    if (isTr && !out.some((f) => f.id === 'brandTr') && TR_IP_SUFFIX.test(kl)) add('ipSuffix', 'cap', 'Ticari marka', 'Başka bir oyunun / markanın adı (ekli hâliyle): sonuçlar o markaya ait, adı meta veride kullanılamaz.', 'WATCH');
    return out;
  };
  if (!isTr) {
    if (LIKE_X.test(k)) add('likeX', 'cap', 'Başka oyuna atıf', '"… like X" araması belirli bir oyunu arıyor; sonuçlar o markaya ait.', 'WATCH');
    else if (IP_3P.test(k)) add('ip', 'cap', 'Ticari marka', 'Başka bir markanın/serinin adını içeriyor: meta veride kullanılamaz, sonuçlar o markaya ait.', 'WATCH');
    const geo = toks.filter((t) => WRONG_GEO.has(t));
    if (geo.length) add('wrongGeo', 'cap', 'Yanlış mağaza', `Başka bir ülkeyi hedefliyor (${geo.join(', ')}): ABD mağazasında ölçülen değerler o pazarı yansıtmaz.`, 'WATCH');
  } else {
    const hit = Object.entries(TR_BRAND).flatMap(([cat, list]) => list.filter((p) => has(k, p)).map((p) => `${p} (${cat})`));
    if (hit.length && !TR_BRAND_EXCEPT.some((e) => k.includes(e))) add('brandTr', 'cap', 'Marka/kurum adı', `Marka ya da kurum adı içeriyor: ${hit.slice(0, 3).join(', ')}. Arayan o uygulamayı istiyor; adı meta veride kullanmak da yasak.`, 'WATCH');
  }
  if (isTr && ctx) {
    const dotEn = ctx.dotlessEn ? toks.filter((t) => ctx.dotlessEn.has(t)) : [];
    if (dotEn.length) add('dotlessEn', 'flag', 'Yazım ikizi', `"${dotEn[0]}" aslında İngilizce "${dotEn[0].replace(/ı/g, 'i')}": noktalı yazımıyla aynı kelime, ölçümler bölünmüş olabilir.`);
  }

  if (!ctx || !Array.isArray(r.top) || !r.top.length) return ipSuffix();
  const apps = topApps(r, ctx);
  if (!apps.length) return ipSuffix();

  /* --- navigasyonel / tek yayıncı (kesinlik 75–100%) --- */
  const devCount = new Map();
  for (const a of apps) devCount.set(a.dev, (devCount.get(a.dev) || 0) + 1);
  const [topDev, topDevN] = [...devCount.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  if (topDevN >= 5) {
    add('singleDev', isTr ? 'flag' : 'cap', 'Tek yayıncı', `İlk 10'un ${topDevN} tanesi tek yayıncının ("${topDev}"): sonuçlar onun kataloğu, yeni uygulamaya yer yok.`, isTr ? undefined : 'WEAK');
  }
  const first = toks[0] || '';
  // tek kelime (canlı) analizde veri seti sözlüğü yok: sıklığa dayalı kurallar çalışmaz
  const full = !!ctx.titleDF;
  const df = (t) => (full ? ctx.titleDF.get(t) || 0 : Infinity);
  const kwDf = (t) => (ctx.kwDF ? ctx.kwDF.get(t) || 0 : Infinity);
  if (r.src !== 'seed' && r.pop && r.pop.minPrefix && first.length >= 4 && !/^\d+$/.test(first) && r.pop.minPrefix <= first.length && df(first) <= 3) {
    add('rarePrefix', isTr ? 'flag' : 'cap', 'Marka adı (talep şişkin)', `"${first}" neredeyse hiçbir uygulama başlığında geçmiyor ama birkaç harfte öneriliyor: tek bir ürünün adı, talep o ürüne ait.`, isTr ? undefined : 'WEAK');
  }
  if (!isTr) {
    const cache = ctx._tok || (ctx._tok = new Map());
    const tok = (s) => { const key = String(s || ''); let v = cache.get(key); if (!v) { v = tokensFor(key, 'en'); cache.set(key, v); } return v; };
    const hits = [];
    for (const t of new Set(toks)) {
      if (t.length < 3 || L.stopwords.has(t) || L.stopwords.has(L.stem(t)) || /^\d+$/.test(t)) continue;
      if (df(t) > 20 || kwDf(t) > 20) continue;
      const dh = apps.filter((a) => tok(a.dev).includes(t)).length;
      const th = apps.filter((a) => tok(a.title).includes(t)).length;
      if ((dh >= 2 && dh >= th) || (dh >= 1 && th === 0)) hits.push(t);
    }
    const kcat = toks.join('');
    for (const a of apps) {
      const dc = tok(a.dev).join('');
      if (dc.length >= 6 && kcat.includes(dc) && tok(a.dev).some((t) => df(t) <= 20 && !L.stopwords.has(t))) hits.push(a.dev);
    }
    if (hits.length) add('navDev', 'cap', 'Geliştirici adı', `Kelime bir geliştiricinin adını içeriyor (${[...new Set(hits)].slice(0, 2).join(', ')}): arayan o geliştiricinin uygulamasını istiyor.`, 'WATCH');
  } else {
    const kt = toks.filter((t) => t.length >= 3 && !TR_GENERIC.has(t) && kwDf(t) <= 20);
    const devHit = apps.slice(0, 5).find((a) => tokensFor(a.dev, 'tr').some((t) => kt.includes(t)));
    if (devHit && !out.some((f) => f.id === 'brandTr')) add('brandTr', 'cap', 'Marka/kurum adı', `Kelime ilk 5'teki bir yayıncının adını içeriyor ("${devHit.dev}"): navigasyonel arama.`, 'WATCH');
  }

  /* --- ölü giriş: eski uygulamalar bile yükleme almıyor --- */
  const inc = apps.filter((a) => { const g = ageDays(a, now); return g === null || g > 365; }).map((a) => a.real || 0).sort((a, b) => a - b);
  if (inc.length >= 2 && inc[1] < 3000) {
    add('zombie', 'cap', 'Ölü sıralar', `İlk 10'daki en az iki eski uygulama 3 binin altında yükleme almış (${inc[1]}): sıralasan da indirme gelmeyebilir.`, 'WATCH');
  }

  /* --- uzun kuyruk ikizi: aynı sonuç sayfası, sadece başlık eşleşmesi düşük --- */
  if (r.seed && r.seed !== r.k && ctx.byK) {
    const seed = ctx.byK.get(r.seed);
    if (seed && seed.st === 'ok' && Array.isArray(seed.top) && seed.comp && r.comp) {
      const s = new Set(seed.top);
      const ov = r.top.filter((id) => s.has(id)).length;
      if (ov >= 6 && r.opportunity > seed.opportunity && r.comp.titleMatches < seed.comp.titleMatches) {
        const seedVerdict = isTr && ctx.verdictOf ? ctx.verdictOf(seed.k) : null;
        add('clone', isTr && seedVerdict ? 'cap' : 'flag', 'Aynı sonuç sayfası', `"${seed.k}" ile ilk 10'un ${ov}'i aynı; bu kelime yalnızca başlık eşleşmesi düşük olduğu için daha kolay görünüyor.`, isTr && seedVerdict ? seedVerdict : undefined);
      }
    }
  }

  /* --- küçük gölet (yalnızca uyarı) --- */
  const mp = incumbentMidpack(r, ctx);
  if (mp !== null && mp < 50_000) add('smallPond', 'flag', 'Küçük gölet', `Eski rakiplerin orta sırası ${Math.round(mp / 1000)} bin yükleme: benzer yeni uygulamalar tipik olarak günde tek ya da düşük iki haneli yükleme alıyor.`);

  /* --- tek uygulamaya yönelik arama olabilir (ABD, ~%60 kesinlik: yalnızca uyarı) --- */
  if (!isTr) {
    const GEN = new Set(['games', 'game', 'app', 'apps', 'free', 'offline', 'online', 'for', 'and', 'the', 'with', 'android', 'simulator', 'kids', 'pro']);
    const kt = toks.filter((t) => t.length >= 3 && !GEN.has(t));
    const has1 = (a) => { const tt = new Set(tokensFor(a.title, 'en')); return kt.every((t) => tt.has(t)); };
    if (kt.length && has1(apps[0]) && apps.slice(1).filter(has1).length <= 1) add('navTop1', 'flag', 'Tek uygulama araması olabilir', `1. sıradaki "${apps[0].title}" kelimeyi birebir taşıyor, diğerleri taşımıyor.`);
  }
  if ((r.st === 'ok' || r.st === 'partial') && /[^\u0000-ɏ\s]/.test(r.k) && !isTr) add('script', 'flag', 'Farklı alfabe', 'Latin olmayan alfabe: bu pazarın dili değil.');
  return ipSuffix();
}

/** Canlı tek kelime analizi için bağlam: yalnızca o kelimenin ilk 10'u (sıklık kuralları kapalı). */
export function liveFlagContext(apps, lang, now = Date.now()) {
  const map = {};
  for (const a of apps || []) if (a && a.id) map[a.id] = a;
  return { lang, apps: map, titleDF: null, kwDF: null, byK: null, dotlessEn: null, now, currentYear: new Date(now).getUTCFullYear(), verdictOf: null, _tok: new Map() };
}

/** Kural listesinin özeti: en sert eylem. */
export function strongestFlag(flags) {
  return (flags || []).find((f) => f.level === 'exclude') || (flags || []).find((f) => f.level === 'cap') || (flags || [])[0] || null;
}
