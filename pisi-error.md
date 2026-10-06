# PISI – Güncel Açıklar ve Bilinen Sınırlar

Bu dosya yalnızca güncel `main` dalında doğrulanabilen açıkları, bilinçli
dağıtım sınırlarını ve repository dışı production bağımlılıklarını listeler.
Kapatılmış tarihsel bulgular `pisi-update.md` içinde tutulur.

Bu kayıt “uygulamada başka bug olamaz” anlamına gelmez; amacı eski migration,
tamamlanmış roadmap maddeleri veya stale test sayıları yerine **mevcut kaynak
durumunu** göstermektir.

## 1. Dependency audit yeniden blokluyor

**[Orta · security/build · CI blocker]** 6 Ekim 2026’da fresh
`npm audit --audit-level=moderate` taraması yeni yayımlanan
`GHSA-hp3w-g68c-fv3c` advisory’sini yakaladı ve **8 moderate vulnerability**
raporladı.

Kilitli dependency zinciri:

```text
electron-builder@26.15.7 / app-builder-lib@26.15.7
  -> @electron/get@3.1.0
  -> global-agent@3.0.0
  -> roarr@2.15.4
  -> sprintf-js@1.1.3
```

Advisory, `sprintf-js` tarafında sınırsız precision specifier ile denial of
service riskidir. Bu zincirdeki paketler `package-lock.json` içinde
**dev dependency** olarak işaretlidir; yani bulgu Pisi’nin paketlenmiş runtime
uygulamasındaki doğrudan kullanıcı dependency’si değildir. Buna rağmen CI ve
Release workflow’ları moderate seviyeyi zorunlu gate yaptığı için current
`main` CI audit adımında durmaktadır.

`npm audit` şu anda çözüm olarak `npm audit fix --force` ile
`electron-builder@26.5.0` kurulmasını öneriyor. Bu, mevcut
`electron-builder@26.15.7` sürümünden geriye giden ve npm tarafından breaking
change olarak sınıflandırılan bir çözüm olduğundan körlemesine uygulanmamalıdır.
Doğru çözüm; upstream uyumlu fix geldiğinde güncellemek veya packaging/Store/
macOS/Linux hatlarını yeniden doğrulayarak kontrollü dependency çözümü
uygulamaktır.

**Current CI sonucu:** audit ❌; bu run’da format ve `validate:source` audit
gate yüzünden çalıştırılmadı. Aynı commit için Electron E2E ✅ geçti.

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

Buna karşılık mevcut Actions geçmişinde henüz bir **Release** veya
**Microsoft Store MSIX** workflow run’ı görünmüyor. Bu nedenle şu iki akış
kaynak/test seviyesinde korunuyor olsa da gerçek repository environment ile
end-to-end çalıştırılmış kabul edilmemelidir:

1. gerçek `v*.*.*` tag → bütün platform paketleri → tek GitHub beta release,
2. gerçek Partner Center identity → MSIX bundle/upload → Store submission.

Public beta/Store yayını öncesinde dependency audit yeniden yeşile döndürüldükten
sonra bu iki yol gerçek release environment ile en az bir kez çalıştırılıp
artifact ve publish sonucu doğrulanmalıdır.

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
- fresh dependency audit: **8 moderate vulnerability / CI blocker**,
- Electron E2E: **başarılı**; startup/smoke, gerçek node+map persistence akışı
  ve kritik task/Sheet/Canvas restart regresyonları geçti,
- Cross-platform Packaging Smoke: Windows + macOS + Linux job’ları
  **başarılı**; Windows NSIS/Portable x64+ARM64 gerçek paket üretimi doğrulandı.

Audit gate nedeniyle 6 Ekim run’ında format/source-validation adımları
çalıştırılmadı. Son tam başarılı source validation 4 Ekim 2026’daki aynı runtime
kod tabanında şu snapshot’ı doğrulamıştı:

- repository Prettier check: **başarılı**,
- syntax check: **372 JavaScript/ES module dosyası**,
- architecture ownership: **121 module / 1275 binding**,
- i18n doğrulaması: **990 key / 149 renderer module**,
- checkJs global üretimi: **1033 runtime-owned identifier**,
- TypeScript `checkJs`: **başarılı / 0 hata**,
- Node regresyon testleri: **664/664 başarılı**.

Bu metrikler “bugünkü CI yeşil” anlamında kullanılmamalıdır; current blocker
dependency audit’tir.

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
