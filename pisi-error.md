# PISI – Güncel Açıklar ve Bilinen Sınırlar

Bu dosya yalnızca güncel `main` dalında doğrulanabilen açıkları, bilinçli
dağıtım sınırlarını ve repository dışı production bağımlılıklarını listeler.
Kapatılmış tarihsel bulgular `pisi-update.md` içinde tutulur.

Bu kayıt “uygulamada başka bug olamaz” anlamına gelmez; amacı eski migration,
tamamlanmış roadmap maddeleri veya stale test sayıları yerine **mevcut kaynak
durumunu** göstermektir.

## 1. Geçici dev-tooling audit istisnası

**[Düşük · security/build · izleniyor]** `GHSA-hp3w-g68c-fv3c`,
`sprintf-js <=1.1.3` için moderate DoS advisory’sidir. 10 Ekim 2026
itibarıyla upstream tarafından yayımlanmış patched npm sürümü yoktur.

Pisi bu bulguyu genel olarak bastırmaz. `npm run audit` artık iki katmanlı,
fail-closed politika uygular:

1. `npm audit --omit=dev --audit-level=moderate` ile production/runtime
   dependency ağacı **istisnasız temiz** olmak zorundadır.
2. Full audit yalnızca tam olarak `GHSA-hp3w-g68c-fv3c` advisory’sine bağlı
   sekiz moderate bulguyu, yalnız aşağıdaki pinned dev-tooling zincirinde kaldığı
   sürece geçici olarak kabul eder:

```text
electron-builder@26.15.7 / app-builder-lib@26.15.7
  -> @electron/get@3.1.0
  -> global-agent@3.0.0
  -> roarr@2.15.4
  -> sprintf-js@1.1.3
```

Audit guard; advisory kimliği, severity toplamı, package isimleri, lockfile node
yolları, exact sürümler ve `dev: true` sınırını doğrular. Yeni bir advisory,
high/critical severity, package/node/version drift veya zincirin runtime
dependency’ye taşınması halinde CI/Release yeniden otomatik olarak kırılır.

`npm audit fix --force` tarafından önerilen `electron-builder@26.5.0`
downgrade uygulanmamıştır. Upstream patched sürüm yayımladığında istisna
kaldırılıp normal full-clean audit’e dönülmelidir.

**Current blocker durumu:** bu advisory artık kontrollü dev-only exception olduğu
için CI blocker değildir; runtime audit temiz kalmak zorundadır.

## 2. Production dağıtım kimlikleri ve dış servisler

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

## 3. Tagged release / Store hattının end-to-end kanıtı

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

## 4. Bilinçli update davranışları

Bunlar bug değil, dağıtım kanalına göre kasıtlı sınırlardır:

- Microsoft Store/MSIX kurulumlarında update’i Pisi direct updater değil,
  Microsoft Store yönetir.
- NSIS direct updater yalnız packaged NSIS build + public HTTPS feed varken
  etkinleşir; feed yoksa build çalışır fakat updater `direct-unconfigured`
  durumunda pasiftir.
- Portable build self-update yapmaz.
- Development ve diğer distribution modlarında direct updater devre dışıdır.

## 5. Güncel doğrulama snapshot’ı

6 Ekim 2026 current `main` kontrolü:

- package version: **0.11.0**,
- CI runtime: **Node.js 24**,
- runtime dependency audit: **moderate+ temiz**; full audit’te yalnız fail-closed `GHSA-hp3w-g68c-fv3c` dev-tooling exception’ı izinli,
- Electron E2E: **başarılı**; startup/smoke, gerçek node+map persistence akışı
  ve kritik task/Sheet/Canvas restart regresyonları geçti,
- Cross-platform Packaging Smoke: Windows + macOS + Linux job’ları
  **başarılı**; Windows NSIS/Portable x64+ARM64 gerçek paket üretimi doğrulandı.

6 Ekim snapshot’ındaki eski audit blocker bilgisi artık tarihsel referanstır. Güncel audit guard runtime ağacını ayrı doğrular ve yalnız exact dev-tooling exception’ına izin verir. Source-validation metrikleri yeni CI koşusuyla yeniden doğrulanmalıdır:

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
