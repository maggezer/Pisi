# Pisi Mobil — test APK'sı ve cihazda doğrulama

Bu belge Pisi Mobil'in (Android) nasıl derlendiğini, test APK'sının telefona nasıl kurulduğunu ve cihazda neyin denetlendiğini anlatır. §4'teki liste MVP'nin (M0–M10) cihaz kabul listesidir: bütün maddeler telefonda işaretlenince MVP kabul edilmiş olur (`docs/mobile-plan.md` M10).

## 1. Otomatik kontroller

Node.js 24 ile, depo kökünden:

```bash
npm --prefix mobile ci
npm --prefix mobile run validate   # biçim, lint, i18n, yapı, birim testleri, derleme
npm --prefix mobile run e2e        # Playwright: Pixel 7 görünümü, açık ve koyu tema
npm --prefix mobile run audit
```

E2E ekran görüntülerini `mobile/e2e/screenshots/` altına yazar. CI aynı görüntüleri `pisi-mobile-screens` adıyla saklar.

- `e2e/sweep.spec.mjs` (genel tarama) her ekranı geri tuşu, klavye, yatay ekran, %130 yazı, ekran okuyucu adları ve hareket azaltma için dener; görüntüleri `90-…`–`93-…` adlarıyladır.
- `e2e/large-project.spec.mjs` masaüstünün proje üreticisiyle (`scripts/generate-project-fixture.mjs`) 2.000 not, 5.000 görev ve 60 günlüklük bir proje kurar; Pisi ekranının ilk görünmesini, not listesi kaydırılırken kare sürelerini ve arama yanıt süresini ölçer. Sonuç `large-project-timing.json` dosyasındadır (aynı artifact, tema klasörü başına bir dosya).

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

Sürüm etiketiyle (`v*.*.*`) çalışan **Release** iş akışı da aynı anahtarla bir APK derler ve GitHub sürümüne `Pisi-<sürüm>-Android.apk` adıyla ekler (geliştirici bölümü olmadan). Sürüm kodu, o anki son **Mobile** çalıştırmasının numarasıdır: sürüm APK'sı önceki test APK'larının, sonraki test APK'sı da sürüm APK'sının üzerine kurulur.

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

Her adımda uygulama kapanmamalı ve ekran boş kalmamalıdır. Önce **Ayarlar → Geliştirici → Örnek proje yükle** ve **Örnek harita yükle** ile örnek veriyi yükleyin (gerçek proje aktarım gelene kadar telefona getirilemiyor).

Cihaz: bildirilmedi · Android sürümü: bildirilmedi · APK sürüm kodu (Ayarlar → Hakkında → Uygulama sürümü, parantez içindeki sayı): bildirilmedi · Tarih: 16-11-2026

**Sonuç:** liste 16-11-2026'da kullanıcının telefonunda uygulandı ve bütün maddeler geçti. M10 ve MVP (M0–M10) kabul edildi (`docs/mobile-plan.md` M10).

### Açılış ve sekmeler

- [x] Uygulamayı son uygulamalardan kapatıp yeniden açın: Pisi ekranı bugünün tarihiyle gelir.
- [x] Başka bir sekmedeyken ana ekrana çıkıp uygulamaya dönün: kaldığınız sekme açıktır.
- [x] Pisi sekmesinde alt menü yoktur; sol alttaki menü düğmesi Görevler, Notlar, Takvim, Haritalar ve Ayarlar'ı ikon ve adlarıyla listeler. Her ekran iki dokunuşla açılır.
- [x] Öteki sekmelerde alt menüde Pisi, Görevler, Notlar, Takvim ve Haritalar tek satırda, etiketleriyle görünür; başlıktaki **Ayarlar** düğmesi Ayarlar'ı açar.

### Ayarlar (M10)

