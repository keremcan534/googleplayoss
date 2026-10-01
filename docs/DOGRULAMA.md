# Metrikler gerçekten işe yarıyor mu? — Doğrulama raporu (Ekim 2026)

Bu rapor, radarın kullandığı ölçülerin gerçek sonuçlarla ilişkisini ölçer ve yanlış pozitifleri
sayar. Analizler 17 ajanlık bir doğrulama turunda yapıldı; her bulguyu bağımsız bir "şüpheci"
yeniden hesapladı, araştırma rakamlarının kaynakları tek tek açılıp kontrol edildi.

## Neyi "gerçek" kabul ettik?

Play Store arama hacmi ve kelime başına yükleme herkese açık değil. Elimizdeki en iyi gerçek veri:
her kelimenin ilk 10'unda **son 1-2 yılda yayınlanmış uygulamalar** ve onların **gerçek yükleme
sayıları**. "Bu kelimeye girmiş yeni bir uygulama ne aldı?" sorusunun cevabı budur.

- Hız = yükleme / yaş (gün) — ömür boyu ortalama, tüm kaynaklardan.
- Bağımsız = geliştiricinin en büyük uygulaması 10M altında ve en fazla 5 uygulaması var.
- ABD'de 4.690 analiz edilmiş kelimenin 2.402'sinde, son bir yılda çıkmış bir uygulama ilk 10'da.

Sınırlar (her sonuçta geçerli): yalnızca **başaranları** görüyoruz (başarısız denemeler görünmez);
yüklemeler yalnızca o kelimeden gelmiyor; aynı başarılı uygulama birçok kelimede görünebiliyor.
"Bir yıl önceki hâli" testi için her kelimenin ilk 10'u, son bir yılda çıkan uygulamalar
çıkarılarak yeniden puanlandı (sızıntısız geri test).

## Ölçü ölçü sonuçlar

| Ölçü | Sonuç | Kanıt |
|---|---|---|
| **Talep** (otomatik tamamlama) | Trafik ölçüsü olarak **yanıltıcı** | Yeni girenlerin hızıyla ilişkisi sıfır ya da ters (Spearman −0,19 ABD / −0,24 TR). Yalnızca 1-2 kelimelik baş terimlerde zayıf pozitif (+0,25 / +0,29). Talebi yüksek görünen kelimelerin önemli kısmı marka adları ve "ı/ğ" yapay ad alanları. |
| **Rekabet (zorluk)** | En iyi tek ölçü, ama zayıf | Sızıntısız testte "bağımsız yeni bir uygulama günde 50+ yükleme aldı" için AUC 0,61 / 0,60. İlişki ters U: en iyi bant 45-65. |
| **Pazar** | **Doyuyordu** | Kayıtların üçte birinde 100; "pazar büyük" sinyali neredeyse her kelimede yanıyordu. Ölçek düzeltildi. |
| **Fırsat** | "Sıralanma kolaylığı" ölçüyor, trafik değil | Yeni girenlerin hızıyla ters ilişkili (−0,37). Eski GOLD+BUILD'lerin çoğu yalnızca "zayıf uygulama" bonusu sayesinde eşiği geçiyordu; bonus zorlukta zaten sayıldığı için kaldırıldı. |
| **Erişim** | Bileşenleri birbirini götürüyor | Girilebilirlik ve gölet büyüklüğü −0,64 korelasyonlu; birleşik puan dar bir bantta sıkışıyor. Yeniye açıklık en iyi bileşen. |
| **Eski rakiplerin orta sırası** (yeni) | **En iyi getiri göstergesi** | Yeni girenlerin hızıyla +0,49 ABD / +0,58 TR; tek-tek dışarıda bırakma testinde dayanıklı. Simülasyonun temeli. |
| **Trend** | İki ölçümle uyduruluyordu | Talep 21 günde bir ölçüldüğü için "fırsat yükseliyor" değişimlerinin tamamı yalnızca rekabetten geliyordu. Artık en az 3 ölçüm ve 21 gün gerekir. |
| **Düşük talep sınırları** | Hiçbir şeyi değiştirmiyordu | Kaldırınca 0 karar değişiyor (√talep terimi zaten sınırlıyor). Kaldırıldı. |

## Yanlış pozitifler

Eski karar listesindeki GOLD+BUILD'lerin elle denetimi:

- **ABD:** 65 GOLD+BUILD'in 17-19'u marka/navigasyonel arama (6 GOLD'un 3'ü). Örnekler: geliştirici
  adları ("kemco rpg games"), ürün adları ("yusibo …"), "… like final fantasy".
