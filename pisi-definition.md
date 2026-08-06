# PISI veri ve davranış tanımı

## Amaç

PISI; not alma, notları bağlamlandırma, bağlamlardan hedef çıkarma ve
hedefleri tarihli görevlere dönüştürme amacıyla geliştirilmiş yerel bir
masaüstü uygulamasıdır.

Uygulamanın iki temel belge türü vardır:

- `.node`: Not içeriği ve node metadata’sı
- `.map`: Node yerleşimleri, bağlantılar, kamera ve görünüm durumu

Her iki dosya da UTF-8 JSON’dur. Eski dokümanda geçen `.md` ve `_res` biçimi
mevcut uygulama tarafından kullanılmaz.

## Arayüz

1. Üst çubuk: logo, pencere kontrolleri ve uygulama araçları.
2. Sol panel: proje klasörleri, `.map` ve `.node` belgeleri.
3. Orta araç çubukları: metin, Paint, Excel-benzeri tablo ve etiket araçları.
4. Orta çalışma alanı: map veya sekmeli node editorü.
5. Sağ panel: görevler, etiket araması, node bağlantıları ve görünüm
   özelleştirmeleri.
6. Takvim: sol/sağ panele dock edilebilir veya ekranda float olarak taşınabilir.

## `.node` dosyası

Basitleştirilmiş örnek:

```json
{
  "pisi": {
    "version": 1,
    "type": "node",
    "id": "node_00000000-0000-4000-8000-000000000000",
    "title": "Örnek Node",
    "sidecar": "inv_Örnek Node__node_00000000-0000-4000-8000-000000000000",
    "createdAt": "2026-07-29T12:00:00.000Z",
    "updatedAt": "2026-07-29T12:00:00.000Z",
    "parentMap": "none",
    "connectionTypes": {
      "up-hub": [],
      "down-hub": [],
      "co-level": [],
      "upstream": [],
      "downstream": []
    }
  },
  "properties": {
    "status": {
      "id": "status",
      "name": "Durum",
      "type": "select",
      "value": "Devam ediyor"
    },
    "priority": {
      "id": "priority",
      "name": "Öncelik",
      "type": "number",
      "value": 4
    }
  },
  "content": "<div class=\"pisi-editor-block\">Not içeriği</div>"
}
```

`content`, allowlist ile temizlenen editör HTML’idir. Paint tuvalları şu anda
bu HTML içindeki `canvas[data-pisi-canvas][data-image]` alanında tek bir
base64 PNG taşır. Excel-benzeri tablolar `table[data-pisi-sheet]` ve hücre
metadata’larıyla saklanır.

Standalone node için `parentMap` değeri `none`, günlük node’u için `diary`,
map altındaki node için parent map kimliğidir.

`properties` alanı proje geneli sorgulama içindir ve editör içindeki sheet
tablosundan ayrıdır. Desteklenen türler `text`, `number`, `date`, `select`,
`multiselect`, `node`, `checkbox`, `relation` ve `rollup` değerleridir. Relation
birden çok node kimliği/yolu tutar; rollup bir relation özellik kimliği, hedef
özellik kimliği ve aggregate (`count`, `sum`, `average`, `min`, `max`, `unique`,
`join`, `checked-percent`) tanımlar. Her özellik kararlı bir `id`,
görünen `name`, `type` ve normalize edilmiş `value` taşır.

## `.map` dosyası

Basitleştirilmiş örnek:

```json
{
  "pisi": {
    "version": 1,
    "type": "map",
    "id": "map_00000000-0000-4000-8000-000000000000",
    "title": "Örnek Map",
    "sidecar": "nd_Örnek Map__map_00000000-0000-4000-8000-000000000000",
    "createdAt": "2026-07-29T12:00:00.000Z",
    "updatedAt": "2026-07-29T12:00:00.000Z"
  },
  "map": {
    "nodes": [
      {
        "id": "node_00000000-0000-4000-8000-000000000000",
        "x": 80,
        "y": 80,
        "width": 220,
        "height": 92
      }
    ],
    "edges": [
      {
        "id": "edge_00000000-0000-4000-8000-000000000000",
        "sourceId": "node_...",
        "targetId": "node_...",
        "sourcePort": "bottom",
        "targetPort": "top",
        "type": "down-hub",
        "sourceRole": "down-hub",
        "targetRole": "up-hub"
      }
    ],
    "camera": {
      "x": 0,
      "y": 0,
      "zoom": 1
    },
    "collapsedHubs": []
  }
}
```

