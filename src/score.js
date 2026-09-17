// Rekabet (zorluk) ve fırsat skorları. Saf fonksiyonlar; test edilebilir.
import { tokens, stem, clamp, median, mean, round, daysSince } from './util.js';

const log10p = (x) => Math.log10(Math.max(0, x || 0) + 1);

/**
 * Başlık eşleşmesinde yok sayılan ticari dolgu kelimeleri.
 * Hiçbir uygulama başlığına "free"/"download" yazmaz; bu kelimeler eşleşmeyi
 * yapay olarak sıfıra çekip zorluğu düşürüyordu ("sudoku" 96 iken
 * "sudoku free" 80 görünüyordu — aynı rakiplerle). Kelimenin özünü karşılaştırırız.
 * Not: "offline"/"online" burada YOK, çünkü onlar gerçekten başlıklarda geçen
 * anlamlı ayırt edici kelimelerdir.
 */
export const TITLE_FILLER = new Set([
  'free', 'app', 'apps', 'android', 'apk', 'download', 'downloads', 'install',
  'best', 'top', 'new', 'pro', 'google', 'play', 'store', 'mobile', 'phone', 'version'
]);

/** Kelimenin başlık eşleşmesinde kullanılacak özü (dolgu ve yıl atılır). */
export function coreTokens(keyword) {
  const all = tokens(keyword).map(stem);
  const core = all.filter((t) => !TITLE_FILLER.has(t) && !/^(19|20)\d\d$/.test(t));
  return core.length ? core : all;
}

/** Başlık, anahtar kelimenin öz kelimelerini (köklenmiş) içeriyor mu? */
export function titleMatches(keyword, title) {
  const kw = coreTokens(keyword);
  if (!kw.length) return false;
  const tt = new Set(tokens(title).map(stem));
  return kw.every((t) => tt.has(t));
}

/**
 * Sıralı ilk N uygulamanın detaylarından rekabet ölçümleri.
 * @param {string} keyword
 * @param {Array} apps kompakt uygulama kayıtları (sıra korunmuş; eksik/missing olanlar atlanır)
 * @param {{topN?:number, now?:number}} opts
 */
