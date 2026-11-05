# PISI Güncelleme Takip Dosyası

## 05-11-2026 — Diary görev düzenleyicisinde kullanılmayan tarih parametresi kaldırıldı

- `organizeDiaryManualTasks` imzası `(content, options)` oldu. `fileDate`
  yalnız eski `Görevler · <tarih>` başlığı için kullanılıyordu; başlık 1beb0df
  ile tarihsiz hale geldiğinden parametrenin işlevi kalmamıştı.
- Mevcut başlıktaki tarihin silinmesi korunur ve diary entegrasyon testinde
  açıkça doğrulanır.

## 05-11-2026 — Audit istisnası kaldırıldı ve CI yeniden yeşile döndü

- Kilitli bağımlılıklar semver aralıkları içinde güncellendi; `electron` 43.8.x
  ve `undici`/`fast-uri` high/moderate advisory’leri kapandı.
- `GHSA-g3hv-75wg-m249` için yalnız etkilenen `minimatch` 7.x–11.0.0 sürümleri
  `package.json` `overrides` ile `^11.0.4`’e yükseltildi; eski API kullanan
  minimatch 3.x/5.x bağımlılıkları değiştirilmedi.
- `sprintf-js` (`GHSA-hp3w-g68c-fv3c`) bulgusu artık audit’te görünmediği için
  geçici dev-tooling istisnası kaldırıldı; `npm run audit` runtime ve full
  ağaçta moderate+ sıfır bulgu ister.
- `document-store-diary.js` içindeki kullanılmayan parametre lint hatası
  giderildi.

## 11-10-2026 — P2.4 map ağacında eski yanıt koruması

- Map dalı yüklemeleri container başına istek kimliği taşır. Daha yeni yükleme
  başladıysa eski başarı/hata yanıtları DOM’u değiştiremez.
- Kontrol IPC yanıtından ve asenkron child oluşturma adımlarından sonra,
  ayrıca hata yakalama yolunda uygulanır; proje değişmişse yanıt atılır.
- Farklı dallar birbirini engellemez; henüz DOM’a eklenmemiş dalların ilk
  oluşturulması çalışmaya devam eder.
- Geciken başarı/hata, child oluşturma yarışı, bağımsız dallar ve proje
  değişimi regresyon testleriyle doğrulandı.

## 11-10-2026 — P2.3 Canvas/Sheet integrity taraması

- Attachment taraması canonical asset referans toplayıcısını kullanarak
  `data-pisi-asset` ve `data-pisi-sheet-asset` hedeflerini de denetler.
- Canvas/Sheet dosyaları yalnız sahibi olan node sidecarında aranır; node
  yanındaki aynı adlı dosya veya hedefteki bir klasör eksik asset’i gizlemez.
- Eksik hedefler mevcut manuel attachment kurtarma uyarısıyla raporlanır;
  tekrarlanan referanslar tekilleştirilir, belge içeriği değiştirilmez.
- Regresyon testleri eksik/mevcut asset, eksik sidecar, yanlış konumdaki dosya
  ve normal src/href eklerinin taranmasını doğrular.

## 11-10-2026 — P1.4 history restore konum bütünlüğü

- History restore geçmişteki belge içeriğini geri getirirken güncel `pisi`
  metadata’sını korur; yalnız `updatedAt` yenilenir.
- Taşıma/yeniden adlandırma sonrası parentMap, başlık ve sidecar bilgileri
  eski snapshot değerlerine dönmez; kaldırılmış sistem rolleri yeniden oluşmaz.
- Haritaya ve harita dışına taşınan, yeniden adlandırılan notlar için testler
  içerik/property geri yüklemesini, güncel metadata’yı ve restore öncesi güvenlik
  snapshot’ını doğrular.

## 11-10-2026 — P1.3 tek canonical history üreticisi

- Portability içindeki sıkıştırılmamış `.json` history üretici/okuyucu/restore
  uygulamaları kaldırıldı. Mevcut public binding’ler doğrudan bounded gzip
  history servisine bağlandı; property, template ve task çağrıları da aynı
  saklama, indeks ve retention politikasını kullanır.
- Merkezi backup restore canonical snapshot servisini kullanır; geri
  getirilecek asset referansları snapshot/GC boyunca korunur.
