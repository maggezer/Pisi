# Pisi Mobil — Claude Code iş tanımı

Sürüm: 1 · 12-11-2026 · Repo: `maggezer/Pisi` · Hedef: Android'de düzgün çalışan Pisi Mobil MVP

Bu belge repoda `docs/mobile-plan.md` olarak durur. Pisi Mobil'in uygulama tarafını faz faz tanımlar.
Cihazlar arası aktarım/senkron bu belgenin konusu değildir; ayrı bir planla gelecektir (bkz. §8).

---

## 0. Çalışma biçimi (her oturumda geçerli)

1. Oturumun başında şunları oku: `CLAUDE.md`, bu belge, `pisi-definition.md`, `docs/single-source-of-truth.md`.
   Fazın ilgili olduğu masaüstü belgelerini de oku (her fazda listelenmiştir).
2. **Her oturumda tek faz.** Fazlar sırayla yapılır. Önceki faz birleştirilmeden (merge) sonraki başlamaz.
3. Her faz **tek PR**dır (CLAUDE.md kural 1). Başlık Conventional Commits biçimindedir, kapsam `mobile`, `shared` veya `ci` olur.
   Örnek: `feat(mobile): Pisi sekmesini başlangıç ekranı yap`. Açıklamada ilgili madde kimlikleri yazılır (ör. `M5, G3, G4`).
4. CLAUDE.md'deki "Definition of Done" mobil için de geçerlidir. Mobil için ek koşullar §3.6'dadır.
5. Birden fazla modülü etkileyen fazlarda (**M1, M4**) önce kısa bir uygulama planı yaz ve onay bekle (CLAUDE.md kural 5).
6. **Karar belirsizse sor, varsayma.** Masaüstü davranışı her zaman esastır. Bu belgeyle masaüstü kodu çelişirse kodu esas al ve bunu PR'da belirt.
7. Bir araç, erişim ya da komut çalışmazsa etrafından dolanan geçici çözüm kurma. Önce asıl sorunu çöz ya da açıkça bildir, sonra devam et.
8. `mobile5` dalı **yalnızca kaynak olarak** kullanılır, birleştirilmez (merge yok). Oradan alınan dosya ve parçaları PR'da `mobile5:<yol>` diye belirt.
    - Erişim: `git fetch origin mobile5` ve ardından `git show origin/mobile5:src/main.js`
    - Çalıştırmak için ayrı bir worktree kullan: `git worktree add ../Pisi-mobile5 origin/mobile5`
9. Her PR açıklamasının sonuna aşağıdaki **oturum raporunu** ekle. Bu raporlar model değerlendirmesinde kullanılacak.

```text
### Oturum raporu
- Madde(ler): M?, G?
- Yapılanlar: (kısa maddeler)
- Testler: (çalıştırılan komutlar ve sonuçları)
- Ekran görüntüleri: (CI artifact adı veya PR'a eklenen görseller; arayüz değiştiyse önce/sonra)
- Belgede olmayan, benim verdiğim kararlar:
- Bilinen eksikler / riskler:
- Masaüstüne etkisi: (yok / şu dosyalar, şu testler)
```

---

## 1. Bağlam

### 1.1 Masaüstü (mevcut, `main` dalı)

- Electron uygulaması, sürüm 0.11.x.
    - `main/` ~23 bin satırdır ve Node `fs`'ye bağlıdır.
    - `renderer/` ~63 bin satırdır ve masaüstü arayüzü içindir.
    - Detaylar CLAUDE.md'dedir.
- Veritabanı yoktur. Kullanıcının proje klasöründe JSON dosyaları vardır:
    - `.node`: not. `content` alanında masaüstü blok HTML'i bulunur.
    - `.map`: harita. Üyelik, yerleşim ve kamera bilgisini tutar.
    - `.pisi/tasks.json`: görev otoritesi. Öncelik 1–5. Durumlar: `todo|doing|waiting|blocked|done`.
    - `.pisi/relationships.json`: ilişki otoritesi.
    - `.pisi/properties.json`: özellik tanımları.
    - `diary/`: günlük klasörü. İçinde `.pisi-diary` işaretçisi bulunur. Dosyalar `YYYY-MM-DD.node` adını taşır, başlıkları `DD-MM-YYYY` biçimindedir.
    - Sidecar klasörleri: not için `inv_<başlık>__<node-id>`, harita için `nd_<başlık>__<map-id>`. Görseller, Paint ve Sheet verisi bu klasörlerde içerik adresli dosyalar olarak durur.
- Biçimin tek kaynağı `pisi-definition.md`'dir. Mobil bu biçimi **birebir** kullanır.

### 1.2 `mobile5` dalı (Temmuz–Eylül 2026, "Pisi Mobile 3.2.0")

Vite + Capacitor 8 + düz JS ile yazılmış ayrı bir uygulamadır. 71 testi geçiyor ve derleniyor. Telefonda temiz bir arayüzü var.

Ancak **temel alınmayacak**. Nedenleri:

- Masaüstünün 1886 commit gerisinde kalmış, biçimi eski.
    - `pisi.connectionTypes` alanını diske yazıyor.
    - `blocks`, `drawing`, `sheet`, `pinned`, `documentKind` gibi mobile özel alanlar yazıyor.
    - Not içindeki blokları `data-block-id` ile işaretliyor. Masaüstü ise `pisi-editor-block` + `data-pisi-block-id` kullanıyor.
    - Wiki-link, görsel ve dosya eklerini tanımıyor.
- `tasks.json` ve `relationships.json` dosyalarını her seferinde IndexedDB kopyasından baştan üretiyor.
- İki veri kaynağı tutuyor: IndexedDB ve klasör.
- `src/main.js` tek dosyada 2906 satır.
- Senkronu Drive ve üçüncü parti uygulamaya dayalı.

**Alınacaklar** (uyarlanarak):

- Ekran fikirleri ve akışları.
- Sıcak renk paleti.
- Pisi sekmesinin kimliği: köşedeki çapraz tarih çarkı ve menü (launcher) düğmesi.
- Capacitor ayarları (özellikle `Keyboard.resize: native`).
- Android tema, splash ve ikon kaynakları.
- APK üreten CI iş akışının iskeleti.
- `docs/mobile-qa.md` cihaz kontrol listesi.

