# Pisi Mobile

Pisi’nin Android için telefon ve tablet çalışma alanı. Uygulama aynı kod tabanında ekran boyutuna göre iki görünüm kullanır:

- Telefon modu, hızlı yakalama ve tek elle kullanıma odaklanan alt menülü görünüm.
- Tablet modu, Windows sürümüne benzeyen belge ağacı, merkez çalışma alanı ve bağlamsal sağ panel.

Veriler cihazdaki IndexedDB alanında çevrimdışı tutulur. Önceki uygulama kimliği, veritabanı ve yedek sözleşmesi korunmaz; bu dal temiz Pisi 3 veri modeliyle çalışır.

## Özellikler

- Global arama, hızlı geçiş, backlink, bağlantısız bahsetme ve harita sonucuna gitme
- Global Quick Add, Inbox, Bugün/Yaklaşan, Türkçe tarih, erteleme ve görev süresi
- Markdown WYSIWYG blok editörü, `/todo`, `/done`, blok referansı ve görev checkbox’ı
- Node özellikleri, relation/rollup temeli, tablo/kart görünümleri, kaydedilen filtreler ve şablonlar
- Markdown/HTML içe aktarma; Markdown, PDF, HTML ve DOCX dışa aktarma
- Yerel sürüm geçmişi, sürüm geri yükleme, bütünlük denetimi ve Pisi 3 yedeği
- Web/DOI kaynak node’ları, bibliyografya alanları ve içerik alıntılama
- Güvenilir uygulama içi eklenti API’si ve altı uzantı noktası
- Yerel Team provider API’si ve değişiklik günlüğü
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

`mobile5` ve `agent/pisi-mobile-responsive` dallarına gönderilen commit’lerde Android APK iş akışı testleri çalıştırır ve `Pisi-android-debug` artifact’ini üretir.
