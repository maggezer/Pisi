# Pisi Sync uygulama kılavuzu

Pisi Sync, proje verisini bir sunucu veritabanına taşımadan masaüstü ile Android arasında eşitler. Her iki cihaz da yerel verisini çevrimdışı kullanmaya devam eder; ortak klasörde yalnız `.pisi-sync` protokol dosyaları bulunur.

## Desteklenen klasörler

- Google Drive: Windows’ta Drive for desktop klasörü, Android’de sistem klasör seçicisindeki Google Drive sağlayıcısı.
- OneDrive: Windows’ta Dosya Gezgini’ndeki OneDrive klasörü, Android’de sistem klasör seçicisindeki OneDrive sağlayıcısı.
- Bağımsız yol: Windows ve Android’de aynı klasörü görünür kılan herhangi bir çift yönlü klasör eşitleme aracı. Android tarafının klasörü Storage Access Framework klasör seçicisinde açabilmesi gerekir.

Resmî başvuru bağlantıları: [Google Drive for desktop kurulumu](https://support.google.com/drive/answer/10838124?hl=tr), [OneDrive klasör eşitleme](https://support.microsoft.com/en-us/onedrive/sync-your-computer-s-files-and-folders-with-onedrive), [Android klasör erişimi](https://developer.android.com/training/data-storage/shared/documents-files).

Aynı Pisi proje klasörünü doğrudan iki cihaz arasında eşitlemeyin. Bunun yerine ayrı ve boş bir `Pisi Sync` klasörü oluşturun; uygulamalar kendi yerel depolarını bu klasördeki protokolle eşitlesin.

## İlk kurulum

1. Windows’ta Google Drive veya OneDrive istemcisini kurun ve oturum açın.
2. Bulut alanında boş bir `Pisi Sync` klasörü oluşturun.
3. Pisi Desktop’ta normal yerel proje klasörünüzü açın.
4. Workspace Center → Ayarlar → Cihazlar arası senkronizasyon bölümüne girin.
5. `Ortak klasör seç` ile oluşturduğunuz `Pisi Sync` klasörünü seçin. İlk senkronizasyon otomatik çalışır.
6. Android’de ilgili bulut sağlayıcı uygulamasını kurun ve aynı hesapla oturum açın.
7. Pisi Mobile → Ayarlar → Senkronizasyon → `Ortak klasör seç` yolunu izleyin.
8. Android sistem seçicisinden aynı `Pisi Sync` klasörünü seçip “Bu klasörü kullan” iznini verin.
9. İlk işlem tamamlandığında Ayarlar ekranında değişiklik, çakışma ve cihaz sayısını doğrulayın.

## Günlük kullanım

- Mobil; başlangıçta, uygulamaya geri dönüldüğünde ve yerel değişikliklerden yaklaşık iki saniye sonra eşitler.
- Masaüstü; başlangıçta, pencere yeniden odaklandığında, düzenleme/görev/property değişikliklerinden sonra ve en geç 60 saniyede bir eşitler.
- Her iki uygulamada `Şimdi senkronize et` düğmesi anlık kontrol için kullanılabilir.
- İnternet yokken çalışmaya devam edebilirsiniz. Bulut klasörü tekrar erişilebilir olduğunda Sync yeniden denenir; yerel içerik silinmez.

## Uygulamalı doğrulama

1. Masaüstünde `Sync denemesi` adlı bir node oluşturup içine `masaüstünden` yazın.
2. Masaüstünde `Şimdi senkronize et`e basın ve bulut istemcisinin dosya aktarımını bitirmesini bekleyin.
3. Mobilde `Şimdi senkronize et`e basın. Node ve içerik görünmelidir.
4. Mobilde metni `mobilden güncellendi` yapıp tekrar senkronize edin.
5. Masaüstünde tekrar senkronize edin. Aynı node güncellenmelidir.
6. Harita düğümü, görev, görev durumu, property ve kaydedilmiş görünüm için aynı gidiş-dönüşü tekrarlayın.
7. Bir node’u mobilde silin, eşitleyin, sonra masaüstünde eşitleyin. Masaüstündeki dosya kalıcı silinmek yerine `.pisi/sync-trash` altına taşınmalıdır.

## Çakışma testi

1. Her iki cihazı çevrimdışı yapın.
2. Aynı node’u iki cihazda farklı metinlerle değiştirin.
3. Önce bir cihazı, ardından diğerini çevrimiçi yapıp `Şimdi senkronize et`e basın.
4. Deterministik kazanan normal node’da kalır; kaybeden içerik `Sync çakışması - cihaz…` adlı ayrı bir node olarak görünür.

## Sorun giderme

- Klasör Android seçicide görünmiyorsa sağlayıcı uygulamasını açıp oturumu ve çevrimdışı dosya erişimini kontrol edin.
- `Klasör izni` hatasında Ayarlar’dan bağlantıyı kesin ve aynı klasörü yeniden seçin.
- Bulut istemcisi hâlâ dosya aktarıyorsa iki cihazda art arda Sync’e basmadan önce aktarımın tamamlanmasını bekleyin.
- Ortak klasördeki `.pisi-sync/manifest.json` veya `devices/` altındaki indeks/parça dosyalarını elle düzenlemeyin.
- Pisi Sync yedek yerine geçmez. Düzenli Pisi yedeği almaya devam edin.
