# Pisi ortak proje klasörü kılavuzu

Pisi Mobile 3.1.2’den itibaren seçilen klasör ayrı bir aktarım kutusu değil, **gerçek Pisi proje köküdür**. `.node` ve `.map` dosyaları, harita yan klasörleri ile `.pisi/tasks.json` ve `.pisi/relationships.json` doğrudan bu klasöre yazılır. Telefonun yerel veritabanı çevrimdışı çalışma kopyasıdır; okunabilir proje dosyaları asıl veridir.

Klasörde ayrıca `.pisi-sync` bulunur. Bu gizli alan yalnız cihaz sürümleri, silme kayıtları ve çakışma birleştirme bilgilerini taşır. Not içeriğinin tek kopyası olarak kullanılmaz.

## Doğru klasör düzeni

```text
Pisi Projem/
├── Toplantı Notu__node_….node
├── Yol Haritası__map_….map
├── nd_Yol Haritası__map_…/
│   └── Harita Düğümü__node_….node
├── .pisi/
│   ├── tasks.json
│   ├── relationships.json
│   └── properties.json
├── .pisi-views.json
├── .pisi-templates.json
└── .pisi-sync/
    ├── manifest.json
    ├── workspace-files.json
    └── devices/
```

Android’de `Pisi Projem` klasörünü seçin. `.pisi-sync` alt klasörünü seçmeyin.

## Android izni neden ayrı açılır pencere göstermiyor?

Pisi, Android’in Storage Access Framework klasör seçicisini kullanır. Bu modelde uygulama “tüm dosyalara erişim” izni istemez. Sistem seçicisinde **Bu klasörü kullan** düğmesine basmanız, yalnız seçtiğiniz klasör için kalıcı okuma ve yazma yetkisidir.

Ayarlar ekranında şu kanıtları birlikte görmelisiniz:

- `Android klasör izni: kalıcı okuma + yazma ✓`
- Son işlemde doğrulanan gerçek dosya sayısı
- Yazılıp geri okunan örnek `.node/.map` dosya adları

Uygulama bir gerçek proje dosyasını yazıp aynı içeriği geri okuyamaz veya klasör listesinde göremezse artık “senkronize edildi” sonucu vermez.

## Google Drive / OneDrive kurulumu

1. Windows’ta Google Drive for desktop veya OneDrive’ı kurup oturum açın.
2. Eşlenen alan içinde `Pisi Projem` gibi tek bir proje klasörü oluşturun.
3. Pisi Desktop’ta bu klasörü proje olarak açın. Mevcut projeniz varsa bütün `.node/.map`, `nd_…` yan klasörleri ve `.pisi` verileriyle birlikte bu konuma taşıyın.
4. Desktop’ta Cihazlar arası senkronizasyon bölümünde ortak klasör olarak **aynı proje kökünü** seçin.
5. Android’de aynı bulut sağlayıcısının uygulamasını kurup aynı hesapla oturum açın.
6. Pisi Mobile → Ayarlar → Not çalışma klasörü → `Not çalışma klasörü seç` yolunu açın.
7. Sistem seçicisinde aynı `Pisi Projem` klasörüne girin ve **Bu klasörü kullan** seçeneğini onaylayın.
8. İlk işlem bittikten sonra kalıcı okuma-yazma iznini ve doğrulanan gerçek dosya sayısını kontrol edin.
9. Drive/OneDrive aktarımının tamamlanmasını bekleyip iki uygulamada birer kez `Şimdi senkronize et`e basın. Proje kimlikleri aynı olmalıdır.

Google Drive/OneDrive yerine, aynı klasörü Windows ve Android sistem klasör seçicisinde çift yönlü görünür kılan başka bir araç da kullanılabilir.

## Eski ayrı `Pisi Sync` klasöründen geçiş

Önceki APK ile boş bir `Pisi Sync` aktarım klasörü seçtiyseniz o klasörde yalnız `.pisi-sync` kayıtları bulunabilir. Şunlardan birini yapın:

1. Önerilen yol: Mobilde bağlantıyı kesin ve masaüstünde açık olan gerçek proje kökünü yeniden seçin.
2. Alternatif: Masaüstü projesinin tüm görünür `.node/.map` dosyalarını, `nd_…` klasörlerini ve `.pisi` authority dosyalarını eski ortak klasöre taşıyıp artık bu klasörü doğrudan proje olarak açın.

Yalnız `.pisi-sync` alt klasörünü seçmeyin ve iki farklı proje kökü kullanmayın.

## Uygulamalı gidiş-dönüş testi

1. Masaüstünde `Sync denemesi` adlı bir not oluşturup `masaüstünden` yazın.
2. Bulut aktarımını bekleyin; mobilde `Şimdi senkronize et`e basın. Not ve içerik görünmelidir.
3. Mobilde içeriği `mobilden güncellendi` yapıp tekrar senkronize edin.
4. Ayarlar’da en az bir gerçek dosyanın doğrulandığını ve dosya kanıtında `.node` adını gördüğünüzü kontrol edin.
5. Drive/OneDrive dosya görünümünde aynı `.node` dosyasını açıp yeni metnin JSON içeriğinde bulunduğunu doğrulayın.
6. Masaüstünde senkronize edin; aynı not güncellenmelidir.
7. Harita düğümü ve görev için aynı gidiş-dönüşü tekrarlayın. Harita `.map`, düğümü de `nd_…` altında `.node` olarak görünmelidir.
8. Bir not dosyasını masaüstünde silip bulut aktarımını bekleyin. Mobil senkronizasyonunda aynı not kaldırılmalıdır. Protokol silme kaydını korur.

## Çakışma testi

1. İki cihazı çevrimdışı yapın.
2. Aynı notu iki cihazda farklı içerikle değiştirin.
3. Önce bir cihazı, ardından diğerini çevrimiçi yapıp senkronize edin.
4. Deterministik kazanan normal notta kalır; kaybeden içerik `Sync çakışması - cihaz…` adlı ayrı bir not olarak korunur.

## Sorun giderme

- Klasör seçici açıldığında dosya seçmeyin; proje klasörünün içindeyken **Bu klasörü kullan** düğmesine basın.
- Güncellemeden sonra izin penceresi tekrar çıkmıyorsa önceki klasör yetkisi hâlâ kalıcıdır. Ayarlar’da `kalıcı okuma + yazma ✓` görünür. Yetkiyi yenilemek için `Klasör iznini yenile / değiştir` düğmesini kullanın.
- `0 gerçek dosya doğrulandı` sonucu yalnız projede hiç not veya harita yoksa normaldir. Not varken sıfır görünmesi hatadır.
- Dosya içeriği geri okunamıyorsa Drive/OneDrive uygulamasını açıp hesabı ve çevrimiçi erişimi doğrulayın; ardından klasör iznini yenileyin.
- Klasörde `.node/.map` yerine yalnız `.pisi-sync` görüyorsanız eski APK kullanıyorsunuz veya yanlışlıkla alt protokol klasörünü seçtiniz.
- `.pisi-sync/manifest.json`, `workspace-files.json` ya da `devices/` içeriğini elle düzenlemeyin.
- İki cihazda art arda senkronizasyona basmadan önce bulut sağlayıcısının dosya aktarımını bitirmesini bekleyin.
- Pisi Sync yedek yerine geçmez; düzenli proje yedeği almaya devam edin.
