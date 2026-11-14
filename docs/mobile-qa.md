# Pisi Mobil — test APK'sı ve cihazda doğrulama

Bu belge Pisi Mobil'in (Android) nasıl derlendiğini, test APK'sının telefona nasıl kurulduğunu ve cihazda neyin denetlendiğini anlatır. Fazlar ilerledikçe §4'teki liste genişler (`docs/mobile-plan.md` M10).

## 1. Otomatik kontroller

Node.js 24 ile, depo kökünden:

```bash
npm --prefix mobile ci
npm --prefix mobile run validate   # biçim, lint, i18n, yapı, birim testleri, derleme
npm --prefix mobile run e2e        # Playwright: Pixel 7 görünümü, açık ve koyu tema
npm --prefix mobile run audit
```

E2E ekran görüntülerini `mobile/e2e/screenshots/` altına yazar. CI aynı görüntüleri `pisi-mobile-screens` adıyla saklar.

## 2. Test APK'sı

**Mobile** iş akışı (`.github/workflows/mobile.yml`), `mobile/` ya da `shared/` klasörüne dokunan her PR'da bir test APK'sı üretir ve `Pisi-mobile-apk` adıyla 14 gün saklar.

1. PR'ın **Checks** sekmesinden **Mobile** çalıştırmasını açın ve `Pisi-mobile-apk` dosyasını indirin.
2. Zip'ten çıkan APK'yı telefona kurun. USB hata ayıklama açıksa:

    ```bash
    adb install -r Pisi-mobile-0.1.0-<sürüm kodu>.apk
    ```

3. Eski `com.maggezer.pisi` test uygulaması telefonda duruyorsa kaldırın; yeni uygulamanın kimliği `com.mumin.pisi`'dir.

Her çalıştırmanın sürüm kodu bir öncekinden büyüktür. Bu yüzden yeni APK, aynı anahtarla imzalandığı sürece eskisinin üzerine kurulur ve telefondaki veriler kalır.

### Sabit test anahtarı

Android, kurulu bir uygulamayı ancak aynı anahtarla imzalanmış bir APK ile günceller. Anahtar tanımlı değilse iş akışı APK'yı yine üretir, ama özetinde **"Bu APK güncelleme olarak kurulamaz"** uyarısını gösterir: o APK'yı kurmak için telefondaki Pisi'yi kaldırmak gerekir ve verisi silinir.

Anahtar bir kez üretilir ve depo secret'ı olarak eklenir:

```bash
keytool -genkeypair -v \
  -keystore pisi-test.keystore -storetype PKCS12 \
  -alias pisi-test -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Pisi Test, O=Pisi"

base64 -w 0 pisi-test.keystore > pisi-test.keystore.base64   # macOS: base64 -i pisi-test.keystore -o pisi-test.keystore.base64
```

GitHub'da **Settings → Secrets and variables → Actions → New repository secret** ile dört secret eklenir:

| Secret                                | Değer                                                     |
| ------------------------------------- | --------------------------------------------------------- |
| `PISI_ANDROID_TEST_KEYSTORE_BASE64`   | `pisi-test.keystore.base64` dosyasının içeriği            |
| `PISI_ANDROID_TEST_KEYSTORE_PASSWORD` | `keytool`'un sorduğu keystore parolası                    |
| `PISI_ANDROID_TEST_KEY_ALIAS`         | `pisi-test`                                               |
| `PISI_ANDROID_TEST_KEY_PASSWORD`      | anahtar parolası (PKCS12'de keystore parolasıyla aynıdır) |

`pisi-test.keystore` dosyasını güvenli bir yerde saklayın ve depoya eklemeyin. Dosya kaybolursa yeni bir anahtar üretilir ve telefondaki uygulama bir kez kaldırılıp yeniden kurulur. Bu bir test anahtarıdır; mağaza yayını için kullanılmaz.

## 3. Yerelde derleme

Java 21 ve Android SDK (platform 36, build-tools 36) kurulu olmalıdır.

```bash
npm --prefix mobile run android:sync      # web derlemesi + cap sync android
cd mobile/android
./gradlew assembleDebug                   # Windows: .\gradlew.bat assembleDebug
```

APK yolu: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Sabit anahtarla imzalamak için derlemeden önce şu ortam değişkenleri verilir: `PISI_ANDROID_TEST_KEYSTORE_FILE` (keystore dosyasının yolu), `PISI_ANDROID_TEST_KEYSTORE_PASSWORD`, `PISI_ANDROID_TEST_KEY_ALIAS`, `PISI_ANDROID_TEST_KEY_PASSWORD`. Sürüm kodu `PISI_ANDROID_VERSION_CODE` ile verilir; verilmezse `1` olur.

Android Studio ile açmak için: `npm --prefix mobile run android:open`.

## 4. Cihazda kabul listesi

Her adımda uygulama kapanmamalı ve ekran boş kalmamalıdır.

1. **Açılış**
    - Uygulamayı son uygulamalardan kapatıp yeniden açın: Pisi ekranı bugünün tarihiyle gelmeli.
    - Başka bir sekmedeyken ana ekrana çıkıp uygulamaya dönün: kaldığınız sekme açık olmalı.
2. **Sekmeler ve Ayarlar**
    - Alt menüde Pisi, Görevler, Notlar, Takvim ve Haritalar tek satırda, etiketleriyle görünmeli.
    - Başlıktaki **Ayarlar** düğmesi Ayarlar ekranını açmalı.
3. **Android geri tuşu** (hareketle geri dahil)
    - Ayarlar → Tema penceresi açıkken geri: yalnız pencere kapanmalı.
    - Ayarlar ekranında geri: önceki sekmeye dönülmeli.
    - Pisi dışındaki bir sekmede geri: Pisi sekmesine gidilmeli.
    - Pisi sekmesinde geri: uygulama arka plana alınmalı, kapanmamalı. Yeniden açınca soğuk açılış ekranı (splash) görünmemeli.
4. **Tema ve sistem çubukları**
    - Ayarlar → Tema: Sistem, Açık ve Koyu seçenekleri hemen uygulanmalı ve uygulama yeniden açılınca korunmalı.
    - "Sistem" seçiliyken telefonun koyu modunu değiştirin: uygulama izlemeli.
    - Durum çubuğundaki saat ve simgeler her temada okunmalı; başlık çentiğin ya da durum çubuğunun altında kalmamalı, alt menü hareket çubuğuyla çakışmamalı.
5. **Dil**
    - Ayarlar → Dil: English seçilince bütün metinler değişmeli, Türkçe'ye dönülebilmeli.
6. **Yazı boyutu ve yön**
    - Android yazı boyutunu en büyüğe alın: sekme etiketleri kesilmemeli, yatay kaydırma oluşmamalı.
    - Telefonu yatay çevirip geri alın: düzen bozulmamalı.

## 5. Sorun kaydı alma

USB hata ayıklama açıkken:

```bash
adb logcat -c
adb logcat
```

Sorunu yeniden oluşturduktan sonra cihaz modelini, Android sürümünü, APK'nın sürüm kodunu ve adımları ilgili log bölümüyle birlikte paylaşın. Test APK'sında WebView, Chrome'un `chrome://inspect` sayfasından incelenebilir.
