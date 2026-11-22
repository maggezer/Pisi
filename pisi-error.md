# PISI – Güncel Açıklar ve Bilinen Sınırlar

Bu dosya yalnızca güncel `main` dalında doğrulanabilen açıkları, bilinçli
dağıtım sınırlarını ve repository dışı production bağımlılıklarını listeler.
Kapatılmış tarihsel bulgular `pisi-update.md` içinde tutulur.

Bu kayıt “uygulamada başka bug olamaz” anlamına gelmez; amacı eski migration,
tamamlanmış roadmap maddeleri veya stale test sayıları yerine **mevcut kaynak
durumunu** göstermektir.

## 1. Production dağıtım kimlikleri ve dış servisler

**[Orta · release/environment]** Paketleme ve update kodu kaynakta hazırdır,
ancak production dağıtımın bazı parçaları repository dışı kimlik ve servis
gerektirir.

Kaynakta mevcut olanlar:

- Windows x64/ARM64 NSIS Setup + Portable release hattı,
- optional Authenticode signing ve final EXE signature verification,
- direct NSIS için SHA-256 doğrulamalı `latest.json` updater altyapısı,
- macOS x64/ARM64/universal DMG + ZIP paketleme,
- optional Developer ID signing + App Store Connect notarization,
- Linux x64/ARM64 AppImage + DEB paketleme,
- optional OpenPGP checksum signature,
- x64 + ARM64 Microsoft Store MSIX bundle / `.msixupload` üretimi,
- optional Partner Center publish ve Store-managed update modu.

Production için dışarıdan sağlanması gerekenler ihtiyaca göre şunlardır:

- GitHub/direct Windows dağıtımı için Authenticode signing identity,
- NSIS auto-update kullanılacaksa public HTTPS `PISI_UPDATE_FEED_URL`,
- macOS direct production dağıtımı için Developer ID certificate ve
  notarization credentials,
- Microsoft Store için Partner Center product identity değerleri ve publish
  credentials,
- Linux checksum signature kullanıcıya güven zinciri olarak sunulacaksa public
  OpenPGP verification key.

Bu değerlerin GitHub Secrets/Variables tarafında gerçekten tanımlı olup olmadığı
kaynak kodundan güvenilir biçimde çıkarılamaz; doküman bunları “kod eksik”
olarak değil, **production environment bağımlılığı** olarak sınıflandırır.

## 2. Tagged release / Store hattının end-to-end kanıtı

**[Orta · release validation]** Cross-platform Packaging Smoke son
package-related `main` çalışmasında Windows, macOS ve Linux paket setlerini
başarıyla doğrulamıştır. Windows smoke gerçek `windows-latest` runner’da
NSIS x64/ARM64 ve Portable x64/ARM64 olmak üzere dört EXE üretmiş; dosyaların
varlığı, boyutu ve PE `MZ` imzası doğrulanmıştır.

GitHub'da 20 Ağustos 2026 tarihli **v0.11.0 Beta** yayını vardır; dört Windows
EXE ve checksum dosyası içerir. Bu eski yayın, güncel cross-platform release ve
Store workflow'larının uçtan uca çalıştığını kanıtlamaz. “Hiç release yok”
şeklindeki önceki ifade yanlıştı.

Güncel kod için **0.11.1** sürümü ve `docs/releases/v0.11.1.md` hazırlanmıştır.
P2.2 şu iki sonuç gözlenene kadar açık kalır:

1. `v0.11.1` tag → güncel Windows/macOS/Linux paketleri ve `latest.json` →
   GitHub beta release; artifact/checksum sonucu doğrulanmış olmalı,
2. gerçek Partner Center identity → MSIX bundle/upload → Store submission;
   atlanmış Store job'ı başarı kanıtı sayılmaz.

Eski `v0.11.0` tag'i taşınmamalı ve yayımlanmış dosyalar değiştirilmemelidir.
Store kimlikleri ve yayın credentials'ının varlığı kaynak kodundan belirlenemez.

## 3. Bilinçli update davranışları

