# KEDI Mobile

KEDI'nin Android için mobil sürümü. Notlar, çizimler, hesap tabloları, zihin
haritaları ve takvim günlükleri cihazda çevrimdışı çalışır.

## Gereksinimler

- Node.js 22 veya üzeri
- Android Studio 2025.2.1 veya üzeri
- Android SDK 36

## Web geliştirme

```bash
npm install
npm run dev
```

## Android

```bash
npm install
npm run android:sync
npm run android:open
```

Android Studio açıldığında bir cihaz/emülatör seçip **Run** düğmesine basın.
Komut satırından çalıştırmak için `npm run android:run` kullanılabilir.

`mobile` branch'ine gönderilen her commit için **Android APK** GitHub Actions
iş akışı testleri çalıştırır ve kurulabilir bir debug APK üretir. Dosya,
iş akışının **Artifacts** bölümünden `KEDI-android-debug` adıyla indirilebilir.

## Veri

Uygulama verileri cihazdaki WebView/IndexedDB alanında tutulur. Ayarlar
sayfasındaki **Yedek oluştur** ve **Yedeği geri yükle** seçenekleriyle tüm
veriler tek bir JSON dosyasına aktarılabilir.
