# PISI Güncelleme Takip Dosyası

## 07-11-2026 — Büyük haritalarda performans

- Harita açılışı O(N²) idi: her düğüm için harita klasörü baştan listeleniyordu
  (`ensurePisiSidecar` → `findExistingSidecarById`). Yan klasör zaten doğru
  adıyla varsa artık klasör taranmıyor; 1.000 düğümde main tarafı 16 sn'den
  0,25 sn'ye, 5.000 düğümde 373 sn'den 1,2 sn'ye indi.
- Bağlantılar dünya koordinatında, kamerayla birlikte dönüşen
  `#map-edge-layer` içinde çiziliyor; pan ve zoom bağlantıları yeniden
  hesaplamıyor. Yol geometrisi DOM ölçümünden (`getBoundingClientRect`, her
  bağlantıda zorunlu yeniden düzen) değil yerleşim değerlerinden geliyor.
  Sürüklemede yalnız taşınan düğümlerin bağlantıları güncelleniyor.
- Görünür alan ayıklama: yalnız kameranın gördüğü alan (+%25 pay) içindeki
  düğümler DOM'da; pan/zoom sırasında requestAnimationFrame ile güncelleniyor.
  Seçili, odaktaki, sürüklenen ve yeniden adlandırılan düğümler DOM'da kalıyor.
  Aramadan odaklama, klavye gezintisi, hizalama, otomatik yerleşim ve dışa
  aktarma tüm düğümleri görüyor.
- Zoom kademeleri: 0,6 ve üstü tam kart; 0,3–0,6 (veya "yalnız başlık") başlık
  kartı; 0,3 altında harita tek bir canvas üzerinde çiziliyor, tıklama o noktaya
  yakınlaşıyor.
- Ölçüm: `scripts/generate-map-fixture.mjs`, `npm run test:perf`
  (`scripts/electron-map-performance-e2e.mjs`); CI'da yalnız rapor üretir.
- Testler: `tests/map-viewport-core.test.mjs`, `scripts/electron-map-viewport-e2e.mjs`.

## 06-11-2026 — Harita düzenleme araçları

- Kopyala / yapıştır / çoğalt: Mod+C seçili düğümleri ve aralarındaki
  bağlantıları kopyalar. Mod+V not kopyalamaz; notları hedef haritaya referans
  olarak ekler ve bağlantıları aynı kimlikle gösterir (haritada zaten bulunan
  notlar atlanır). Mod+Alt+V ve Mod+D kopya not oluşturur (yeni kimlik,
  "(kopya)" başlığı, içerik, özellikler ve yan klasör varlıkları kopyalanır,
  görev kimlikleri kaldırılır) ve seçimdeki bağlantıları kopyalar arasında
  yeniden kurar. Yeni domain komutu `map.nodes.duplicate.v1` (atomik).
- Hizalama ve dağıtma: çoklu seçimde sola/ortaya/sağa, üste/ortaya/alta hizala;
  yatay/dikey eşit dağıt (düğüm bağlam menüsü ve komut paleti). Sürüklerken
  diğer düğümlere hizalama kılavuzları; isteğe bağlı "Izgaraya yapış" (20 px).
  Alt sürükleme sırasında yapışmayı kapatır.
- Otomatik yerleşim: seçili hub veya tüm harita için hiyerarşi bağlantılarına
  göre ağaç yerleşimi; 50'den fazla düğüm etkilenecekse onay sorulur.
- Klavye: ok tuşları en yakın komşu düğüme geçer, Shift+ok bir ızgara adımı
  kaydırır, Tab/Shift+Tab bağlı düğümler arasında gezer, Mod+Enter klavyeyle
  bağlantı kurar, Esc seçimi temizler. Odak halkası görünür; ekran okuyucu
  başlığı ve bağlantı sayısını duyurur. Bağlantı portları Tab sırasından çıktı.
- Dokunmatik: iki parmakla yakınlaştırma ve kaydırma; uzun basma bağlam
  menüsünü açar.
- Her işlem harita geçmişinde tek adımdır (yeni "toplu" adım türü).
- Testler: `tests/map-align-core.test.mjs`, `tests/map-auto-layout-core.test.mjs`,
  `tests/map-node-copy-core.test.mjs`, `tests/map-history-core.test.mjs`,
  `scripts/electron-map-editing-e2e.mjs`.

## 06-11-2026 — Haritada geri al / yinele

- Harita için komut geçmişi eklendi: düğüm oluşturma, silme (Trash), haritadan
  referans kaldırma, taşıma (bir sürükleme ve çoklu seçim taşıma tek adım),
  boyutlandırma, bağlantı ekleme/silme/tür değiştirme, hub daraltma/açma ve
  başlık düzenleme. Kamera hareketi (zoom/pan) geçmişe girmez.
