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
- Atomik yazma, proje kilidi, kapanışta kayıt kuyruğunu boşaltma ve silmede
  sistem çöp kutusu

## Kaynak yapısı

```text
main.js                               İnce Electron bootstrap
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

Ortak çalışma durumu `window.Pisi.state` altında tutulur. Eski global adlar,
mevcut özelliklerin uyumluluğu için bu state’e köprülenmiştir.

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
2 Ekim 2026 tarihli güncel `main` doğrulamasında dependency audit
**0 vulnerability**, `tsc --checkJs` **0 hata** ve Node regresyon testleri
**638/638 başarılı** durumdadır.

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

Her içerik değişikliğinden önce node’un tam JSON sürümü
`.pisi-history/<node-id>/` altında saklanır ve son 50 sürüm korunur. Atomik
`.pisi-backup` dosyaları geri yüklenebilir. Geri yükleme öncesinde mevcut node
ayrıca geçmişe alınır.

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

## Paketleme

```bash
npm run dist:installer
npm run dist:portable
```

Windows NSIS ve portable çıktıları x64 ile ARM64 için üretilir. Çıktı adı
ürün, sürüm, işletim sistemi ve mimariyi içerir. `v*.*.*` etiketiyle çalışan
release workflow’u doğrulama, Windows paketleme, SHA256 üretimi ve GitHub beta
release oluşturma adımlarını otomatikleştirir. Code signing henüz yapılandırılmış
değildir.

## Proje verileri

PISI, kullanıcı notlarını uygulama veritabanına taşımadan seçilen proje
klasöründe tutar. `.map` ve `.node` biçimlerinin tam tanımı
[`pisi-definition.md`](pisi-definition.md) dosyasındadır.

Dosya silme işlemleri sistem çöp kutusuna gider. JSON yazımları aynı klasörde
geçici dosya ve rename ile yapılır; önceki sürüm `.pisi-backup` olarak
korunabilir. Bozuk JSON otomatik olarak boş içerikle ezilmez.

## Mevcut sınırlar

- Sheet, DOM tabanlı çalışma modelini kontrollü tutmak için 300 × 80 güvenlik
  sınırı uygular. Satır/sütun silme, fare/klavye ile dikdörtgen çoklu seçim,
  seçili aralığa toplu biçimlendirme ve yapısal formül referansı güncelleme
  desteklenir.
- Windows paketleri henüz code-signed değildir; SmartScreen ilk çalıştırmada
  uyarı gösterebilir.
- macOS/Linux paket hedefleri, platform imzalama/notarization ve otomatik
  güncelleme yayın altyapısı henüz yapılandırılmamıştır.
- Electron ana süreç domainleri CommonJS, renderer domainleri ES module olarak
  çalışır; tek bir paket formatına tam dönüşüm yapılmamıştır.
