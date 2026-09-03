# Pisi Desktop ↔ Android ortak proje klasörü

Senkronizasyonun kaynağı okunabilir Pisi proje dosyalarıdır. Desktop ve Android aynı Google Drive/OneDrive proje kökünü kullanır; `.node`, `.map`, `nd_…` yan klasörleri ve `.pisi` authority dosyaları doğrudan bu kökte bulunur. `.pisi-sync` yalnız sürüm, silme ve çakışma metadatasıdır.

## Kurulum

1. Google Drive for desktop veya OneDrive’ı kurup oturum açın.
2. Eşlenen alanda `Pisi Projem` adlı bir klasör oluşturun ya da mevcut Pisi projenizi bütün dosya ve yan klasörleriyle buraya taşıyın.
3. Pisi Desktop’ta bu `Pisi Projem` klasörünü açın.
4. Workspace Center → Ayarlar → Cihazlar arası senkronizasyon → `Proje kökünü seç` yoluna gidin.
5. Dosya seçicide açık projenin **aynı kök klasörünü** seçin. Alt klasör veya üst klasör kabul edilmez.
6. Android’de aynı bulut hesabını açın.
7. Pisi Mobile → Ayarlar → Not çalışma klasörü → `Not çalışma klasörü seç` yoluna gidin.
8. Android sistem seçicisinde aynı `Pisi Projem` kökünü seçip **Bu klasörü kullan** onayını verin. `.pisi-sync` alt klasörünü seçmeyin.
9. Bulut aktarımını bekleyip her iki uygulamada birer kez `Şimdi senkronize et`e basın.

Android ayrı bir “tüm dosyalar” izni istemez. **Bu klasörü kullan** onayı yalnız seçilen proje köküne kalıcı okuma-yazma yetkisidir.

## Beklenen klasör

```text
Pisi Projem/
├── Not__node_….node
├── Harita__map_….map
├── nd_Harita__map_…/
├── .pisi/
│   ├── tasks.json
│   └── relationships.json
└── .pisi-sync/
    ├── manifest.json
    ├── workspace-files.json
    └── devices/
```

## Davranış

- Desktop ve mobil aynı `.node/.map` içeriklerini çift yönlü okur ve yazar.
- Desktop başlangıçta, odak değişiminde, yerel düzenlemelerden sonra ve periyodik olarak eşitler.
- Mobil başlangıçta, uygulamaya dönüşte, yerel değişikliklerden sonra ve manuel düğmeyle eşitler.
- Mobil, gerçek proje dosyalarını yazıp aynı baytları geri okumadan ve klasör listesinde görmeden başarı göstermez.
- Silmeler tombstone olarak yayılır; Desktop’ta uzaktan silinen dosya `.pisi/sync-trash/` altında kurtarılabilir.
- Eşzamanlı çevrimdışı düzenlemede deterministik kazanan kalır, diğer içerik çakışma kopyası olarak korunur.

## Kabul testi

1. Desktop’ta `Sync kabul testi` notu, bir harita ve görev oluşturun; senkronize edin.
2. Drive/OneDrive aktarımından sonra mobilde senkronize edin ve üçünü açın.
3. Mobilde not metnini, harita düğümünü ve görev durumunu değiştirin; senkronize edin.
4. Mobil Ayarlar’da gerçek dosya doğrulama sayısını ve `.node/.map` dosya kanıtını kontrol edin.
5. Desktop’ta senkronize edip üç değişikliği doğrulayın.
6. Aynı notu iki cihaz çevrimdışıyken farklı değiştirip sırayla eşitleyin; çakışma kopyası oluşmalıdır.
7. Bir notu mobilde silip iki cihazı eşitleyin; Desktop’ta `.pisi/sync-trash` kaydını doğrulayın.

## Sorun giderme

- Klasörde yalnız `.pisi-sync` görünüyor ve `.node/.map` görünmüyorsa eski ayrı aktarım klasörü seçilmiştir. Gerçek proje kökünü yeniden seçin.
- Android’de izin tekrar sorulmuyorsa kalıcı yetki hâlâ geçerlidir; mobil Ayarlar’daki izin satırını kontrol edin veya klasör iznini yenileyin.
- Sağlayıcı görünmiyorsa Drive/OneDrive uygulamasını açıp oturumu doğrulayın.
- İki cihazda manuel senkronizasyona basmadan önce bulut aktarımının bitmesini bekleyin.
- `.pisi-sync` içindeki JSON dosyalarını elle düzenlemeyin.
- Senkronizasyon yedek değildir; düzenli Pisi yedeği alın.
