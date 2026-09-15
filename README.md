# 📡 Play Kelime Radarı

Google Play'de bir uygulama/oyun yayınladığında **reklam vermeden, mağaza aramasından (organik) yükleme getirebilecek anahtar kelimeleri ve nişleri** bulan, **7/24 kendi kendine çalışan** açık kaynak araç.

- **GitHub Actions** her gün Play Store'u tarar, sonuçları depoya commit eder.
- **GitHub Pages** veya **Vercel** üzerinde statik bir panel olarak yayınlanır (ikisi de olur, ikisi birden de olur).
- Vercel'de ek olarak **canlı analiz** çalışır: bir kelime yaz, saniyeler içinde talep + rakip + fırsat puanı.
- Ücretli API yok, anahtar yok. Sadece Play Store'un herkese açık uç noktaları (`google-play-scraper`).

> ⚠️ Talep puanı gerçek arama hacmi değildir; otomatik tamamlama davranışından türetilmiş bir **tahmindir**. Kelimeleri birbirine göre kıyaslamak için kullan.

---

## Nasıl çalışır?

```mermaid
flowchart LR
  A[Tohum kelimeler<br/>config/seeds.json] --> B[Otomatik tamamlama genişletme<br/>tohum, "tohum ", "tohum a".."tohum z"]
  B --> C[Aday havuzu]
  D[Arama sonuçları ve kategori listelerindeki<br/>uygulama başlıkları → n-gram] --> C
  C --> E[Talep ölçümü<br/>en kısa tetikleyici ön ek, ikili arama]
  E -->|önerilmiyor| F[talep yok]
  E -->|öneriliyor| G[Arama → ilk 10 rakip<br/>yükleme, puan, güncellik, başlık]
  G --> H[Zorluk · Pazar · Fırsat]
  H --> I[public/data/us-en.json<br/>+ nişler]
  I --> J[GitHub Pages / Vercel paneli]
```

### Puanlar

| Puan | Ne ölçer | Nasıl |
|---|---|---|
| **Talep** (0-100) | Kelimenin ne kadar arandığı | Kelime, otomatik tamamlamada ne kadar kısa bir ön ekle çıkıyor? `off` → "offline games" çıkıyorsa talep çok yüksek; tamamını yazınca çıkıyorsa düşük. Listedeki sıra da katkı verir. Hiç önerilmiyorsa "talep yok". |
| **Zorluk** (0-100) | Rakiplerin gücü | İlk 10 uygulamanın gerçek yükleme sayıları (medyan + ilk 3'ün en güçlüsü), değerlendirme sayısı, ortalama puan, başlığında kelimeyi geçiren uygulama oranı, güncellik. |
| **Pazar** (0-100) | Pastanın büyüklüğü | İlk 10 uygulamanın toplam yüklemesi (logaritmik). |
| **Fırsat** (0-100) | Sana düşebilecek pay | `√(talep × (100 − zorluk))`; ilk 10'da zayıf (<100K), düşük puanlı (<4.0) ve 1+ yıldır güncellenmemiş uygulamalar küçük bonus verir. **60+ güçlü · 45+ iyi · 30+ orta · altı zor**. |

### Nişler

Talebi olan kelimeler ortak kelimeye göre ("offline", "tracker", "kids"…) ve tohuma göre gruplanır. Niş skoru = grubun en iyi 5 kelimesinin ortalama fırsatı × grup büyüklüğü. Bir uygulama fikri ararken kelime tek tek değil, niş olarak bakmak daha faydalıdır.

### 7/24

- `crawl` iş akışı her gün 03:17 UTC'de çalışır (`.github/workflows/crawl.yml` içindeki cron'u değiştirerek sıklaştırabilirsin, ör. 6 saatte bir).
- Her koşu **istek bütçesiyle** sınırlıdır (varsayılan: 1500 otomatik tamamlama, 250 arama, 1500 uygulama detayı, en fazla 40 dk). Google'ı yormaz, engel yemez.
- Kelime evreni her koşuda büyür; eski analizler 10 günde bir, talep ölçümleri 21 günde bir yenilenir; "talep yok" denenler 30 günde bir tekrar denenir.
- Sonuçlar `public/data/` altına, önbellekler `data/` altına commit edilir. Böylece hem geçmiş korunur hem de Vercel aynı commit ile güncellenir.

---

## Kurulum

### 1) GitHub (tarama + GitHub Pages) — zorunlu adım

1. Bu depoyu **fork'la** veya kendi hesabına push et.
2. **Settings → Actions → General → Workflow permissions**: *Read and write permissions* seçili olsun (tarayıcı sonuçları commit edecek).
3. **Settings → Pages → Build and deployment → Source**: **GitHub Actions** seç. (İş akışı bunu kendisi açmayı da dener; açamazsa uyarı verir.)
4. **Actions → crawl → Run workflow** ile ilk taramayı başlat (ya da ertesi sabahı bekle).
5. Panel: `https://<kullanıcı>.github.io/<depo>/`

> Not: Herkese açık depolarda GitHub, 60 gün "hareketsiz" kalan zamanlanmış iş akışlarını kapatır. Tarayıcı her gün commit attığı için normalde bu olmaz; olursa Actions sekmesinden tek tıkla yeniden etkinleştir.

### 2) Vercel (panel + canlı analiz) — isteğe bağlı