**Kenara konacak:** `PisiSyncFolderPlugin.java` ve `src/sync-*`. Bunlar aktarım planında değerlendirilecek.

### 1.3 Verilmiş kararlar

| Konu                    | Karar                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Platform                | Önce Android. iOS sonra.                                                                                     |
| Teknoloji               | Capacitor 8 + Vite + düz ESM JavaScript (framework yok)                                                      |
| Arayüz                  | Mobil için ayrı ve sade arayüz. Masaüstü renderer'ı taşınmaz.                                                |
| Kod paylaşımı           | Saf iş kuralları `shared/` klasöründe tutulur, masaüstü ve mobil aynı kodu kullanır.                         |
| Repo yeri               | Aynı repo, `mobile/` klasörü, kendi `package.json`'ı ile                                                     |
| MVP                     | Pisi sekmesi (günlük + günün görevleri), Görevler + Hızlı ekle, Notlar, Takvim, Harita (yalnız görüntüleme)  |
| Başlangıç ekranı        | **Uygulama açılınca Pisi sekmesi, bugünün tarihiyle**                                                        |
| Veri yeri               | Uygulamanın kendi alanında bir Pisi proje klasörü (`Directory.Data`)                                         |
| Android `applicationId` | `com.mumin.pisi`. Masaüstü `appId` ile aynı. Eski `com.maggezer.pisi` test uygulaması telefondan kaldırılır. |
| Mobil sürüm             | `mobile/package.json` içinde `0.1.0`'dan başlar. Masaüstü sürümünden bağımsızdır.                            |

---

## 2. Değişmez veri kuralları

Bu kurallar her fazda geçerlidir. Bir PR bunlardan birini çiğniyorsa bitmiş sayılmaz.

- **V1 · Tek kaynak:** Gerçek veri proje dosyalarıdır. Bellek veya IndexedDB yalnız silinip yeniden üretilebilen önbellek olabilir. Önbellek hiçbir zaman dosyaya geri yazılmaz.
- **V2 · Biçim:** Yazılan her dosya `pisi-definition.md`'ye uyar. Şunlar diske **yazılmaz**:
    - `pisi.connectionTypes`, `map.edges`
    - Gömülü `drawing`/`sheet`
    - Mobile özel alanlar
    - `data-block-id` gibi mobile özel HTML öznitelikleri
- **V3 · Bilinmeyeni koru:** Okunan JSON'daki tanınmayan alanlar ve kayıtlar aynen geri yazılır.
- **V4 · Gereksiz yazma yok:** İçeriği değişmeyen dosya yeniden yazılmaz. Boş kayıt ve "kaydet" düğmesiyle tetiklenen gereksiz yazma olmaz.
- **V5 · Otorite dosyaları:** `tasks.json`, `relationships.json` ve `properties.json` hiçbir zaman projeksiyondan baştan üretilmez. Yazmadan hemen önce dosya yeniden okunur ve yalnız ilgili kayıt değiştirilir.
- **V6 · Atomik yazma:** Önce geçici dosyaya yazılır, sonra yeniden adlandırılır, sonra geri okunup doğrulanır. Açılışta yarım kalmış geçici dosyalar toparlanır.
- **V7 · Bozuk dosya:** JSON'u bozuk bir dosya boş içerikle veya varsayılanla **ezilmez**. O dosya salt okunur işaretlenir ve kullanıcıya bildirilir.
- **V8 · Blok koruma:** Mobilin düzenleyemediği not blokları değişmeden kalır. Bunlar Sheet, Paint/canvas, görsel, dosya, rollup, diary-managed ve bilinmeyen bloklardır. Notun geri kalanı düzenlense bile bu blokların HTML'i bayt bayt aynı kalır.
- **V9 · Silme ve yeniden adlandırma yok (MVP):** Masaüstünde silme geri alınabilir çöp kutusuna gider ve referansları arşivler. Yeniden adlandırma ise dosyayı, sidecar'ı ve wiki-link başlıklarını birlikte günceller. Bu kurallar mobilde kurulana kadar not silme, not yeniden adlandırma ve görev silme yapılmaz.
- **V10 · Masaüstü bütünlüğü:** Mobilin yazdığı bir proje, masaüstünün Project Integrity denetiminde **yeni bulgu** üretmemelidir (bkz. M4 uyumluluk testi).

---

## 3. Hedef mimari

### 3.1 Klasör yapısı

```text
/                         masaüstü (değişmeden kalır, M1'de shared'a bağlanır)
shared/                   saf ESM (.mjs): DOM, node:*, electron, Capacitor importu YOK; yan etkisi YOK
  date-parser.mjs         Türkçe doğal tarih (masaüstü pisi-date-parser.mjs'ten)
  task-model.mjs          görev normalizasyonu, durum/öncelik/tekrar kuralları (task-store.js'in saf kısmı)
  task-views.mjs          Bugün/Yaklaşan/Gecikmiş/Gelen kutusu tanımları (masaüstündekiyle aynı)
  wiki-link-core.mjs      wiki-link ayrıştırma/çözme (main + renderer kopyaları tek kaynağa iner)
  diary-rules.mjs         diary yol/başlık kuralları
  document-naming.mjs     .node/.map dosya adı ve sidecar adı kuralları
  ids.mjs                 node_/map_/task_/block kimlik üretimi (masaüstüyle aynı biçim)
mobile/
  package.json            kendi bağımlılıkları ve betikleri
  capacitor.config.json
  vite.config.mjs
  index.html
  android/                Capacitor native proje KAYNAĞI (commit'lenir); build çıktıları ve kopyalanan web varlıkları .gitignore'da
  locales/tr.json, locales/eng.json
  src/
    app/                  açılış, yönlendirici (router), geri tuşu, yaşam döngüsü (pause/resume)
    data/                 sürücü arayüzü, ProjectWriter, repo'lar, arama indeksi (Capacitor'ı DOĞRUDAN import etmez)
    platform/             Capacitor sürücüsü, haptics, status bar, keyboard köprüleri
    ui/                   tasarım token'ları, ikonlar, bileşenler
    screens/pisi|tasks|notes|calendar|maps|settings/
    i18n/
  tests/                  vitest + happy-dom birim testleri
  e2e/                    Playwright telefon görünümü testleri ve ekran görüntüleri
docs/mobile-plan.md       bu belge
docs/mobile-qa.md         cihaz kabul listesi
.github/workflows/mobile.yml
```