Bunlar bug değil, dağıtım kanalına göre kasıtlı sınırlardır:

- Microsoft Store/MSIX kurulumlarında update’i Pisi direct updater değil,
  Microsoft Store yönetir.
- NSIS direct updater yalnız packaged NSIS build + public HTTPS feed varken
  etkinleşir; feed yoksa build çalışır fakat updater `direct-unconfigured`
  durumunda pasiftir.
- Portable build self-update yapmaz.
- Development ve diğer distribution modlarında direct updater devre dışıdır.

## 4. Pisi Sync proje yeniden yüklemesiyle açık notu kapatıyor ve metin kaybettiriyordu

**[Yüksek · sync/editor · çözüldü; eski kod kaldırıldı (S7, 18-11-2026)]** Eski klasör
tabanlı senkron (`renderer/sync/pisi-sync-settings.mjs`) her senkrondan sonra
`window.loadProject()` çağırıyordu. `loadProject` bekleyen 800 ms'lik autosave
zamanlayıcısını iptal edip açık notu, sekmeleri, modalı ve haritayı kapatıyordu: not
yazımdan ~7 sn sonra kapanıyor, 60 sn'lik tetikleyici yazmanın ilk 800 ms'ine denk gelirse
metin kayboluyordu.

**Çözüm:**

- 05-11-2026: eski senkron `PISI_LEGACY_SYNC_ENABLED = false` ile kapatıldı. `loadProject`,
  yüzeyleri kapatmadan önce `flushPisiPendingSaves()` ile bekleyen kayıtları yazar; aynı proje
  yeniden yüklenirken sekmeler, aktif not ve imleç korunur (`renderer/tree/pisi-project-reload.mjs`).
  Bu davranışın E2E'si artık `scripts/electron-project-reload-e2e.mjs`'tir.
- 17-11-2026 (S3): yeni eşleştirme sistemi senkron turunda `loadProject` çağırmaz; açık notta
  yalnız değişen bloklar yerinde değişir, imleç, kaydırma ve sekmeler korunur, kaydedilmemiş
  değişikliği olan belge o turda ertelenir (`scripts/electron-sync-client-e2e.mjs`).
- 18-11-2026 (S7): eski kod (`sync-core.js`, `sync-domain.js`, `sync-project-adapter.js`,
  `pisi-sync-settings.mjs`, `window.pisiSync`, `pisi-sync:*` IPC) kaldırıldı. Aynı kural iki
  cihazla da sınanır: senaryo matrisinin 14. senaryosunda telefonun değişikliği gelirken
  masaüstünde yazılan metin, imleç, kaydırma ve sekmeler yerinde kalır, `loadProject` sayısı
  0'dır (`scripts/sync-e2e-matrix.mjs`). Eski projelerdeki `.pisi-sync/` ve
  `.pisi/sync-state.json` silinmez ve senkron edilmez (SV7).

## 5. Editörde fareyle blok sürükle-bırak çalışmıyor

**[Düşük · editor · doğrulandı, çözülmedi]** `renderer/editor/pisi-block-editor.mjs`
içindeki `handlePisiBlockDrop`, sürüklenen bloğu
`pisiBlocksEditorState.draggedBlockId` üzerinden bulur. Ancak bu alan kaynakta
hiçbir yerde atanmıyor (yalnız `null` yapılıyor) ve bloklar için bir `dragstart`
işleyicisi yok. Bu yüzden hiçbir blok türü fareyle sürüklenerek taşınamıyor.
Bloklar `Alt+Shift+↑/↓` komutlarıyla taşınabiliyor; görsel blokları da bu
komutlarla taşınıyor (`scripts/electron-image-blocks-e2e.mjs`). Fareyle
sürükleme ayrı bir işte ele alınmalı.

## 5a. Türkçe arayüzde "node" ve "map" terimleri hâlâ karışık