export function scoreCompetition(keyword, apps, opts = {}) {
  const { topN = 10, now = Date.now() } = opts;
  const list = (apps || []).filter((a) => a && !a.missing).slice(0, topN);
  const n = list.length;
  if (!n) {
    return { difficulty: null, market: null, comp: { n: 0 } };
  }
  const strengths = list.map((a) => clamp((log10p(a.real) - 3) / 4, 0, 1)); // 1K → 0, 10M → 1
  const strength = median(strengths);
  const topStrength = Math.max(...strengths.slice(0, 3));
  const ratingsVol = median(list.map((a) => clamp((log10p(a.ratings) - 2) / 4, 0, 1))); // 100 → 0, 1M → 1
  const rated = list.filter((a) => Number.isFinite(a.score) && a.ratings >= 50);
  const avgScore = rated.length ? mean(rated.map((a) => a.score)) : null;
  const quality = avgScore === null ? 0.5 : clamp((avgScore - 3.5) / 1.3, 0, 1); // 3.5 → 0, 4.8 → 1
  const matches = list.filter((a) => titleMatches(keyword, a.title)).length;
  const titleDensity = matches / n;
  const fresh = list.filter((a) => { const d = daysSince(a.updated, now); return d !== null && d <= 180; }).length;
  const freshness = fresh / n;

  const difficulty = Math.round(100 * (
    0.30 * strength +
    0.15 * topStrength +
    0.15 * ratingsVol +
    0.15 * quality +
    0.15 * titleDensity +
    0.10 * freshness
  ));

  const weak = list.filter((a) => a.real < 100_000).length;
  const lowRated = list.filter((a) => Number.isFinite(a.score) && a.score < 4.0 && a.ratings >= 100).length;
  const stale = list.filter((a) => { const d = daysSince(a.updated, now); return d !== null && d > 365; }).length;
  const big = list.filter((a) => a.real >= 10_000_000).length;
  const installs = list.map((a) => a.real || 0);
  const sumInstalls = installs.reduce((s, x) => s + x, 0);
  const medianInstalls = median(installs);
  const market = Math.round(100 * clamp(log10p(sumInstalls) / 9, 0, 1)); // toplam 1 milyar → 100
  const ads = list.filter((a) => a.ads).length;
  const iap = list.filter((a) => a.iap).length;
  const paid = list.filter((a) => a.free === false || (a.price || 0) > 0).length;

  // --- para ve ilgi sinyalleri (CR/CPA değil; Play'in açık verisinden çıkarılabilenler)
  // engagement: 1000 yüklemeye düşen değerlendirme sayısı (medyan).
  //   Yükleyenlerin ne kadarı uygulamayı yeterince kullanıp puan vermiş — bağlılık göstergesi.
  //   Gerçek "conversion rate" DEĞİLDİR; mağaza sayfası görüntüleri herkese açık değildir.
  const engBase = list.filter((a) => (a.real || 0) >= 1000 && Number.isFinite(a.ratings));
  const engagement = engBase.length ? round(median(engBase.map((a) => (a.ratings / a.real) * 1000)), 2) : null;
  // moneyShare: ilk 10'un kaçında para kazanma yolu var (IAP, reklam ya da ücretli).
  const monetized = list.filter((a) => a.iap || a.ads || a.free === false || (a.price || 0) > 0).length;

  // --- "girebilir miyim, girince ne alırım" ölçüleri (hepsi gerçek yükleme verisi)
  // entry: ilk 10'daki EN ZAYIF uygulamanın yüklemesi. Küçükse sıralamaya girmek kolaydır,
  //        milyonlarsa yeni bir uygulama ilk 10'a hiç giremez (= 0 indirme).
  const sortedInstalls = installs.slice().sort((a, b) => a - b);
  const entry = sortedInstalls[0];
  // entry2: en küçükten ikinci. Tek bir aykırı uygulama (ör. yeni yayınlanmış,
  // 0 yüklemeli bir uygulamanın ilk 10'a düşmesi) girilebilirliği yanlış göstermesin.
  const entry2 = sortedInstalls.length > 1 ? sortedInstalls[1] : sortedInstalls[0];
  // tiny: ilk 10'da 10 binin altında yüklemesi olan kaç uygulama var (girilebilirlik kanıtı)
  const tiny = installs.filter((x) => x < 10_000).length;
  // midpack: 3. sıradan sonuncuya kadar olanların medyanı. Lideri dışarıda bırakır;
  //          "ortalarda bir yere yerleşirsem komşularım ne durumda" sorusunun cevabı.
  const midpack = Math.round(median(installs.slice(2)) || 0);
  // leaderShare: liderin ilk 10 toplamındaki payı. Yüksekse pazar tek uygulamanın.
  const leaderShare = sumInstalls > 0 ? round(Math.max(...installs) / sumInstalls, 2) : null;
  // newcomers: son 2 yılda yayınlanıp ilk 10'a girebilmiş uygulama sayısı.
  //            0 ise pazar donmuş, yeni gelen sıralamaya giremiyor demektir.
  const dated = list.filter((a) => a.released);
  const newcomers = dated.filter((a) => { const d = daysSince(a.released, now); return d !== null && d <= 730; }).length;
  const medianAgeYears = dated.length ? round(median(dated.map((a) => daysSince(a.released, now) / 365)), 1) : null;

  return {
    difficulty,
    market,
    comp: {
      n,
      titleMatches: matches,
      weak,
      lowRated,
      stale,
      big,
      ads,
      iap,
      paid,
      monetized,
      engagement,
      avgScore: avgScore === null ? null : round(avgScore, 2),
      medianInstalls: Math.round(medianInstalls),
      sumInstalls: Math.round(sumInstalls),
      entry: Math.round(entry),
      entry2: Math.round(entry2),
      tiny,
      midpack,
      leaderShare,
      newcomers,
      dated: dated.length,
      medianAgeYears
    }
  };
}

/** Talep × (100 - zorluk) → fırsat. Zayıf rakipler küçük bonus verir. */
export function opportunityScore(demand, difficulty, comp = {}) {
  if (!Number.isFinite(demand) || !Number.isFinite(difficulty)) return null;
  const d = clamp(demand / 100, 0, 1);
  const e = clamp(1 - difficulty / 100, 0, 1);
  const base = Math.sqrt(d * e);
  const bonus = Math.min(0.15, 0.03 * (comp.weak || 0) + 0.02 * (comp.lowRated || 0) + 0.01 * (comp.stale || 0));
  return Math.round(100 * Math.min(1, base * (1 + bonus)));
}

export function verdict(opportunity, demand) {
  if (!Number.isFinite(demand) || demand <= 0) return 'talep-yok';
  if (!Number.isFinite(opportunity)) return 'eksik';
  if (opportunity >= 60) return 'guclu';
  if (opportunity >= 45) return 'iyi';
  if (opportunity >= 30) return 'orta';
  return 'zor';
}

export const VERDICT_LABELS = {
  guclu: 'Güçlü fırsat',
  iyi: 'İyi fırsat',
  orta: 'Orta',
  zor: 'Zor',
  eksik: 'Eksik veri',
  'talep-yok': 'Talep yok'
};