1. [vercel.com](https://vercel.com) → **Add New → Project** → bu depoyu içe aktar. Framework: **Other**. Başka ayar gerekmez (`vercel.json` hazır).
2. Her commit'te (günlük veri commit'leri dahil) Vercel otomatik yeniden dağıtır.
3. "Canlı analiz" sekmesi Vercel'de otomatik açılır (`/api/analyze`).
4. Paneli GitHub Pages'te kullanıp canlı analizi Vercel'den almak istersen: panelde **Canlı analiz → API adresi ayarı** kısmına Vercel adresini yaz.

Vercel'in ücretsiz planı bu iş için fazlasıyla yeterlidir (fonksiyon süresi 60 sn'ye ayarlı; bir analiz ~3-8 sn sürer ve 6 saat önbelleklenir).

### 3) Yerel çalıştırma

```bash
npm install
npm run crawl                      # tam tarama (config'deki bütçeyle)
npm run crawl -- --search 30 --app 200 --minutes 5   # küçük deneme
npm run analyze -- "offline rpg games"                # tek kelimeyi anında analiz et
npm run analyze -- "çevrimdışı oyunlar" --market tr:tr
npm run serve                      # http://localhost:3000 — panel + canlı analiz
npm test
```

---

## Konfigürasyon — `config/seeds.json`

| Alan | Açıklama |
|---|---|
| `markets` | Taranacak pazarlar: `[{ "country": "us", "lang": "en" }, { "country": "tr", "lang": "tr" }]`. Her pazar ayrı dosya ve ayrı bütçe. |
| `seeds` | Keşfin başladığı tohum kelimeler. Kendi alanına göre değiştir (ör. sadece oyun türleri). |
| `letters` / `marketLetters` | Harf genişletmesi için alfabe (Türkçe için `tr` tanımlı). |
| `categories` | Kategori listelerinden (Top Free) başlık madenciliği yapılacak kategoriler. |
| `budget.*` | Koşu başına istek sınırları ve süre. `maxKeywordsTotal` kelime evreninin tavanı. |
| `discoveryShare` | Otomatik tamamlama bütçesinin keşfe ayrılan payı (kalanı talep ölçümüne gider). |
| `refreshDays`, `demandRefreshDays`, `noDemandRecheckDays` | Yenileme aralıkları. |
| `suggestTtlDays`, `appTtlDays` | Önbellek ömürleri. |
| `topN` | Kaç rakip incelensin (10). |
| `throttleMs`, `concurrency` | İstek hızı. Engel yersen `throttleMs`'i artır. |

Elle tetiklenen koşuda (Run workflow) pazar ve bütçeleri geçici olarak değiştirebilirsin.

---

## Dosya yapısı

```
config/seeds.json        tohumlar, pazarlar, bütçeler
src/run.js               7/24 tarayıcı (keşif → talep → rekabet → skor → JSON)
src/analyze.js           tek kelime analizi (tarayıcı ve API ortak)
src/demand.js            otomatik tamamlama ile talep ölçümü (ikili arama)
src/score.js             zorluk / pazar / fırsat formülleri
src/niches.js            niş gruplama
src/discover.js          başlık n-gram adayları
src/store.js             google-play-scraper sarmalayıcı: hız sınırı, retry, bütçe
src/suggest.js           dayanıklı otomatik tamamlama istemcisi
src/cli.js               npm run analyze
src/serve.js             yerel sunucu (panel + api)
api/*.js                 Vercel fonksiyonları: health, suggest, search, analyze
public/                  statik panel (index.html, app.js, style.css) + data/*.json
data/<pazar>/            önbellekler (apps, suggest, meta)
.github/workflows/       crawl (cron), pages (yayın), ci (test)
```

## Çıktı formatı — `public/data/us-en.json`

```jsonc
{
  "market": { "id": "us-en", "country": "us", "lang": "en" },
  "generatedAt": "...", "stats": { "keywords": 1234, "analyzed": 800, ... },
  "niches": [ { "name": "offline", "type": "token", "count": 42, "score": 61, "keywords": [...] } ],
  "keywords": [ {
    "k": "offline rpg games", "src": "suggest", "seed": "rpg games", "first": "2026-09-15",
    "st": "ok", "demand": 36, "difficulty": 80, "market": 91, "opportunity": 27, "verdict": "zor",
    "pop": { "minPrefix": 9, "pos": 4, "len": 17 },
    "comp": { "n": 10, "titleMatches": 0, "weak": 0, "lowRated": 0, "stale": 0, "big": 5, "avgScore": 4.59, "sumInstalls": 149869369 },
    "top": ["com.example.app", "..."], "hist": [["2026-09-15", 36, 80, 27]]
  } ],
  "apps": { "com.example.app": { "title": "...", "real": 15224793, "score": 4.65, "updated": "2026-07-29", ... } }
}
```

CSV dışa aktarma panelden yapılır (filtrelenmiş görünüm).

## Sınırlamalar

- Uç noktalar resmi değildir. Google biçimi değiştirirse `npm update google-play-scraper` çoğu zaman yeterlidir.
- Çok sık/agresif tarama geçici engel yiyebilir; bütçeler ve `throttleMs` bunun için var.
- Sonuçlar pazara (ülke/dil) özeldir; sıralama kişiselleştirmesi hesaba katılmaz.

## Lisans

MIT

---

### English summary

Self-running (GitHub Actions cron) keyword & niche finder for Google Play ASO. It expands seed keywords via Play autocomplete, estimates demand from the shortest prefix that triggers a suggestion, measures competition from the top-10 apps (real installs, ratings, freshness, title matches) and computes an opportunity score. Results are committed to the repo and served as a static dashboard on GitHub Pages and/or Vercel; on Vercel a live `/api/analyze` endpoint powers instant keyword analysis. No paid APIs.
