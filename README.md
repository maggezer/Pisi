# Pisi Android

Samsung telefonlar için sıfırdan hazırlanmış, çevrimdışı çalışan Android not ve görev uygulaması.

## Özellikler

- Mobil öncelikli alt gezinme
- Hızlı not oluşturma
- Not ekleme, düzenleme ve silme
- Görev ekleme ve tamamlandı işaretleme
- Not ve görevlerde arama
- Türkçe ve İngilizce Android kaynakları
- Verilerin telefonda çevrimdışı saklanması
- Samsung One UI ile uyumlu sistem durum ve gezinme çubukları

## Derleme

### Android Studio

Bu klasörü Android Studio ile açın ve `app` yapılandırmasını çalıştırın.

### Windows PowerShell

Android SDK yolu tanımlıysa:

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\build.ps1
```

APK yolu:

```text
app\build\outputs\apk\debug\app-debug.apk
```

## Teknik bilgiler

- Java 17
- Minimum Android 8.0 (API 26)
- Hedef Android API 35
- Harici çalışma zamanı kütüphanesi yok
- SharedPreferences içinde JSON tabanlı yerel veri deposu