- Gerçek property/template/backup servislerini çalıştıran entegrasyon testleri
  geçmiş görünürlüğünü, gzip formatını ve sonraki GC’de asset korunmasını doğrular.
- Eski `.json` verileri için migration/compatibility okuyucusu eklenmedi.

## 10-10-2026 — P2.2 release hazırlığı (uçtan uca doğrulama bekliyor)

- Mevcut `v0.11.0` beta yayını doğrulandı; eski tag ve asset’ler korunur.
- Yeni yayın çakışmasını önlemek için package/lockfile sürümü `0.11.1` oldu
  ve bu sürümün yayın notları eklendi.
- Açıklar kaydındaki hiç release olmadığı ifadesi düzeltildi.
- P2.2 ancak gerçek yeni tag yayını ve Partner Center submission sonucu
  doğrulandığında kapatılacaktır; hazırlık commit’i tamamlanma kanıtı değildir.

## 10-10-2026 — P2.1 Store zorunlu doğrulama kapısı

- Store workflow’una tag ve manuel tetiklemelerde koşulsuz çalışan audit,
  format ve kaynak doğrulama job’ı eklendi.
- Paketleme ve aynı job içindeki yayın adımları `needs: validate` ve başarılı
  validation sonucu şartına bağlandı; iki checkout aynı `github.sha` kullanır.
- Store kimlikleri yokken de validation çalışır; paketleme yine atlanır.
- Workflow regresyon testi tetiklemeleri, aynı commit doğrulamasını, zorunlu
  adımları ve paketleme/yayın bağımlılığını YAML üzerinden kontrol eder.

## 10-10-2026 — P1.2 Sheet entity round-trip düzeltmesi

- Sidecar JSON doğrulaması HTML attribute çözümlemesinden ayrıldı; ham JSON
  ve object girdilerindeki literal entity metinleri değiştirilmez.
- HTML attribute sınırında named/numeric entity çözümlemesi tek geçişte yapılır;
  çözülmüş ampersand üzerinden ikinci kez entity çözümlemesi uygulanmaz.
- Hydration sırasında `<` ve `>` attribute içinde escape edilir; tekrar
  kaydetmede tablo etiketi ayrıştırılması bozulmaz.
- Dört regresyon testi ham JSON/object girdilerini, iki tırnak türünü, üç
  ampersand kodlamasını ve üç save/reopen döngüsünde model/hash bütünlüğünü kapsar.

## 10-10-2026 — P1.1 History restore asset koruması

- `before-restore` snapshot’ı alınırken retention hedef history kaydını budasa
  bile geri getirilecek Canvas/Sheet sidecar referansları GC’den korunur.
- Koruma yalnız restore işlemine aittir; ilgisiz orphan asset temizliği devam
  eder ve geri yazımdan sonra dosyaları canlı node içeriği korur.
- Varsayılan 50 sürüm sınırı ve byte bütçesi için iki regresyon testi eklendi;
  hedef snapshot gerçekten silinirken PNG/JSON byte bütünlüğü ve yeniden
  hydrate edilen içerik doğrulanır.

## 10-10-2026 — P3.2 compatibility kalıntılarının temizlenmesi

- Kaldırılmış alt görev sisteminin etkisiz `getPisiSubtaskParentIdSecondRelease`
  ve `addPisiSubtaskSecondRelease` fonksiyonları, module API/export ve manifest
  kayıtlarıyla birlikte kaldırıldı.
- Yalnız bu etkisiz yolun kullandığı TR/EN hata çevirileri temizlendi.
- Font modülündeki kullanılmayan `ensurePisiEditorSystemFontOptions` ve
  `PISI_SYSTEM_FONT_OPTIONS` alias’ları kaldırıldı; mevcut extra-font API korundu.
- Mevcut regresyon kontrolleri kaldırılan compatibility yüzeylerini artık
  zorunlu tutmayacak biçimde güncellendi.

## 10-10-2026 — sprintf-js / electron-builder audit policy

- `GHSA-hp3w-g68c-fv3c` için upstream patched npm sürümü olmadığı doğrulandı.
- Risk yalnız `electron-builder@26.15.7` altındaki dev-tooling zincirinde;
  production/runtime dependency ağacında değildir.
