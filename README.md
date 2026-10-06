# PISI

PISI, notları JSON tabanlı yerel dosyalarda tutan bir Electron masaüstü
uygulamasıdır. Notlar `.node`, bilgi haritaları `.map` dosyalarıdır. Uygulama;
zengin metin, Paint tuvali, hesap tablosu/formül, etiket, görev, günlük ve
takvim işlevlerini tek bir proje klasöründe birleştirir.

## Başlıca özellikler

- Sol Explorer’da klasör, map ve node yönetimi
- Map üzerinde node oluşturma, taşıma, boyutlandırma ve çoklu seçim
- Hiyerarşi, süreç ve denk bağlam bağlantıları
- Sekmeli center editor ve map içi node modalı
- Zengin metin, Paint ve Excel-benzeri tablo/formül araçları
- Kalıcı kimlikli WYSIWYG Markdown blokları, `/` menüsü, sürükleme, blok türü
  ve Markdown kaynak görünümü
- Kullanıcı etiketleri, proje görev indeksi ve görev başına tamamlanma durumu
- Canonical görev deposu, görev bağımlılıkları, durum/öncelik/zaman alanları
  ve diary/takvim projeksiyonları
- `Ctrl+P` ile node, içerik, görev, etiket, map, tablo ve dosya yolu araması
- Metin/map/görev ilişkilerini birleştiren backlink ve bağlantısız bahsetme paneli
- Arama sonucundaki node’u kendi map’inde merkezleme ve vurgulama
- `Ctrl+M` (`Mod+M`) ile Global Quick Add, otomatik Inbox ve proje geneli
  Inbox/Bugün/Yaklaşan/Geciken/Tarihsiz/Engellenen görünümleri
- Türkçe doğal tarih ayrıştırma, hızlı erteleme, planlanan zaman, deadline,
  hatırlatma ve tahmini/gerçek görev süresi
- Metin, Sayı, Tags ve Relation türlerinde canonical node özellikleri;
  Rollup ise ana toolbardan node bloğu olarak eklenir
- Özellikleri sorgulayan tablo/kart görünümleri, kaydedilebilir filtreler ve
  sonuçlardan kaynak node’ları silmeden map üretme; proje düzeyi şablonlar
- Map dışa aktarma, map node yazı tipi/boyut tercihleri ve özelleştirilebilir
  bağlantı görünümü
- Markdown klasörü içe aktarma; Markdown, HTML, PDF ve DOCX dışa aktarma
- Son 50 node sürümünü tutan yerel geçmiş, önizleme/karşılaştırma, bütünlük
  denetimi ve görünür yedek geri yükleme
- `Ctrl+K` komut paleti, değiştirilebilir/çakışma denetimli kısayollar
- Canonical görevlerden üretilen read-only diary görünümü ve
  sürüklenebilir/dock edilebilir takvim
- Türkçe/İngilizce arayüz, light/dark tema ve değiştirilebilir arayüz tercihleri
- Proje dışı yol erişimini engelleyen IPC sınırı ve HTML allowlist sanitizer
- Atomik yazma, proje kilidi, kapanışta kayıt kuyruğunu boşaltma ve
  project-local reversible Trash

## Kaynak yapısı

```text
main.mjs                              İnce Electron bootstrap
main/functions/                       Dosya, görev, özellik, geçmiş ve IPC domainleri
preload.js                            Sınırlı ve doğrulanmış renderer köprüsü
renderer/bootstrap.mjs                Renderer ES module başlangıcı
renderer/editor/                      Node, zengin metin, Paint ve sheet araçları
renderer/map/                         Map çalışma alanı, bağlantılar ve map dışa aktarma
renderer/tags/                        Blok, etiket ve görev sistemi
renderer/search/pisi-search-core.mjs  Arama puanlama ve ilişki modeli
renderer/search/pisi-search-index.mjs Yerel proje arama indeksi
renderer/search/pisi-global-search.mjs Hızlı geçiş penceresi ve map odağı
renderer/search/pisi-links-panel.mjs  Backlink/ilişki sağ paneli
renderer/productivity/                Quick Add ve Türkçe tarih ayrıştırma
renderer/data/                        Node özellikleri, Bases ve rollup arayüzleri
renderer/portability/                 Geçmiş, içe/dışa aktarma ve kurtarma arayüzü
style.css                             Uygulama stilleri
tests/                                Formül, yol güvenliği ve regresyon testleri
```

Ortak çalışma durumu `window.Pisi.state` altında tutulur. Bazı renderer modüllerinin
kullandığı top-level `window` erişimleri accessor üzerinden aynı state alanına
yönlendirilir; ayrı persisted state veya semantic authority oluşturmaz.

## Çalıştırma

Node.js 24 önerilir.

