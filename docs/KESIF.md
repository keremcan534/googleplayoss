# Keşif skoru — hipotez, sinyaller ve geri besleme döngüsü (Ekim 2026)

> **Durum: hipotez.** Ağırlıklar elle seçildi, geri testi yok ve tek bir başarı gözlemine dayanıyor. Skor bir
> başarı olasılığı değildir; adayları aşağıdaki hipotezlere göre sıralar. Karar sınıfının (GOLD…SKIP) yerine
> geçmez, kararı ve onun geri test kalibrasyonunu ([`DOGRULAMA.md`](DOGRULAMA.md)) değiştirmez.

## Neden?

Radarın önerilerinden otomatik uygulama üreten bir hat (Fabrika) 11-15 Ekim 2026'da 12 uygulama yayınladı.
Seçimlerin 10'u GOLD kelimelerdendi; yalnızca biri gerçek organik trafik aldı. İlk haftanın verisinde:

1. **Karar sınıfı erken trafiği ayırmadı.** GOLD/BUILD, "ilk 10'a girip aramadan yükleme alabilir miyim?"
   sorusunu cevaplar. Yeni bir uygulamanın ilk haftalarda yükleme, puan ve elde tutma geçmişi olmadığı için arama
   sıralaması yok; o soru erken dönemde karşılık vermiyor.
2. **Gelen trafik aramadan değil, keşiften geldi.** Trafik alan uygulamanın gösterimlerinin neredeyse tamamı Play'in
   öneri, "benzer uygulamalar" ve kategori listesi yüzeylerindendi; uygulama hiçbir genel kelimede ilk 30'da değildi.
3. **Görsel gündelik oyunlar gösterilince dönüşüyor, araçlar hiç gösterilmiyor.** Alarm, su terazisi, geri sayım,
   pomodoro gibi araç uygulamaları neredeyse hiç gösterim almadı.

Mutlak sayılar çok küçük. Bu güçlü bir işaret ama kanıt değil.

## Hipotezler → sinyaller

| Hipotez | Sinyal | Ağırlık (öncül) |
|---|---|---|
| **H1** büyük, görsel gündelik kategorilerin keşif hacmi büyük; araçların trafiği yalnızca aramadan | **Keşif potansiyeli** | 0,35 |
| **H3** önde gelen rakiplerin reklam / ödeme duvarı / içerik bitti şikâyetleri, reklamsız ve kilitsiz bir sürüme kapı açar | **Rakip boşluğu** | 0,25 |
| **H2** ürün küçük resimde çekiciyse gösterimden ziyarete dönüşüm artar | **Görsel kanca** | 0,15 |
| (eski kural, düşük ağırlıkla) | **Giriş bandı** = girebilirlik / 100 | 0,15 |
| otomatik bir yapım çevrimdışı ve ücretsiz bir sürümü çıkarabilir mi | **Yapılabilirlik** | 0,10 |

`skor = 100 · Σ ağırlık · sinyal` (her sinyal 0-1). **H4**'e göre (devlerin varlığı keşif için fırsat işaretidir)
ilk 10'daki büyük uygulamalar için ceza yok; tersine "benzer devler" keşif sinyaline artı yazar.

### Keşif potansiyeli

- **Tür ağırlığı (×0,50):** ilk 10'un sıra ağırlıklı tür ortalaması. 1,0: gündelik, bulmaca, simülasyon, arcade ·
  0,8: sanat ve tasarım, yarış, aksiyon, kutu oyunu · 0,6: diğer oyunlar, kişiselleştirme, eğlence · 0,4:
  fotoğraf, müzik, video, sağlık… · 0,2: araçlar, verimlilik, yaşam tarzı, eğitim ve diğer kategoriler.
  Öncüldür; geri besleme döngüsü düzeltecek.
- **Yükleme / talep oranı (×0,25):** `log10(ilk 10 toplam yükleme / talep puanı)`, 5,5 → 0 ile 8,0 → 1 arası
  (veri setinde p10 ≈ 5,7, medyan ≈ 7,1, p90 ≈ 8,1). Yükleme aramaya göre çok büyükse trafik başka yerden geliyor.
  Karışıklık: uzun kuyruk kelimelerin talebi doğal olarak düşük, ilk 10'ları ise popüler uygulamalarla dolu; oran
  bu yüzden uzun kuyrukta da yükselir.