### 3.2 Teknik kurallar

- Biçimlendirme kökteki Prettier ayarıyla yapılır (4 boşluk, tek tırnak, `printWidth` 160). ESLint de kullanılır.
- Dosya boyutu sınırı: `mobile/src` içinde `.mjs`/`.js` dosyaları ≤ 600 satır, CSS dosyaları ≤ 800 satır. Büyüyen dosya bölünür.
- `mobile/src/data` Capacitor'ı doğrudan import etmez. Depolama sürücüsü dışarıdan verilir (dependency injection). Böylece aynı veri katmanı Node testlerinde gerçek dosya sistemiyle çalışır.
- Bağımlılıklar en az düzeyde tutulur. `docx`, `jspdf`, `moment`, `moment-hijri`, `lunar-javascript` ve `marked` **alınmaz**.
- Bağımlılık denetimi masaüstüyle aynıdır: moderate ve üstü bulgu olmayacak, istisna yok.
- Kullanıcıya görünen her metin `locales/tr.json` ve `locales/eng.json` dosyalarındadır. İki dosyada anahtarlar birebir aynı olmalıdır; bunu bir betik denetler.
- Erişilebilirlik:
    - Her dokunma hedefi en az 48×48 dp olur.
    - Her ikon düğmesinin erişilebilir bir adı olur.
    - `prefers-reduced-motion` desteklenir.
    - Android yazı boyutu %130 olduğunda düzen bozulmaz.

### 3.3 Veri katmanı (M4'te kurulur)

- **`StorageDriver` arayüzü:**
    - Metodlar: `readText`, `writeText`, `rename`, `list`, `stat`, `mkdir`, `exists`.
    - Uygulamaları:
        - `CapacitorFsDriver`: `Directory.Data/projects/default/` altında çalışır.
        - `NodeFsDriver`: testler için.
        - `MemoryDriver`: hızlı birim testleri için.
- **`ProjectWriter`:**
    - Bütün yazmalar buradan geçer. Yazmalar tek bir kuyrukta sırayla yapılır.
    - Kurallar V4 (gereksiz yazma yok) ve V6 (atomik yazma) burada uygulanır.
    - Her yazmadan sonra `fileChanged(path)` olayı yayınlanır. Aktarım aşaması bu olayı kullanacak. **Şimdilik diske ek senkron metadata'sı yazılmaz.**
- **Repo'lar:**
    - `TaskRepo`, `NoteRepo`, `DiaryRepo`: okuma ve yazma.
    - `MapRepo`: salt okunur.
    - `ProjectRepo`: açılış, iskelet oluşturma ve bütünlük durumu.
- **Arama indeksi:** bellekte tutulur, açılışta kurulur, `fileChanged` olaylarıyla artımlı güncellenir. Türkçe eşleştirme kuralları masaüstüyle aynıdır (`İ↔i`, `I↔ı`).
- **Yaşam döngüsü:** bekleyen kayıtlar Capacitor `App` `pause` olayında, ekran değişiminde ve geri tuşunda diske yazılır (flush).

### 3.4 Arayüz katmanı

- Yönlendirme durumu tek bir yerde tutulur. Ekranlar `screens/*` altında, her biri kendi modülündedir.
- Ekranlar arasında ortak bileşenler `ui/` altındadır: görev satırı, kart, sheet, diyalog, snackbar, boş durum, metin alanı, onay kutusu, segment/çip, üst başlık, alt menü.
- İkonlar: tek bir SVG ikon seti kullanılır, öneri **Lucide** (ISC lisansı, lisans notu eklenir). Yalnız kullanılan ikonlar satır içi (inline) SVG olarak eklenir. Unicode glyph ile ikon yapılmaz.

### 3.5 Komutlar (M2'de tanımlanır)

```bash
npm --prefix mobile ci
npm --prefix mobile run dev            # vite, telefondan aynı Wi-Fi ile açılabilir (--host)
npm --prefix mobile run validate       # format:check + lint + i18n + test + build
npm --prefix mobile run e2e            # Playwright, Pixel 7 görünümü, açık/koyu tema, ekran görüntüleri
npm --prefix mobile run audit
npm --prefix mobile run android:sync   # build + cap sync android
npm --prefix mobile run android:open
```

### 3.6 Mobil PR'lar için ek "bitti" koşulları

- `npm --prefix mobile run validate` ve `npm --prefix mobile run e2e` geçer.
- Masaüstüne dokunulduysa kökte `npm run validate` geçer. Arayüze dokunulduysa `xvfb-run -a npm run test:e2e` da geçer.
- CI, telefona kurulabilir bir APK üretir. Arayüz değiştiyse PR'da önce/sonra ekran görüntüleri bulunur (CI artifact'ı yeterli).
- `pisi-update.md` dosyasına tarihli bir giriş eklenir. Bu girişte bunun mobil iş olduğu belirtilir.

---

## 4. Fazlar

Her faz: amaç → yapılacaklar → kabul kriterleri. Madde kimlikleri PR'larda kullanılır.

### M0 · Planı repoya ekle

- Bu dosyayı `docs/mobile-plan.md` olarak ekle.
- `CLAUDE.md`'ye kısa bir "Mobile" bölümü ekle: bu belgeye bağlantı ver ve "mobil işlerde önce bunu oku" de.
- **Kabul:** yalnız belge değişikliği olur, `npm run validate` geçer.

### M1 · Ortak çekirdek: `shared/`

**Oku:** `renderer/productivity/pisi-date-parser.mjs`, `main/functions/task-store.js`, `main/functions/wiki-link-core.js`, `renderer/editor/pisi-wiki-link-core.mjs`, `renderer/tags/pisi-todo-utils.mjs`, `main/functions/document-store-diary.js`, `main/functions/map-semantic-core.js`, `scripts/check-architecture.js`.

**Önce plan yaz, onay bekle.**

1. §3.1'deki modülleri oluştur. İçerikleri masaüstündeki mevcut saf kodun **taşınmasıyla** gelir, yeniden yazılmaz.
    - Bir fonksiyon `fs`, DOM veya registry global'ine bağlıysa saf kısmını ayır. Kalan kısım masaüstünde kalır.