```bash
npm ci
npm start
```

Kullanılabilir doğrulama komutları:

```bash
npm run check:syntax
npm run check:types
npm run lint
npm test
npm run format
npm run format:check
npm run validate
npm run audit
```

`npm run validate`, repository-wide Prettier format kontrolünü; sözdizimi ve
mimari kontrollerini; branding/i18n kontrollerini; `checkJs: true` ile çalışan
TypeScript tip denetimini; ESLint kurallarını ve otomatik regresyon testlerini
çalıştırır. Aynı doğrulama `main` push’larında ve pull request’lerde GitHub
Actions üzerinde de çalışır. CI ayrıca `npm run audit` sonucunu raporlar.
Güncel `main` için format, source validation, Electron E2E ve dependency audit
GitHub Actions üzerinde zorunlu doğrulamalardır. Sabit test sayıları dokümana
otorite olarak yazılmaz; geçerli sonuç CI çalıştırmasının kendisidir.

## Arama ve bağlantılar

`Ctrl+P`, projenin yerel `.node` ve `.map` dosyalarından üretilen hızlı geçiş
penceresini açar. Sonuçlarda ok tuşlarıyla gezinilir, `Enter` içeriği açar,
`Alt+Enter` ise map içindeki node’u açmadan yalnızca konumuna odaklanır.
İndeks diske ayrı bir veritabanı olarak yazılmaz. Dosya sistemi değişiklikleri
değişen node yollarını önbellekten düşürür; değişmeyen belgelerin ayrıştırılmış
kayıtları yeniden kullanılır. Üçlü-karakter postings indeksi büyük projelerde
her tuşta tüm kayıtların yeniden normalize edilmesini önler.

Sağ paneldeki bağlantı görünümü doğrudan `[[Node Başlığı]]` metin referanslarını,
map oklarını, bağlantıya dönüştürülmemiş başlık bahsetmelerini, node görevlerini
ve ortak map üyeliklerini birlikte gösterir.

## Çalışma merkezi

Explorer başlığındaki pusula düğmesi veya `Ctrl+Shift+P`, çalışma merkezini
açar. Templates, Ayarlar, Tercihler ve Kısayollar sayfaları buradadır.
`Ctrl+M` (`Mod+M`) Quick Add penceresini açar. Bir node seçilmeden eklenen
görev proje kökündeki sistem rollü `Inbox.node` dosyasına yazılır.

İçe/Dışa Aktarma ve sürüm geçmişi ana arayüzden erişilebilir; Project Integrity
ayarları Settings altında tutulur. Research, Team ve Plugins yüzeyleri ilk beta
sonrası sadeleştirme kapsamında uygulamadan çıkarılmıştır.

Türkçe ayrıştırıcı; `yarın 14:00`, `cuma saat 3`, `her pazartesi`, `ayın son
iş günü`, `iki haftada bir`, `görev tamamlandıktan üç gün sonra`, `15
Ağustos’a kadar` ve `gelecek hafta ertele` gibi ifadeleri plan, deadline ve
tekrar alanlarına ayırır.

Özellik filtreleri `Durum:"Devam ediyor" Öncelik:>=4` gibi sorguları kabul
eder. Filtreler proje kökündeki `.pisi-views.json` dosyasına kaydedilir.
Filtre sonucundan üretilen map, kaynak node dosyalarını kopyalamaz; güvenli
referanslar kullanır ve map’ten kaldırma kaynak node’u silmez.

## Taşınabilirlik

İçerik değişikliklerinde node’un tam JSON snapshot’ı
`.pisi-history/<node-id>/` altında gzip sıkıştırmalı olarak tutulur. Her node
için en fazla 50 sürüm ve normal durumda 24 MiB history bütçesi korunur; restore
öncesinde mevcut node ayrıca `before-restore` snapshot’ına alınır. Atomik
`.pisi-backup` dosyaları Version History’den ayrı kurtarma katmanıdır.

İçe ve dışa aktarma akışları proje verilerini taşımaya yardımcı olur. Sürüm
geçmişi ile Project Integrity kontrolleri yerel proje dosyaları üzerinde çalışır;
kullanıcı verileri harici bir uygulama veritabanına taşınmaz.

## Cihazlar arası senkronizasyon

Workspace Center → Ayarlar bölümündeki Pisi Sync; masaüstünde açık olan gerçek
proje kökünü Android sürümüyle çift yönlü eşitler. Google Drive, OneDrive veya
iki cihazda aynı klasörü gösteren başka bir sağlayıcı kullanılabilir. Okunabilir
`.node/.map` proje dosyaları kaynak olmaya devam eder; `.pisi-sync` yalnız sürüm
ve çakışma metadatasıdır. Silmeler kurtarılabilir, eşzamanlı düzenlemeler
çakışma kopyasıyla korunur. Kurulum ve kabul testi için
[`docs/pisi-sync-guide-tr.md`](docs/pisi-sync-guide-tr.md) dosyasına bakın.

