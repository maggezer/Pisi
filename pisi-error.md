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

## 4a. Günlükteki görev ayracının içine yazılan metni yansıtma siliyor

**[Orta · diary/tasks · doğrulandı, çözülmedi]** Masaüstünün günlük görev yansıtması
(`main/functions/document-store-diary.js`, `syncDiaryMissions`) yönetilen bölümü
(`PISI_DIARY_MANAGED_START`…`END`) her seferinde baştan kurar. Kullanıcı, bölümü kapatan
ayraç bloğunun (`pisi-diary-task-divider`) içine yazarsa metin bu bölümde kalır ve bir
sonraki yansıtmada silinir. Masaüstü fixture'ında (`tests/fixtures/desktop-project/diary/2026-11-13.node`)
böyle bir metin vardır ("Veri katmanı için notlar aldım."); uygulama açılınca kaybolur.
S7'deki senaryo matrisi sırasında görüldü. Çözüm önerisi: ayraç bloğu düzenlenemez olsun ya da
yönetilen bölümün dışındaki/ayraç içindeki kullanıcı metni bölüm yeniden kurulurken
korunsun. Aynı bölüm `data-pisi-diary-node-path` içinde masaüstünün mutlak dosya yolunu
taşır; senkronla telefona da gider (sunucuya şifreli). Telefon bu bölümü salt okunur kart
olarak gösterir ve yolu kullanmaz.

## 4b. Masaüstü bir dosyayı yazınca görev ve günlük yansıtmaları ikinci bir yazma yapabiliyor

**[Düşük · sync/tasks · kısmen çözüldü (S7)]** Senkronla gelen `tasks.json` uygulanınca masaüstü
günlüklerin görev bölümünü yeniden yazar. Bu yazma, telefonun bir sonraki turunda iner;
iki cihaz bir ya da iki ek turda durulur (matris her senaryoda en çok 4 turda durulmayı
şart koşar). S7'de yapılanlar:

- Değişiklik getirmeyen görev yansıtması (`sync-index`) `tasks.json`'u artık yeniden yazmaz
  (`main/functions/task-store.js`; `tests/task-store-projection-unchanged.test.mjs`).
- Görev ayraçları, düzenleyicinin verdiği blok kimliğini korur; her yansıtmada yeni kimlik
  almaz (`tests/diary-task-integration.test.js`).
- Görev deposu okunmadan günlük eşitlenmez; açılışta görev bölümleri önce silinip sonra
  geri yazılmaz (`renderer/tags/pisi-source-of-truth.mjs`; `tests/task-projection-write-through.test.js`).

Kalan: ayraç bloğunun kimliği hâlâ renderer'da ilk kayıtta verilir; ana süreçte yazılan yeni
bir günlüğün ayraçları kimliği ilk açılışta alır ve bu bir kez daha yazılır.

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

## 5c. Quick Add'in açtığı Inbox notu Project Integrity'de kritik bulgu üretiyor

**[Orta · masaüstü · çözüldü]** Boş bir projede ilk Quick Add, `Inbox.node`
dosyasını `properties.systemRole` değeriyle oluşturuyor, `.pisi/properties.json`
ise yalnız şema gerektiğinde yazılıyordu. Arada kalan projede Project Integrity
`property-schema-authority-missing` (critical) bulgusu veriyordu.

Çözüm (16-11-2026): Quick Add, Inbox'ı oluşturmadan önce `systemRole` tanımını
proje şemasına yazar (`registerPisiSystemPropertyDefinitions`,
`main/functions/property-schema-store.js`). Bu durumda kalmış eski projeler bir
sonraki Quick Add ile onarılır; okunamayan bir şema ezilmez, Quick Add hata
döner. Testler: `tests/quick-add-inbox-schema.test.js`,
`scripts/electron-mobile-fixture-e2e.mjs` (denetim bulgusu kalmamalı) ve
`tests/mobile-desktop-compat.test.mjs` (taban çizgisi artık boş).

## 5d. Mobilde değişen görev, kaynağı olan not bloğuna yansımıyor

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

## 5e. Türkçe tarih ayrıştırıcısı başlıktaki sayıları tarih sayabiliyor

**[Düşük · productivity + mobil · doğrulandı, çözülmedi]**
`parsePisiTurkishDateExpression` (`shared/date-parser.mjs`) `a.b`, `a/b` ve
`a-b` biçimindeki her sayı çiftini, geçerli bir gün-ay ise tarih olarak okur.
Masaüstünde tarih ifadesi ayrı alanda yazıldığı için sorun olmaz. Mobilde
görev başlığı ve tarih aynı satırda yazılır: "v1.2 sürüm notları" 1 Şubat'a,
"3-4 sayfa özet" 3 Nisan'a tarihlenir. Okunan tarih kaydetmeden önce çip olarak
göründüğü için kullanıcı fark edebilir, ama satırı değiştirmeden düzeltemez;
görev detayından tarihi kaldırması gerekir.

Ayrıca ayrıştırıcının tekrar ifadeleri sınırlıdır: `her gün`, `her pazartesi`,
`iki haftada bir` ve `görev tamamlandıktan N gün sonra` tanınır; `her hafta`,
`her ay`, `hafta içi` ve pazartesi dışındaki `her <gün>` tanınmaz (mobilde
tekrar görev detayından seçilebilir). Düzeltme `shared/` içinde yapılır ve
masaüstünü de değiştirir.

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
düzeltildi; davranış duruyor). Çözüm önerisi: testlerde logger'ın süreç
yakalayıcılarını kurmaması (ör. bir ortam bayrağı) ya da bu dosyaların test
sayısını denetleyen bir koruma.

## 5h. `picomatch` ReDoS açığı geliştirme bağımlılıklarında; yamalı sürüm yok, audit kapısı kırmızı

**[Yüksek (bildirim) · bağımlılık / CI · doğrulandı, çözülmedi; yama bekleniyor]**
GHSA-fc5q-39xc-vjpf (19-10-2026): `picomatch` `<=4.0.7` tek dallı, tekrarlanan extglob kalıplarında
(`+(*)` gibi) üstel geri izleme yapıyor. npm'deki en yeni sürüm 4.0.7 ve bildirimde yamalı sürüm yok,
bu yüzden `overrides` ile düzeltilemiyor.

- Kökte yalnız tam ağaçta: electron-builder → app-builder-lib → `@electron/rebuild` → node-gyp →
  tinyglobby/fdir → picomatch. Çalışma zamanı denetimi temiz. `npm run audit` tam ağaç adımında düşüyor;
  CI'ın `validate` işi bu adımda duruyor.
- Mobilde vite/vitest → tinyglobby → picomatch; `npm --prefix mobile run audit` düşüyor (Mobile
  `validate` işi #177'den beri kırmızı).
- Risk: yalnız derleme ve test araçları; kalıplar depodan gelir, kullanıcıdan gelmez. Uygulama paketine
  girmez.
- `npm audit fix --force`'un önerisi sürüm düşürmek (electron-builder 26.0.20, vite 6.2.7); yapılmadı.
- Karar (18-11-2026): istisna eklenmez, `picomatch` yaması beklenir. Yama çıkınca kökte ve mobilde
  kapsamlı bir `overrides` (ör. `"picomatch@<=4.0.7": "^4.0.8"`) ya da doğrudan güncelleme ile kapatılır ve
  bu madde silinir.

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
- canonical task / relationship / property authority ayrımı,
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