Özellik görünümünden üretilen map’ler ayrıca proje köküne göre güvenli bağıl
node yolları tutan `map.references` dizisine sahiptir. Bu girdiler görünüm
referansıdır; map’ten kaldırılmaları kaynak `.node` dosyasını silmez. Map
bağlantı portları referans node’larında kapalıdır.

Bağlantı türleri:

- `down-hub`: parent–child hiyerarşisi; child sol ağaçta parent altında görünür.
- `co-level`: denk bağlam ilişkisi.
- `stream`: süreç/zaman akışı; hiyerarşik parent oluşturmaz.

Bir child yalnızca bir hiyerarşik parent taşır. İkinci parent isteği kullanıcı
onayıyla `stream` ilişkisine çevrilebilir. Self-loop, bozuk ID, duplicate edge
ve hiyerarşi döngüleri kabul edilmez veya güvenli biçimde normalize edilir.

## Global arama ve node ilişkileri

Global indeks proje içindeki görünür klasörleri, standalone node’ları ve map
sidecar’larındaki node’ları kapsar. Aranabilen alanlar:

- node ve map başlığı,
- editör blok metni,
- görev kaynak metni ve görev etiketi,
- kullanıcı etiketi,
- tablo hücre metni,
- proje köküne göre dosya yolu.

İndeks türetilmiş ve geçicidir; kullanıcı dosyalarının yanında ayrı bir indeks
dosyası oluşturmaz. Dosya sistemi değişikliğinde yalnız değişen yolun ayrıştırma
önbelleği atılır; belge imzası değişmeyen kayıtlar ve üçlü-karakter postings
indeksi yeniden kullanılır. Map içindeki
bir sonuç açıldığında önce map yüklenir, kamera node’u merkezler ve node modalı
map bağlamı korunarak açılır. `Alt+Enter` yalnız map odağını uygular.

Bağlantılar paneli üç ilişki kaynağını birleştirir:

1. `[[Node Başlığı]]` biçimindeki doğrudan metin referansı,
2. `.map` içindeki yönlü veya co-level bağlantı,
3. node içindeki görev kaynağı.

Başlığı düz metinde geçen fakat `[[...]]` referansı bulunmayan node’lar
“bağlantısız bahsetme” olarak listelenir. İlişki indeksi kaynak `.node` ve
`.map` belgelerini değiştirmez.

## Sidecar klasörleri

- Map sidecar’ı: `nd_<başlık>__<map-id>`
- Node sidecar’ı: `inv_<başlık>__<node-id>`

Map altında oluşturulan `.node` dosyaları map sidecar klasöründe bulunur.
Node sidecar’ı da node dosyasıyla aynı klasörde oluşturulur. Klasör adı
başlık değişiminde aynı transaction içinde güncellenir.

PISI yalnızca tam sidecar desenine uyan klasörleri Explorer’da gizler; sadece
`inv_` veya `nd_` ile başlayan normal kullanıcı klasörleri gizlenmez.

## Günlük ve takvim

PISI tarafından yönetilen günlük klasörü proje kökündeki `diary/` klasörüdür
ve `.pisi-diary` marker dosyası taşır. Tarihli node dosya adı
`YYYY-MM-DD.node`, görünen başlığı `DD-MM-YYYY` biçimindedir.

Görevlerden üretilen günlük kopyaları iki marker arasında yönetilir:

```text
<!--PISI_DIARY_MANAGED_START-->
...
<!--PISI_DIARY_MANAGED_END-->
```

Marker dışındaki kullanıcı içeriği eşitleme sırasında korunur. Eksik veya
başarısız proje taraması “tam indeks” sayılmaz ve günlükteki managed alanları
silmek için kullanılmaz.

Görev etiketi:

```text
..todo.<öncelik>.<GG>-<AA>-<YY>
..todo.<öncelik>.<GG>-<AA>-<YYYY>
```

Öncelik `1–9` aralığındadır. Tamamlanma işareti bloktaki tüm görevleri değil,
ilgili todo etiketini hedefler; tamamlanan görev sağ panelden yeniden
açılabilir.