**[Düşük · i18n · doğrulandı, çözülmedi]** Bildirim ve onay metinleri
"not" ve "harita" terimlerine geçirildi (ENG arayüz zaten "note" ve "map"
kullanıyor). Düğme etiketleri, araç ipuçları ve menüler hâlâ "node"/"map"
diyor (ör. "Yeni Node", "Node sil", "Map referansını kaldır"); yeni dosyaların
varsayılan adı da "Yeni Node". Main süreçten gelen bazı hata metinleri de
"node" içeriyor. Bu etiketler ve varsayılan dosya adı ayrı bir terim
geçişinde ele alınmalı; dosya adı değişikliği mevcut projeleri etkilemez,
yalnız yeni dosyaların adını değiştirir.

## 5d. Mobilde değişen görev, kaynağı olan not bloğuna yansımıyor

G2'den (21-11-2026) beri not görev bilgisi taşımaz; masaüstü görev bloğunu `tasks.json`'dan
çizer, bu yüzden telefonun değişikliği masaüstünde görünür. Kalan kısım (telefonda not görevinin
bütün alanlarıyla düzenlenmesi) `docs/task-plan.md` G8'dedir. Aşağıdaki metin G2 öncesini anlatır.

**[Orta · mobil · bilinçli sınır]** Pisi Mobil görev durumunu yalnız
`.pisi/tasks.json` içinde değiştirir; mobilin düzenleyemediği not bloklarına
dokunmaz (`docs/mobile-plan.md` V8). Kaynağı bir not bloğu olan görev (Quick Add
ile Inbox'a ya da bir nota yazılmış görev) mobilde tamamlanınca nottaki görev
işareti eski durumunda kalır.

- Kesin olan: masaüstünde not açıldığında blok hâlâ "todo" görünür.
- Kod incelemesiyle görülen, uçtan uca denenmemiş risk: masaüstünde kullanıcı
  görev panelinde bir değişiklik yaptığında çalışan projection eşitlemesi
  (`renderer/tags/pisi-source-of-truth.mjs`, `sync-index`) görevi nottaki
  işaretten yeniden normalize eder ve mobilde verilen "tamamlandı" durumunu
  geri alabilir.
- Tekrar eden görevde mobil sonraki tekrarı kaynak bloğu olmayan yeni bir kayıt
  olarak ekler; masaüstü ise nottaki bloğu kopyalar. Aynı görev iki cihazda da
  tamamlanırsa sonraki tekrar iki kez oluşabilir.
    - 16-11-2026 (S1): mobil artık sonraki tekrarın kimliğini önceki görev
      kimliği ve yeni tarihten türetir (`formatPisiRecurrenceTaskId`,
      `shared/ids.mjs`); iki telefon ya da telefon + ileride aynı kuralı
      kullanan bir istemci aynı kaydı üretir ve senkron birleştirmesi tek kayıt
      bırakır. Masaüstünün blok kopyası hâlâ rastgele blok kimliği alır ve görev
      kimliği o bloktan türer; masaüstü tarafı S3'te (Electron E2E ile) bu kurala
      bağlanacak. O zamana kadar masaüstü + telefon çiftinde risk sürer.
    - 17-11-2026 (S3): masaüstü de sonraki tekrarın kimliğini aynı kuralla verir
      (`renderer/tags/pisi-todo-second-release.mjs`; Electron E2E
      `scripts/electron-sync-client-e2e.mjs`). Tekrarın iki kez oluşma riski kapandı.
- 17-11-2026 (S3), SV13: E2E iki geri dönüş yolu buldu ve ikisi de düzeltildi.
    - Quick Add'in yazdığı görev bloğu `data-pisi-task-id` taşımıyordu; not masaüstünde
      düzenlenince editör ona yeni rastgele kimlik veriyor, yansıtma eski canonical görevi
      siliyor ve uzaktan gelen durum kayboluyordu. Editör artık canonical görevi kaynağından
      (not, blok, etiket) bulur (`renderer/tags/pisi-task-store.mjs`).
    - Bir senkron turu `tasks.json`'daki durumu değiştirince masaüstü bunu cihaz durumunda bir
      koruma olarak tutar; nottaki eski işaretten gelen yansıtma yazması canonical durumu geri
      çevirmez (`main/functions/sync-client-desktop.js`, `task-store.js`). Görev paneli açılıp
      kapanınca ve kaynak not düzenlenip kaydedilince durum korunur.
    - Kalan bilinçli sınır: nottaki işaret eski durumda görünmeye devam eder (masaüstü
      canonical durumu nota geri yazmaz). Koruma sürerken eski duruma notun işaretinden dönmek
      için işaret iki kez değiştirilmeli ya da görev panelinden değiştirilmelidir.

Bu yüzden Görevler sekmesinin görev detayı (M6) kaynağı not bloğu olan
görevlerde yalnız durumu değiştirir; başlık, öncelik, tarih, saat, tekrar ve
hatırlatma salt okunurdur ("Masaüstünde nottan düzenlenir"). Kaynağı olmayan
görevlerde bütün alanlar düzenlenir. Durum değişikliği için yukarıdaki risk
sürer.

Kalıcı çözüm mobilin görev bloğu işaretini güvenle güncelleyebilmesini ya da
masaüstünün canonical durumu nota geri yansıtmasını gerektirir; aktarım planıyla
birlikte ele alınmalıdır.

Plan: `docs/task-plan.md` G2 ve G8. Not görev bilgisi taşımayacağı için yansıtılacak
bir işaret kalmaz; mobil not görevlerinin bütün alanlarını düzenler.

## 5f. Mobilde bazı masaüstü paragrafları salt okunur kart olarak görünüyor

**[Düşük · mobil · doğrulandı, çözülmedi]**
Mobil not editörü (M7) bir metin bloğunu ancak içindeki her şeyi aynen geri
yazabildiğinde düzenler: düz metin, satır sonu, `b/strong/i/em/u/s` etiketleri
(özniteliksiz) ve linkler. Masaüstü editörü kalın, italik, renk gibi biçimleri
bazen `<span class="pisi-inline-command-style" style="…">` olarak yazar
(`renderer/editor/pisi-editor-command-authority.mjs`). Böyle bir span içeren
paragraf, başlık ya da madde mobilde "Masaüstünde düzenlenir" kartı olarak
gösterilir; metni okunur ama değiştirilemez. Veri kaybı yoktur: blok bayt bayt
korunur (V8). Aynı durum başlık 4–5, alıntı, kod, girintili alt maddeleri
kapalı (`pisi-bullet-collapsed`) maddeler ve tanınmayan HTML varlıkları
(`&eacute;` gibi) için de geçerlidir.

Mobilde ayrıca madde girintisi değiştirilemez (Tab yok; mevcut girinti
korunur), web bağlantıları açılmaz (wiki-link'ler açılır) ve Sheet bloğunun
hücreleri gösterilmez. Çözüm için önce bu biçimlerin güvenli okunup yazılması
`shared/note-blocks.mjs` ve `mobile/src/data/note-inline.mjs` içinde genişletilmeli,
uyumluluk testi (`tests/mobile-desktop-compat.test.mjs`) buna göre büyütülmelidir.

## 5g. Masaüstü modüllerini yükleyen bir test dosyası import sırasında çökerse `node --test` onu geçti sayıyor

**[Orta · test altyapısı · doğrulandı, çözülmedi]**
`main/functions/logger.js` yüklenince süreç düzeyinde `uncaughtException` ve
`unhandledRejection` yakalayıcıları kurar. Masaüstü main modüllerini gerçekten
yükleyen bir test dosyası (ör. `tests/mobile-desktop-compat.test.mjs`) daha
testleri tanımlamadan import sırasında hata verirse hata bu yakalayıcıda
kalır, süreç 0 ile çıkar ve `node --test` dosyayı tek bir geçen test olarak
raporlar; içindeki testler hiç çalışmamış olur. M9 sırasında, eksik bir
bağımlılıkla yüklenen `map-semantic-operation-hooks.js` bunu gösterdi (hata
düzeltildi; davranış duruyor). G2'de silinen görev modüllerini (`task-capture.js`,
`source-of-truth.js`, `task-reference-integrity.js`) yükleyen `mobile-desktop-compat`,
`sync-client-apply`, `sync-merge-integrity` ve `sync-initial-transfer` testleri de böyle
sessizce geçti; modül listeleri düzeltildi ve testlerin gerçekten çalıştığı test sayısıyla
denetlendi. Çözüm önerisi: testlerde logger'ın süreç
yakalayıcılarını kurmaması (ör. bir ortam bayrağı) ya da bu dosyaların test
sayısını denetleyen bir koruma.

## 5h. Görev sistemi: kalan bulgular (G8)

**[Orta · tasks · kısmen çözüldü (G2–G7)]** 21-11-2026 incelemesinin bulguları
[`docs/task-plan.md`](docs/task-plan.md) Ek A'dadır. G2'de (`tasks.json` sürüm 2, görev servisi)
GB1–GB9, GB12, GK4, GK5, GK11, GK12 ve GK14, G3'te (editörde görev bloğu) GB14 ve GK2, G4'te (görev paneli, çalışma
alanı, Quick Add) GK6, GK7 ve GK8, G5'te (takvim, harita, arama, gezinme, dışa/içe aktarma, not kopyası, not
geçmişi) GB11, GK3, GK9 ve GK10 kapandı; G6'da etiketler (`tags`) ve başlıktaki not bağlantıları kayıt üzerinden geri geldi;
G7'de (bütünlük, onarım, ölçüm, temizlik) GK1, GK13 ve GK15 kapandı; not ve günlük artık yalnız görev kimliğini taşır, bütün görev yazmaları
ana süreçteki görev servisinden geçer, hiçbir görev işlemi projeyi taramaz ve bütün yüzeyler görevi kayıttan çizer.
Kalanlar (parantez içi kapatacak faz):