- Genel `audit || true` veya `npm audit fix --force` downgrade yerine
  `scripts/audit-dependencies.js` ile fail-closed iki katmanlı audit eklendi.
- Runtime audit moderate+ seviyede sıfır bulgu ister.
- Full audit yalnız exact advisory + exact sekiz package + pinned lockfile node
  ve sürümler + `dev: true` koşulları aynı anda sağlanırsa geçici exception’ı
  kabul eder.
- Advisory/severity/package/node/version drift veya runtime’a sızma CI ve Release
  audit gate’ini tekrar kırar.
- Regresyon testleri exception’ın dar kapsamını ve CI/Release audit gate’lerinin
  bastırılmadığını doğrular.

## 06-10-2026 — P2.3 Windows packaging smoke

- `Cross-platform Packaging Smoke` workflow’una gerçek `windows-latest` job’ı
  eklendi.
- Signing auto-discovery kapalı smoke build’de NSIS x64/ARM64 ve Portable
  x64/ARM64 paketleri ayrı ayrı üretiliyor.
- Dört Windows EXE’nin varlığı, sıfırdan büyük boyutu ve PE `MZ` imzası
  doğrulanıyor.
- Smoke ilk koşuda Windows PowerShell/npm üzerinden kısa
  `-c.extraMetadata...` override biçiminin electron-builder tarafından config
  dosya yolu gibi yorumlandığını yakaladı. Windows smoke ve gerçek release
  workflow’u `--config.*` uzun biçimine geçirildi.
- Regresyon testi Windows/macOS/Linux job’larının tek parse edilebilir packaging
  workflow’unda kalmasını ve Windows x64/ARM64 NSIS + Portable sözleşmesini
  koruyor.
- GitHub Actions run `37459640076`: Windows, macOS ve Linux packaging smoke
  job’larının tamamı başarılı.

> Bu dosya tarihsel değişiklik günlüğüdür; eski tarihlerde yazılmış “ertelendi”,
> geçiş, uyumluluk veya eski veri biçimi notları aktif mimari sözleşme değildir.
> Güncel mimari için `pisi-definition.md`, `docs/single-source-of-truth.md`,
> `docs/domain-command-query.md`, `docs/storage-abstraction.md` ve ilgili
> domain belgeleri esas alınır.

## 04-10-2026 — P2.4 canonical mimari doküman temizliği

- Domain command/query belgesi tek `pisi:domain-query` / `pisi:domain-command`
  transportuna göre yeniden yazıldı; kaldırılmış compatibility IPC geçiş anlatımı
  çıkarıldı.
- Property schema belgesinden legacy alias/migration akışları kaldırıldı; eksik
  veya desteklenmeyen property state’inin otomatik dönüştürülmediği canonical-only
  kuralı netleştirildi.
- Storage belgesinden kaldırılmış task migration marker’ı ve “transitional
  compatibility architecture” anlatımı çıkarıldı; aktif ProjectStorage +
  project-fs bridge sınırı tanımlandı.
- Project Integrity ve Trash restore belgeleri current-contract audit/rebuild
  davranışına hizalandı; `map.edges` / persisted `connectionTypes` eski mimari
  beklentileri aktif dokümantasyondan çıkarıldı.
- README’de runtime state köprüsü canonical state’ten ayrıldı; stale Sheet,
  paketleme ve sabit test-sayısı bilgileri güncellendi.

## 03-10-2026 — P3.10 E2E kullanıcı senaryoları

- Electron E2E artık smoke/startup kontrollerine ek olarak gerçek kullanıcı
  akışını çalıştırıyor: node oluşturma, editörde yazma, kaydetme, sekmeyi
  kapatıp yeniden açınca içeriğin diskten geri gelmesi.
- Map oluşturma, standalone node'u tree drag/drop ile map altına taşıma, map
  node'unu sürükleyerek yerleşimi değiştirme ve map kapatılıp yeniden
  açıldığında hem üyeliğin hem koordinatların korunması doğrulanıyor.
- Senaryo ayrı `electron-user-workflow-e2e.mjs` dosyasında tutuluyor;
  mevcut ayrıntılı smoke E2E ile ardışık çalışıyor.

## 03-10-2026 — P3.7 CSS konsolidasyonu / CI düzeltmesi

