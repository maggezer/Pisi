# Pisi Mobile

Pisi’nin Android için telefon ve tablet çalışma alanı. Uygulama aynı kod tabanında ekran boyutuna göre iki görünüm kullanır:

- Telefon modu, hızlı yakalama ve tek elle kullanıma odaklanan alt menülü görünüm.
- Tablet modu, Windows sürümüne benzeyen belge ağacı, merkez çalışma alanı ve bağlamsal sağ panel.

Pisi 3.1.2; masaüstündeki node/map, first-class görev, ilişki ve property sözleşmelerini kullanır. Bağlanan çalışma klasöründeki okunabilir `.node/.map` dosyaları asıl veridir; IndexedDB çevrimdışı çalışma kopyasıdır. Google Drive, OneDrive veya Android sistem klasör seçicisinde görünen başka bir çift yönlü klasör sağlayıcısı kullanılabilir.

## Özellikler

- Global arama, hızlı geçiş, backlink, bağlantısız bahsetme ve harita sonucuna gitme
- Global Quick Add, Inbox, Bugün/Yaklaşan, Türkçe tarih, erteleme, görev süresi ve görev bağımlılıkları
- Markdown WYSIWYG blok editörü, `/todo`, `/done`, blok referansı ve görev checkbox’ı
- Node özellikleri, relation/rollup temeli, tablo/kart görünümleri, kaydedilen filtreler ve şablonlar
- Markdown/HTML içe aktarma; Markdown, PDF, HTML ve DOCX dışa aktarma
- Yerel sürüm geçmişi, sürüm geri yükleme, bütünlük denetimi ve Pisi 3 yedeği
- Masaüstüyle uyumlu node/map kimlikleri, first-class görevler ve property tipleri
- Gerçek Pisi proje köküne `.node/.map` yazan ve geri okuyarak doğrulayan otomatik/manüel senkronizasyon
- Deterministik sürüm birleştirme, tombstone silme ve içerik kaybetmeyen çakışma kopyaları
- Mantıksal, metin, matematik ve bilimsel hesap tablosu formülleri
- Dış klavye kısayolları ve büyük veri için önceden oluşturulan arama indeksi

## Gereksinimler

- Node.js 22.12 veya üzeri
- Android Studio 2025.2.1 veya üzeri
- Android SDK 36

## Geliştirme

```bash
npm install
npm run dev
```

Test ve üretim derlemesi:

```bash
npm run test:server
npm test
npm run build
```

## Android

```bash
npm install
npm run android:sync
npm run android:open
```

Android Studio’da cihaz veya emülatör seçip **Run** düğmesine basın. Komut satırından `npm run android:run` da kullanılabilir.

`mobile5` dalına gönderilen commit’lerde ve `mobile5` hedefli pull request’lerde Android APK iş akışı testleri çalıştırır ve `Pisi-android-debug` artifact’ini üretir.

Klavye, dokunmatik akışlar, APK kurulumu ve Samsung cihaz kontrol listesi için [mobil doğrulama kılavuzuna](docs/mobile-qa.md) bakın. Ortak klasör kurulumu için [Pisi Sync uygulama kılavuzu](docs/pisi-sync-guide-tr.md) ayrıntılı adımları içerir.
