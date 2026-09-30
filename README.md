# 📡 Play Fırsat Radarı

Google Play'de bir uygulama/oyun yayınladığında **reklam vermeden, mağaza aramasından (organik) yükleme getirebilecek anahtar kelimeleri ve nişleri** bulan, **7/24 kendi kendine çalışan** açık kaynak araç.

Panel tek bir soruya cevap verecek şekilde tasarlandı: **bu kelime için uygulama yapmaya değer mi?** Her kelime bir karara indirgenir — **GOLD / BUILD / WATCH / WEAK / SKIP** — yanında tek cümlelik gerekçesiyle. Ham metrikler silinmedi, sadece arkaya alındı: karar → gerekçe → detay → ham veri.

- **GitHub Actions** her gün Play Store'u tarar, sonuçları depoya commit eder.
- **GitHub Pages** veya **Vercel** üzerinde statik bir panel olarak yayınlanır (ikisi de olur, ikisi birden de olur).
- Vercel'de ek olarak **canlı analiz** çalışır: bir kelime yaz, saniyeler içinde karar + gerekçe + rakip özeti.
- Ücretli API yok, anahtar yok. Sadece Play Store'un herkese açık uç noktaları (`google-play-scraper`).
- **Projeler / Yayın Paketi**: oyununu ya da uygulamanı başka bir yerde geliştir, burada içe aktar (elle, GitHub reposu, kısa açıklama, Play'deki uygulama, ZIP) ve Play'e yüklenecek her şeyi (metinler, ikon, tanıtım görseli, ekran görüntüleri, Data Safety, gizlilik politikası, kontrol listesi) tek pakette hazırla. Anahtar kelime keşfi bunun için şart değil.

> ⚠️ Talep puanı gerçek arama hacmi değildir; otomatik tamamlama davranışından türetilmiş bir **tahmindir**. Kelimeleri birbirine göre kıyaslamak için kullan.

---

## Arayüz

| Bölüm | Ne için |
|---|---|
| **Projeler** | Üç giriş yolu: *fırsattan*, *fikirden*, *mevcut projeyi içe aktar*. Her projenin bir **Yayın Paketi** var; **YAYIN PAKETİ ÜRET** 16 aşamalı hattı çalıştırır ve her kalemi EKSİK / ÜRETİLİYOR / HAZIR / GÖZDEN GEÇİR / ONAYLANDI olarak izler; üstte **YAYIN HAZIRLIĞI %**. Ayrıntı aşağıda. |
| **Genel Bakış** | Pazarın o anki durumu: karar sayaçları, en iyi skor, yeni fırsat sayısı, son tarama zamanı; ardından *şu andaki en iyi fırsatlar*, *yeni bulunanlar* ve *yükselenler*. Sayaç kutularına tıklayınca ilgili liste açılır. |
| **Fırsatlar** (varsayılan çalışma ekranı) | Karar odaklı kartlar: karar etiketi, kelime, fırsat puanı, tek cümlelik gerekçe ve üç kritik metrik (talep, rekabet, trend). Hızlı filtre çipleri: **Gerçekçi** (kararı BUILD+ *ve* erişimi 65+ olanlar) / Tümü / GOLD / BUILD / WATCH / Yeni / Yükselen / Kayıtlı. Aynı ilk 10'a düşen kelimeler ("tip calculator", "tip calculator free", "tip calculator free android") tek kartta katlanır; varyantlar detayda listelenir. Sayısal filtreler *Gelişmiş filtreler* altında saklı. |
| **Nişler** | Aynı karar dili nişlerde: niş kararı, niş skoru, işe yarar kelime sayısı, en iyi kelime, talep/rekabet/trend. *Nişi aç* o nişin tüm kelimelerini karara göre sıralı listeler. |
| **Sıralama** | Nişleri ya da kelimeleri seçtiğin ölçüye göre sıralayan yatay çubuk grafik; ikinci kolonda ikinci bir ölçü (gelir modeli, kullanıcı ilgisi, talep…). Altında medyan, P75 eşiği ve yayılım. |
| **Canlı Analiz** | Kelimeyi yaz, önce büyük karar ve gerekçe gelir; metrikler, "neden iyi", "riskler", rakip özeti ve ham veri altında. |
| **Kaydedilenler** | ★ ile işaretlediklerin. Tarayıcında saklanır (`localStorage`). |
| **Analist Modu** | Eski yoğun tablo olduğu gibi duruyor: tüm kolonlar, sıralama, sayısal filtreler ve CSV çıktısı. Artık varsayılan değil, derin araştırma için. |
| **Bilgi** | Kararların ve puanların tanımı, uyarılar. Panodan uzun açıklama metinleri buraya taşındı. |

Detay için herhangi bir karta tıkla: masaüstünde yan panel, mobilde alt sayfa açılır ve tüm metrikler, sinyaller ve rakip listesi orada.

### Kararlar

| Karar | Fırsat puanı | Anlamı |
|---|---|---|
| ★ **GOLD** | 70-100 | Olağanüstü fırsat, öncelik ver |
| **BUILD** | 60-69 | Yapmaya değer |
| **WATCH** | 45-59 | Takipte tut |
| **WEAK** | 30-44 | Muhtemelen değmez |
| **SKIP** | 0-29 | Vakit harcama |

Karar **sunum katmanıdır**; puan formüllerini değiştirmez. Ham skorun üstünde koruma kuralları çalışır:

- Talep 45'in altında → GOLD verilmez. Talep 25'in altında → karar en fazla WATCH.
- Rekabet 80'in üstünde → karar WATCH'a çekilir; talep 85'in üstündeyse en fazla BUILD.
- Rakip verisi 5'ten az (eksik tarama) → karar en fazla WATCH.
- Trend için yeterli geçmiş yoksa **YENİ** yazar; trend asla uydurulmaz.

### "0 indirme" koruması

Bir kelime iki ayrı şekilde seni boş bırakır ve araç ikisini ayırır:

| Başarısızlık | Nasıl anlaşılır | Sonuç |
|---|---|---|
| **Giriş duvarı** — sıralamaya hiç giremezsin | İlk 10'un *en zayıf* uygulaması bile 1M+ yükleme | Karar en fazla **WEAK** |
| Giriş zor | En zayıf rakip 100K+ | Karar en fazla **WATCH** |
| **Ölü gölet** — girersin ama kimse aramıyor | Orta sıra (3-10) medyanı 1.000'in altında | Karar en fazla **WEAK** |
| İnce pazar | Orta sıra medyanı 5.000'in altında | Karar en fazla **WATCH** |
| Erişim getirisi zayıf | Erişim puanı 50'nin altında | GOLD verilmez |

Örnek: `quran` kelimesinde ilk 10'un en zayıfı 998 bin yükleme → yeni bir uygulama giremez, garanti 0 indirme. `tip calculator` kelimesinde ilk 10'un son sırası 43 yükleme → girmek bedava ama orta sıra 11 bin, yani girmek kolay, kazanmak ayrı konu. Araç ikisini farklı söyler.

### Panelde olmayan şeyler (ve nedeni)

**Conversion rate ve CPA yok.** Mağaza sayfası görüntüleri sadece uygulamanın sahibine, Play Console'da görünür; CPA ise reklam harcaması verisidir. İkisi de Play'in herkese açık sayfalarında yoktur, dolayısıyla kazıyıcıyla üretilemez. Bu araç onların yerine aynı kararı veren ve **gerçekten ölçülebilen** karşılıklarını kullanır: *erişim puanı* (sıralama indirmeye dönüşür mü) ve *gelir modeli* (bu alanda para kazanan var mı). Uydurma tahmin üretilmez.

Tüm eşikler, koruma kuralları, metrik etiketleri ve tek cümlelik gerekçe üreteci tek dosyada: [`public/js/verdict.js`](public/js/verdict.js). Eşiği değiştirmek istersen `THRESHOLDS` ve `GUARDS` sabitlerine dokunman yeter; `test/verdict.test.js` sınır değerleri ve kuralları doğrular.

### Metrik dili

Sayılar her zaman etiketle birlikte gösterilir; kesin skor da görünür kalır.

| Puan | 0-24 | 25-44 | 45-64 | 65-79 | 80-100 |
|---|---|---|---|---|---|
| Talep | ÇOK DÜŞÜK | DÜŞÜK | ORTA | YÜKSEK | ÇOK YÜKSEK |
| Rekabet | ÇOK DÜŞÜK | DÜŞÜK | ORTA | YÜKSEK | AŞIRI |

Fırsat puanı: 0-29 KÖTÜ · 30-44 ZAYIF · 45-59 İLGİNÇ · 60-69 İYİ · 70-84 MÜKEMMEL · 85-100 OLAĞANÜSTÜ.

---

## Projeler ve Yayın Paketi

Anahtar kelime keşfi proje oluşturmak için **hiçbir zaman gerekmez**. Uygulamanı tamamen başka bir yerde yapıp bu aracı yalnızca sonda paketlemek ve yayına hazırlamak için kullanabilirsin.

**Giriş yolları**

| Yol | Ne alır |
|---|---|
| Fırsattan | Radar'daki bir kelime (+ isteğe bağlı ürün fikri). Fırsat çekmecesinde *Bu fırsattan proje oluştur* düğmesi de var. |
| Fikirden | Ad, pazar, birkaç cümlelik fikir, isteğe bağlı tür. |
| Mevcut projeyi içe aktar | **Elle** (açıklama, mekanikler, mevcut mağaza metinleri) · **GitHub reposu** (README, AndroidManifest, Gradle/Unity/Godot/Flutter ayarları, SDK'lar, betik adları; özel repo için anahtar yalnızca bellekte tutulur ve sadece api.github.com'a gider) · **Kısa açıklama** · **Play'deki uygulama** (paket adı → `api/listing`) · **ZIP** (bu aracın paketi ya da fastlane meta verisi). |

**Hat:** Ürünü analiz et → Tür / çekirdek kanca → İlgili arama kelimeleri → Konumlandırma → ASO → Mağaza meta verisi → İkon → Logo → Tanıtım görseli → Ekran görüntüsü planı → Ekran görüntüsü dosyaları → Tanıtım videosu planı → Sosyal video planı → Gizlilik / Data Safety → Sürüm notları → Son yayın kontrolü.

**Dürüst konumlandırma.** Amaç oyunu bir kelimeye göre değiştirmek değil, var olan oyun için en güçlü *doğru* konumlandırmayı bulmak:

- Tohumlar ürünün kendisinden çıkar (ad, açıklama, README, mekanikler, tür, ekran notları, mevcut mağaza metni, repo dosya adları); adaylar günlük tarama verisinden, Play otomatik tamamlamasından ve (API açıksa) canlı analizden gelir ve **mevcut fırsat/rekabet sisteminden** (`verdict.js`) geçer.
- Kavramlar dilden bağımsızdır: İngilizce README ile Türkiye pazarı için "tır oyunları" eşleşir.
- Birincil ve ikincil kelimenin **her parçası** üründe karşılık bulmalı ve kelime ürünün çekirdeğine (tür, konu, ana mekanik) dayanmalı. Elenenler: başka marka/rakip uygulama adı, yıl, ürünün yapmadığı iddia ("offline", "multiplayer"), farklı arama niyeti (oyun için "… apps"), başka ürünün konusu (tır oyunu için "car"), yalnızca yan özellik eşleşmesi (hava durumu efekti olan oyun için "rain sounds"). Kısmi uyumlular ayrıca gösterilir ama metinlerde kullanılmaz.
- Mağaza metinlerine yalnızca olgular girer; repo taramasından gelen iddialar "gözden geçir" olarak işaretlenir. Başlık/kısa açıklama Play meta veri politikasına göre denetlenir (30/80/4000/500 karakter, "best", "#1", "free", emoji, tekrar eden işaret, marka adları).
- Rakip konumlandırması farklılaşma açılarını yalnızca ürün olgularıyla önerir (ör. rakiplerin 10/10'u reklamlıysa ve senin oyunun reklamsızsa).

**Görseller** tarayıcıda canvas ile üretilir ve Play ölçülerine göre denetlenir: ikon 512×512 PNG, tanıtım görseli 1024×500 alfasız JPEG, ekran görüntüleri **kendi yüklediğin gerçek oyun görüntülerinden** başlık ve çerçeveyle. Kendi dosyanı yüklersen o kullanılır ve aynı kurallarla denetlenir.

**Uyumluluk:** SDK/izin tespitinden Data Safety taslağı, gizlilik politikası taslağı (hukuki tavsiye değildir), IARC derecelendirme soruları, derleme kontrolleri (paket adı, hedef API — doğrulanmış eşik 35, 2026 için büyük olasılıkla 36, AAB, imza, kişisel hesaplar için 12 test kullanıcısı / 14 gün kapalı test).

**Durumlar ve hazırlık:** Onayladığın ya da elle düzenlediğin kalemler yeniden üretimde ezilmez. Hazırlık yüzdesi zorunlu kalemlere daha çok ağırlık verir; %100 her şeyin onaylandığı anlamına gelir.

**ZIP:** fastlane `supply` düzeni (`fastlane/metadata/android/<dil>/title.txt`, `short_description.txt`, `full_description.txt`, `changelogs/<versionCode>.txt`, `images/icon.png`, `images/featureGraphic.jpg`, `images/phoneScreenshots/…`) + `publish-pack/README.md` (kontrol listesi ve rapor), `privacy-policy.txt`, `project.json` ve görseller. Aynı ZIP başka bir tarayıcıda içe aktarılır. Projeler yalnızca tarayıcında (IndexedDB) saklanır; sunucuya hiçbir şey gönderilmez.

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
| **Talep** (0-100) | Kelimenin ne kadar arandığı | Kelime, otomatik tamamlamada ne kadar kısa bir ön ekle çıkıyor? `off` → "offline games" çıkıyorsa talep çok yüksek; tamamını yazınca çıkıyorsa düşük. Listedeki sıra da katkı verir. Otomatik tamamlama 5 öneriyle sınırlı olduğundan "block puzzle" gibi baş terimlerde kelimenin kendisi görünmeyebilir; kelimeyle başlayan bir öneri ("block puzzle games") varsa **uzantı modu** ile %10 iskontolu puanlanır. Ne kendisi ne uzantısı önerilmiyorsa "talep yok". |
| **Zorluk** (0-100) | Rakiplerin gücü | İlk 10 uygulamanın gerçek yükleme sayıları (medyan + ilk 3'ün en güçlüsü), değerlendirme sayısı, ortalama puan, başlığında kelimeyi geçiren uygulama oranı, güncellik. |
| **Pazar** (0-100) | Pastanın büyüklüğü | İlk 10 uygulamanın toplam yüklemesi (logaritmik). |
| **Fırsat** (0-100) | Sana düşebilecek pay | `√(talep × (100 − zorluk))`; ilk 10'da zayıf (<100K), düşük puanlı (<4.0) ve 1+ yıldır güncellenmemiş uygulamalar küçük bonus verir. **60+ güçlü · 45+ iyi · 30+ orta · altı zor**. |
| **Erişim** (0-100) | Sıralarsan indirme gelir mi | Üç gerçek ölçüden: ilk 10'un en zayıf uygulamasının yüklemesi (girmek kolay mı), 3. sıradan sonuncuya kadarki medyan yükleme (girince komşuların durumu), son 2 yılda ilk 10'a girebilmiş uygulama sayısı (pazar yeniye açık mı). |
| **Gelir modeli** (0-10) | Bu alanda para var mı | İlk 10 uygulamanın kaçında uygulama içi satın alma, reklam ya da ücretli sürüm var. |
| **Kullanıcı ilgisi** | Yükleyen kullanıyor mu | 1000 yüklemeye düşen değerlendirme sayısı (ilk 10 medyanı). |

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
npm test                           # karar katmanı + tarayıcı birim testleri
npm run build                      # yayın kontrolü: JS sözdizimi, JSON'lar, public/ referansları
npm run rescore                    # puanlama mantığı değişince: ağa gitmeden yeniden hesapla
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
src/score.js             zorluk / pazar / fırsat formülleri + erişim ölçüleri (giriş, orta sıra, yeni giren)
src/rescore.js           npm run rescore — önbellekten yeniden puanlama (ağ yok)
src/niches.js            niş gruplama
src/discover.js          başlık n-gram adayları
src/store.js             google-play-scraper sarmalayıcı: hız sınırı, retry, bütçe
src/suggest.js           dayanıklı otomatik tamamlama istemcisi
src/cli.js               npm run analyze
src/serve.js             yerel sunucu (panel + api)
api/*.js                 Vercel fonksiyonları: health, suggest, search, analyze, listing
public/index.html        panel kabuğu (Genel Bakış, Fırsatlar, Nişler, Canlı, Kayıtlı, Analist, Bilgi)
public/app.js            arayüz mantığı: kartlar, filtreler, çekmece, tablo, CSV
public/js/verdict.js     KARAR KATMANI: eşikler, koruma kuralları, gerekçe üreteci, metrik etiketleri
public/js/pack/          YAYIN PAKETİ: lexicon (kavram/tür/SDK sözlüğü), product (ürün analizi, uyum),
                         repo (GitHub tarama), keywords (konumlandırma), aso, compliance, marketing,
                         pack (model + hat + dışa aktarım), binary (ZIP, PNG), render (canvas), db, ui
public/style.css         tema ve düzen (karanlık/aydınlık, mobil)
public/data/*.json       tarayıcı çıktısı (panelin okuduğu veri)
data/<pazar>/            önbellekler (apps, suggest, meta)
scripts/build-check.js   npm run build — yayın öncesi doğrulama
.github/workflows/       crawl (cron), pages (yayın), ci (test + build)
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

CSV dışa aktarma Analist Modu'ndan yapılır (filtrelenmiş görünüm; karar, gerekçe ve metrik etiketleri de kolon olarak gelir).

## Sınırlamalar

- Uç noktalar resmi değildir. Google biçimi değiştirirse `npm update google-play-scraper` çoğu zaman yeterlidir.
- Çok sık/agresif tarama geçici engel yiyebilir; bütçeler ve `throttleMs` bunun için var.
- Sonuçlar pazara (ülke/dil) özeldir; sıralama kişiselleştirmesi hesaba katılmaz.

## Lisans

MIT

---

### English summary

Self-running (GitHub Actions cron) keyword & niche finder for Google Play ASO. It expands seed keywords via Play autocomplete, estimates demand from the shortest prefix that triggers a suggestion, measures competition from the top-10 apps (real installs, ratings, freshness, title matches) and computes an opportunity score. Results are committed to the repo and served as a static dashboard on GitHub Pages and/or Vercel; on Vercel a live `/api/analyze` endpoint powers instant keyword analysis. No paid APIs.

The dashboard is decision-first: every keyword is reduced to GOLD / BUILD / WATCH / WEAK / SKIP with a one-sentence, deterministic reason and four key metrics (demand, competition, reach, trend). A **reach** score answers the question that decides whether you get any installs at all: can a new app even enter this top 10 (the weakest top-10 app's install count), and does mid-pack placement pay (median installs of ranks 3-10), and is the market open to newcomers (apps released in the last 2 years that rank). Two guardrails encode the two ways a keyword leaves you at zero: a **wall** (you never rank) and a **dead pond** (you rank but nobody searches). Conversion rate and CPA are deliberately absent: store-listing views are private to the app owner and CPA is ad-spend data, so neither can be scraped; the dashboard uses measurable stand-ins (reach, and how many of the top 10 monetize at all). The decision layer in `public/js/verdict.js` is presentation only — it never alters the scoring formulas — and applies guardrails (no GOLD on weak demand, capped verdicts on extreme competition or incomplete competitor data, never an invented trend). The original dense table lives on in Analyst Mode with all columns, numeric filters and CSV export.

**Projects / Publish Pack.** Keyword discovery is never required. Create a project from an opportunity, from an idea, or by importing an existing project (manual, GitHub repo, short description, published Play listing, or ZIP). *Generate Publish Pack* runs a 16-stage pipeline that starts from the product itself (description, README, mechanics, manifest, SDKs), derives search terms, passes them through the existing opportunity/competition system and picks the strongest *truthful* positioning: every part of a primary/secondary keyword must be backed by the product, and trademarks, years, unsupported claims, mismatched intent and side-feature-only matches are excluded. It produces policy-linted store copy, Play-spec icon/feature graphic/framed screenshots (from real uploaded captures), Data Safety and privacy-policy drafts, rating prep, build checks and marketing plans. Every item is tracked as MISSING / GENERATING / READY / NEEDS REVIEW / APPROVED with an overall publish-readiness percentage, and the whole pack exports as a fastlane-layout ZIP. All project data stays in the browser (IndexedDB).