Quick Add görev etiketi üzerinde aşağıdaki birbirinden ayrı alanları saklar:

- `data-pisi-todo-scheduled-at`: planlanan yerel tarih veya tarih-saat,
- `data-pisi-todo-deadline`: son tarih,
- `data-pisi-todo-reminder-at`: hatırlatma anı,
- `data-pisi-todo-duration-minutes`: tahmini süre,
- `data-pisi-todo-actual-minutes`: gerçek harcanan süre,
- `data-pisi-todo-completion-offset-days`: tamamlanmaya bağlı tekrar aralığı.

Node seçilmeden yakalanan görevler `pisi.systemRole = "inbox"` olan proje
kökü Inbox node’una eklenir. `biweekly` ve `after-completion` tekrar türleri
mevcut günlük/haftalık/aylık türlerle birlikte desteklenir. Alt görevler aynı
todo etiketi üzerinde `data-pisi-todo-parent="subtask:<mission-id>"` biçiminde
saklanır; `dep:` önekli görev bağımlılıklarından ayrı yorumlanır.

## Yerel geçmiş ve taşınabilirlik

Node kaydından önce tam JSON sürümü aşağıdaki yapıda tutulur:

```text
.pisi-history/
  <node-id>/
    <epoch>-<iso-zaman>-<içerik-hash>.json
```

Aynı hash tekrar kaydedilmez ve node başına son 50 sürüm korunur. Geri yükleme
öncesinde mevcut sürüm `before-restore` nedeni ile ayrıca yakalanır. Atomik
`<belge>.pisi-backup` dosyası da kimlik doğrulamasından sonra aynı arayüzden
geri yüklenebilir.

Markdown klasörü içe aktarma klasör hiyerarşisini koruyarak yeni `.node`
dosyaları oluşturur. Proje dışa aktarma node’ları frontmatter özellikleriyle
Markdown’a, map verisini JSON’a yazar. Açık node ayrıca HTML, PDF ve gerçek
OOXML/ZIP tabanlı DOCX olarak dışa aktarılabilir.

## Kaynak node’ları ve blok referansları

Web yakalama ile oluşturulan node `pisi.systemRole = "source"` taşır. URL,
erişim tarihi, yazar, yayın tarihi, DOI, atıf anahtarı ve bibliyografya node
özelliklerinde kalır. Sayfadan alınamayan metadata kullanıcı alanlarıyla
tamamlanabilir; ağ hatası seçili metinle kaynak oluşturmayı engellemez.

Editörün Word-benzeri davranışı korunurken içerik blokları kararlı
`data-pisi-block-id` ve `data-pisi-block-type` alır. Paragraf, başlık, alıntı,
kod, madde, numaralı madde ve görev blokları WYSIWYG görünüm ile Markdown kaynak
görünümü arasında dönüştürülebilir. Bir referans `göreli/yol.node#block-id`
biçimindedir; `[[Node#^block-id]]` linkleri ve `((block-id))` mention ifadeleri
blok ilişki indeksine dahil edilir.
Alıntı blokları `data-pisi-citation-source`, `data-pisi-citation-key` ve
isteğe bağlı `data-pisi-block-ref` taşır; kaynak yolu backlink indeksine dahil
edilir.

## Veri güvenliği kuralları

- Renderer yalnızca aktif projenin gerçek yolu altında işlem yapabilir.
- Symlink/junction üzerinden proje dışına çıkılamaz.
- PISI kimlikleri katı `map_...` veya `node_...` deseninde olmalıdır.
- Yazımlar geçici dosya, `fsync` ve atomik rename ile yapılır.
- Rename, move, bağlantı metadata’sı ve silme akışları hata halinde geri alma
  uygular.
- Map/node silme işlemi dosya ve sidecar’ı birlikte sistem çöp kutusuna taşır.
- Bozuk/boş JSON otomatik olarak yeni boş dokümanla değiştirilmez.
- Bütünlük denetimi bozuk JSON, yinelenen kimlik, eksik sidecar, kopuk map
  referansı/yerleşimi ve bulunamayan edge uçlarını raporlar.
- Uygulama kapanmadan ve proje değişmeden önce bekleyen editor kayıtları
  tamamlanır.