- **Benzer devler (×0,25):** kelimenin ve tohum kelimesinin ilk 10'unda, baskın türden 1M+ ve 10M+ uygulama
  sayısı (`(1M+ + 10M+) / 15`). Tohum eklenmesinin nedeni: uzun kuyruk bir kelimenin ilk 10'u kategorinin
  devlerini göstermeyebilir, baş terimin ilk 10'u gösterir. **Pazar geneli tür sayımı bilerek kullanılmadı:**
  taranan uygulamalar tohum listesini yansıtıyor, Play kataloğunu değil (TR'de "Araçlar"da "Basit eğlence"den çok
  1M+ uygulama var); öyle bir sayım H1'in tersini söylerdi.

### Rakip boşluğu

- **Baskı (×0,45):** ilk 10'da hem reklam hem uygulama içi satın alma olan uygulamaların payı.
- **Puan (×0,20):** ortalama puan 4,7 ve üstü → 0, 3,9 ve altı → 1 (en az 50 değerlendirmeli uygulamalar).
- **Şikâyetler (×0,35):** tarayıcı her gün `reviewCalls` (varsayılan 80) uygulamanın en yeni 100 değerlendirmesini
  çeker (önce en çok kelimenin ilk 3'ünde görünenler; 30 gün önbellek). 1-3 yıldızlı yorumlarda reklam, ödeme
  duvarı / abonelik ya da "içerik bitti" kalıpları aranır (İngilizce ve Türkçe, `src/reviews.js`). İlk 5'te en az
  iki uygulamanın 20+ değerlendirmelik örneği yoksa bu bileşen atlanır ve diğer ikisi yeniden ölçeklenir.
  Şikâyet oranı %30 → tam puan. İlk örneklemde araç uygulamalarında %0-10, yoğun reklamlı sıralama ve park
  oyunlarında %22-36 görüldü. Kullanıcı adı ya da görseli saklanmaz; yalnızca oranlar.

### Görsel kanca

Türün görsel tabanı (gündelik / bulmaca / simülasyon / sanat 0,7 … kelime ve bilgi yarışması oyunları 0,3, araçlar
0,15), kelimede görsel bir sözcük varsa +0,25 (color, paint, pixel, sort, merge, jigsaw, truck… / boyama, renk,
yapboz, sırala, tır…), araç ya da metin sözcüğü varsa −0,25 (timer, calculator, widget, word, quiz… / zamanlayıcı,
hesap makinesi, su terazisi, kelime…). Elle ya da bir dil modeliyle verilmiş değer `config/discovery.json` →
`visual["us-en"]["kelime"] = 0-1` olarak girilirse sözlük tahmininin yerine geçer.

### Yapılabilirlik

`flags.js` işaretlerinin ve bu skora özel sözlüklerin en düşüğü:

- politika riski / gerçek para / **yetişkin içerik araması** 0 (**engelli**: kısa listeye girmez),
- marka / ticari ad / "… like X" / kurum adı 0,2 — `flags.js`'e ek olarak araç markaları (bmw, jeep, scania…) ve
  bilinen oyun adları (block blast, hill climb, candy crush…),
- geliştirici adı / nadir ön ekli marka 0,3, **başka platform** (pc, xbox, youtube…) 0,3,
- yanlış ülke 0,4 — `flags.js`'e ek olarak pazar dışındaki ülke ve bölge adları (zimbabwe, qatar, europe… / almanya,
  amerikan, avrupa…); sıfatlar ("korean cooking") bilerek yok, çoğu zaman bir temadır,
- tek yayıncı 0,6, mevsimlik / yıla bağlı 0,7.

Sonra çarpanlar: ağır yapım sözcüğü (online, multiplayer, pvp, open world, AR/VR, AI chat, bank, crypto… /
çevrimiçi, çok oyunculu, açık dünya, canlı…) ×0,6; tür kelimesi iki kez geçen başlık parçası ("farm games pizza
wala game") ×0,5. Elle değer: `feasibility[...]`.

Ek sözlükler yalnızca bu skoru etkiler; karar sınıfını sınırlayan `flags.js` kuralları (elle ölçülmüş kesinlikleriyle)
değişmedi. Ekim 2026'da keşif kısa listesinin başında `flags.js`'in yakalamadığı bu tür kelimeler vardı; tuzak
kelimeler ("steam train", "air traffic controller", "mac and cheese", "adult coloring", "seksen", "sudan") testte.

## İlk kontrol (örneklem içi, doğrulama değil)

Öncül ağırlıklarla Fabrika'nın 12 kelimesi skorlandığında, görsel oyun kelimeleri (60-80) kelime oyunundan (55)
ve araç kelimelerinden (27-46) açıkça ayrılıyor; bu H1'in kendisi. **Ama oyunlar arasında trafik alanı öne
çıkarmıyor:** başarılı uygulamanın kelimesi 12 kelimenin 4.'sü; üstündeki üç kelimeden ikisinin uygulaması ilk
haftada neredeyse hiç gösterim almadı, üçüncüsünün verisi henüz yok. Ağırlıklar bu tek gözleme göre ayarlanmadı; ayarlansaydı aşırı uyum olurdu. Tek bir başarıyla
bu ayrımı açıklayan sinyal (ikon kalitesi, uygulamanın kendisi, şans) şu an ölçülemiyor.

## Geri besleme döngüsü

Fabrika her uygulama için Play Console'un **ilk 28 günlük** sayılarını (gösterim, ziyaretçi, yükleme dokunuşu,
edinme; varsa trafik kaynağı) ve rank izleyicisinin genel arama sıralarını gönderir.

