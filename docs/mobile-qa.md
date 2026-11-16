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

Bileşen galerisi yalnız geliştirme sunucusunda açılır: `npm --prefix mobile run dev` çalışırken adresin sonuna `?gallery` ekleyin. Galerinin açık ve koyu görüntüleri de aynı artifact'tadır (`20-gallery.png`).

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
    - Pisi sekmesinde alt menü görünmemeli; sol alttaki menü düğmesi Görevler, Notlar, Takvim, Haritalar ve Ayarlar'ı ikon ve adlarıyla listelemeli. Her ekran iki dokunuşla açılmalı.
    - Öteki sekmelerde alt menüde Pisi, Görevler, Notlar, Takvim ve Haritalar tek satırda, etiketleriyle görünmeli.
    - Bu sekmelerde başlıktaki **Ayarlar** düğmesi Ayarlar ekranını açmalı.
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

### Pisi sekmesi (M5)

Önce Ayarlar → Geliştirici → "Örnek proje yükle" ile örnek veriyi yükleyin.

- [ ] Başlıkta seçili gün "Cumartesi, 14 Kasım" biçiminde yazar; bugünse yanında "Bugün" etiketi vardır.
- [ ] **Tarih çarkı** (sağ alt köşe): parmakla kaydırınca günler akar ve hafif titreşim hissedilir; ortada duran gün seçilir. Bir güne dokunmak da onu seçer.
- [ ] Çarkta bugün çerçeveli, seçili gün dolu görünür; görevi olan günlerde dolu, günlüğü olan günlerde halka nokta vardır. Ay etiketi Türkçede "Kas", İngilizcede "Nov" yazar.
- [ ] İçerik alanında sağa/sola kaydırmak günü değiştirir; yukarı/aşağı kaydırmak yalnız sayfayı kaydırır. Günlük alanına yazarken kaydırma günü değiştirmez.
- [ ] Başlığa dokununca tarih seçici açılır; başka bir gün seçilince kapanır. Başka gündeyken "Bugüne dön" görünür ve bugüne getirir.
- [ ] **Günlük:** boşken "Bugün neler oldu?" ipucu görünür. Yazıp bir saniye bekleyin, uygulamayı tamamen kapatıp açın: metin durur. Yazar yazmaz ana ekrana çıkıp uygulamayı kapatın: metin yine durur.
- [ ] Klavye açıkken yazılan satır klavyenin altında kalmaz.
- [ ] **Görevler:** bugünde "Gecikmiş" ve "Bu gün" grupları görünür; uzun başlık iki satıra sarılır, kırpılmaz. Saatli görevde saat, her görevde öncelik rengi ve adı yazar.
- [ ] Onay kutusuna dokununca görev tamamlanır, telefon kısa titrer ve 5 saniye "Geri al" görünür. "Geri al" görevi geri getirir. Tekrar eden görevde ("Sabah yürüyüşü") geri alınca yarına eklenen tekrar da kalkar.
- [ ] "Tamamlanan (n)" kapalı gelir; dokununca açılır.
- [ ] **Görev ekle:** "yarın 14:00 rapor yaz" yazınca altında "15 Kas" ve "14:00" çipleri görünür; kaydedince görev yarına eklenir. Tarihsiz yazılan görev seçili güne eklenir.
- [ ] Görev satırına dokununca görev detayı açılır (Görevler sekmesindekiyle aynı); geri tuşu kapatır.
- [ ] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz.
- [ ] "Animasyonları kaldır" açıkken gün değişimi animasyonsuzdur.

### Görevler sekmesi (M6)

Önce Ayarlar → "Örnek proje yükle" ile örnek veriyi yükleyin.

- [ ] Görevler sekmesi "Bugün" görünümüyle açılır; bugünün görevleri listelenir.
- [ ] Çiplerde görünüm adı ve sayı yazar: Bugün, Yaklaşan, Gecikmiş, Gelen kutusu, Tamamlanan. Satır parmakla yatay kayar; ekrandan taşan kenar solar, kesik çip görünmez.
- [ ] "Yaklaşan" görünümünde "7 gün içinde" ve (varsa) "Daha sonra" grupları görünür; satırlarda tarih yazar.
- [ ] **Hızlı ekle:** "yarın 14:00 rapor" yazınca "Yarın", "14:00" ve "Öncelik 3" çipleri görünür. "Öncelik 3" çipine dokunup başka bir öncelik seçin: yazdığınız metin silinmez, klavye açıkken çipler görünür kalır.
- [ ] Tarihsiz yazılan görev Gelen kutusu'na düşer ve snackbar bunu söyler. "her pazartesi toplantı" yazınca "Her hafta" çipi görünür.
- [ ] Onay kutusu görevi tamamlar, telefon kısa titrer, 5 saniye "Geri al" görünür; çiplerdeki sayılar hemen değişir.
- [ ] **Görev detayı:** satıra dokununca açılır. Durum, öncelik, tarih, tekrar ve hatırlatma satırları kendi seçim ekranını açar; geri tuşu önce onu, sonra detayı kapatır.
- [ ] Başlığı değiştirip klavyede "Bitti"ye basın: listedeki satır güncellenir. Saat alanı Android saat seçicisini açar; seçilen saat satırda görünür.
- [ ] Tarihi başka bir güne alınca görev öteki görünüme geçer ve saati korunur. "Tarihi kaldır" görevi Gelen kutusu'na gönderir; tarihsiz görevde saat alanı pasiftir.
- [ ] Durumu "Tamamlandı" yapınca tekrar eden görevin ("Sabah yürüyüşü") yarınki tekrarı oluşur.
- [ ] Uygulamayı tamamen kapatıp açın: yapılan bütün değişiklikler durur.
- [ ] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz.