- **GB5 (mobil tarafı):** Telefon sürüm 1 kurallarıyla çalışıyor: `tasks.json`'u `version: 1` diye
  yazıyor, değiştirdiği kayda eski alanları (`todoTag`, `scheduledAt`) ekliyor, tekrar eden görevi
  tamamlayınca yeni kayıt açıyor ve günlüğün görev bölümünü yazmıyor. Notta sürüm 2 görev bloğu
  salt okunur "Görev · Masaüstünde düzenlenir" kartı olarak görünür. Masaüstü bunları okur ve
  korur; Project Integrity günlük bölümünü G8'e kadar yalnız yapı ve bilinmeyen kimlik için
  denetler. Telefonun takvimi G5'te masaüstüyle aynı gün kuralına geçti; Pisi ve Görevler sekmeleri
  görevin gününü hâlâ `scheduledAt → dueDate → deadline` sırasıyla okur, bu yüzden telefonda
  `scheduledAt`'ı `dueDate`'ten farklı olan eski bir kayıt takvimde ve gün görünümünde farklı günde
  görünebilir. (G8)
- Arama dizini, kurulduktan sonra "Yeni not" düğmesiyle oluşan notu görmüyor (dosya sistemi
  yenilemesi bastırıldığı için dizine delta gelmiyor; G4 E2E'sinde doğrulandı). Görev tarafı G5'te
  kapandı: görev kaydı notunu Explorer ağacından da bulur. Notun kendisi (başlığı, içeriği) dizin
  yeniden kurulana kadar aranamıyor. (arama, faz dışı)
- Telefon görev etiketlerini göstermiyor ve düzenleyemiyor; başlıktaki `[[Not]]` bağlantısı telefonda düz
  metin olarak görünür. Telefon kaydı yazarken `tags` alanını korur. (G8)
- Bir not açılınca etiket dizini (`renderer/tags/pisi-tag-index.mjs`) bütün notları ve günlükleri ana süreçten
  tek tek okur; 2.000 notlu projede bu ~12 sn sürer ve arka planda çalışır (G7 ölçümünde görüldü,
  `scripts/electron-tasks-scale-e2e.mjs` `tagIndexReadUntilQuietMs`). Görevlerle ilgisi yok: görevler `tasks.json`'dan
  okunur. Çözüm önerisi: etiket dizinini arama dizini gibi proje okuma işçisinden ve değişiklik deltasıyla kurmak.
  (etiketler, faz dışı)

## 5i. Görev satırının üstüne gelince boş çipler görünüp başlığı kaydırıyor

**[Düşük · tasks · doğrulandı, çözülmedi]**
Not bloğundaki ve günlük satırındaki boş çipler (Öncelik, Tekrar, Tarih, Etiket) yalnız `:hover` ya da
`:focus-within` iken `display: inline` olur (`renderer/tasks/pisi-tasks.css` `.pisi-task-chip-empty`). Görünür
olunca satırdaki başlık daralır; dar pencerede (ör. 1024 px ve açık sağ panel) başlık kaydırılır ve fare
altındaki metin yer değiştirir: kullanıcının üstüne geldiği `[[Not]]` bağlantısı alt satıra iner, tıklama
çipe düşer. `scripts/electron-tasks-links-e2e.mjs` Windows CI'da (pencere 1024 × 720) bu yüzden düşüyordu;
test artık önce fareyi satıra getirip yerleşim durulduktan sonra ölçüyor. Çözüm önerisi: boş çiplerin yerini
her zaman ayırmak (`visibility`/`opacity`) ya da çipleri başlığın akışından çıkarmak.

## 6. Güncel doğrulama snapshot’ı

6 Ekim 2026 current `main` kontrolü:

- package version: **0.11.0**,
- CI runtime: **Node.js 24**,
- runtime ve full dependency audit: **moderate+ temiz** (5 Kasım 2026 itibarıyla istisna yok),
- Electron E2E: **başarılı**; startup/smoke, gerçek node+map persistence akışı
  ve kritik task/Sheet/Canvas restart regresyonları geçti,
- Cross-platform Packaging Smoke: Windows + macOS + Linux job’ları
  **başarılı**; Windows NSIS/Portable x64+ARM64 gerçek paket üretimi doğrulandı.

6 Ekim snapshot’ındaki eski audit blocker bilgisi artık tarihsel referanstır. Güncel audit guard runtime ve full ağacı istisnasız doğrular. Source-validation metrikleri yeni CI koşusuyla yeniden doğrulanmalıdır:

- repository Prettier check: **başarılı**,
- syntax check: **372 JavaScript/ES module dosyası**,
- architecture ownership: **121 module / 1275 binding**,
- i18n doğrulaması: **990 key / 149 renderer module**,
- checkJs global üretimi: **1033 runtime-owned identifier**,
- TypeScript `checkJs`: **başarılı / 0 hata**,
- Node regresyon testleri: **664/664 başarılı**.

Bu metriklerin güncel sayıları CI her çalıştığında yeniden üretilir; audit politikası artık yeni veya kapsamı genişleyen bulguları fail-closed biçimde engeller.

## 7. Tamamlanmış olup açık sayılmaması gereken maddeler

Aşağıdakiler artık `pisi-error.md` için açık değildir:

- migration/legacy compatibility temizliği,
- canonical relationship / property authority ayrımı (görevler için bkz. §5h),
- generated Android/Capacitor ağacının desktop `main` içinden kaldırılması,
- repository-wide Prettier ve zorunlu CI format gate,
- CI/release dependency audit gate’in zorunlu hale getirilmesi,
- Electron main/renderer ESM geçişi,
- reversible project-local Trash,
- Project Integrity + atomic mutation/recovery,
- Paint/Sheet content-addressed sidecar ve orphan asset GC,
- Sheet Phase 2: 10.000 × 80 sınırı, gerçek range selection, bulk formatting,
  row/column mutation ve structural formula reference rewrite,
- Windows Store-aware auto-update mimarisi,
- macOS/Linux paket hedefleri,
- gerçek kullanıcı akışını kapsayan Electron E2E.

Yeni bir kaynak-kod açığı doğrulandığında bu dosyaya ayrı başlık olarak
eklenmelidir; tarihsel tamamlanmış maddeler yeniden “current issue” gibi
taşınmamalıdır.
