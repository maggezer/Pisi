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

**[Yüksek · sync/editor · çözüldü, özellik kapalı]** Sync yapılandırılmışken
`renderer/sync/pisi-sync-settings.mjs` her senkrondan sonra
`window.loadProject()` çağırıyordu. Tetikleyiciler açılış, pencere odağı,
60 sn’lik zamanlayıcı ve yazmayı bıraktıktan 5 sn sonrasıydı.
`loadProject` bekleyen 800 ms’lik autosave zamanlayıcısını iptal edip açık
notu, sekmeleri, modalı (kaydetmeden) ve haritayı kapatıyordu. Sonuç: not,
yazım bittikten ~7 sn sonra kendiliğinden kapanıyordu; 60 sn’lik tetikleyici
yazmanın ilk 800 ms’ine denk gelirse metin diske yazılmadan kayboluyordu.

**Çözüm (05-11-2026):**

- Klasör tabanlı sync tek bir bayrakla kapatıldı:
  `PISI_LEGACY_SYNC_ENABLED = false` (`main/functions/sync-domain.js`).
  Sync IPC çağrıları `PISI_SYNC_DISABLED` döner; ayarları, `.pisi-sync`’i ve
  `.pisi/sync-state.json`’u okumaz ve yazmaz. Renderer ne Ayarlar bölümünü
  çizer ne de otomatik tetikleyicileri kurar. Kod ve mevcut dosyalar korunur.
- `loadProject`, zamanlayıcıları iptal etmeden ve yüzeyleri kapatmadan önce
  `flushPisiPendingSaves()` ile bekleyen kayıtları yazar. Kayıt başarısız
  olursa yükleme durur ve hata gösterilir. Bu tüm çağıranları kapsar
  (proje değiştirme, açılış).
- Aynı proje yeniden yüklenirken açık sekmeler, aktif not ve imleç korunur
  (`renderer/tree/pisi-project-reload.mjs`). Açık modal kaydedilip kapanır ve
  yeniden açılmaz.
- Testler: `tests/sync-domain-disabled.test.js`,
  `scripts/electron-sync-reload-e2e.mjs`.

**Yeni eşleştirme sistemi için kural:** Senkron sonrasında proje bütünüyle
yeniden yüklenmez; yalnız değişen dosyalar güncellenir. Açık not, sekmeler,
modal, harita ve imleç senkron yüzünden kapanmamalı ya da yeniden
çizilmemelidir. Açık bir belge dışarıdan değiştiyse mevcut
`reloadPisiWorkspaceAfterExternalChange` akışındaki gibi yalnız o belge ele
alınır ve kaydedilmemiş değişiklik varsa kullanıcıya sorulur.

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