- Önceki konsolidasyondaki 51 global CSS dosyasının içeriği ve yükleme sırası
  9 bundle içinde eksiksiz korunuyor; önceki commit ile karşılaştırıldı.
- CI'ın okuduğu kaldırılmış CSS dosya yolları güncel bundle yollarına taşındı.
- Modal kapatma stili sıralama testi artık aynı importu kendisiyle değil,
  bundle içindeki ilgili kaynak bölümlerinin sırasını karşılaştırıyor.
- To-do ve map seçimi negatif stil kontrolleri ilgili kaynak bölümüyle
  sınırlandı; diğer bileşenlerin geçerli kuralları yanlış hata üretmiyor.
- CSS giriş noktası, masaüstü paketleme kapsamı, yerel asset URL'leri ve iç içe
  import yasağı regresyon denetimine alındı.
- `npm run validate`: format, syntax, architecture, branding, i18n, checkJs,
  lint ve **643/643 test başarılı**.

## 29-07-2026-1

- `w1`, `w2` ve `w3` silindi.
- `pisi-error.md` ile hata takibi başlatıldı.

## 29-07-2026-2

- **[Kritik · kesin] Paint çizimleri yeniden açıldığında yüklenmiyor ve
  sonradan tamamen silinebiliyor** hatası düzeltildi.

## 29-07-2026-3

- **[Kritik · kesin] Map silme sırası toplu veri kaybına açık** hatası
  düzeltildi.
- **[Kritik · kesin] Node silme de yanlış sırada ve geri alınamıyor** hatası
  düzeltildi.
- Map ve node silmeleri transaction düzenine alındı; dosya, sidecar ve bağlantı
  metadata’sı birlikte hazırlanıyor, başarısızlıkta geri alınıyor ve başarıda
  sistem Çöp Kutusu’na taşınıyor.

## 29-07-2026-4

`pisi-error.md` içindeki kalan bulgular veri kaybı, güvenlik, eşzamanlı kayıt,
map bağlantıları, diary/calendar, tags/missions, performans, erişilebilirlik,
paketleme ve dokümantasyon başlıklarında yeniden denetlendi.

### Veri ve dosya güvenliği

- **4:** Renderer IPC dosya yolları aktif projenin gerçek köküyle
  sınırlandırıldı. Dosya türü, varlık türü ve symlink/junction kaçışı her
  işlemde doğrulanıyor.
- **5, 35, 36:** Map/node kimlikleri katı desenle doğrulanıyor,
  `crypto.randomUUID()` ile üretiliyor ve aynı map içindeki duplicate node
  kimliği açılışı durduran açık bir hataya dönüşüyor.
- **6, 7, 19, 20:** Kapanış, proje değişimi, sekme değişimi ve sekme kapatma
  öncesinde modal, center editor, map layout ve kamera kayıt kuyrukları
  boşaltılıyor. Başarısız kayıt sekmeyi/pencereyi kapatmıyor. Center ve modal
  kayıtları seri kuyruk ve revision kontrolü kullanıyor.
- **8, 9:** Bozuk veya boş `.node/.map` dosyası yeni boş içerikle ezilmiyor.
  Dosya listesi sağlam öğeleri göstermeye devam ediyor; bozuk dosya için
  kurtarma yedeği oluşturulabiliyor.
- **17:** JSON yazımları hedefle aynı klasörde geçici dosya, `fsync`, önceki
  sürüm yedeği ve atomik rename kullanıyor.
- **18, 26, 27:** Rename, move, tree reparent ve map/node bağlantı metadata
  güncellemeleri geri alma veya çoklu-belge transaction akışına alındı.
- **21–24:** Map/klasör rename ve move sonrasında bütün descendant sekme,
  aktif map node, center editor ve modal yolları güncelleniyor. Silinen
  map/node ile ilişkili ölü sekmeler ve editörler kapatılıyor.
- **25:** Map silme onayı, map ile birlikte Çöp Kutusu’na taşınacak child node
  sayısını açıkça gösteriyor.
- **37–39:** Dış dosya değişiklikleri map açıkken de işleniyor. Global süreli
  bastırma yerine yalnızca PISI’nin gerçekten yazdığı yollar kısa süreli
  filtreleniyor. Alt klasörler Windows, Linux ve macOS’ta ayrı watcher’larla
  izleniyor.
