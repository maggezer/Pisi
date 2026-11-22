# Pisi Sync — cihazda kabul listesi

Bu belge Pisi Sync'in gerçek telefon, gerçek masaüstü ve kullanıcının kendi cPanel sunucusuyla elle kabul listesidir (`docs/sync-plan.md` S8).
Bütün maddeler işaretlenince ve `pisi-error.md`'de senkron için "yüksek" önemde açık madde kalmayınca S8, dolayısıyla Pisi Sync'in ilk sürümü kabul edilmiş olur.

Otomatik testler (sözleşme testleri, iki cihazlı senaryo matrisi, duman testi) her PR'da ve kullanıcının sunucusunda zaten geçiyor.
Bu liste onların göremediğini denetler: gerçek Android telefon (kamera, uçak modu, arka plana alma, pil), gerçek pencere ve klavye, gerçek internet bağlantısı.

## 0. Okumadan önce

### 0.1 Birkaç terim

| Terim              | Anlamı                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu             | cPanel hosting'inizdeki Pisi senkron sunucusu. Dosyalarınızın yalnız **şifreli** kopyasını tutar; içeriği, dosya adlarını göremez.     |
| Alan               | Sunucuda bir Pisi projesine ayrılan bölüm. Masaüstü açar.                                                                              |
| Eşleştirme         | Telefonun (ya da başka bir bilgisayarın) alana katılması. Şifreleme anahtarı bu sırada masaüstünden telefona geçer; sunucu onu görmez. |
| Kurulum anahtarı   | Sunucuyu kurarken ürettiğiniz gizli değer (`config.php`'ye yalnız özeti yazıldı). Yalnız yeni alan açarken sorulur.                    |
| Tur                | Bir senkron denemesi: sunucudaki yenilikleri al, buradakileri gönder.                                                                  |
| Çakışma kopyası    | Aynı paragraf iki cihazda farklı değişirse ikisinden biri kaybolmasın diye oluşan ikinci not.                                          |
| Doğrulama numarası | Kodla eşleşmede iki ekranda görünen 6 haneli sayı. Aynıysa aradaki bağlantıyı kimse değiştirmemiştir.                                  |

### 0.2 Neyi paylaşmayın

Sonuçları ve sorunları yazarken **sunucu adresinizi, kurulum anahtarını, eşleştirme kodunu ve QR kodunun fotoğrafını** paylaşmayın.
Ekran görüntüsünde bunlar görünüyorsa üstünü karalayın. Cihaz modeli, Android sürümü, saat ve dosya adları paylaşılabilir.

### 0.3 Telefon ne zaman eşitler?

Telefon arka planda kendi kendine eşitlemez (bu ilk sürümün bilinçli sınırı, `docs/sync-plan.md` §5). Telefonda tur şu anlarda çalışır:

- uygulama açılınca,
- uygulamaya geri dönünce (başka uygulamadan ya da ana ekrandan),
- telefonda bir şey yazdıktan yaklaşık 3 saniye sonra,
- açık bir not kaydedilince,
- Ayarlar → Senkron → **Şimdi eşitle** ile.

Masaüstü ise proje açılınca, pencereye dönünce, yazdıktan 3 saniye sonra, pencere öndeyken dakikada bir, arka plandayken 5 dakikada bir ve **Şimdi eşitle** ile eşitler.
Bu yüzden aşağıda "masaüstünde görünür" denen yerlerde en çok bir dakika bekleyin; "telefonda görünür" denen yerlerde telefonda uygulamaya dönün ya da **Şimdi eşitle**'ye basın.

### 0.4 Bir madde geçmezse

Maddenin kutusunu boş bırakın, altına girintili bir satır ekleyin ve ne olduğunu yazın:

```text
- [ ] Telefonda görev görünür.
    - Sorun: 2 dakika bekledim, görünmedi. Şimdi eşitle'ye basınca geldi. (Pixel 7, 14:32)
```

Sonra listeye devam edin; bir sorun öteki maddeleri genelde engellemez. Çıkan sorunlar bir sonraki oturumda düzeltilir ya da `pisi-error.md`'ye yazılır.

## 1. Hazırlık

### 1.1 Sunucu güncel olmalı

Sunucu en az 18-11-2026 sürümünde olmalıdır (alan silme ve hız sınırı davranışı bu sürümle geldi).

1. cPanel → **Git Version Control** → depo → **Manage** → **Pull or Deploy** → önce **Update from Remote**, sonra **Deploy HEAD Commit** (`docs/sync-server-cpanel.md` §13).
2. cPanel **Terminal**'inde (yoksa Cron Jobs'ta tek seferlik) `php app/bin/check.php` çalıştırın: bütün satırlar `[ OK ]` olmalıdır (§8 ve §14).

