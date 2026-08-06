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
- Kullanıcı etiketleri, proje görev indeksi ve görev başına tamamlanma durumu
- `Ctrl+P` ile node, içerik, görev, etiket, map, tablo ve dosya yolu araması
- Metin/map/görev ilişkilerini birleştiren backlink ve bağlantısız bahsetme paneli
- Arama sonucundaki node’u kendi map’inde merkezleme ve vurgulama
- Günlük node’larıyla eşitlenen görevler ve sürüklenebilir/dock edilebilir takvim
- Proje dışı yol erişimini engelleyen IPC sınırı ve HTML allowlist sanitizer
- Atomik yazma, proje kilidi, kapanışta kayıt kuyruğunu boşaltma ve silmede
  sistem çöp kutusu

## Kaynak yapısı

```text
main.js                              Electron ana süreci, dosya/IPC işlemleri
preload.js                           Sınırlı renderer köprüsü
app.js                               Başlangıç, sekmeler ve editör araçları
renderer/pisi-tree.js                Explorer ve proje yenileme
renderer/pisi-map-workspace.js       Map/node çalışma alanı ve editör kayıtları
renderer/pisi-map-connections.js     Bağlantılar, kamera, pan/zoom ve seçim
renderer/pisi-tags.js                Blok, etiket ve görev sistemi
renderer/pisi-calendar.js            Takvim ve günlük eşitlemesi
renderer/pisi-node-modal.js          Modal klavye/focus davranışı
renderer/search/pisi-search-core.mjs Arama puanlama ve ilişki modeli
renderer/search/pisi-search-index.mjs Yerel proje arama indeksi
renderer/search/pisi-global-search.mjs Hızlı geçiş penceresi ve map odağı
renderer/search/pisi-links-panel.mjs Backlink/ilişki sağ paneli
style.css                            Uygulama stilleri
tests/                               Formül, yol güvenliği ve regresyon testleri
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
npm run lint
npm test
npm run validate
npm run audit
```

`npm run validate`, bütün JavaScript dosyalarının sözdizimini, doğruluk odaklı
ESLint kurallarını ve otomatik regresyon testlerini çalıştırır. Aynı doğrulama
`main` push’larında GitHub Actions üzerinde de çalışır.

## Arama ve bağlantılar

`Ctrl+P`, projenin yerel `.node` ve `.map` dosyalarından üretilen hızlı geçiş
penceresini açar. Sonuçlarda ok tuşlarıyla gezinilir, `Enter` içeriği açar,
`Alt+Enter` ise map içindeki node’u açmadan yalnızca konumuna odaklanır.
İndeks diske ayrı bir veritabanı olarak yazılmaz; proje değiştiğinde veya dosya
sistemi güncellendiğinde güvenli biçimde yeniden oluşturulur.

Sağ paneldeki **Bağlantılar** sekmesi doğrudan `[[Node Başlığı]]` metin
referanslarını, map oklarını, bağlantıya dönüştürülmemiş başlık bahsetmelerini,
node görevlerini ve ortak map üyeliklerini birlikte gösterir.

## Paketleme

```bash
npm run dist:installer
npm run dist:portable
```

Windows NSIS ve portable çıktıları x64 ile ARM64 için üretilir. Çıktı adı
ürün, sürüm, işletim sistemi ve mimariyi içerir. Code signing ve otomatik
güncelleme için ayrıca yayın sertifikası ile güncelleme sunucusu gerekir.

## Proje verileri

PISI, kullanıcı notlarını uygulama veritabanına taşımadan seçilen proje
klasöründe tutar. `.map` ve `.node` biçimlerinin tam tanımı
[`pisi-definition.md`](pisi-definition.md) dosyasındadır.

Dosya silme işlemleri sistem çöp kutusuna gider. JSON yazımları aynı klasörde
geçici dosya ve rename ile yapılır; önceki sürüm `.pisi-backup` olarak
korunabilir. Bozuk JSON otomatik olarak boş içerikle ezilmez.

## Mevcut sınırlar

- Paint görseli halen node JSON’undaki `data-image` alanında base64 PNG olarak
  tutulur; sidecar’a harici kaynak taşıma henüz yapılmamıştır.
- macOS/Linux paket hedefleri, platform ikonları ve imzalama altyapısı henüz
  yapılandırılmamıştır.
- Ana scriptler klasik global script olarak yüklenir; domain dosyalarına
  ayrılmış olsalar da tam ES module dönüşümü tamamlanmamıştır.