- **Türkiye:** 107 GOLD+BUILD'in 48'inde en az bir sert işaret. 19 kelime "ı/ğ" yapay ad alanından
  geliyor ("ıveco", "ğerçekçi"), talepleri 89'a kadar çıkıyordu.

Bunlar artık otomatik kapılarla yakalanıyor (`public/js/flags.js`). Her kuralın kesinliği elle
denetlendi; sözlüğe dayanan kurallar (marka, geliştirici adı) yalnızca **sınırlar**, silmez.

| Kural | Pazar | Eylem | Elle ölçülen kesinlik |
|---|---|---|---|
| ı/ğ yapay kelime | TR | SKIP | 19/19 |
| Geçmiş yıl ("… 2019") | ikisi | SKIP | 15/15 |
| Doğal olmayan öbek (tekrar, 6+ kelime, tek harfle başlayan) | TR | SKIP | 15/15 |
| Nadir ön ekli marka adı | ABD (TR'de uyarı) | en fazla WEAK | 19/19 |
| Tek yayıncının sonuç sayfası (ilk 10'un 5+'sı aynı geliştirici) | ABD (TR'de uyarı) | en fazla WEAK | 15/15, 12/12 |
| Geliştirici adı içeren kelime | ABD | en fazla WATCH | ~%75-85 |
| Marka/kurum sözlüğü (e-devlet, bankalar, kulüpler, IP) | TR | en fazla WATCH | ~%80 |
| Ölü sıralar (iki eski uygulama 3 binin altında) | ikisi | en fazla WATCH | küçük örnek, tutarlı |
| Aynı sonuç sayfasının uzun ikizi | TR (ABD'de uyarı) | tohum kelimenin kararı | 14/15 |
| Yanlış ülke (india, indonesia…) | ABD | en fazla WATCH | 15/15 |
| Politika riski (kumar, kredi, hile, casus, VPN…) | ikisi | en fazla WATCH | 13/15 |
| "… like X" / üçüncü taraf marka | ABD | en fazla WATCH | 15/15 |
| Yıla bağlı / mevsimlik | ikisi | en fazla BUILD | 15/15, 5/5 |

## Düzeltilen hatalar

- **Başlık eşleşmesi:** bağlaçlar ("for", "ve") ve "games/oyun" zorunluydu, Türkçe başlıklardaki
  İngilizce kelimeler ("GIF") Türkçe kuralla "gıf" oluyordu. Uzun kuyruk kelimelerde başlık eşleşmesi
  ~0 çıkıp zorluk düşük görünüyordu (aynı ilk 10'a sahip uzun varyant %83 oranında daha "kolay").
- **Türkçe harf genişletme:** taramada "tohum ı" / "tohum ğ" sorgulanıyordu; Play bunları i/g'ye
  katlıyor ama seyrek, yapay ad alanları açıyordu. Kaldırıldı.
- **Yarım talep ölçümü** 21 gün donuyordu; artık bir sonraki çalıştırmada yeniden ölçülür.
- **Niş kararı** üyelerin korumalı kararlarını yok sayıyordu (hiçbir üyesi BUILD olmayan BUILD nişler).
- **"Girmesi kolay"** sinyali tek bir minik uygulamaya bakıyordu ("alarm clock": 293 ve 435 bin).
- **Tarih ayrıştırma** UTC'nin doğusunda bir gün geri kayıyordu.
- **İngilizce kökleme** "zombies" ile "zombie"yi eşleştiremiyordu.

## Yeni karar: Girebilirlik × Getiri

Eski karar (talep × rekabet → fırsat eşikleri) sızıntısız geri testte sıralanmıyordu (AUC 0,52 ABD /
0,50 TR; üst sınıflarda ölü kalma oranı en yüksekti). Ortak bir değerlendirme düzeneği üzerinde üç
bağımsız tasarım (iki eksenli kapılar, kalibre olasılık modeli, asgari değişiklik) yarıştırıldı; üç
yargıç (istatistik titizliği, dürüstlük/kullanılabilirlik, uygulanabilirlik) puanladı ve en iyi
parçalar birleştirildi.

- **Girebilirlik (0-100):** ilk 10'un sıra ağırlıklı olarak ne kadarı son 2 yılda çıkmış ve ne kadarı
  küçük geliştiricilerin. Bantlar 60 / 40 / 30 / 15 → GOLD / BUILD / WATCH / WEAK / SKIP (duvar).
  Bant eşikleri 20 rastgele yarıya bölmede dışarıda tutulan sıralamayla seçildi.
- **Getiri sınırları:** yerleşik (1+ yaş) rakiplerin en zayıf ikincisi 3 binin altındaysa en fazla WEAK
  (ölü sıralar), 100 binin altındaysa en fazla WATCH (ince pazar, piyango).
- **Diğer sınırlar:** 1-2 kelimelik baş terimler en fazla WATCH; yanlış pozitif kuralları; pazar geneli
  geliştirici tablosu yoksa (veri seti dışı canlı analiz) GOLD yok ve geçmiş oran gösterilmez.
- **Kullanılmayanlar:** talep ve fırsat puanı karara girmez.

Geri test sonucu (aynı sonuç sayfasını paylaşan kelimeler bir kez sayıldı; "T50" = o yıl çıkan küçük
bir geliştiricinin uygulaması ilk 10'a girip günde 50+ yükleme aldı):

| Sınıf | ABD n | ABD T50 [%95 GA] | TR n | TR T50 [%95 GA] |
|---|---|---|---|---|
| GOLD | 32 | %68,8 [53–84] | 15 | %73,3 [53–93] |
| BUILD | 296 | %52,7 [47–59] | 131 | %52,7 [44–61] |
| WATCH | 733 | %39,8 [36–44] | 395 | %37,2 [32–42] |
| WEAK | 809 | %30,2 [27–33] | 494 | %24,9 [21–29] |
| SKIP | 615 | %20,2 [17–23] | 499 | %15,6 [13–19] |

Sınıflar her iki pazarda tek yönlü (AUC 0,63 ABD / 0,66 TR); GOLD+BUILD, WATCH'tan anlamlı biçimde
iyi (+14,4 puan [8,3–20,7] ABD, +17,6 puan [8,0–27,4] TR), girenlerin ölü kalma oranı %2-4. Dayanıklılık:
farklı "küçük geliştirici" tanımları, eşik oynatmaları, en sık 10 kazananın çıkarılması ve örneklem
eşleştirmesiyle sonuç büyük ölçüde korunuyor; en katı tanımda (geliştirici 1M altı, en fazla 2 uygulama)
ABD farkı anlamlılığı kaybediyor. Ayırt etme gücü gerçek ama orta düzeyde.

Sınırlar: tek dönem (2025-10 → 2026-10); yalnızca başaranlar görünür; GOLD küçük ve aralığı geniş;
kararlar her gün kaydedilir ve bant sınırında ±3 puanlık histerezis uygulanır (günlük sınıf değişimi
%1'in altında). Oranlar yeni bir pazarda ayrı geri test yapılmadan gösterilmez.

## Simülasyon

"Bu kelimeyi hedefleyen, reklam bütçesiz bir uygulama yayınlasam?" sorusu için: yükleme tarafı
kelimenin kendi yeni girenlerinden (yoksa aynı tür × eski rakip orta sırası hücresindeki yeni
uygulamalardan) gelir; talep veya fırsat puanıyla ölçeklenmez. Elde tutma ve gelir varsayımları
kaynak kontrolünden geçmiş kıyaslamalardır (GameAnalytics, Adjust, AppsFlyer, Appodeal/Tenjin,
RevenueCat, Play ve AdMob yardım sayfaları). Hep üç senaryo, hep aralık. Tüm varsayımlar ve
kaynaklar arayüzde görünür (`public/js/sim.js`).

Ölçek fikri vermesi için (eski karar sınıflarıyla, girebildiğin varsayımıyla, medyan kelime):
ABD'de tipik BUILD kelimesi ilk yıl kötümser/temel/iyimser ~1,9 bin / 7,1 bin / 30 bin yükleme;
yalnızca reklamla temel senaryoda ~150 $. Türkiye'de reklam geliri belirgin şekilde daha düşük.
Mesaj açık: kolay girilen kelimeler küçük. Sitenin asıl değeri boşa geliştirme yapmamanı sağlamak
(duvarlar, ölü göletler, marka tuzakları, yapay kelimeler) ve gerçekçi beklenti kurmak.

## İleriye dönük doğrulama

Her tarama artık `data/<pazar>/history/AAAA-AA.jsonl` dosyasına analiz edilen kelimelerin ilk 10'unu
ve tazelenen uygulamaların yükleme sayısını ekliyor. 60-90 gün sonra: yeni bir uygulamanın kaç günde
sıralamaya girdiği, sıra başına günlük yükleme ve kararın ileriye dönük isabeti ölçülebilecek. O
zamana kadar hiçbir sınıf "para kazandırır" anlamına gelmez.