2. Masaüstü modülleri, aynı global adları ve manifest kayıtlarını koruyarak `shared/`'dan import eden **ince sarmalayıcılara** dönüşür. Kullanıcı açısından masaüstünde hiçbir davranış değişmez.
3. Wiki-link çekirdeğinin main ve renderer kopyalarını karşılaştır.
    - Farklıysa farkları PR'da listele.
    - Tek kaynağa indir, ama davranışı değiştirme. Gerekiyorsa iki ayrı fonksiyon olarak bırak.
4. `check:architecture`'a `shared/` kuralı ekle: yasak importlar (node:*, electron, DOM global'leri, `@capacitor/*`), yan etki ve registry kullanımı.
5. Paketleme:
    - `package.json` `build.files` listesine `shared/**/*` ekle.
    - Worker dosyaları `shared`'a bağımlı hale gelirse `asarUnpack` listesini de güncelle.
    - Packaging smoke ve E2E ile doğrula.
6. Testler: her shared modül için `tests/shared-*.test.mjs` yaz; testler modülü doğrudan import etsin. Kırılan regex tabanlı kaynak testlerini davranış testine çevir.

**Kabul:**

- Kökte `npm run validate` geçer.
- `xvfb-run -a npm run test:e2e` geçer.
- Packaging smoke iş akışı geçer.
- Masaüstünde görünür bir fark yoktur.

### M2 · Mobil iskelet, CI ve APK

**Oku:** `mobile5:package.json`, `mobile5:capacitor.config.json`, `mobile5:.github/workflows/android.yml`, `mobile5:android/app/build.gradle`, `mobile5:docs/mobile-qa.md`.

