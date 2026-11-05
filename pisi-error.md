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

## 4. Editör klavye E2E’sinde aralıklı Enter kaybı

**[Orta · editor/test · kök neden bulunamadı]** `scripts/electron-editor-keyboard-e2e.mjs`
CI’da (GitHub `ubuntu-latest` + `xvfb-run`) aralıklı olarak kırılıyor. İki
farklı adımda görüldü; her ikisinde de CDP ile gönderilen Enter editörde hiçbir
blok değişikliği üretmedi:

- 05-11-2026, PR #131: `<pre>` code bloğunda ikinci Enter bloktan çıkmadı
  (`code: second Enter exits block`, 1 blok kaldı).
- 05-11-2026, PR #132: görev metninin başında Enter görevi bölmedi
  (beklenen `task ''` + `paragraph 'abcdef'`, gelen tek `task 'abcdef'`).

İki PR da editör koduna dokunmuyor. Hata yerelde Electron 43.8.7 ile
yeniden üretilemedi: normal koşuda 6/6, tek çekirdek + CPU yükü altında 6/6
başarılı. İki Enter arasına 1,5 sn bekleme eklendiğinde de imleç doğru yerde
kaldı. Olası neden, `setup()` ile tuş arasında çalışan eşzamansız bir işin
(ör. kayıt sonrası görev/etiket projeksiyonu) bloğu yeniden çizip seçimi
düşürmesi; doğrulanmadı. Gerçek kullanıcıda da tuş kaybına yol açabileceği
için yalnız test kararsızlığı sayılmamalıdır. Sonraki adım: tuştan hemen önce
seçimin editör içinde olduğunu doğrulayan teşhis assertion’ı ve hata anında
blok kimliği/seçim kaydı.

## 5. Güncel doğrulama snapshot’ı

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

## 6. Tamamlanmış olup açık sayılmaması gereken maddeler

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
