# Pisi Mobile — cihaz üstünde doğrulama

Bu kontrol listesi özellikle Samsung Android cihazlarda klavye, odak, görünür alan ve dokunmatik akışları doğrulamak içindir.

## 1. Otomatik kontroller

Node.js 24 kurulu bir terminalde proje kökünden çalıştırın:

```bash
npm ci
npm run test:server
npm test
npm run build
npm run android:sync
```

`test:server`, Vite'ı yalnızca `127.0.0.1` üzerinde geçici olarak açar; giriş sayfasını, mobil stilleri ve klavye görünür-alan modülünü HTTP üzerinden denetleyip sunucuyu kapatır.

## 2. Debug APK üretme

Java 21 ve Android SDK kurulu olmalıdır.

macOS / Linux:

```bash
cd android
./gradlew assembleDebug
```

Windows:

```powershell
cd android
.\gradlew.bat assembleDebug
```

APK yolu:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

USB hata ayıklama açıksa güncelleme kurulumu:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

GitHub'daki **Android APK** iş akışı da her mobil PR'da aynı debug APK'yı üretir ve `Pisi-android-debug` adıyla 14 gün saklar.

## 3. Samsung telefon testi

Her adımda uygulamanın kapanmaması, ekranın boşalmaması ve yazı odağının beklenmedik biçimde kaybolmaması gerekir.

1. **Not başlığı ve gövdesi**
   - Bir not açın, başlığa dokunun ve en az 10 saniye yazın.
   - Klavye açık kalmalı; kayıt bildirimi görünürken başlık odağı kaybolmamalı.
   - Klavyedeki İleri/Enter tuşu gövde editörüne geçmeli.
   - Gövdede yazmaya devam edin; otomatik kayıt klavyeyi kapatmamalı.

2. **Biçim araçları ve görev kutusu**
   - Klavye açıkken Kalın, İtalik ve Liste araçlarına dokunun.
   - Klavye açık kalmalı ve seçim kaybolmamalı.
   - Görev ayrıntıları penceresini açıp İptal'e basın; imleç editöre dönmeli.

3. **Hızlı görev ve global arama**
   - Görevler ekranındaki `＋` ile hızlı görev penceresini açın.
   - İlk alan tek seferde odaklanmalı; pencere klavyenin arkasında kalmamalı.
   - Global aramayı açın, sonuç yazıp bir nota geçin.

4. **Harita düğümü**
   - Yeni harita ve yeni düğüm oluşturun.
   - Başlıkta Enter'a basınca düğüm notuna geçmeli.
   - Android geri tuşunun ilk basışı düğüm penceresini, sonraki basışı haritayı kapatmalı.

5. **Alt menü ve yön değiştirme**
   - Altta Notlar, Haritalar, Görevler, Takvim ve Ayarlar aynı satırda görünmeli.
   - Telefonu dikeyden yataya ve tekrar dikeye çevirin; içerik görünür alana oturmalı.
   - Klavye açılınca alt menü ve yeni-kayıt düğmesi gizlenmeli, klavye kapanınca geri gelmeli.

6. **Tema ve hızlı gezinme**
   - Ayarlar'da Açık/Koyu tema seçip hemen Node sistemi ekranına geçin.
   - Ekran eski sayfaya dönmemeli ve tekrar tekrar yanıp sönmemeli.

7. **Takvim ve veri bütünlüğü**
   - Takvimde bugüne dokunup günlük oluşturun.
   - Ayarlar → Node sistemi ve taşınabilirlik → Taşınabilirlik yolundan `Denetimi çalıştır` seçin.
   - Sonuç alanı önce `Denetleniyor…`, sonra sonuç göstermeli.

## 4. Senkronizasyon testi

1. Google Drive veya OneDrive Android uygulamasını kurup hesabınıza giriş yapın.
2. Pisi'de Ayarlar → Not çalışma klasörü → Not çalışma klasörü seç yolunu açın.
3. Android sistem seçicisinde masaüstünde açık olan gerçek Pisi proje kökünü seçin; `.pisi-sync` alt klasörünü seçmeyin.
4. `Bu klasörü kullan` onayından sonra Ayarlar'da `Android klasör izni: kalıcı okuma + yazma ✓` satırını doğrulayın.
5. Telefonda Türkçe karakter ve boşluk içeren başlıklı bir not oluşturup `Şimdi senkronize et` seçin.
6. Sonuçta en az bir gerçek dosyanın doğrulandığını, `Dosya kanıtı` satırında `.node` adının göründüğünü ve Drive/OneDrive klasöründe aynı dosyanın gerçekten bulunduğunu doğrulayın.
7. Bir harita ve harita düğümü oluşturun; kökte `.map`, `nd_…` yan klasöründe `.node` yazıldığını doğrulayın.
8. Masaüstünde aynı proje kökünü açın/senkronize edin ve mobil içeriğin geldiğini kontrol edin.
9. Görünür `.node` dosyasını masaüstünde silin; bulut aktarımından ve mobil senkronizasyondan sonra notun mobilde de kalktığını doğrulayın.
10. Aynı notu iki cihazda çevrimdışı değiştirerek çakışma kopyasının ve iki içeriğin korunduğunu doğrulayın.

## 5. Sorun kaydı alma

USB hata ayıklama açıkken:

```bash
adb logcat -c
adb logcat
```

Sorunu tekrar oluşturduktan sonra cihaz modeli, Android/One UI sürümü, kullanılan klavye (Samsung Keyboard veya Gboard) ve adım sırasıyla birlikte ilgili log bölümünü paylaşın.
