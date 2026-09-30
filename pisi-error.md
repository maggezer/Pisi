# PISI – Güncel Açıklar ve Bilinen Sınırlar

Bu dosya yalnızca güncel `main` dalında gerçekten devam eden açıkları ve bilinçli
olarak ertelenmiş işleri listeler. Kapatılmış tarihsel bulgular
`pisi-update.md` içinde tutulur.

## 1. Paint/Sheet sidecar depolama

**[Orta · mimari]** Paint görselleri ve büyük Sheet içerikleri hâlâ node belgesi
içinde tutuluyor. Özellikle Paint `data-image` verisi büyük node dosyaları,
daha pahalı sürüm geçmişi ve cihazlar arası senkronizasyonda gereksiz veri
taşınmasına neden olabilir. Ayrı sidecar depolama tasarımı henüz uygulanmadı.

## 2. Otomatik formatlama

**[Düşük · kalite]** Syntax, architecture, branding, i18n, `tsc --checkJs`,
ESLint ve Node test runner kontrolleri CI'da çalışıyor. Repository-wide otomatik
formatlama ve format-check adımı henüz yok.

## 3. Dağıtım / imzalama

**[Orta · release]** Windows NSIS ve portable paketleri x64 ile ARM64 için
üretiliyor; release hattı temiz dependency audit, source validation, SHA256 ve
tag doğrulaması uyguluyor. Henüz:

- Windows code signing / SmartScreen itibarı,
- macOS ve Linux paket hedefleri,
- platform imzalama/notarization,
- otomatik güncelleme yayın altyapısı

yapılandırılmış değil.

## Doğrulama durumu

30 Eylül 2026 tarihli güncel `main` doğrulamasında:

- `npm audit`: **0 vulnerability**,
- `tsc --checkJs`: **0 hata**,
- architecture ownership: **107 module / 1142 binding**,
- Node regresyon testleri: **571/571 başarılı**,
- Electron E2E: **başarılı**.

Sheet Phase 2 kapsamında 300 × 80 güvenlik sınırı, satır/sütun silme, gerçek
dikdörtgen çoklu seçim, toplu hücre biçimlendirme ve yapısal formül referansı
yeniden yazma tamamlanmıştır.