- Her adım, işlemin kullandığı domain komutlarıyla geri alınır ve yinelenir
  (`map.relationship.upsert.v1`, `map.layout.save.v1`, `project.item.rename.v1`
  vb.); `relationships.json` ve `.map` aynı yoldan yazılır. Bağlantılar ve
  düğümler kimliklerini korur.
- Silmeyi geri alma Trash'ten geri yüklemedir (görev ve ilişki referansları
  dahil). Oluşturmayı geri alma düğümü Trash'e gönderir; yinele aynı düğümü
  geri yükler.
- Yeni domain komutu `map.reference.attach.v1`: haritadan kaldırılan bir
  referansı eski yerleşimiyle geri ekler (`map.reference.detach.v1`'in tersi).
- Kısayollar: harita odaktayken Mod+Z geri al, Mod+Shift+Z ve Mod+Y yinele.
  Not editörü, modal, Sheet veya bir giriş alanı odaktayken onların kendi
  geçmişi çalışır (`docs/editor-keyboard-rules.md`). Kısayollar komut kayıt
  sistemindedir ve Ayarlar'dan değiştirilebilir, çakışma denetimine tabidir.
- Harita zoom denetimlerinde geri al / yinele düğmeleri; yapılacak adım yoksa
  pasif, üzerinde sıradaki adımın adı ve kısayolu görünür.
- Geçmiş en çok 200 adım tutar; başka harita açılınca, proje kapanınca veya
  harita dosyası Pisi dışında değişince temizlenir.
- Testler: `tests/map-history-core.test.mjs`, `scripts/electron-map-history-e2e.mjs`.

## 06-11-2026 — Hatırlatmalar main süreçte, yerel bildirimlerle

- Tek model: canonical görevde `reminderAt` kesin andır. "Bitiş günü / 1 gün /
  3 gün önce" seçenekleri bitiş tarihinden Ayarlar → Hatırlatmalar'daki
  varsayılan saatle (ön tanım 09:00) hesaplanır; an dosyaya yazılmaz, bitiş
  tarihi ya da saat değişince hatırlatma kendiliğinden kayar. Quick Add ile
  yazılan saatli hatırlatmalar (ör. "yarın 14:00") artık tetikleniyor.
  Mevcut `tasks.json` kayıtları değişmeden okunur.
- Zamanlayıcı renderer'dan main sürece taşındı: `tasks.json`'dan sıradaki
  hatırlatmayı hesaplayan tek bir `setTimeout` (en çok 15 dk bekler). Görev
  yazımı, proje açma/kapama, ayar değişikliği, uykudan uyanma ve ekran kilidi
  açılınca yeniden planlanır.
- Bildirim Electron'un main süreç `Notification` API'siyle gösterilir. Tıklanınca
  pencere öne gelir ve görevin kaynak notu açılır. Renderer izin politikası
  değişmedi; diğer izinler reddedilmeye devam ediyor.
- macOS'ta bildirimde "10 dk ertele" ve "Tamamlandı" eylemleri var. Tüm
  platformlarda sağ alttaki hatırlatma listesinde Aç, 10 dk ertele, Tamamlandı
  ve Kapat düğmeleri bulunur.
- Kaçırılanlar sessizce atlanmıyor: uygulama kapalıyken zamanı geçen
  hatırlatmalar açılışta tek bir özet bildirim ve listede "kaçırıldı" olarak
  gösterilir. Eski localStorage kayıtları taşınmadığı için geçmişteki
  tamamlanmamış hatırlatmalar ilk açılışta bir kez listede görünür.
- "Gösterildi" kaydı localStorage yerine `.pisi/reminder-state.json` içinde
  atomik yazımla tutulur.
- İsteğe bağlı ayar: "Pencereyi kapatınca sistem tepsisinde çalışmaya devam et"
  (ön tanım kapalı). Açıkken pencere gizlenir; tepsi menüsünde "Pisi'yi aç" ve
  "Çık" vardır, "Çık" bekleyen kayıtları doğrulayan normal kapanışı çalıştırır.
- `renderer/tags/pisi-todo-third-*` içindeki eski `setInterval` zamanlayıcısı,
  localStorage kaydı ve renderer `Notification` kullanımı kaldırıldı; bunları
  regex ile okuyan test davranış testleriyle değiştirildi.
- Testler: `tests/reminder-schedule-core.test.mjs` (saat dilimi ve yaz saati
  dahil), `tests/reminder-service.test.mjs` (Electron stub'lı),
  `scripts/electron-reminders-e2e.mjs`.

## 06-11-2026 — Notlara dosya ekleri

- Görsel olmayan dosyalar "ek" bloğu olarak eklenir: dosya sürükle-bırak,
  panodan dosya yapıştırma, araç çubuğundaki "Dosya ekle" ve `/file` (`/dosya`)
  slash komutu. Görsellerle birlikte bırakılan dosyalarda görseller görsel
  bloğu, diğerleri ek bloğu olur.
- Saklama: not yan klasöründe `file/<sha256>.<uzantı>`; aynı içerik tek dosya.
  20 MB sınırı aşılınca anlaşılır mesaj gösterilir, dosya yazılmaz.
- Blok dosya adını, boyutunu ve türüne göre bir simge gösterir. Tık veya Enter
  dosyayı varsayılan uygulamada açar (`shell.openPath`); yol main'de not ve
  referanstan çözülür, proje dışı yol ve symlink reddedilir, hash doğrulanır.
  Çalıştırılabilir dosyalar (exe, msi, bat, sh, app, dmg, jar …) açılmaz,
  "Klasörde göster" yapılır. Alt+tık her ek için klasörde gösterir.
- Blok seçme, Delete/Backspace ile silme, geri al/yinele, blok taşıma ve
  kopyala-yapıştır çalışır; başka nota yapıştırılan ek o notun yan klasörüne
  kopyalanır.
- Project Integrity, sürüm geçmişi, yedek koruması, Trash ve 24 saat
  ertelemeli orphan temizliği `file/` varlıklarını tanır.
- Dışa aktarma: Markdown ve HTML eki `<ad>.assets/` klasörüne kopyalayıp
  bağlantı verir; PDF ve DOCX ad ve boyutu yazar.
- Testler: `tests/editor-file-assets.test.mjs`, `tests/editor-file-policy.test.mjs`,
  `tests/portability-canvas-export.test.js` (ek dışa aktarımı),
  `scripts/electron-file-attachments-e2e.mjs`.

## 06-11-2026 — Kimlikli not bağlantıları ve yeniden adlandırmada bağlantı güncelleme

- Editörde `[[` yazınca arama indeksiyle bulanık eşleşen not önerileri açılır;
  ok tuşları, Enter/Tab ve Esc paylaşılan menünün klavye sahipliğiyle çalışır,
  IME bileşimi sırasında açılmaz. `[[Not#` o notun bloklarını listeler; tam
  eşleşme yoksa "Yeni not oluştur" seçeneği notu kaynak notun klasörüne açar.
- Seçilen bağlantı hedef notun kalıcı kimliğini taşır
  (`data-pisi-node-id`, `data-pisi-link-block`); görünen metin başlıktır.
  Hedef silinmişse "kırık bağlantı" stili gösterilir.
- Ctrl/Cmd+tık notu (ve `#blok` varsa bloğu) açar; salt okunur yüzeylerde düz
  tık açar. Kimliksiz eski `[[Başlık]]` metinleri vurgulanır ve başlığa göre
  çözülür; birden fazla not eşleşirse seçim listesi açılır.
- Komut paletinde "Bağlantıları onar": tek bir notla eşleşen eski bağlantılara
  kimlik ekler, önce etki özetini gösterir, atomik çalışır.
- Not yeniden adlandırılınca (`project.item.rename.v1`, aynı atomik işlem)
  kimlikli bağlantıların başlığı ve eski `[[Eski Ad]]` metinleri tüm projede
  güncellenir; eski ad başka bir notta da varsa eski metinlere dokunulmaz.
  Etkilenecek not varsa işlemden önce sayısı sorulur (ağaç, sekme, harita ve
  modal yeniden adlandırma yolları). Açık editörler de güncellenir.
- Arama indeksi ve backlink paneli kimlikli bağlantıları kimlik üzerinden okur.
- Düzeltme: Harita odak menüsü, ilişki menüsü, çalışma merkezi ve Bases
  penceresindeki Esc işleyicileri, öğeleri hiç oluşturulmamışken de her Esc'i
  iptal ediyordu; bu yüzden editör menüleri Esc ile kapanmıyordu.
- Düzeltme: İlk açılış rehberi proje yüklendikten ~1 sn sonra kendiliğinden
  açılıp kendi düğmesine odak veriyordu; kullanıcı o sırada yazıyorsa tuşlar
  (ör. Enter) rehbere gidiyordu. CI'daki aralıklı "Enter kaybı"nın
  (`pisi-error.md` eski madde 4) kök nedeni buydu. Rehber artık odak bir
  yazma alanındayken başlamaz ve açık olsa da yazma alanından odak çalmaz.
- Testler: `tests/wiki-link-core.test.mjs`, `tests/wiki-link-store.test.mjs`
  (yarıda kesilen yeniden adlandırmanın atomik geri dönüşü dahil),
  `scripts/electron-wiki-links-e2e.mjs`.

## 05-11-2026 — Dış bağlantılar güvenle açılıyor; bağlantı ekleme/düzenleme

- Main süreçte tek "dış bağlantıyı aç" yolu (`main/functions/external-links.js`):
  URL `new URL()` ile ayrıştırılır; yalnız `http:`, `https:`, `mailto:` kabul
  edilir; kullanıcı adı/parola, boşluk veya kontrol karakteri içeren URL'ler
  reddedilir; `shell.openExternal` ile açılır.
- `setWindowOpenHandler` ve `will-navigate` bu yolu kullanır; uygulama penceresi
  hiçbir zaman dış sayfaya gitmez. Önceden bağlantılar hiç açılmıyordu.
- Preload: `window.pisiShell.openExternal(url)`.
- Editörde Ctrl+tık (macOS'ta Cmd+tık) açar, düz tık imleci koyar; üzerine
  gelince hedef URL ve ipucu görünür. Salt okunur yüzeylerde düz tık açar.
- Bağlantı ekleme/düzenleme/kaldırma: `Mod+Shift+K`, araç çubuğu düğmesi ve
  `/link`. Şemasız girdiye `https://`, e-posta adresine `mailto:` eklenir.
- Testler: `tests/external-url-policy.test.mjs` (main ve renderer aynı
  vektörlerle), `scripts/electron-external-links-e2e.mjs`
  (`PISI_TEST_CAPTURE_EXTERNAL=1` ile `shell.openExternal` yakalanır).

## 05-11-2026 — Notlara görsel ekleme

- Yeni varlık türü `image/<sha256>.<png|jpg|gif|webp>` node sidecar içinde,
  içerik adresli ve tekilleştirilmiş olarak saklanır. Tür, dosya imzasından ve
  gerçek boyutlardan doğrulanır; sınır 20 MB, SVG PNG'ye çevrilir.
- Kayıtlı HTML yalnız referansı taşır; görsel oturum boyunca `blob:` URL ile
  gösterilir. Geri al/yinele geçmişi ve autosave görsel verisi taşımaz.
- Ekleme: panodan yapıştırma (ekran görüntüsü dahil), dosya sürükle-bırak,
  araç çubuğu `Image` düğmesi ve `/image` slash komutu.
- Görsel bloğu: sol/orta/sağ hizalama, alt metin, tutamaçla genişlik,
  tıklayınca büyük önizleme, Delete/Backspace ile silme, kopyala/kes/yapıştır
  ve Markdown kaynak görünümü (`{{pisi-image:…}}`).
- Notlar arası kopyalanan görsel hedef notun sidecar'ına yeniden yazılır.
- Referanssız görseller sürüm geçmişi korumasına ek olarak 24 saat bekleme
  süresinden sonra temizlenir.
- Project Integrity eksik görselleri raporlar; Trash ve geri yükleme
  görselleri notla birlikte taşır.
- Dışa aktarma: HTML/PDF gömülü, Markdown `<not>.assets/` klasörüne göreli
  yolla, DOCX gömülü medya.
- Metni olmayan düzenlenemez bloklarda imleç yerleştirme artık bloğu boş
  satıra çevirmez.
- Seçili görsel `Alt+Shift+↑/↓` ile taşınır; görsel seçiliyken yazmaya
  başlamak görseli silmez, metin görselin altındaki bloğa yazılır.
- Pisi'den Pisi'ye yapıştırma görsel bloğunu bütün blok olarak aktarır.
- Testler: `tests/editor-image-assets.test.mjs`,
  `tests/editor-image-policy.test.mjs`, dışa aktarma testi ve
  `scripts/electron-image-blocks-e2e.mjs`.

## 05-11-2026 — Klasör tabanlı sync kapatıldı; yeniden yüklemede kayıtlar önce yazılıyor

- `PISI_LEGACY_SYNC_ENABLED = false`: Pisi Sync ayarlar bölümü, otomatik
  tetikleyiciler ve main sync IPC yazımları devre dışı. Kod ve mevcut
  `.pisi-sync` / `.pisi/sync-state.json` dosyaları korunuyor.
- `loadProject` bekleyen editör, modal ve harita kayıtlarını zamanlayıcıları
  iptal etmeden önce yazar; kayıt başarısızsa yükleme durur.
- Aynı proje yeniden yüklenirken açık sekmeler, aktif not ve imleç korunur.
- Yeni testler: `tests/sync-domain-disabled.test.js`,
  `scripts/electron-sync-reload-e2e.mjs` (`test:e2e` içinde).

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