### Takvim (M8)

Önce Ayarlar → "Örnek proje yükle" ile örnek veriyi yükleyin.

- [ ] Takvim bugünün ayıyla açılır; hafta pazartesi başlar, gün adları Türkçedir (Pzt … Paz). Bugün çerçeveyle işaretlidir.
- [ ] Miladi/Hicri/Çin takvim seçicisi yoktur.
- [ ] Görevi olan günlerde dolu nokta, günlüğü olan günlerde halka vardır; görevlerin hepsi biten günde nokta yeşildir. Izgaranın altındaki açıklama satırı üçünü de yazar.
- [ ] Bir güne dokununca Pisi sekmesi o günle açılır; başlıkta o günün tarihi yazar.
- [ ] O gün bir görevi tamamlayıp günlük yazın, Takvim'e dönün: noktalar hemen değişir.
- [ ] Oklarla ve ızgarayı sağa/sola kaydırarak ay değişir (kısa titreşim). "Bu aya dön" bugünün ayına getirir. Başka sekmeye gidip dönünce takvim kalınan ayda durur.
- [ ] TalkBack bir güne gelince tarihi ve "görev var", "görevlerin hepsi tamamlandı", "günlük var" bilgilerini okur.
- [ ] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz, gün hücreleri parmakla rahat seçilir.

### Haritalar (M9)

Önce Ayarlar → Geliştirici → "Örnek harita yükle" ile altı notlu örnek haritayı ekleyin.

- [ ] Haritalar sekmesinde "Örnek Harita" ve "6 not" görünür; ikinci kez yüklemek kopya oluşturmaz ("Örnek harita zaten var").
- [ ] Harita ekrana sığmış açılır. Hiyerarşi bağlantıları turuncu, akış (stream) yeşil, denk (co-level) bağlantı iki uçlu mavi oktur.
- [ ] Tek parmakla harita kayar, iki parmakla yakınlaşır/uzaklaşır; hareket akıcıdır. Sağ alttaki +, − ve "Ekrana sığdır" düğmeleri çalışır.
- [ ] Bir nota dokununca not açılır; geri tuşu haritaya, harita da kaldığı yakınlıkta ve konumda durur; bir kez daha geri listeye döner.
- [ ] Bir notu sürükleyerek başlayan hareket notu açmaz. Hızlı bir kaydırmadan hemen sonra düğmeye dokunun: ilk dokunuş yutuluyorsa not edin (tarayıcıda böyle; cihazda da öyleyse kayda değer).
- [ ] Telefonu yatay çevirin: kaydırılmamış harita yeni ekrana yeniden sığar.
- [ ] TalkBack not kartlarını başlıklarıyla okur; altında daraltılmış not olan kart "…, altında 1 gizli not" diye okunur.
- [ ] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz.

### Örnek proje (aktarım gelene kadar)

Gerçek proje telefona henüz aktarılamıyor. Test APK'sında **Ayarlar →
Geliştirici → Örnek proje yükle** örnek görev, not ve günlük ekler; ikinci kez
dokunmak kopya oluşturmaz. Ayarlar'daki **Proje** bölümü görev, not ve harita
sayısını gösterir.

- [ ] İlk açılışta Proje bölümünde sayılar 0 görünür.
- [ ] "Örnek proje yükle" sonrası 6 görev ve 4 not görünür.
- [ ] Uygulama tamamen kapatılıp açıldığında sayılar aynıdır.
- [ ] Uygulama güncelleme APK'sıyla üzerine kurulduğunda veriler durur.

## 5. Sorun kaydı alma

USB hata ayıklama açıkken:

```bash
adb logcat -c
adb logcat
```

Sorunu yeniden oluşturduktan sonra cihaz modelini, Android sürümünü, APK'nın sürüm kodunu ve adımları ilgili log bölümüyle birlikte paylaşın. Test APK'sında WebView, Chrome'un `chrome://inspect` sayfasından incelenebilir.
