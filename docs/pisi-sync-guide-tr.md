# Pisi Desktop ↔ Android senkronizasyonu

Pisi Sync yerel-önceliklidir. Desktop `.node`, `.map` ve `.pisi` proje kayıtlarını; Android ise IndexedDB kayıtlarını kaynak olarak kullanmaya devam eder. Ortak klasörde sadece sağlayıcıdan bağımsız `.pisi-sync` anlık görüntüleri tutulur.

## Kurulum

1. Windows’ta Google Drive for desktop veya OneDrive’ı kurup oturum açın.
2. Bulut alanında boş bir `Pisi Sync` klasörü oluşturun.
3. Pisi Desktop’ta yerel Pisi projenizi açın.
4. Workspace Center → Ayarlar → Cihazlar arası senkronizasyon → `Ortak klasör seç` yoluyla bu klasörü seçin.
5. Android’de aynı sağlayıcı hesabını açın.
6. Pisi Mobile → Ayarlar → Senkronizasyon → `Ortak klasör seç` yoluna gidin.
7. Android’in sistem klasör seçicisinden aynı klasörü seçip kalıcı okuma/yazma izni verin.
8. Her iki cihazda `Şimdi senkronize et`e birer kez basın.

OneDrive/Google Drive zorunlu değildir. Windows ve Android’de aynı klasörü görünür kılan, Android Storage Access Framework ile seçilebilen başka bir çift yönlü klasör aracı da kullanılabilir.

Resmî başvuru bağlantıları: [Google Drive for desktop kurulumu](https://support.google.com/drive/answer/10838124?hl=tr), [OneDrive klasör eşitleme](https://support.microsoft.com/en-us/onedrive/sync-your-computer-s-files-and-folders-with-onedrive), [Android klasör erişimi](https://developer.android.com/training/data-storage/shared/documents-files).

## Otomatik çalışma

- Desktop başlangıç, pencere odağı, düzenleme tetikleyicileri ve 60 saniyelik kontrol ile eşitler.
- Android başlangıç, resume ve yerel değişikliklerden yaklaşık 1,8 saniye sonra eşitler.
- Sağlayıcı çevrimdışıyken yerel çalışma devam eder. Bir sonraki başarılı deneme değişiklikleri birleştirir.

## Veri ve güvenlik davranışı

- Node, map, first-class görev, semantic ilişki, property schema, kayıtlı görünüm ve şablonlar eşitlenir.
- Silmeler sürümlü tombstone olarak yayılır.
- Desktop’ta uzaktan silinen proje dosyası kalıcı silinmez; `.pisi/sync-trash/<zaman>/` altına taşınır.
- Aynı kayıt iki cihazda çevrimdışıyken değişirse Lamport sürümüyle deterministik kazanan seçilir, kaybeden içerik `Sync çakışması - cihaz…` kopyası olarak korunur.
- Her cihaz yalnız kendi `devices/<deviceId>/` indeks ve parça kümesini yazar; iki cihaz aynı uzak anlık görüntüyü eşzamanlı yazmaz.
- Dosyalar geçici dosya + atomik rename ile yayımlanır. Manifest proje kimliğini ve protokol sürümünü doğrular.

## Beş dakikalık kabul testi

1. Desktop’ta `Sync kabul testi` node’u, bir harita ve bir görev oluşturup Sync’e basın.
2. Bulut istemcisinin aktarımı bitince mobilde Sync’e basın; üçünü de açın.
3. Mobilde node metnini, harita düğümünü ve görev durumunu değiştirip Sync’e basın.
4. Desktop’ta Sync’e basın ve üç değişikliği doğrulayın.
5. Aynı node’u iki cihaz çevrimdışıyken farklı düzenleyin; cihazları sırayla çevrimiçi yapıp eşitleyin. Normal node yanında bir çakışma kopyası oluşmalıdır.
6. Mobilde test node’unu silip iki cihazı eşitleyin. Desktop’ta `.pisi/sync-trash` kurtarma kaydını doğrulayın.

## Sorun giderme

- `Ortak klasör bağlı değil`: doğru projeyi açın ve Ayarlar’dan klasörü yeniden seçin.
- Android’de sağlayıcı görünmüyor: sağlayıcı uygulamasını açın, oturumu doğrulayın ve sistem Dosyalar uygulamasına dönün.
- Değişiklik gelmiyor: bulut istemcisinin aktarım durumunu bekleyip iki cihazda manuel Sync çalıştırın.
- `.pisi-sync` içindeki JSON dosyalarını elle düzenlemeyin.
- Sync yedek değildir; Pisi’nin yedek özelliğini ayrıca kullanın.