- **71–73:** Yol karşılaştırması yalnızca Windows’ta küçük harfe çevriliyor;
  Windows reserved dosya adları temizleniyor; yalnızca gerçek PISI sidecar ve
  marker/metadata taşıyan diary klasörleri gizleniyor. Aynı adlı normal
  kullanıcı klasörüne marker eklemek yerine işlem güvenli biçimde duruyor.
- **77, 78:** Explorer listelemesi metadata’yı salt-okunur inceliyor; yalnızca
  okuma sırasında sidecar veya dosya oluşturmuyor ve bellekte sahte
  `updatedAt` üretmiyor.
- **79, 80:** `process.chdir()` kaldırıldı. Tek uygulama örneği kilidine ek
  olarak PID, instance kimliği ve eski kilit kurtarması olan proje kilidi
  eklendi; kapanışta kilit temizleniyor.

### Formül, Paint ve editör

- **10:** `Function`/`eval` kullanımı kaldırıldı; CSP gevşetilmeden çalışan
  güvenli aritmetik ayrıştırıcı eklendi.
- **11, 16:** Formül aralıkları gerçek tablo ve 2.080 hücre sınırıyla
  sınırlandı. Tablo büyütme 80 satır ve 26 sütunda duruyor.
- **12, 13:** Excel’in geçici event-binding niteliği kayda girmiyor; yeniden
  açılan tablolar tekrar bağlanıyor. Düz metin girilen hücrede eski formül
  metadata’sı siliniyor.
- **14, 15:** `COUNT` ve `AVG` boş/sayısal olmayan hücreleri doğru ele alıyor;
  aralık içindeki döngü ve hesap hataları sessizce yutulmuyor.
- **75:** Paint PNG’si artık kalıcı HTML’de iki kez tutulmuyor;
  `data-image-loaded` ve diğer geçici bağlama nitelikleri kayıttan temizleniyor.
- **76:** Büyük `ImageData` snapshot yalnızca çizgi, dikdörtgen ve elips önizleme
  araçlarında alınıyor; kalem ve silgi her pointer-down’da tüm tuvali
  kopyalamıyor.
- **83:** Editör HTML temizleyicisi etiket, nitelik, CSS özelliği ve URL
  protokolü allowlist’i kullanıyor. Diary’ye giden görev HTML’i ana süreçte
  ikinci kez güvenlik temizliğinden geçiyor.
- **85:** CSP ile çelişen inline başlangıç stili kaldırıldı ve `hidden`
  niteliğine taşındı.
- **93, 94, 97:** Modal kapatma, center/modal başlık ve center save kontrolleri
  HTML’e geri getirildi; iki editörde spellcheck açıldı.

### Map ve bağlantılar

- **28–31:** Self-loop, bozuk ID, type/role çelişkisi, eksik node referansı,
  semantic duplicate, ikinci parent ve hiyerarşi döngüsü normalize ediliyor.
  Aynı iki node arasında farklı ilişki türleri birlikte korunuyor. İkinci
  parent ancak kullanıcı onayıyla stream’e çevriliyor.
- **29:** Eski dosyada döngü bulunsa bile tree root fallback’i node’ları görünür
  tutuyor.
- **32–34:** Kamera, zoom, node konumu ve boyutu sonlu/güvenli aralıklara
  sıkıştırılıyor; silinmiş node layout kayıtları temizleniyor ve ilk yerleşim
  sıralı/deterministik üretiliyor.
- **62, 64:** Node drag/resize sırasında geçici global listener kullanılıyor ve
  işlem bitince kaldırılıyor; resize farkı map zoom oranına bölünüyor.
- **63:** Edge SVG öğeleri mümkün olduğunda yeniden kullanılıyor ve yoğun
  çizimler `requestAnimationFrame` ile birleştiriliyor.
- **65:** Map node metin önizlemesi 600 karakterle sınırlı.
- **66:** Map verisi ve zorunlu DOM öğeleri başarıyla yüklenmeden aktif sekme,
  aktif map veya board değiştirilmiyor.
- **67, 68:** Kamera autosave map yolu ve snapshot’ını zamanlanırken yakalıyor;
  collapse edilen hub portları map JSON’una kaydedilip yeniden açılışta
  uygulanıyor.