- [x] **Tema:** Sistem, Açık ve Koyu hemen uygulanır ve uygulama yeniden açılınca korunur. "Sistem" seçiliyken telefonun koyu modunu değiştirin: uygulama izler.
- [x] Durum çubuğundaki saat ve simgeler her temada okunur; başlık çentiğin ya da durum çubuğunun altında kalmaz, alt menü hareket çubuğuyla çakışmaz.
- [x] **Dil:** English seçilince bütün metinler değişir; Türkçe'ye dönülebilir.
- [x] **Proje** bölümü proje adını ("Pisi Projem"), görev, not, günlük ve harita sayılarını gösterir. Örnek proje ve örnek haritadan sonra: 6 görev, 9 not, 1 günlük, 1 harita.
- [x] **Bütünlük** satırı "Sorun yok" yazar. (Okunamayan bir dosya olsaydı "n dosya salt okunur" yazar, altında uyarı ve dosya listesi görünürdü; bu durum otomatik testlerde denenir.)
- [x] **Hakkında** bölümünde uygulama sürümü APK'nın sürümüyle aynıdır (ör. `0.1.0 (57)`; parantez içi sayı CI'daki sürüm kodudur).
- [x] DriveSync, Google Drive ya da "Two-way" geçen bir metin yoktur (G13). ("Cihazlar arası aktarım: Yakında" satırı S5'te kalktı; yerine **Senkron** bölümü geldi.)
- [x] Geliştirici bölümü test APK'sında görünür ("Örnek proje yükle", "Örnek harita yükle"); ikinci kez dokunmak kopya oluşturmaz.
- [x] Uygulama tamamen kapatılıp açıldığında ve güncelleme APK'sı üzerine kurulduğunda sayılar ve veriler aynıdır.

### Senkron ve eşleştirme (S5)

Test APK'sı Android 8.0 ve üstüne kurulur (QR okuyucu için `minSdkVersion` 26). Sunucu kurulu ve masaüstü bir alana bağlı olmalıdır (`docs/sync-server-cpanel.md`, masaüstünde Ayarlar → Senkron). Bu adımlar APK'nın eşleştirmesini kısaca denemek içindir; senkronun tam cihaz kabul listesi `docs/sync-qa.md`'dedir (S8) ve aşağıdaki maddelerin hepsi orada da vardır.

**Senkronlu test APK'sı (S8):**

- §2'deki `Pisi-mobile-apk` senkronu içerir; ayrı bir "senkronlu" APK yoktur. Senkron kabulünde `main` dalının son **Mobile** çalıştırmasının APK'sı kullanılır; 14 günden yeni bir çalıştırma yoksa **Actions → Mobile → Run workflow** (`main`) ile yenisi üretilir.
- Test APK'sı debug derlemesidir: Ayarlar'da Geliştirici bölümü görünür ve WebView `chrome://inspect` ile incelenebilir. Gerçek sunucuya yalnız `https://` ile bağlanır; sunucunun `config.php` dosyasındaki CORS kaynağı (`https://localhost`) değiştirilmemelidir (`docs/sync-server-cpanel.md` §6).
- Eşleşme, token ve şifreleme anahtarı uygulamanın kendi alanında, Android Keystore ile sarılı durur. APK aynı sabit anahtarla imzalandıysa yeni APK eskisinin üzerine kurulunca eşleşme ve veriler kalır. Anahtarı farklı bir APK için uygulama kaldırılırsa eşleşme de silinir: telefon masaüstünden iptal edilip yeniden eşleştirilir.
- Geliştirici bölümündeki "Örnek proje yükle", senkron kabulünde yalnız "kenara koy" adımı için kullanılır (`docs/sync-qa.md` §4); eşleşmiş bir telefonda yüklenirse örnek notlar masaüstüne de gider.

- [ ] Ayarlar → **Senkron** → "Masaüstüyle eşleştir" → **QR kodu okut**: kamera izni istenir, masaüstündeki QR okununca "Masaüstünde bu telefonun bağlanmasını onaylayın." görünür; masaüstünde onaylayınca "Bağlandı".
- [ ] **Kodla bağlan**: sunucu adresi, kısa kod ve cihaz adı girilir; iki ekranda aynı 6 haneli doğrulama numarası görünür. Masaüstünde "Farklı" denirse telefonda "Masaüstünde reddedildi." yazar.
- [ ] Bağlandıktan sonra Ayarlar'da proje adı, "Eşit" durumu ve son senkron saati görünür; masaüstündeki notlar Notlar sekmesine gelir.
- [ ] Telefonda bir görev ve günlük yazın; birkaç saniye sonra (ya da "Şimdi eşitle" ile) masaüstünde bir sonraki turda görünür.
- [ ] Uygulamayı tamamen kapatıp açın: eşleşme durur, yeniden eşleştirme istenmez.
- [ ] Masaüstünde cihaz listesinden telefonu iptal edin: telefonda "bağlantısı masaüstünden kaldırıldı" uyarısı çıkar, notlar ve görevler telefonda kalır.

### Genel tarama (M10)

- [x] **Geri tuşu** (hareketle geri dahil): açık pencere (sheet) varsa yalnız o kapanır; iç içe pencerede (görev detayı → öncelik) önce üstteki kapanır.
- [x] Alt ekranda (not, harita, Ayarlar) geri bir üst ekrana döner: haritadan açılan not → harita → harita listesi → Pisi.
- [x] Pisi dışındaki bir sekmede geri Pisi sekmesine götürür; Pisi sekmesinde geri uygulamayı arka plana alır, kapatmaz (yeniden açınca splash görünmez).
- [x] **Klavye:** Pisi sekmesinde "Görev ekle" alanına dokunun: alan klavyenin üstünde görünür; menü düğmesi ve tarih çarkı klavye açıkken gizlenir, klavye kapanınca geri gelir.
- [x] Günlük alanına uzun bir metin yazın: yazılan satır klavyenin altında kalmaz.
- [x] Uzun bir notun sonuna yazın: imleç biçim çubuğunun ve klavyenin üstünde kalır; biçim çubuğu klavyenin hemen üstündedir.
- [ ] **Türkçe klavye (Gboard):** günlük alanına, "Görev ekle" alanına ve bir notun paragrafına `ğüşıöçİĞÜŞÖÇ` yazın: bütün harfler girer. Aynı alanlarda bir kelimeyi kaydırarak yazın: kelime girer, öneri şeridi çalışır. Bir harfe uzun basıp açılan menüden aksanlı harfi seçin: harf girer.
- [x] Görevler sekmesinde hızlı ekle, Notlar'da arama alanı ve görev detayında başlık alanı yazılırken alt menü gizlenir, alan görünür kalır.
- [ ] **Gezinme düğmeleri:** uygulama açılınca alttaki geri/ana ekran/son uygulamalar düğmeleri (ya da hareket çubuğu) görünmez; alt menü, biçim çubuğu ve sheet'ler ekranın en altına kadar iner, hiçbiri kesilmez. Alt kenardan yukarı kaydırınca düğmeler bir süre uygulamanın üstünde görünür, içerik yerinden oynamaz, sonra kendiliğinden gizlenir. Klavyeyi açıp kapatınca, QR okuyucudan ve başka bir uygulamadan dönünce düğmeler yine gizlidir. Durum çubuğu (saat, pil) her zaman görünür.
- [x] **Yatay ekran:** her sekmede, notta, haritada ve Ayarlar'da telefonu yatay çevirip geri alın: yatay kaydırma oluşmaz, içerik kesilmez, kaydırılabilir.
- [x] **Yazı boyutu:** Android yazı boyutunu %130'a (ya da en büyüğe) alın: hiçbir ekranda yatay kaydırma oluşmaz, sekme etiketleri ve düğmeler kesilmez, düğmeler parmakla rahat seçilir.
- [x] **TalkBack** açıkken temel akışlar: Pisi sekmesinde gün başlığı, günlük alanı, görev onay kutusu ("… tamamla") ve "Görev ekle" okunur; menüden Notlar açılır, bir not açılıp okunur; Takvim'de bir gün tarihiyle ve işaretleriyle okunur; Ayarlar'da tema değiştirilir. Adı okunmayan ("düğme" diye geçen) bir kontrol yoktur.
- [x] **Hareket azaltma:** Ayarlar → Erişilebilirlik → "Animasyonları kaldır" açıkken gün değişimi, pencere (sheet) açılıp kapanması ve onay kutuları animasyonsuzdur.

### Pisi sekmesi (M5)

Önce Ayarlar → Geliştirici → "Örnek proje yükle" ile örnek veriyi yükleyin.

- [x] Başlıkta seçili gün "Cumartesi, 14 Kasım" biçiminde yazar; bugünse yanında "Bugün" etiketi vardır.
- [x] **Tarih çarkı** (sağ alt köşe): parmakla kaydırınca günler akar ve hafif titreşim hissedilir; ortada duran gün seçilir. Bir güne dokunmak da onu seçer.
- [x] Çarkta bugün çerçeveli, seçili gün dolu görünür; görevi olan günlerde dolu, günlüğü olan günlerde halka nokta vardır. Ay etiketi Türkçede "Kas", İngilizcede "Nov" yazar.
- [x] İçerik alanında sağa/sola kaydırmak günü değiştirir; yukarı/aşağı kaydırmak yalnız sayfayı kaydırır. Günlük alanına yazarken kaydırma günü değiştirmez.
- [x] Başlığa dokununca tarih seçici açılır; başka bir gün seçilince kapanır. Başka gündeyken "Bugüne dön" görünür ve bugüne getirir.
- [x] **Günlük:** boşken "Bugün neler oldu?" ipucu görünür. Yazıp bir saniye bekleyin, uygulamayı tamamen kapatıp açın: metin durur. Yazar yazmaz ana ekrana çıkıp uygulamayı kapatın: metin yine durur.
- [x] Klavye açıkken yazılan satır klavyenin altında kalmaz.
- [x] **Görevler:** bugünde "Gecikmiş" ve "Bu gün" grupları görünür; uzun başlık iki satıra sarılır, kırpılmaz. Saatli görevde saat, her görevde öncelik rengi ve adı yazar.
- [x] Onay kutusuna dokununca görev tamamlanır, telefon kısa titrer ve 5 saniye "Geri al" görünür. "Geri al" görevi geri getirir. Tekrar eden görevde ("Sabah yürüyüşü") geri alınca yarına eklenen tekrar da kalkar.
- [x] "Tamamlanan (n)" kapalı gelir; dokununca açılır.
- [x] **Görev ekle:** "yarın 14:00 rapor yaz" yazınca altında "15 Kas" ve "14:00" çipleri görünür; kaydedince görev yarına eklenir. Tarihsiz yazılan görev seçili güne eklenir.
- [x] Görev satırına dokununca görev detayı açılır (Görevler sekmesindekiyle aynı); geri tuşu kapatır.
- [x] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz.
- [x] "Animasyonları kaldır" açıkken gün değişimi animasyonsuzdur.

### Görevler sekmesi (M6)

Önce Ayarlar → "Örnek proje yükle" ile örnek veriyi yükleyin.

- [x] Görevler sekmesi "Bugün" görünümüyle açılır; bugünün görevleri listelenir.
- [x] Çiplerde görünüm adı ve sayı yazar: Bugün, Yaklaşan, Gecikmiş, Tarihsiz, Tamamlanan (G8'den önce "Gelen kutusu"). Satır parmakla yatay kayar; ekrandan taşan kenar solar, kesik çip görünmez.
- [x] "Yaklaşan" görünümünde "7 gün içinde" ve (varsa) "Daha sonra" grupları görünür; satırlarda tarih yazar.
- [x] **Hızlı ekle:** "yarın 14:00 rapor" yazınca "Yarın", "14:00" ve "Öncelik 3" çipleri görünür. "Öncelik 3" çipine dokunup başka bir öncelik seçin: yazdığınız metin silinmez, klavye açıkken çipler görünür kalır.
- [x] Tarihsiz yazılan görev "Tarihsiz" görünümüne düşer ve snackbar bunu söyler (G8'den beri bugünün günlüğünde durur). "her pazartesi toplantı" yazınca "Her hafta" çipi görünür.
- [x] Onay kutusu görevi tamamlar, telefon kısa titrer, 5 saniye "Geri al" görünür; çiplerdeki sayılar hemen değişir.
- [x] **Görev detayı:** satıra dokununca açılır. Durum, öncelik, tarih, tekrar ve hatırlatma satırları kendi seçim ekranını açar; geri tuşu önce onu, sonra detayı kapatır.
- [x] Başlığı değiştirip klavyede "Bitti"ye basın: listedeki satır güncellenir. Saat alanı Android saat seçicisini açar; seçilen saat satırda görünür.
- [x] Tarihi başka bir güne alınca görev öteki görünüme geçer ve saati korunur. "Tarihi kaldır" görevi "Tarihsiz" görünümüne gönderir; tarihsiz görevde saat alanı pasiftir.
- [x] Durumu "Tamamlandı" yapınca tekrar eden görevin ("Sabah yürüyüşü") yarınki tekrarı oluşur.
- [x] Uygulamayı tamamen kapatıp açın: yapılan bütün değişiklikler durur.
- [x] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz.

### Notlar (M7)

- [x] Notlar sekmesi son değişene göre sıralı açılır; kartlarda başlık, bloklar arası boşluklu bir satır önizleme ve gün görünür; köşe süsü ya da sabitleme simgesi yoktur (G7, G8).
- [x] Arama başlıkta ve metinde arar; "ışık" yazınca "Işık ve ısı" bulunur, "istanbul" yazınca "İstanbul" geçen not bulunur. Tümü / Notlar / Günlükler filtresi listeyi değiştirir.
- [x] Bir notu açın, bir paragrafın sonuna yazın: klavyenin hemen üstünde kalın, italik, başlık, madde ve numaralı liste düğmeleri vardır (48 dp, SVG ikon). Enter yeni blok açar; başlık düğmesi bloğu başlık yapar.
- [x] Geri tuşu notu kaydeder; uygulamayı tamamen kapatıp açın: yazdığınız durur.
- [x] Sağ alttaki düğmeyle yeni not: önce başlık sorulur; boş başlıkla oluşturulamaz. Mevcut notun başlığı değiştirilemez.
- [x] Örnek projedeki "Toplantı Notları"nın her paragrafı ayrı bir düzenlenebilir alandır.

- [x] Not metni arayüzle aynı yazı ailesindedir (G9). Koyu temada ve %130 yazıda düzen bozulmaz.

Masaüstü blokları (Sheet, Paint, görsel, dosya: "Masaüstünde düzenlenir" kartı), görev blokları ve wiki-link'ler örnek projede yoktur; aktarım gelene kadar masaüstü fixture'ıyla otomatik testlerde denenir (`mobile/e2e/notes.spec.mjs`, `tests/mobile-desktop-compat.test.mjs`).

### Takvim (M8)

Önce Ayarlar → "Örnek proje yükle" ile örnek veriyi yükleyin.

- [x] Takvim bugünün ayıyla açılır; hafta pazartesi başlar, gün adları Türkçedir (Pzt … Paz). Bugün çerçeveyle işaretlidir.
- [x] Miladi/Hicri/Çin takvim seçicisi yoktur.
- [x] Görevi olan günlerde dolu nokta, günlüğü olan günlerde halka vardır; görevlerin hepsi biten günde nokta yeşildir. Izgaranın altındaki açıklama satırı üçünü de yazar.
- [x] Bir güne dokununca Pisi sekmesi o günle açılır; başlıkta o günün tarihi yazar.
- [x] O gün bir görevi tamamlayıp günlük yazın, Takvim'e dönün: noktalar hemen değişir.
- [x] Oklarla ve ızgarayı sağa/sola kaydırarak ay değişir (kısa titreşim). "Bu aya dön" bugünün ayına getirir. Başka sekmeye gidip dönünce takvim kalınan ayda durur.
- [x] TalkBack bir güne gelince tarihi ve "görev var", "görevlerin hepsi tamamlandı", "günlük var" bilgilerini okur.
- [x] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz, gün hücreleri parmakla rahat seçilir.

### Haritalar (M9)

Önce Ayarlar → Geliştirici → "Örnek harita yükle" ile altı notlu örnek haritayı ekleyin.

- [x] Haritalar sekmesinde "Örnek Harita" ve "6 not" görünür; ikinci kez yüklemek kopya oluşturmaz ("Örnek harita zaten var").
- [x] Harita ekrana sığmış açılır. Hiyerarşi bağlantıları turuncu, akış (stream) yeşil, denk (co-level) bağlantı iki uçlu mavi oktur.
- [x] Tek parmakla harita kayar, iki parmakla yakınlaşır/uzaklaşır; hareket akıcıdır. Sağ alttaki +, − ve "Ekrana sığdır" düğmeleri çalışır.
- [x] Bir nota dokununca not açılır; geri tuşu haritaya, harita da kaldığı yakınlıkta ve konumda durur; bir kez daha geri listeye döner.
- [x] Bir notu sürükleyerek başlayan hareket notu açmaz. Hızlı bir kaydırmadan hemen sonra düğmeye dokunun: ilk dokunuş yutuluyorsa not edin (tarayıcıda böyle; cihazda da öyleyse kayda değer).
- [x] Telefonu yatay çevirin: kaydırılmamış harita yeni ekrana yeniden sığar.
- [x] TalkBack not kartlarını başlıklarıyla okur; altında daraltılmış not olan kart "…, altında 1 gizli not" diye okunur.
- [x] Koyu temada ve Android yazı boyutu %130'da düzen bozulmaz.

### Büyük proje (M10)

Telefonda büyük proje yüklemenin yolu aktarım gelene kadar yoktur; süreler her PR'da E2E ile ölçülür (`large-project-timing.json`, §1). Cihazdaki genel his için:

- [x] Örnek proje yüklüyken Notlar listesi hızlı kaydırmada takılmaz, arama her harfte hemen güncellenir.
- [x] Pisi ekranı soğuk açılışta bir saniye içinde görünür.

## 5. Sorun kaydı alma

USB hata ayıklama açıkken:

```bash
adb logcat -c
adb logcat
```

Sorunu yeniden oluşturduktan sonra cihaz modelini, Android sürümünü, APK'nın sürüm kodunu ve adımları ilgili log bölümüyle birlikte paylaşın. Test APK'sında WebView, Chrome'un `chrome://inspect` sayfasından incelenebilir.
