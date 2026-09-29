# PISI – Güncel Açıklar ve Bilinen Sınırlar

Bu dosya yalnızca güncel `main` dalında gerçekten devam eden açıkları ve bilinçli
olarak ertelenmiş işleri listeler. Kapatılmış tarihsel bulgular
`pisi-update.md` içinde tutulur.

## 1. Sheet gelişmiş düzenleme işlemleri

**[Orta · özellik eksiği]** Tablo büyütme artık 80 satır × 26 sütun
(2.080 hücre) sınırıyla korunuyor; eski sınırsız büyüme hatası kapatıldı.
Ancak satır/sütun silme, gelişmiş hücre biçimlendirme, yapısal değişikliklerde
formül referanslarını yeniden yazma ve çoklu hücre seçimi henüz yok.

## 2. Paint / Sheet sidecar depolaması

**[Orta · mimari borç]** Paint PNG verisi halen node JSON içindeki
`data-image` alanında tutuluyor. Paint/Sheet kaynaklarını sidecar dosyalara
taşıma; mevcut belgeler için migration ve geri uyumluluk gerektirdiği için
ertelendi.

## 3. Development dependency audit bulguları

**[Orta · build zinciri]** 29 Eylül 2026 tarihli CI auditinde
**3 high + 1 moderate** bulgu bulunuyor. Yüksek bulgular:

- `@xmldom/xmldom@0.8.13` — `plist` üzerinden,
- `fast-uri@3.1.5` — `ajv` üzerinden,
- `js-yaml@4.3.1` — `electron-builder` / `app-builder-lib` zincirinde.

Moderate bulgu `undici` paketinde. Kilit dosyasında bu paketlerin tamamı
development/build bağımlılığı olarak işaretli; uygulamanın kullanıcı verisini
işleyen production bağımlılıkları değiller. CI audit raporunu görünür şekilde
çalıştırıyor, fakat bu bulgular şimdilik buildi bloklamıyor. Güncelleme yapılırken
`npm audit fix` sonrası paketleme ve 557 regresyon testinin tamamı yeniden
çalıştırılmalı.

## 4. Typecheck ve otomatik formatlama

**[Düşük · kalite]** Syntax, architecture, branding, i18n, ESLint ve Node test
runner kontrolleri mevcut ve CI'da çalışıyor. Ancak repository-wide typecheck
ve otomatik format kontrolü henüz yok.

## 5. Dağıtım / imzalama

**[Orta · release]** Windows NSIS ve portable paketleri x64 ile ARM64 için
üretiliyor. Henüz:

- Windows code signing / SmartScreen itibarı,
- macOS ve Linux paket hedefleri,
- platform imzalama/notarization,
- otomatik güncelleme yayın altyapısı

yapılandırılmış değil.

## Doğrulama durumu

Güncel `main` CI; syntax, architecture, branding, i18n, ESLint ve test
kontrollerinden geçiyor. Son doğrulamada **557/557 test başarılı**.