- **69, 70:** Proje ağacı yenilemesi gerçek render tamamlanana kadar await
  edilebilen seri/debounce kuyruğu kullanıyor; basename hem `/` hem `\\`
  ayırıcısını destekliyor.

### Diary, Calendar, Tags ve Missions

- **40–43:** Calendar tarih istekleri proje anahtarı ve request kimliği
  taşıyor; eski proje yanıtları yok sayılıyor. Diary imzası proje bazlı
  tutuluyor, yalnızca başarılı eşitlemeden sonra kaydediliyor ve eşitleme
  sırasında gelen son istek kuyruğa alınıyor.
- **44:** Eksik/başarısız proje taraması diary ile eşitlenmiyor. Ana süreç
  yalnızca `complete: true` zarfını ve bütünü geçerli görev listesini kabul
  ediyor; tek bir geçersiz girdi bile herhangi bir diary yazımından önce
  işlemi durduruyor. Çoklu diary yazımı transaction içinde.
- **45–48:** Managed alan çıkarılırken manuel içerik ve boşluklar korunuyor.
  Diary başlığı `DD-MM-YYYY`, dosya adı `YYYY-MM-DD` kalıyor; `parentMap` her
  onarımda `diary` yapılıyor. Boş görev listesi yeni `diary/` klasörü
  oluşturmuyor.
- **49–51:** Takvim state’i proje bazlı localStorage anahtarında tutuluyor;
  float görünüm gerçek boyutuyla ekran içine sıkıştırılıyor ve resize’da
  yeniden konumlanıyor. Dock alanı küçük pencerelerde esneyebiliyor.
- **52:** Tags/Missions tam proje taraması yazma başına 250 ms yerine 1 saniyelik
  birleştirilmiş yenileme kullanıyor.
- **53–56:** Standalone center node etiket indeksine katılıyor; diary managed
  kopyaları tekrar sayılmıyor; eski bloklara verilen kimlikler node’a
  kaydediliyor; sonuç vurgusu gerçekten CSS sınıfını ekleyip kaldırıyor.
- **57–60:** Tamamlanma durumu todo etiketi başına `data-pisi-done-for` ile
  tutuluyor. Başarısız kayıtta editor DOM’u geri alınıyor. Tamamlanan görevler
  gösterilip yeniden açılabiliyor. Todo tarihi iki veya dört basamaklı yıl
  kabul ediyor.
- **61:** Proje değişiminde kullanıcı etiket öneri önbelleği temizleniyor.

### Electron, arayüz ve bakım

- **81, 82, 84:** Renderer sandbox açıldı; production DevTools otomatik açılışı
  kaldırıldı; popup, navigation ve permission istekleri varsayılan olarak
  engelleniyor.
- **86–88:** `project:delete-path` main handler’ı eklendi; duplicate preload API
  anahtarı kaldırıldı; event abonelikleri unsubscribe fonksiyonu döndürüyor.
- **89–91:** Aynı scope’taki yinelenen fonksiyon bildirimleri kaldırıldı ve daha
  kapsamlı tree yenileme davranışı korundu. ESLint parsing/doğruluk kontrolü
  artık CI’da çalışıyor.
- **95, 96:** Tree satırları, map node’ları ve portlar klavye semantiği aldı;
  port bağlantısı klavyeyle kurulabiliyor. Custom confirm gerçek dialog,
  focus trap, doğru Enter/Escape davranışı ve önceki odağa dönüş kullanıyor.
- **99:** Sağ panel tablarının yatay scroll’unu iptal eden çelişkili
  `overflow:hidden` override’ı kaldırıldı.
- **102, 103, 106:** Electron `43.2.0`, electron-builder `26.15.7` ve ESLint
  `10.8.0` sürümlerine taşındı. Kullanılmayan dört production paketi
  kaldırıldı; runtime/build app ID `com.mumin.pisi` olarak birleştirildi.
- **104:** `check:syntax`, ESLint, Node test runner ve birleşik `validate`
  komutları eklendi. GitHub Actions her `main` push ve pull request’te
  `npm ci --ignore-scripts` ardından doğrulama çalıştırıyor. Formül, edge,
  layout/kamera, diary sanitizer, Paint kalıcılığı, Electron sınırları, PISI
  kimliği, normal diary klasörü koruması ve proje yolu için 16 otomatik test
  vardı; watcher/CSP/Paint/tree regresyonlarıyla toplam sayı 18’e çıktı.
