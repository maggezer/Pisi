# PISI – Güncel Açıklar ve Bilinen Sınırlar

Bu dosya yalnızca güncel `main` dalında gerçekten devam eden açıkları ve bilinçli
olarak ertelenmiş işleri listeler. Kapatılmış tarihsel bulgular
`pisi-update.md` içinde tutulur.

## 1. Dağıtım kimliği / production yayını

**[Orta · release]** Windows NSIS/portable paketleri x64 ve ARM64 için,
Microsoft Store hattı çok mimarili MSIX için, macOS hattı DMG/ZIP için ve Linux
hattı AppImage/DEB için yapılandırılmıştır. Direct Windows auto-update altyapısı
ve Microsoft Store dağıtımına uygun Store-aware güncelleme davranışı da
mevcuttur.

Kalan işler artık kaynak kodundan çok yayın ortamına bağlıdır:

- GitHub üzerinden dağıtılan Windows EXE’leri için gerçek code-signing
  kimliği/SmartScreen itibarı,
- macOS dağıtımı için Apple signing ve notarization kimlik bilgileri,
- production direct-update feed URL’si ve yayın altyapısının işletilmesi,
- Microsoft Store submission/publishing hesabının gerçek mağaza sürecine
  bağlanması.

## Doğrulama durumu

4 Ekim 2026 tarihli güncel `main` doğrulamasında:

- `npm run format:check`: **başarılı**,
- `npm audit` (2 Ekim 2026): **0 vulnerability**,
- `tsconfig.checkjs.json` içinde `checkJs: true`; `tsc`: **0 hata**,
- checkJs global üretimi: **1036 runtime-owned identifier**,
- architecture ownership: **121 module / 1277 binding**,
- Node regresyon testleri: **662/662 başarılı**,
- Electron E2E (4 Ekim 2026): **başarılı**.

Sheet Phase 2 kapsamında 10.000 × 80 güvenlik sınırı, satır/sütun silme, gerçek
dikdörtgen çoklu seçim, toplu hücre biçimlendirme ve yapısal formül referansı
yeniden yazma tamamlanmıştır.