1. `mobile/` paketini kur: Vite, Capacitor 8 (mobile5'teki sürümler veya güvenlik açığı olmayan daha yenileri) ve şu eklentiler:
    - `@capacitor/app`
    - `@capacitor/filesystem`
    - `@capacitor/haptics`
    - `@capacitor/keyboard`
    - `@capacitor/status-bar`
2. `android/` projesini Capacitor 8 ile **temiz oluştur** (`npx cap add android`). Ardından mobile5'teki özelleştirmeleri taşı: tema, splash, ikonlar ve klavye ayarı.
    - `applicationId` = `com.mumin.pisi`.
    - `versionCode` CI'da `github.run_number` olur, böylece her APK bir öncekinin üzerine kurulabilir.
3. **Sabit imza:** CI'ın debug anahtarı her çalıştırmada değişir. Anahtar değişince telefondaki uygulama güncellenemez, kaldırılması gerekir ve veriler gider. Bu yüzden test APK'ları sabit bir test anahtarıyla imzalanır.
    - Anahtar, GitHub secrets'tan okunur: `PISI_ANDROID_TEST_KEYSTORE_BASE64`, `PISI_ANDROID_TEST_KEYSTORE_PASSWORD`, `PISI_ANDROID_TEST_KEY_ALIAS`, `PISI_ANDROID_TEST_KEY_PASSWORD`.
    - Keystore'u üretme komutlarını ve secret'ları ekleme adımlarını PR açıklamasına yaz. Secret'ları kullanıcı ekler.
    - Secret'lar yoksa iş akışı APK'yı yine üretir, ama özet bölümünde "Bu APK güncelleme olarak kurulamaz" uyarısını gösterir.
4. `.github/workflows/mobile.yml`:
    - Tetikleyiciler: `main`'e yapılan push ve PR'lar. Yol filtresi: `mobile/**`, `shared/**` ve iş akışı dosyasının kendisi.
    - Ortam: Node 24, Java 21 (temurin).
    - İşler:
        - **validate:** format, lint, i18n, test, build ve audit.
        - **e2e:** Playwright ile çalışır, ekran görüntülerini `pisi-mobile-screens` artifact'ı olarak yükler.
        - **android:** test APK'sını üretir, imzasını doğrular ve `Pisi-mobile-apk` artifact'ı olarak yükler (14 gün saklanır). Bu artifact **her PR'da** üretilir.
5. Kök araçlarla uyum:
    - Kökteki `prettier`, `eslint`, `check:syntax` ve `check:architecture` komutları `mobile/node_modules`, `mobile/dist` ve `mobile/android` klasörlerini atlar.
    - Kökte `npm run validate` geçer.
6. Uygulama kabuğu:
    - Yönlendirici kurulur ve altı ekran yer tutucu (placeholder) olarak eklenir: Pisi, Görevler, Notlar, Takvim, Haritalar, Ayarlar.
    - **Soğuk açılışta Pisi ekranı** gelir, bugünün tarihiyle.
    - Arka plandan dönüşte kullanıcı kaldığı yerde kalır.
    - Android geri tuşu:
        - Açık sheet veya diyalog varsa onu kapatır.
        - Alt ekrandaysa (ör. not editörü) bir üst ekrana döner.
        - Başka bir sekmedeyse Pisi sekmesine gider.
        - Pisi sekmesindeyse uygulamayı arka plana alır (kapatmaz).
    - Status bar rengi temaya uyar. Güvenli alan boşlukları (safe area) uygulanır.
    - Tema seçenekleri: sistem / açık / koyu.
    - i18n altyapısı (TR/ENG) ve anahtar eşitliği betiği eklenir.
7. `docs/mobile-qa.md`'yi mobile5'ten uyarla.
8. `CLAUDE.md` "Mobile" bölümüne komutları ve klasör yapısını ekle.

**Kabul:**

- PR'daki APK telefona kurulur ve açılınca Pisi yer tutucusu gelir.
- Geri tuşu yukarıdaki kurallara uyar.
- E2E ekran görüntüleri artifact olarak indirilebilir.

### M3 · Tasarım temeli ve görsel iyileştirme altyapısı

**Oku:** §5 (görsel iyileştirme listesi), `mobile5:src/styles.css` (ilk 60 satır, token'lar).

1. Önce mobile5'i çalıştırıp her sekmenin açık ve koyu temada ekran görüntüsünü al. Bunlar "önce" görüntüleridir; PR'a ekle.
2. `ui/tokens.css`:
    - Renkler: açık ve koyu tema. Mobile5'in sıcak paleti korunur, ama kontrast düzeltilir. Açık temadaki turuncu `#d9801f` metin olarak 2.8:1 kontrast veriyor ve AA'yı geçmiyor. Metin için daha koyu bir vurgu tonu eklenir.
    - Boşluk ölçeği: 4/8 tabanlı.
    - Köşe yarıçapları, gölge ve hareket süreleri.
    - Yazı ölçeği: 12 / 14 / 16 / 20 / 24 / 32.
    - **Tek yazı ailesi** kullanılır, arayüz ve editör aynı olur (G9).
3. Token çiftleri için otomatik bir kontrast testi ekle: metin için ≥ 4.5:1, arayüz öğeleri için ≥ 3:1.
4. İkon seti ekle (bkz. §3.4).
5. Temel bileşenleri yaz: düğme türleri, ikon düğme, çip/segment, liste satırı, kart, bottom sheet, diyalog, geri alma düğmeli snackbar, boş durum, metin alanı, onay kutusu (görünür boyutu 24 px, dokunma alanı 48 dp), FAB, üst başlık, etiketli alt menü.
6. Yalnız geliştirme derlemelerinde açılan bir bileşen galerisi ekle (`?gallery`). E2E bu sayfanın açık/koyu ekran görüntüsünü alır.

**Kabul:**

- Galeri görüntüleri artifact'ta bulunur.
- Kontrast testi geçer.
- §5'te "M3" diye işaretli maddeler çözülmüştür.

### M4 · Veri katmanı ve masaüstü uyumluluğu

**Oku:** `pisi-definition.md` (tamamı), `docs/single-source-of-truth.md`, `docs/atomic-mutations.md`, `docs/project-integrity.md`, `main/functions/task-store.js`, `main/functions/document-store*.js`, `main/functions/project-operations.js` (yeni proje iskeleti), `scripts/generate-project-fixture.mjs`.

**Önce plan yaz, onay bekle.**

1. §3.3'teki sürücüleri, `ProjectWriter`'ı ve repo'ları yaz.
2. **Proje iskeleti:** ilk açılışta proje yoksa `Pisi Projem` adıyla bir proje oluştur. İskelet, masaüstünün yeni proje oluştururken yazdığıyla aynı olmalıdır: `.pisi/` dosyaları, `diary/` ve `.pisi-diary`.
3. **TaskRepo:** `list`, `upsert`, `setStatus` ve tekrar eden görevin tamamlanması. Normalizasyon `shared/task-model.mjs` ile yapılır, V3 ve V5 kuralları uygulanır.
4. **NoteRepo:**
    - Hafif bir indeks tutar: id, başlık, yol, `updatedAt`, önizleme metni.
    - `read` bir notu okur.
    - `updateContent` notun içeriğini blok düzeyinde bir yama (patch) ile değiştirir. Notun diğer alanları aynen kalır.
    - `create` yeni not oluşturur. Dosya adı, sidecar ve kimlik kuralları `shared/`'dan gelir.
5. **DiaryRepo:** `diary/YYYY-MM-DD.node` okur ve yazar. Dosya **ilk karakter yazıldığında** oluşturulur, boş günlük dosyası yaratılmaz.
6. **MapRepo:** `.map` dosyasını, `.pisi/relationships.json`'ı ve `relationshipViews`'u okur.
7. **Uyumluluk testi:** kökte `tests/mobile-desktop-compat.test.mjs` adında bir test yaz. Masaüstü CI'ı da bu testi çalıştırır. Test şu adımları izler:
    - Bir örnek proje üret. Projede Sheet, Paint, görsel ve dosya bloğu olan notlar, görevler, ilişkiler, bir harita ve günlük dosyaları bulunsun.
        - `scripts/generate-project-fixture.mjs` bugün yalnız not, harita, sidecar ve id-link üretiyor. Görev, ilişki, günlük ve Sheet/Paint/görsel/dosya bloğu üretmiyor.
        - Bu eksik içerik elle yazılmış HTML veya JSON ile değil, **masaüstü kodunun kendisiyle** üretilir. Yollar: üreticiyi `main/functions` servislerini çağıracak şekilde genişlet ya da bir masaüstü E2E'siyle oluştur.
        - İkisi de olmazsa gerçek masaüstünde oluşturulmuş küçük bir projeyi `tests/fixtures/desktop-project/` altına ekle ve nasıl üretildiğini yaz.
    - Mobil repo'ları `NodeFsDriver` ile çalıştır ve şu işlemleri yap:
        - Görev ekle, görev tamamla, tekrar eden görevi tamamla.
        - Sheet bloğu olan bir notta tek bir paragrafı düzenle.
        - Yeni not oluştur, bugünün günlüğünü yaz.
    - Ardından şunları doğrula:
        - (a) Masaüstü Project Integrity denetimi **yeni bulgu** üretmiyor.
        - (b) Dokunulmayan dosyalar bayt bayt aynı.
        - (c) Düzenlenen notta yalnız ilgili blok değişmiş.
        - (d) `tasks.json` içindeki bilinmeyen alanlar ve diğer kayıtlar korunmuş.
        - (e) Masaüstü `task-store` mobilin yazdığı görevleri aynı biçimde okuyor.
        - (f) Bozuk bir `tasks.json` verildiğinde mobil o dosyayı ezmiyor.
8. **Geliştirici menüsü:** yalnız debug derlemelerinde, Ayarlar'da "Örnek proje yükle" seçeneği. Aktarım gelene kadar telefonda bu örnek proje ile test edilir.

**Kabul:**

- Uyumluluk testi ve vitest birim testleri geçer.
- Uygulama yeniden başlatıldığında veriler kalıcıdır. E2E bunu sayfayı yeniden yükleyerek doğrular.

### M5 · Pisi sekmesi: başlangıç ekranı

**Oku:** `mobile5:src/main.js` (`renderPisiDay` ve çevresi), `mobile5:src/styles.css` (`.pisi-*`), `shared/task-views.mjs`.

**Korunacak kimlik:**

- Sağ alt köşedeki çapraz tarih çarkı ve ay etiketi.
- Sol alttaki menü (launcher) düğmesi.
- Bu sekmede alt menünün gizli olması.
- Önce günlük, sonra görevler sıralaması ve aradaki vurgu çizgisi.
- Sıcak tema.

**Ekran tanımı:**

1. **Üst başlık:**
    - Seçili gün "Perşembe, 12 Kasım" biçiminde yazar. Seçili gün bugünse yanında "Bugün" etiketi görünür.
    - Başlığa dokununca tarih seçici bir bottom sheet açılır.
    - Seçili gün bugün değilse "Bugüne dön" düğmesi görünür.
2. **Günlük bölümü:**
    - Başlığı "Günlük" (ENG'de "Diary").
    - Satır içinde düzenlenir. Boşken en az 3 satır yüksekliğinde olur ve "Bugün neler oldu?" ipucunu gösterir.
    - Otomatik kayıt yapılır (gecikmeli kayıt ve `pause` anında flush).
    - Dosya, ilk karakter yazıldığında `diary/YYYY-MM-DD.node` olarak oluşur.
3. **Görevler bölümü:**
    - Başlığı "Görevler".
    - Görevler şu gruplarda gösterilir:
        - "Gecikmiş": yalnız seçili gün bugünse görünür.
        - "Bu gün".
        - "Tamamlanan (n)": varsayılan olarak kapalıdır.
    - Grupların tanımı `shared/task-views.mjs`'ten gelir.
    - **Görev satırı:**
        - Tam genişlikte olur. Başlık en fazla 2 satıra sarılır, kırpılmaz.
        - Altında bir meta satırı vardır: saat (ör. `10:00`), öncelik işareti (1–5 için renk + erişilebilir ad) ve görevin geldiği not.
        - Sol tarafta onay kutusu bulunur. Dokununca görev tamamlanır, kısa bir titreşim verir ve 5 saniyelik "Geri al" snackbar'ı gösterir.
        - Satıra dokununca görev detayı bottom sheet olarak açılır (M6'daki bileşen; M5'te salt okunur bir sürümü yeterli).
    - **"+ Görev ekle" satırı:** Türkçe doğal dil kabul eder (`shared/date-parser.mjs`). Tarih verilmezse **seçili gün** kullanılır. Kaydetmeden önce ayrıştırılan tarih ve saat bir çip olarak gösterilir.
    - **Boş durum:** sade bir metin ve ekleme satırı.
4. **Tarih çarkı:**
    - Ay etiketi yerelleştirilir: TR'de "Kas", ENG'de "Nov".
    - Her gün öğesi en az 48 dp dokunma alanına sahip olur.
    - "Bugün" ve "seçili gün" görsel olarak ayrışır.
    - Görevi veya günlüğü olan günlerde nokta gösterilir.
    - Kaydırırken hafif titreşim olur. İçerik alanında sağa/sola kaydırma da günü değiştirir.
    - `prefers-reduced-motion` açıkken animasyon kısalır.
5. **Menü (launcher):**
    - Dokununca etiketli bir sekme listesi açılır (ikon + metin): Görevler, Notlar, Takvim, Haritalar, Ayarlar.
    - Her ekran en fazla 2 dokunuşla açılabilir. Bu, Pisi'nin "her özelliğe en fazla 3 tıkla ulaşma" ilkesine uyar.
6. **Açılış hızı:**
    - Pisi ekranı ilk açılışta, indeks tamamlanmadan önce görevleri ve günlüğü gösterir. Bunun için doğrudan `tasks.json` ve günün diary dosyası okunur.
    - E2E, büyük örnek projede bu ekranın görünme süresini ölçer ve PR'da raporlar.

**Kabul:**

- Soğuk açılışta Pisi ekranı ve bugün gelir.
- Görev ekleme ve tamamlama `tasks.json`'a doğru yazılır.
- Günlük yazılınca diary dosyası oluşur.
- Gün değiştirme her üç yolla çalışır: çark, kaydırma ve tarih seçici.
- Açık ve koyu tema ekran görüntüleri vardır.
- G2, G3, G4, G5, G15 ve G16 çözülmüştür.

### M6 · Görevler sekmesi + Hızlı ekle

**Oku:** masaüstündeki görev görünümleri (`renderer/tags/pisi-todo-*`), `renderer/productivity/pisi-quick-capture.mjs`, `pisi-definition.md` § "Görevler ve Calendar / Diary".

1. **Görünümler:** Bugün (**varsayılan**), Yaklaşan, Gecikmiş, Gelen kutusu (tarihsiz), Tamamlanan. Sayılar çiplerde gösterilir. Çipler ekrana sığmazsa yatay kaydırılır ve kenarda bir solma efektiyle bunun ipucu verilir (G14).
2. **Görev satırı:** M5'teki bileşen kullanılır.
3. **Görev detayı (bottom sheet):** başlık, durum (5 durum), öncelik (1–5), `dueDate`, `scheduledAt` (saat), `reminderAt` ve `reminderMode` (yalnız değer olarak saklanır, bildirim MVP'de yok), tekrar ve kaynak not bağlantısı (dokununca not açılır).
4. **Hızlı ekle:**
    - Üstte bir giriş alanı bulunur.
    - Masaüstüyle aynı ayrıştırıcı kullanılır.
    - Kaydetmeden önce ayrıştırılan alanlar çip olarak gösterilir. Örnek: "Yarın 14:00 · Öncelik 4 · Her hafta".
5. **Tekrar eden görev:** tamamlanınca davranış masaüstüyle aynıdır (`shared/task-model.mjs`).

**Kabul:**

- Masaüstündeki görünüm tanımlarıyla aynı örnek veri, aynı listeleri üretir. Bunu bir birim testi doğrular.
- G6 ve G14 çözülmüştür.

### M7 · Notlar

**Oku:** `renderer/editor/pisi-block-editor.mjs`, `docs/editor-keyboard-rules.md`, `docs/editor-paste-rules.md`, `pisi-definition.md` § "Block identity", "Arama, link", görsel ve dosya ekleri.

1. **Liste:**
    - Arama yapılır (başlık + düz metin, Türkçe eşleştirme kurallarıyla).
    - Filtreler: Tümü, Notlar, Günlükler. Sıralama son değişikliğe göredir.
    - Uzun listeler sanal kaydırmayla gösterilir (2.000 not akıcı kaymalı).
    - Önizleme metninde bloklar arasında boşluk vardır (G7).
    - Sabitleme özelliği yoktur, çünkü masaüstünde karşılığı yok (G8).
2. **Not görünümü ve düzenleme:**
    - Masaüstü blok HTML'i bloklara ayrılır.
    - **Düzenlenebilen bloklar:** paragraf, başlık (H1–H3), madde listesi ve numaralı liste.
    - **Salt okunur kart olarak gösterilen bloklar:** diğer tüm bloklar. Kart blok türünü ve "Masaüstünde düzenlenir" yazısını gösterir. HTML'leri bayt bayt korunur (V8).
    - **Görev blokları:** salt okunurdur. Durumları `tasks.json`'dan okunur. Dokununca görev detayı açılır ve değişiklik `TaskRepo` üzerinden yapılır.
    - **Görseller:** sidecar'dan okunup gösterilir. `blob:` URL'leri diske yazılmaz.
    - **Wiki-link'ler:** dokununca hedef not açılır.
    - Yeni oluşturulan blokların HTML'i ve kimlikleri masaüstü biçimindedir.
    - Mobilin kendi özniteliği eklenmez (V2).
    - Kaydetme blok düzeyinde bir yamayla yapılır. Hiçbir şey değişmediyse dosyaya yazılmaz (V4).
3. **Araç çubuğu:**
    - Klavyenin hemen üstünde durur.
    - Düğmeler: kalın, italik, başlık, madde listesi, numaralı liste.
    - İkonlar SVG'dir, dokunma alanları 48 dp'dir (G10).
4. **Başlık:**
    - Yeni not oluşturulurken başlık sorulur.
    - Mevcut notların başlığı MVP'de **salt okunurdur** (V9).
5. **Editör yazı tipi:** arayüzle aynı aile kullanılır (G9).

**Kabul:**

- Uyumluluk testi genişletilmiş haliyle geçer: değişmeyen not bayt bayt aynı kalır, tek blok düzenlendiğinde yalnız o blok değişir, bilinmeyen bloklar korunur.
- E2E testleri: not aç, düzenle, uygulamayı yeniden başlat, içeriğin kalıcı olduğunu doğrula.
- G7, G8, G9 ve G10 çözülmüştür.

### M8 · Takvim

1. **Ay ızgarası:**
    - Hafta pazartesi başlar, gün adları yerelleştirilir.
    - Bugün işaretlenir.
    - **Görevi olan günlerde** (`dueDate`/`scheduledAt`) ve günlüğü olan günlerde iki ayrı nokta gösterilir. Noktaların anlamı bir açıklama satırında yazar.
2. Bir güne dokununca **Pisi sekmesi o günle** açılır. Gün görünümü tek bir yerde, Pisi sekmesinde bulunur.
3. Miladi/Hicri/Çin takvim seçicisi **kaldırılır** (G12).

**Kabul:** takvimdeki noktalar örnek veriyle birebir eşleşir. Takvimden Pisi sekmesine geçiş E2E testiyle doğrulanır.

### M9 · Haritalar (yalnız görüntüleme)

**Oku:** `pisi-definition.md` § ".map belgesi" ve "Canonical semantic relationships", `main/functions/map-semantic-core.js`, `docs/scoped-filterable-maps.md`.

1. **Liste:** harita başlığı ve not sayısı gösterilir.
2. **Görüntüleyici:**
    - Notlar `nodes[].layout` konumlarında çizilir.
    - Bağlantılar `relationships.json`'dan gelir. Yalnız haritadaki notlar arasındaki ilişkiler, `relationshipViews` stilleriyle çizilir.
    - `map.edges` okunmaz.
    - Daraltılmış hub'lar dikkate alınır.
    - İki parmakla yakınlaştırma, kaydırma ve "ekrana sığdır" desteklenir.
    - Bir nota dokununca o not açılır.
3. **Performans:** 500 notluk bir harita akıcı kaymalıdır. Gerekirse canvas ile çizilir.

**Kabul:** örnek haritada düğüm ve bağlantı sayısı masaüstüyle aynıdır. Bunu bir birim testi doğrular. E2E görüntüsü artifact'ta bulunur.

### M10 · Ayarlar, cila ve cihaz kabulü

1. **Ayarlar:**
    - Tema ve dil seçimi.
    - Proje bilgisi: dosya sayıları ve bütünlük durumu.
    - Uygulama sürümü.
    - "Cihazlar arası aktarım: yakında" notu.
    - Geliştirici bölümü (yalnız debug derlemelerinde).
    - DriveSync ve "Two-way" metinleri kaldırılır (G13).
2. **Genel tarama:**
    - Geri tuşu.
    - Klavye: odaktaki alan klavyenin altında kalmamalı.
    - Yatay ekran: düzen bozulmamalı.
    - Android yazı boyutu %130.
    - TalkBack ile temel akışlar.
    - `prefers-reduced-motion`.
3. **Büyük proje testi:** M4'te genişletilen örnek proje üreticisiyle büyük bir proje oluştur (2.000 not, 5.000 görev). Şu süreleri ölç ve raporla:
    - Pisi ekranının ilk görünmesi.
    - Not listesi kaydırma akıcılığı.
    - Arama yanıt süresi.
4. **Cihazda kabul:** `docs/mobile-qa.md` listesi güncellenir ve kullanıcı bu listeyi kendi telefonunda uygular.

**Kabul:** kontrol listesindeki tüm maddeler işaretli olur. §5'te açık madde kalmaz.

---

## 5. Görsel iyileştirme listesi

Mobile5'in Pixel 7 görünümünde açık ve koyu temada alınan ekran görüntülerinden çıkarıldı. Her maddede çözüleceği faz yazılıdır.

| Kimlik | Şu an (mobile5)                                                                                                                     | Hedef                                                                                                                                                                                         | Faz   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| G1     | Alt menü ikonları unicode glyph (⌂ ⌘ ✓ □ ▤ ◉): kalınlıkları tutarsız, anlamları belirsiz, etiket yok. 6 öğe var.                    | Tek setten SVG ikonlar, altında kısa etiket, belirgin etkin durum. Sıra: Pisi · Görevler · Notlar · Takvim · Haritalar (5 öğe). Ayarlar Pisi menüsünden ve başlıktaki dişli ikonundan açılır. | M3    |
| G2     | Türkçe arayüzde "Diary", "Tasks", "Nov" gibi İngilizce metinler var.                                                                | Tüm metinler i18n'den gelir. TR'de "Günlük", "Görevler", "Kas".                                                                                                                               | M5    |
| G3     | Pisi ekranında seçili günün tarihi ve haftanın günü hiçbir yerde yazmıyor.                                                          | Üst başlık + "Bugün" etiketi + "Bugüne dön" düğmesi.                                                                                                                                          | M5    |
| G4     | Görevler dar çiplerde, başlık kırpılıyor ("TÜBİTAK raporunun yöntem…").                                                             | Tam genişlikte satır, başlık 2 satıra kadar sarılır, altında meta satırı.                                                                                                                     | M5    |
| G5     | Görevin saati (`scheduledAt`) gösterilmiyor.                                                                                        | Meta satırında saat ve öncelik işareti.                                                                                                                                                       | M5    |
| G6     | Görevler sekmesi "Inbox" ile açılıyor. Bugünün görevleri varken liste boş görünüyor.                                                | Varsayılan görünüm "Bugün". Etiket TR'de "Gelen kutusu".                                                                                                                                      | M6    |
| G7     | Not kartı önizlemesinde bloklar boşluksuz birleşiyor ("GündemMobil…", "olacakGörseller").                                           | Bloklar arasında boşluk veya satır sonu.                                                                                                                                                      | M7    |
| G8     | Kart köşelerinde dekoratif yaylar var, anlamı belirsiz ◇ sabitleme simgesi var.                                                     | Sade kart. Sabitleme MVP'de yok.                                                                                                                                                              | M7    |
| G9     | Editör gövdesi serif (Georgia/Iowan), arayüz sans.                                                                                  | Arayüz ve editörde tek yazı ailesi.                                                                                                                                                           | M3/M7 |
| G10    | Editör araç çubuğunda glyph ikonlar (≡ ☐ ⌁) ve küçük dokunma alanları var. Yazı/Çizim/Tablo sekmeleri bulunuyor.                    | SVG ikonlar, 48 dp dokunma alanı, klavyenin üstünde duran araç çubuğu. Çizim/Tablo sekmeleri kalkar (salt okunur kartlar).                                                                    | M7    |
| G11    | Yardımcı ve ipucu metinleri küçük ve soluk. Açık temada turuncu vurgu metni 2.8:1 kontrastla AA'yı geçmiyor ("Tümü", "Nov", "NOT"). | En az 13–14 px boyut, metin için ≥ 4.5:1 kontrast, metin için ayrı koyu vurgu tonu.                                                                                                           | M3    |
| G12    | Takvimin üstünde Miladi/Hicri/Çin seçicisi yer kaplıyor. Görevi olan günler işaretli değil.                                         | Seçici kalkar, görev ve günlük noktaları eklenir.                                                                                                                                             | M8    |
| G13    | Ayarlar'da DriveSync ve Two-way kurulum metinleri var.                                                                              | Kaldırılır, "aktarım yakında" notu eklenir.                                                                                                                                                   | M10   |
| G14    | Görev filtre çipleri ekrandan taşıyor ("Tamamlanan" kesik), kaydırılabildiğine dair ipucu yok.                                      | Kenarda solma efektiyle yatay kaydırma veya daha kompakt çipler.                                                                                                                              | M6    |
| G15    | Tarih çarkında öğeler küçük, bugün ve seçili gün ayrışmıyor.                                                                        | 48 dp dokunma alanı, bugün/seçili ayrımı, görev ve günlük noktaları.                                                                                                                          | M5    |
| G16    | Pisi ekranında orta alan boş, görsel hiyerarşi zayıf.                                                                               | Başlık, bölümler, gruplar ve boş durumlarla dengeli bir düzen.                                                                                                                                | M5    |
| G17    | Uygulama Notlar sekmesiyle açılıyor.                                                                                                | Soğuk açılışta Pisi sekmesi ve bugün.                                                                                                                                                         | M2/M5 |

**Tasarım ilkeleri:**

- Pisi'nin karakteri korunur: sıcak palet, kedi ikonu, köşedeki çapraz tarih çarkı.
- Sakin ve az öğeli ekranlar.
- Tek elle kullanım: birincil eylemler ekranın alt yarısındadır.
- Her özelliğe en fazla 3 dokunuşla ulaşılır.
- Metinler önce Türkçe düşünülerek yazılır.

---

## 6. Kapsam dışı (MVP)

Aşağıdakiler MVP'ye girmez. Her biri ayrı bir karar ve ayrı bir plan gerektirir.

- Cihazlar arası aktarım ve senkron (ayrı plan, bkz. §8). Gerçek projeyi telefona getirmek de buna dahildir.
- Not, görev ve harita silme; not yeniden adlandırma (V9).
- Sheet, Paint/canvas düzenleme; görsel ve dosya ekleme.
- Harita düzenleme.
- Not içinde görev bloğu oluşturma.
- Wiki-link oluşturma (yalnız açma var).
- Bildirimler ve hatırlatma zamanlaması.
- Sürüm geçmişi arayüzü, çöp kutusu arayüzü, Bases/özellik görünümleri, dışa aktarma.
- iOS, Play Store yayını, tablet için özel düzen. Tablet MVP'de telefon düzeniyle çalışır, bozulmaması yeterlidir.

---

## 7. Oturum başlatma metinleri

**İlk oturum (M0):**

```text
maggezer/Pisi reposunda çalışıyoruz. Ekteki pisi-mobil-plan.md dosyasını docs/mobile-plan.md olarak ekle,
CLAUDE.md'ye kısa bir "Mobile" bölümü yazıp bu belgeye bağla ve M0'ı bitir. Belgenin §0'daki çalışma
kurallarına uy, PR'ı aç ve dur.
```

**Sonraki her oturum:**

```text
maggezer/Pisi reposunda çalışıyoruz. Önce CLAUDE.md ve docs/mobile-plan.md dosyalarını oku.
Sıradaki faz: M<numara>. Belgenin §0'daki çalışma kurallarına uy. Bu faz birden fazla modüle dokunuyorsa
önce uygulama planını yaz ve onayımı bekle. Bitince PR'ı oturum raporuyla aç ve dur.
```

---

## 8. Sonraki plan: aktarım

Bu belge tamamlandıktan sonra ayrı bir "aktarım planı" yazılacak. Bu planın şimdiden bilinen sınırları:

- Pisi kendi eşleştirme sistemini kullanacak. Google Drive gibi ikinci bir uygulamaya dayanmayacak.
- Senkron sonrasında proje baştan yeniden yüklenmeyecek. Yalnız değişen dosyalar güncellenecek, açık not ve imleç korunacak (`pisi-error.md` §4, "Yeni eşleştirme sistemi için kural").
- Mobil tarafta bağlanma noktası `ProjectWriter`'ın `fileChanged` olayıdır.