- **105:** Windows NSIS ve portable hedefleri x64 yanında ARM64 üretiyor;
  artifact adı ürün, sürüm, işletim sistemi ve mimariyi içeriyor.
- **111–115:** README ve `pisi-definition.md` gerçek uygulama/dosya yapısına
  göre yenilendi; ISC `LICENSE` eklendi; `.gitignore` test, log, işletim
  sistemi, editör ve build cache çıktılarını kapsayacak biçimde genişletildi.

### Bilinçli olarak ertelenenler

- **16:** Satır/sütun silme, hücre biçimlendirme, formül referanslarını yapısal
  değişimde yeniden yazma ve çoklu hücre seçimi yeni özellik kapsamındadır;
  mevcut tablo özelliği değiştirilmeden bırakıldı.
- **74:** Paint/Excel kaynaklarını node JSON’undan sidecar dosyalarına taşıma,
  mevcut belgeler için migration ve geri uyumluluk tasarımı gerektiriyor.
  Mevcut Paint ve Excel özelliği korunarak ertelendi.
- **92:** Listelenen kullanılmayan yardımcı fonksiyonlar, özellik kaybı riski
  oluşturmamak için bu toplu düzeltmede silinmedi.
- **101:** Ana domain dosyalarını daha küçük modüllere bölme ayrı, geniş
  kapsamlı refactor olarak bırakıldı.

### Sonradan tamamlanan kalite / release maddeleri

- **92 / P3.9:** Temmuz auditinde listelenen eski sekiz kullanılmayan helper
  (`getConnectionRoleFromPort`, `getEdgeVisualTypeFromRoles`,
  `getNodeDocByIdInMap`, `getDirectTreeRow`,
  `updateTreeAfterSavedConnection`, `updateMapBoxAfterRename`,
  `getEditableBaseName`, `getBaseName`) sonraki modülerleştirmelerde zaten
  ortadan kalkmıştı. Güncel repo `no-unused-vars` ile yeniden tarandı; kalan
  ölü helper, import, local değişken ve kullanılmayan parametre artıkları
  temizlendi. `no-unused-vars` artık main ve renderer production kaynaklarında
  kalıcı ESLint kuralı olduğundan aynı bakım borcunun yeniden birikmesi CI
  tarafından engelleniyor.

- **98 / P3.7:** Global CSS konsolidasyonu tamamlandı. `style.css` 51 ayrı
  global import yerine 9 semantik bundle yüklüyor; eski tek-fix numbered CSS
  parçaları bundle'lara kaynak sırası korunarak taşındı. Renderer altındaki
  modül-sahipli lazy CSS dosyaları bilinçli olarak ayrı bırakıldı ve yeni
  `css-consolidation` testi global stil mimarisinin yeniden parçalanmasını
  engelliyor.
- **100 / P3.6:** Renderer ve Electron ana süreç domainleri ES module’a geçirildi.
  Uygulama `main.mjs` ile başlıyor; `main/package.json` `type: module` sınırını
  tanımlıyor ve mimari kontrolü ana süreçte `require` / `module.exports`
  kalmasını engelliyor. `sandbox: true` kullanılan `preload.js` ise Electron’ın
  sandbox preload modeli gereği bilinçli CommonJS uyumluluk sınırı olarak
  bırakıldı.
- **102:** Güncel CI’da `npm audit` **0 vulnerability** raporluyor; önceki
  paketleme zinciri güvenlik bulgusu notu artık güncel değildir.
- **104:** `checkJs: true` tabanlı TypeScript denetimi ve repository-wide
  Prettier dönüşümü tamamlandı. `npm run validate` format kontrolünü de içeriyor
  ve CI `npm run format:check` adımını zorunlu çalıştırıyor.
- **105:** macOS/Linux çok mimarili paket hedefleri, Microsoft Store için
  çok mimarili MSIX hattı ve Store-aware/direct auto-update altyapısı eklendi.
  Gerçek Windows/Apple signing kimlikleri, notarization ve production update
  feed/Store publishing ayarları dağıtım ortamında sağlanacak operasyonel
  girdiler olarak kalıyor.