## Paketleme ve dağıtım

Yerel paketleme komutları:

```bash
npm run dist:installer
npm run dist:portable
npm run dist:mac
npm run dist:linux
```

Tagged `v*.*.*` release hattı önce audit/format/source validation çalıştırır,
ardından aynı beta release için şu paketleri üretir:

- Windows x64/ARM64 NSIS Setup ve Portable,
- macOS x64/ARM64/universal DMG ve ZIP,
- Linux x64/ARM64 AppImage ve DEB,
- platform checksum dosyaları.

Windows direct-download Authenticode signing optional’dır; kimlik sağlanırsa
workflow final EXE imzalarını ayrıca doğrular. macOS signing/notarization da
Developer ID ve App Store Connect kimlik bilgileri sağlandığında etkinleşir.
Linux checksum manifesti isteğe bağlı OpenPGP detached signature alabilir.

Microsoft Store ayrı `Microsoft Store MSIX` workflow’udur. Partner Center
identity değerleri yapılandırıldığında x64 + ARM64 unsigned MSIX bundle ve
`.msixupload` üretir; Store yayımlama aşamasında paketi Microsoft imzalar.
Partner Center credentials varsa yayın manuel olarak veya
`PISI_STORE_AUTO_PUBLISH=true` ile tag sonrasında otomatik başlatılabilir.

Güncelleme kanalları dağıtım tipine göre ayrıdır: Store/MSIX güncellemelerini
Microsoft Store yönetir; NSIS direct updater yalnız public HTTPS
`PISI_UPDATE_FEED_URL` yapılandırılmışsa çalışır; Portable build bilinçli
olarak self-update yapmaz.

Package-related `main` değişikliklerinde `Cross-platform Packaging Smoke`
gerçek platform runner’larında Windows unsigned NSIS + Portable x64/ARM64,
macOS DMG/ZIP x64/ARM64/universal ve Linux AppImage/DEB x64/ARM64 paketlerini
üretip doğrular. Windows smoke dört EXE’nin varlığını, boş olmadığını ve PE
`MZ` imzasını kontrol eder; signing credentials gerektirmez.

## Proje verileri

PISI, kullanıcı notlarını uygulama veritabanına taşımadan seçilen proje
klasöründe tutar. `.map` ve `.node` biçimlerinin tam tanımı
[`pisi-definition.md`](pisi-definition.md) dosyasındadır.

Node, map, klasör ve desteklenen proje yolu silmeleri varsayılan olarak
`.pisi/trash/items/` altındaki project-local reversible Trash’a gider. Trash;
payload ile birlikte canonical task/relationship ve map presentation
referanslarını güvenli restore için arşivler. Kalıcı silme ve Trash’i tamamen
boşaltma ayrı, açık kullanıcı işlemleridir.

JSON yazımları aynı klasörde geçici dosya ve rename ile atomik yapılır; önceki
sürüm `.pisi-backup` olarak korunabilir. Bozuk JSON otomatik olarak boş
içerikle ezilmez.

## Mevcut sınırlar

- Sheet, 10.000 × 80 güvenlik sınırı uygular. Satır/sütun silme, fare/klavye ile
  dikdörtgen çoklu seçim, toplu hücre biçimlendirme ve yapısal formül referansı
  güncelleme desteklenir.
- GitHub direct-download Windows paketleri signing identity olmadan üretilebilir;
  unsigned beta EXE’leri SmartScreen/Unknown Publisher uyarısı gösterebilir.
- Direct NSIS auto-update kodu hazırdır ancak public HTTPS update feed
  yapılandırılmadığında updater devre dışıdır. Portable build self-update yapmaz.
- macOS paketleri signing identity olmadan test/beta amacıyla üretilebilir;
  production direct dağıtımında Developer ID signing/notarization dış
  yapılandırması gerekir.
- Microsoft Store paketleme/publish hattı kaynakta hazırdır ancak gerçek Store
  identity, ürün kaydı ve Partner Center credentials repository dışı yayın
  bağımlılıklarıdır.
- Electron ana süreç ve renderer domainleri ES module olarak çalışır. Ana süreç
  `main.mjs` üzerinden başlar ve `main/package.json` altında `type: module` ile
  korunur. `preload.js`, `sandbox: true` Electron preload ortamının sınırlı
  `require` API'si nedeniyle bilinçli olarak CommonJS sınırında tutulur.

Güncel açık/production bağımlılıkları için
[`pisi-error.md`](pisi-error.md) dosyasına bakın.
