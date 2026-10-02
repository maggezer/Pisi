# PISI Güncelleme Takip Dosyası

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
- **98, 100, 101:** Tam CSS konsolidasyonu, klasik global scriptlerden ES
  module’a geçiş ve ana domain dosyalarını daha küçük modüllere bölme ayrı,
  geniş kapsamlı refactor olarak bırakıldı.
- **102:** `npm audit` kritik açığı **0** ve production-only açığı **0**
  gösteriyor. electron-builder’ın paketleme zincirinde 16 yüksek seviye
  geliştirme/build bulgusu sürüyor; npm’in önerdiği otomatik çözüm güncel
  sürüme yükseltmek yerine eski major sürüme düşürdüğü için uygulanmadı.
- **104:** Tam typecheck ve repository-wide otomatik format dönüşümü mevcut
  klasik global mimariyi geniş ölçüde değiştireceğinden bu turda yapılmadı.
- **105:** macOS/Linux ikonları ve paket hedefleri, code-signing sertifikası,
  SmartScreen itibarı ve otomatik güncelleme yayın sunucusu sağlanmadan güvenli
  biçimde tamamlanamaz; Windows’un mevcut release akışı korunarak ertelendi.

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
- Sheet Phase 2 regresyonları dahil güncel doğrulama **571/571 test** ve
  Electron E2E ile yeşildir.