**Özellik kaldırma durumu:** Uygulama özelliği kaldırılmadı. Kaldırılan
`@panzoom/panzoom`, `lunar-javascript`, `moment` ve `moment-hijri` paketleri
kaynak kodun hiçbir yerinde kullanılmıyordu; map, takvim, Paint, Excel, Tags,
Missions, diary ve sağ panel özellikleri korunuyor.

## 29-07-2026-5

- CSP’de yalnızca dinamik stil nitelikleri için `style-src-attr
'unsafe-inline'` açıldı. Harici stiller hâlâ yalnızca uygulama kaynağından
  yükleniyor; script tarafında `unsafe-inline` ve `unsafe-eval` açılmadı.
  Böylece özelleştirme renkleri, tree girintileri, map konumları ve güvenlik
  temizleyicisinden geçen zengin metin stilleri konsol ihlali üretmeden
  çalışıyor.
- Sol Explorer ağacı yenilenirken eski DOM artık baştan boşaltılıp düğümler
  tek tek ekranda gösterilmiyor. Yeni ağaç, genişletilmiş dallarıyla birlikte
  bağlantısız bir DOM parçasında hazırlanıp tek işlemde değiştiriliyor; mevcut
  scroll konumu korunuyor.
- PISI’nin kendi atomik dosya kayıtları watcher tarafında dosya
  boyutu/zaman imzasıyla takip ediliyor. Gecikmiş veya yinelenen Windows
  filesystem olayları altı saniyelik güvenli pencere içinde ayırt ediliyor;
  aynı dosya gerçekten başka bir program tarafından değiştirilirse imza
  farklı olduğu için dış değişiklik uyarısı yine gösteriliyor.
- Paint tuvalinin beyaz zemini yalnızca CSS görünümü olmaktan çıkarılıp gerçek
  canvas/PNG verisine işlendi. Yeni, temizlenen ve eski şeffaf Paint
  tuvallerinin zemini center editor ile modalda aynı biçimde beyaz kalıyor;
  silgi beyaza çizerek şeffaf/gri alan üretmiyor.
- Watcher imzası, CSP sınırı, Paint zemini ve atomik tree render davranışı için
  regresyon kontrolleri eklendi.

**Özellik kaldırma durumu:** Bu düzeltmede hiçbir uygulama özelliği veya
biçimlendirme seçeneği kaldırılmadı.

## 30-09-2026 — Sheet Phase 2

- Sheet güvenlik sınırı 80 × 26'dan **300 × 80** hücre ızgarasına çıkarıldı;
  çok harfli sütun adları (AA, AB, ...) destekleniyor.
- Satır ve sütun silme seçili dikdörtgen aralığa göre çalışıyor; tabloda en az
  bir satır ve sütun korunuyor.
- Hücreler fareyle sürükleme, Shift+tıklama, Shift+ok, satır/sütun başlıkları
  ve sol üst köşe üzerinden gerçek dikdörtgen aralık olarak seçilebiliyor.
- Seçili aralığa toplu bold/italic/underline/strike, font, boyut, yatay/dikey
  hizalama, wrap, yazı/dolgu rengi ve kenarlık işlemleri uygulanabiliyor.
- Table popover aktif Sheet için satır/sütun ve format araçlarını gösteriyor;
  ayrıca 300 × 80 sınırına kadar özel boyutlu yeni tablo oluşturabiliyor.
- Yapısal satır/sütun ekleme ve silmede formül referansları yeniden yazılıyor.
  Aralıklar kısmi silmede daralıyor, yalnız tamamen silinen aralıklar
  `#REF!` oluyor; quoted stringler ve `LOG10` gibi fonksiyon adları
  referans sanılmıyor.
- `$A$1`, `A$1`, `$A1` biçimindeki absolute referanslar formül
  ayrıştırıcısında destekleniyor.
- Sheet Phase 2 regresyonları dahil 2 Ekim 2026 tarihli güncel doğrulama
  **638/638 test**, aktif `checkJs` typecheck, repository-wide format-check ve
  Electron E2E ile yeşildir. Güncel `npm audit` sonucu **0 vulnerability**’dir.