- **Etiketler:** başarılı = edinme ≥ 20 (eşiği geçtiği an kesinleşir) · zayıf = gösterim < 50 · arada = orta.
  Zayıf ve orta ancak 28 günlük pencere dolunca kesinleşir; öncesinde "bekliyor" (eğilimiyle) görünür. Orta
  etiketliler ağırlık uyumuna girmez.
- **Marka araması sayılmaz:** uygulamanın kendi adıyla (başlığın ":" / "-" öncesi ya da `brand` alanı) yapılan
  aramadaki 1. sıra başarı değildir. Bu sıralar rapordan ayıklanır; etiket edinme ve gösterimden gelir.
- **Sızıntı önlemi:** her uygulama, seçildiği kelimenin **seçim anındaki** ilk 10'uyla (ileriye dönük kayıttan,
  `pickedAt`) ve Fabrika'nın kendi uygulaması çıkarılarak skorlanır.
- **Kapı:** en az 20 kesin etiket ve her sınıftan en az 4 olmadan ağırlıklar değişmez. Kapı açılınca her sinyalin
  ayırma gücü (AUC − 0,5) veri ağırlığıdır ve öncüle doğru büzülür: `w = (1 − λ)·öncül + λ·veri`,
  `λ = n / (n + 40)`; 20 uygulamada veri ağırlıkları yalnızca üçte bir oranında yansır.

```bash
npm run calibrate-discovery                                   # rapor (data/factory/outcomes.json)
npm run calibrate-discovery -- --outcomes ../aso-tracker/outcomes.json
npm run calibrate-discovery -- --write                        # config/discovery.json: etiket özeti; kapı açıksa ağırlıklar
npm run shortlist -- --by discovery --limit 20                # keşif skoruna göre kısa liste
```

Keşif kısa listesi engellileri ve yapılabilirliği 0,5'in altındakileri (marka, başka platform, başka ülke, başlık
parçası) çıkarır (`--min-feasibility`). Skor büyük ölçüde tür düzeyinde olduğu için aynı temanın kelimeleri art
arda gelir ("truck simulator …" ×10); her tohumdan en fazla 2 pazar alınır (`--per-seed`).

**Gizlilik:** Play Console sayıları herkese açık depoya girmez. `data/factory/outcomes.json` `.gitignore`'dadır;
biçim için [`data/factory/outcomes.example.json`](../data/factory/outcomes.example.json). Yayınlanan veriye
yalnızca sayım özeti (kaç uygulama, kaç başarılı / zayıf / bekliyor, kapı durumu) girer. `--write` ile
`config/discovery.json` değişir; o değişiklik bir commit ile gözden geçirilip yayınlanır.

## Çıktı

- `public/data/<pazar>.json` → her kelimede `disc: {s: skor, p: [keşif, boşluk, görsel, bant, yapılabilirlik], b?: 1}`
  (0-100), üstte `discoveryModel` (sürüm, ağırlıklar, kaynak, etiket özeti, elle değerler). Uygulamalarda,
  değerlendirmesi çekilmişse `cx: {n, any, ads, pay, content}` (şikâyet oranları).
- Panel: kartlarda **Keşif** metriği, detayda sinyal dökümü ve gerekçeler, "En yüksek keşif skoru" sıralaması,
  Analist Modu'nda kolon, CSV'de `kesif`, `kesif_<sinyal>` kolonları, Bilgi'de model ve etiket durumu.

Kod: [`public/js/discovery.js`](../public/js/discovery.js) · etiketler ve uyum: [`src/outcomes.js`](../src/outcomes.js),
[`src/calibrate-discovery.js`](../src/calibrate-discovery.js) · şikâyetler: [`src/reviews.js`](../src/reviews.js) ·
ayarlar: [`config/discovery.json`](../config/discovery.json).