### 1.2 Masaüstü uygulaması

Senkron henüz bir sürüm paketinde (kurulum dosyasında) yok; masaüstü uygulaması depodan çalıştırılır.
Duman testi için depoyu bilgisayarınıza almıştınız. O klasörde, bir komut penceresinde (Windows'ta PowerShell ya da cmd):

```bash
git checkout main
```

```bash
git pull
```

```bash
npm ci
```

```bash
npm start
```

- `git pull` deponun son hâlini indirir.
- `npm ci` uygulamanın ihtiyaç duyduğu parçaları kurar. Duman testinde kullandığınız `npm ci --ignore-scripts` Electron'u (masaüstü penceresini çizen programı) indirmez; bu yüzden burada `--ignore-scripts` **olmadan** çalıştırın. Birkaç dakika sürebilir.
- `npm start` Pisi'yi açar. Pencere kapanınca komut da biter. Sonraki açılışlarda yalnız `npm start` yeterlidir.

Hangi sürümle denediğinizi not etmek için:

```bash
git log -1 --format=%h
```

Çıkan 7 karakterlik kod (commit kimliği) aşağıdaki sonuç satırına yazılır.

### 1.3 Telefon uygulaması (test APK'sı)

Telefonda Android 8.0 ya da üstü gerekir. APK'nın nereden indirileceği ve nasıl kurulacağı `docs/mobile-qa.md` §2'dedir. Kısaca:

1. GitHub'da depo → **Actions** → soldan **Mobile** → en üstteki `main` çalıştırması → sayfanın altındaki **Pisi-mobile-apk**.
2. Listede 14 günden yeni bir `main` çalıştırması yoksa **Run workflow** → Branch: `main` → **Run workflow**; bitince (yaklaşık 15 dk) aynı yerden indirin.
3. Zip'ten çıkan APK'yı telefona kurun. APK sürüm kodunu Ayarlar → Hakkında → Uygulama sürümü satırında, parantez içinde görürsünüz.

### 1.4 Deneme projesi

Kabul sırasında bilerek çakışma kopyası oluşturulacak, not silinecek ve adı değiştirilecek. Bu yüzden **gerçek projenizin bir kopyasıyla** çalışın:

1. Dosya Gezgini'nde (Windows Explorer / Finder) proje klasörünüzü kopyalayıp yanına yapıştırın, adını ör. `Pisi Kabul` yapın.
2. Pisi'de bu kopyayı açın.
3. Kopyada şunlar yoksa ekleyin: en az bir görselli not, en az bir dosya ekli not (ör. bir PDF), bugünün günlüğü, birkaç görev (biri Quick Add ile yazılmış, biri her gün tekrar eden), bir harita.
4. Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**. Sonucu not edin (ör. "Hiç sorun bulunmadı." ya da bulgu sayısı). En sonda (§14) aynı denetimle karşılaştırılacak.

Telefonda Pisi'nin şu an tuttuğu veriler §4'te "kenara konacak". Telefonda önemli bir şey varsa önce masaüstüne elle aktarın.

### 1.5 Sonuç satırı

Cihaz: · Android sürümü: · APK sürüm kodu: · Masaüstü işletim sistemi: · Masaüstü commit: · Sunucu PHP / MariaDB: · Tarih:

**Sonuç:** henüz uygulanmadı.

## 2. Sunucu

- [x] Bilgisayarda `curl -s https://<sunucu adresiniz>/v1/info` yanıtı `{"service":"pisi-sync","protocol":{"min":1,"max":1,…` ile başlar (`docs/sync-server-cpanel.md` §11).
- [x] Aynı sayfa telefonun tarayıcısında (Chrome) açılınca da aynı yanıt görünür; tarayıcı sertifika uyarısı vermez.
- [x] `cd ~ && /opt/alt/php84/usr/bin/php ~/pisi-sync/app/bin/check.php` bütün satırlarda `[ OK ]` yazar (§1.1).

## 3. Masaüstünde alan açma ve ilk yükleme

- [x] Ayarlar → **Senkron** bölümünde açıklama metni ("Projeyi kendi Pisi senkron sunucunuz üzerinden …") ve **Yeni senkron alanı aç** görünür.
- [ ] Sunucu adresi `http://` ile girilince "Sunucu adresi https:// ile başlamalı." uyarısı çıkar, alan açılmaz.
      Hata çıkıyor ama alt katmanda kaldığı için gözükmüyor.
- Yanlış kurulum anahtarını **bilerek denemeyin**: sunucu yanlış denemeden sonra o internet bağlantısından alan açmayı bir saat kilitler (bu davranış otomatik testlerde sınanır). Yanlışlıkla yanlış girerseniz "Kurulum anahtarı yanlış." görünür; bir saat sonra doğru anahtarla yeniden deneyin.
- [x] Doğru adres ve anahtarla **Alan aç ve projeyi yükle**: "Senkron alanı açıldı; proje yükleniyor." görünür, ilerleme satırı "Yükleniyor … dosya" diye sayar.
- [x] Yükleme sürerken **Durdur**: "Senkron durduruldu; "Sürdür" ile kaldığı yerden devam eder." yazar. **Sürdür** ile kaldığı yerden devam eder ve biter. (Proje küçükse yükleme bir iki saniyede biter ve Durdur görünmeyebilir; o zaman bu maddenin yanına "proje küçük, denenemedi" yazın.)
- [x] Yükleme bitince durum satırında "Son senkron: <saat>" yazar.
- [x] **Senkron edilmeyen dosyalar** listesi boştur ya da yalnız beklediğiniz dosyaları gösterir (ör. 64 MB'tan büyük bir dosya). Listede bir not ya da görsel varsa adını yazın.
- [x] **Cihazlar** listesinde yalnız bu bilgisayar görünür: "<ad> · masaüstü · bu cihaz".
- [x] Pisi'yi kapatıp `npm start` ile yeniden açın, aynı projeyi açın: Ayarlar → Senkron'da **Bağlı alan** görünür, yeniden alan açmak istenmez.
- [x] Yükleme ve tur sırasında açık not kapanmaz, sekmeler yerinde kalır, ağaç (Gezgin) baştan yüklenmez.

## 4. QR ile eşleştirme ve "kenara koy"

Telefonda bir proje varken eşleşmeyi dener. Telefonda veri yoksa önce Ayarlar → Geliştirici → **Örnek proje yükle**'ye basın; Pisi sekmesinde bugünün günlüğüne "telefondaki eski günlük" yazın.

- [ ] Masaüstünde Ayarlar → Senkron → **Cihaz eşleştir**: pencerede QR kodu, `XXXX-XXXX` biçiminde kısa kod, geri sayan "Kalan süre" ve "Telefon bekleniyor…" görünür.
- Eşleşme tamamlandı ancak pencere ayarlar penceresinin altında çıkıyor.
- [x] Pencereyi **×** ile kapatın, sonra telefonda bu kısa kodla bağlanmayı deneyin (Ayarlar → Senkron → **Masaüstüyle eşleştir** → **Kodla bağlan**): "Kod bulunamadı ya da süresi doldu. …" yazar. Kapanan pencerenin kodu kullanılamaz.
- [x] Masaüstünde yeniden **Cihaz eşleştir**. Telefonda **Masaüstüyle eşleştir**; "Bu cihazın adı" alanına telefonunuza bir ad verin (ör. "Pixel").
- [x] **QR kodu okut**: telefon kamera izni ister. İzin verince "Masaüstündeki QR kodunu çerçeveye alın" ekranı açılır ve QR okunur.
- [x] Telefon "Telefonda bir proje var" diye sorar: **Telefondakileri projeye ekle** ve **Telefondakileri kenara koy** seçenekleri açıklamalarıyla görünür. **Telefondakileri kenara koy**'u seçin.
- [x] Telefonda "Masaüstünde bu telefonun bağlanmasını onaylayın." görünür. Masaüstünde "<telefonun adı> bağlanmak istiyor", "Rol: Telefon (silme yapamaz)" ve "Bu cihazı tanıyorsanız onaylayın." yazar; doğrulama numarası **görünmez** (QR yolu kendini doğrular).
- [x] Masaüstünde **Onayla**: masaüstünde "Cihaz eşleştirildi.", telefonda "Bağlandı" ve "Bu telefon "<proje adı>" projesine bağlandı. İlk senkron başladı." görünür.
- [x] Telefonda "Telefondaki proje kenara kondu; Ayarlar → Proje'de görünür." yazar. Ayarlar → Proje'de **Kenara konan proje** satırı `default-oncesi-<tarih>` adıyla görünür.
- [x] Masaüstündeki **Cihazlar** listesinde telefon "<ad> · telefon · son görülme <saat>" olarak görünür.

## 5. Telefonda ilk indirme

- [x] Proje büyükse telefonda Ayarlar → Senkron'da "İniyor: n / m dosya" ilerlemesi görünür (10 dosyadan az inen turda ilerleme gösterilmez).
- [x] İndirme sürerken Pisi sekmesi açılır ve bugünün görevleri ve günlüğü, notlar inmeden önce görünür.
- [x] İndirme bitince Ayarlar → Senkron'da proje adı (masaüstündeki proje adı), **Durum: Eşit** ve **Son senkron** saati yazar.
- [x] Ayarlar → Proje'deki görev, not, günlük ve harita sayıları masaüstündekiyle aynıdır. Bütünlük satırı "Sorun yok" yazar.
- [x] Örnek projenin notları ve "telefondaki eski günlük" telefondaki projede **yoktur** (kenara kondu), masaüstündeki projede de **yoktur**.
- [x] Notlar sekmesinde masaüstünün notları, Haritalar sekmesinde masaüstünün haritası görünür; bir not açılınca metni masaüstündekiyle aynıdır.
- [x] Görselli bir not açılınca önce "Görsel iniyor…" görünür, sonra görsel gelir.
- [x] Uygulamayı son uygulamalardan kapatıp yeniden açın: eşleşme durur, yeniden eşleştirme istenmez, notlar yeniden inmez.

## 6. Telefondan masaüstüne değişiklik

Telefonda yapın, sonra masaüstünde en çok bir dakika bekleyin.

- [x] Pisi sekmesinde "yarın 10:00 telefon görevi" ekleyin: masaüstünün görev panelinde yarına, 10:00'a tarihli görünür.
- [x] Bugünün günlüğüne "telefondan günlük satırı" yazın: masaüstünde bugünün günlüğünde görünür.
- [x] Bir notun bir paragrafını değiştirin ve geri tuşuyla çıkın: masaüstünde aynı paragraf değişir, notun başka hiçbir yeri değişmez.
- [x] Notlar sekmesinde yeni bir not oluşturun (sağ alttaki düğme), içine bir satır yazın: masaüstünün Gezgin'inde görünür ve açılır.
- [x] Masaüstünde açılmış bir görevi telefonda tamamlayın: masaüstünde tamamlanmış görünür.
- [ ] Quick Add ile yazılmış (kaynağı bir not olan) bir görevi telefonda tamamlayın. Masaüstünde görev panelini açıp kapatın, görevin kaynak notunu açıp bir harf yazıp silin ve kaydedin: görev panelinde görev **tamamlanmış kalır**. (G2'den beri not görevin durumunu taşımaz; nottaki görev bloğu da tamamlanmış görünür.)
      Bu biraz sıkıntılı görev içinde yazma değişikliği aktarılmıyor.
- [ ] Her gün tekrar eden bir görevi telefonda tamamlayın: masaüstünde yarınki tekrarı **bir kez** görünür.

## 7. Masaüstünden telefona değişiklik

Masaüstünde yapın, sonra telefonda uygulamaya dönün ya da **Şimdi eşitle**'ye basın.

- [x] Yeni bir not oluşturun ve bir satır yazın: telefonun Notlar listesinde görünür.
- [x] Var olan bir notun bir paragrafını değiştirin: telefonda aynı paragraf değişir.
- [x] Yeni bir görev ekleyin (bugüne tarihli): telefonda Pisi sekmesinde ve Görevler sekmesinde görünür.
- [ ] Bir görevi tamamlayın: telefonda tamamlanmış görünür; Takvim'de o günün noktası güncellenir.
- [x] Bugünün günlüğüne "masaüstünden günlük satırı" yazın: telefonda Pisi sekmesinin günlük alanında görünür.
- [ ] Haritada bir notun yerini değiştirin: telefonda harita açıkken **Şimdi eşitle** sonrası harita kamerayı koruyarak güncellenir.

## 8. Açık not ve imleç korunur

- [ ] **Masaüstünde yazarken:** masaüstünde bir not açın, 3. paragrafın ortasına tıklayıp ağır ağır yazmaya başlayın. Telefonda aynı notun 5. paragrafını değiştirin. Masaüstünde yazmayı bir dakika boyunca sürdürün: 5. paragraf değişir; imleç yazdığınız yerde kalır, yazdığınız metin durur, sekmeler kapanmaz, "Diskteki sürüm yüklensin mi?" diye bir soru çıkmaz.
- [ ] **Telefonda yazarken:** telefonda bir not açın ve 2. paragrafa yazmaya başlayın. Masaüstünde aynı notun 4. paragrafını değiştirin. Telefonda yazmayı sürdürün: yazılanlar kaybolmaz, imleç 2. paragrafta kalır. Yazmaya biraz ara verince (ya da geri tuşuyla çıkıp notu yeniden açınca) 4. paragraf masaüstündeki gibi olur. Bu arada "Başka cihazdan gelen bir değişiklik, yazdıklarının kaydedilmesini bekliyor." görünmesi beklenen bir durumdur.
- [ ] Masaüstünde başka bir not (aynı not değil) değişince telefonda açık olan not yeniden açılmaz, kaydırma yeri değişmez.

## 9. Çakışma kopyası

Telefonda uçak modunu açarak iki cihazın aynı anda değişiklik yapmasını taklit eder.

- [ ] **Aynı paragraf:** telefonda uçak modunu açın. Telefonda bir notun 1. paragrafının sonuna "TELEFON", masaüstünde aynı paragrafın sonuna "MASAÜSTÜ" yazın. Telefonda uçak modunu kapatıp **Şimdi eşitle**. Sonuç:
    - telefonda "Bir not iki cihazda aynı yerden değişti; 1 çakışma kopyası oluştu." bildirimi çıkar;
    - iki cihazda da asıl notun yanında "<not başlığı> (çakışma <gün>-<ay>-<yıl> <saat>.<dakika> <telefonun adı>)" adlı **tek** bir not vardır;
    - asıl notta "MASAÜSTÜ", kopyada "TELEFON" vardır; iki metin de kaybolmamıştır;
    - telefonda Ayarlar → Senkron → **Çakışma günlüğü**'nde bu not için bir satır vardır.
- [ ] **Aynı notta farklı paragraflar:** uçak modu açıkken telefonda 1., masaüstünde 3. paragrafı değiştirin; uçak modunu kapatıp eşitleyin: iki değişiklik de asıl notta durur, çakışma kopyası **oluşmaz**.
- [ ] **Aynı görev:** uçak modu açıkken telefonda bir görevi tamamlayın, masaüstünde aynı görevin başlığını değiştirin; eşitleyin: iki cihazda da görev hem tamamlanmış hem yeni başlıklıdır, kopya oluşmaz.
- [ ] **Aynı günün yeni günlüğü:** üç gün sonrasını seçin (o gün için iki cihazda da günlük olmamalı). Uçak modu açıkken telefonda Pisi sekmesinde o güne "telefon günlüğü", masaüstünde takvimde o güne tıklayıp "masaüstü günlüğü" yazın; eşitleyin: o gün için **tek** günlük vardır ve iki satır da içindedir.
- [ ] **Tekrar eden görev iki cihazda:** uçak modu açıkken her gün tekrar eden bir görevi iki cihazda da tamamlayın; eşitleyin: yarınki tekrar **bir kez** görünür.
- [ ] Çakışma kopyası masaüstünde normal bir not gibi açılır, düzenlenir ve telefonda da görünür.

## 10. Masaüstünde silme ve yeniden adlandırma

Telefon not silmez ve not adı değiştirmez; bunları yalnız masaüstü yapar.

- [ ] Masaüstünde bir notu silin (Gezgin'de sağ tık → sil): telefonda eşitleyince not listeden kalkar.
- [ ] Telefonda bir not açıkken masaüstünde o notu silin; telefonda eşitleyin: "Bu not masaüstünde silindi." görünür ve telefon not listesine döner; uygulama kapanmaz.
- [ ] Masaüstünde bir notun adını değiştirin: telefonda not yeni adıyla görünür, içeriği aynıdır, eski adlı bir not kalmaz.
- [ ] **Adı değişen not:** telefonda uçak modunu açıp bir notun paragrafını değiştirin; masaüstünde aynı notun adını değiştirin. Uçak modunu kapatıp eşitleyin: telefondaki değişiklik **yeni adlı** notta görünür (iki cihazda da); eski adlı not ya da çakışma kopyası oluşmaz.
- [ ] **Silinen not:** telefonda uçak modunu açıp bir notun paragrafını değiştirin; masaüstünde aynı notu silin. Uçak modunu kapatıp eşitleyin: telefonda yazdığınız metin bir çakışma kopyasında durur ve kopya masaüstünde de görünür; asıl not iki cihazda da silinmiştir.
- [ ] Telefonda hiçbir ekranda not silme ya da not adını değiştirme düğmesi yoktur.

## 11. Görsel ve dosya ekleri

- [ ] Masaüstünde bir nota **Görsel ekle** ile yeni bir görsel ve **Dosya ekle** ile bir PDF ekleyin. Telefonda eşitleyip notu açın: görsel "Görsel iniyor…" sonrası görünür. Dosya bloğu dosyanın adını ve boyutunu gösterir.
- [ ] Dosya bloğunda **Aç**: "Dosya iniyor…" sonrası PDF telefonun PDF görüntüleyicisinde açılır.
- [ ] **Uçak modunda yer tutucu:** masaüstünde başka bir nota görsel ve dosya ekleyin. Telefonda eşitleyin ama o notu **açmayın**. Uçak modunu açın, notu açın: uygulama kapanmaz; görselin yerinde "Görsel bağlantı gelince iner.", dosya bloğunda **Aç**'a basınca "Dosya bağlantı gelince iner." görünür ve **Yeniden dene** düğmesi vardır.
- [ ] Uçak modunu kapatın ve **Yeniden dene**'ye basın (ya da notu kapatıp açın): görsel iner ve görünür, dosya açılır.
- [ ] Uçak modunu yeniden açın ve indirdiğiniz görselin notunu açın: görsel bağlantısız da görünür (inen ek telefonda kalır).
- [ ] Telefonda inmemiş görseller Ayarlar → Proje → Bütünlük'te sorun sayılmaz ("Sorun yok").

## 12. Arka plana alma ve geri dönme

- [ ] Telefonda Pisi'yi ana ekran tuşuyla arka plana alın. Masaüstünde bir notu değiştirin. Bir dakika sonra telefonda Pisi'ye dönün: birkaç saniye içinde değişiklik görünür; açık olan sekme ve ekran değişmez, uygulama baştan açılmaz (splash görünmez).
- [ ] Telefonda Pisi'yi son uygulamalardan kapatın. Masaüstünde bir görev ekleyin. Telefonda Pisi'yi açın: Pisi ekranı çizildikten sonra görev gelir.
- [ ] Masaüstünde Pisi penceresini küçültün. Telefonda bir görev ekleyin. Masaüstünde pencereyi geri açın: görev birkaç saniye içinde görünür.
- [ ] Masaüstünde Pisi'yi kapatın, telefonda bir günlük satırı yazın, masaüstünde Pisi'yi açıp projeyi açın: satır görünür.
- [ ] Wi-Fi'den mobil veriye geçin (ya da tersi) ve telefonda bir görev yazın: görev masaüstüne gider; telefonda hata görünmez.
- [ ] Masaüstünde internet bağlantısını kesin (Wi-Fi'yi kapatın): Ayarlar → Senkron'da durum "Çevrimdışı" olur, yazmaya devam edilebilir. Bağlantı gelince bekleyen değişiklikler gider ve durum "Son senkron: <saat>" olur.

## 13. Cihaz iptali ve yeniden eşleşme

- [ ] Masaüstünde Ayarlar → Senkron → **Cihazlar** → telefon → **Cihazı iptal et**: "Bu cihazın senkron bağlantısı iptal edilsin mi? Cihazdaki dosyalar silinmez." sorulur. Onaylayınca listede telefonun yanında "iptal edildi" yazar.
- [ ] Telefonda eşitleyin: "Bu telefonun bağlantısı masaüstünden kaldırıldı. Proje dosyaları telefonda duruyor; yeniden eşleşebilirsiniz." görünür. Notlar, görevler ve günlük telefonda kalır.
- [ ] İptal edilmişken telefonda "iptal sonrası görev" diye bir görev ve günlüğe bir satır yazın: hata vermez, telefonda kalır. (Bu arada masaüstünde değişiklik yapmayın.)
- [ ] **Kodla eşleşme ve "Farklı":** masaüstünde **Cihaz eşleştir**. Telefonda **Masaüstüyle eşleştir** → **Kodla bağlan**; sunucu adresini, masaüstündeki kısa kodu ve cihaz adını girip **Bağlan**. Telefon "Telefonda bir proje var" diye sorarsa **Telefondakileri projeye ekle**'yi seçin. İki ekranda **aynı** 6 haneli doğrulama numarası görünür; telefonda "Masaüstünde de bu sayı görünüyor mu? …", masaüstünde "Bu sayı öbür cihazda da görünüyor mu?" yazar. Masaüstünde **Farklı**'ya basın: telefonda "Masaüstünde reddedildi." yazar, eşleşme olmaz.
- [ ] **Kodla eşleşme ve "Aynı":** masaüstünde yeniden **Cihaz eşleştir** (yeni kod), telefonda aynı adımlar ve yine **Telefondakileri projeye ekle**. Doğrulama numaraları aynıysa masaüstünde **Aynı**: telefonda "Bağlandı" görünür.
- [ ] Telefonda iptal sırasında yazdığınız "iptal sonrası görev" ve günlük satırı masaüstüne gelir. Telefondaki notlar masaüstünde ikinci kez oluşmaz, çakışma kopyası oluşmaz.
- [ ] Masaüstünün cihaz listesinde yeni telefon kaydı etkin, eski kayıt "iptal edildi" olarak görünür.
- [ ] **Telefondan ayrılma:** telefonda Ayarlar → Senkron → **Bu cihazın bağlantısını kaldır** → **Kaldır**: "Bağlantı kaldırıldı." görünür; masaüstündeki listede telefon "iptal edildi" olur; telefondaki dosyalar kalır. Ardından telefonu kodla ya da QR ile yeniden eşleştirin (§15'teki gözlem için eşleşmiş olmalı).

## 14. Kapanış denetimi

§2–§13 bittikten sonra, iki cihaz eşitken:

- [ ] Masaüstünde Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**: §1.4'teki sonuca göre **yeni** bir bulgu yoktur.
- [ ] Telefonda Ayarlar → Proje → Bütünlük "Sorun yok" yazar; görev, not, günlük ve harita sayıları masaüstündekiyle aynıdır.
- [ ] Sunucudan gelen her değişiklik doğrulanıp uygulanmıştır: telefonda Ayarlar → Senkron'da **Uygulanmayan değişiklikler** bölümü, masaüstünde Ayarlar → Senkron'da "Sunucudan gelen ve doğrulanamayan değişiklikler uygulanmadı" uyarısı görünmez.
- [ ] Masaüstünün **Çakışma günlüğü** ve telefonun **Çakışma günlüğü** yalnız §9 ve §10'da bilerek oluşturduğunuz çakışmaları gösterir.

## 15. Pil ve veri kullanımı (bir gün)

Telefonu bir gün boyunca Pisi'yi normal kullanarak (birkaç kez açıp görev ve günlük yazarak) eşleşmiş bırakın. Akşam şunları yazın:

- Telefon: Android Ayarlar → Uygulamalar → Pisi → **Pil** (son tam şarjdan beri yüzde; ön plan ve arka plan ayrı yazıyorsa ikisi de) ve **Mobil veri ve Wi-Fi** (ön plan / arka plan veri miktarı).
- Masaüstü: Pisi'nin gün boyu açık kaldığı süre (yaklaşık).
- Sunucu: cPanel → **Metrics** → **Bandwidth** sayfasındaki günlük kullanım (o gün başka site trafiği varsa yazın).

Değerler:

- Telefon pil: · Telefon veri: · Masaüstü açık kalma süresi: · Sunucu bant genişliği:

- [ ] Telefonda Pisi'nin arka plan pil kullanımı sıfıra yakındır (telefon arka planda eşitlemez, §0.3); pil listesinde Pisi ekranda kalma süresine göre beklenmedik bir sırada değildir.
- [ ] Görseller ve dosya ekleri dışında telefonun Pisi için günlük veri kullanımı birkaç MB'ı geçmez. (Geçerse sayıyı yazın; sorun sayılıp sayılmayacağına birlikte karar verilir.)
- [ ] Masaüstü açıkken bilgisayarın fanı ya da işlemci kullanımı Pisi yüzünden artmaz (Görev Yöneticisi'nde Pisi'nin işlemci kullanımı boştayken %1–2'nin altındadır).

## 16. Bu listede elle denenmeyenler

Aşağıdakiler sunucuyu bilerek bozmayı ya da geri almayı gerektirir; otomatik testlerde sınanır ve bu listede işaretlenmez:

- Sunucunun eski bir yedeğe dönmesi, "Sunucuyla yeniden eşleş" (senaryo matrisi 12).
- Sunucuda bozulan ya da başka dosyaya taşınan içerik (matris 13).
- Yükleme ortasında kopan bağlantı (matris 10), günlerce çevrimdışı kalan telefon ve budanan değişiklik günlüğü (matris 9).
- Hız sınırı (matris 16) ve son masaüstünün alandan ayrılıp alanı silmesi (matris 17).

Matris `scripts/sync-e2e-matrix.mjs` ile her PR'da çalışır (`sync-server.yml`, `sync-e2e-matrix` raporu); gerçek sunucu duman testi 20-11-2026'da geçti (`docs/sync-plan.md` S7).
Deneme projesiyle işiniz bittiğinde sunucudaki alanı silmek isterseniz masaüstünde **Bu cihazın bağlantısını kaldır** → "Senkron alanı silinsin mi?" → **Alanı sil ve ayrıl** yolunu kullanabilirsiniz; bu da listeye sayılmaz.

## 17. Sorun kaydı

Bir madde geçmezse §0.4'teki gibi yazın ve mümkünse şunları ekleyin (sunucu adresi ve anahtar olmadan):

- ne yaptığınız, ne beklediğiniz, ne gördüğünüz ve saat;
- ekran görüntüsü (adres ve kod karalanmış);
- masaüstü günlük dosyası: Windows'ta `%APPDATA%\Pisi\logs`, macOS'ta `~/Library/Application Support/Pisi/logs`, Linux'ta `~/.config/Pisi/logs` klasöründeki son dosya;
- telefon için USB hata ayıklama açıksa `adb logcat` çıktısı (`docs/mobile-qa.md` §5).
