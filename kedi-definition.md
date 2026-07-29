# KEDI veri ve davranış tanımı

## Amaç

KEDI; not alma, notları bağlamlandırma, bağlamlardan hedef çıkarma ve
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
5. Sağ panel: görevler, etiket araması ve görünüm özelleştirmeleri.
6. Takvim: sol/sağ panele dock edilebilir veya ekranda float olarak taşınabilir.

## `.node` dosyası

Basitleştirilmiş örnek:

```json
{
  "kedi": {
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
  "content": "<div class=\"kedi-editor-block\">Not içeriği</div>"
}
```

`content`, allowlist ile temizlenen editör HTML’idir. Paint tuvalları şu anda
bu HTML içindeki `canvas[data-kedi-canvas][data-image]` alanında tek bir
base64 PNG taşır. Excel-benzeri tablolar `table[data-kedi-sheet]` ve hücre
metadata’larıyla saklanır.

Standalone node için `parentMap` değeri `none`, günlük node’u için `diary`,
map altındaki node için parent map kimliğidir.

## `.map` dosyası

Basitleştirilmiş örnek:

```json
{
  "kedi": {
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

Bağlantı türleri:

- `down-hub`: parent–child hiyerarşisi; child sol ağaçta parent altında görünür.
- `co-level`: denk bağlam ilişkisi.
- `stream`: süreç/zaman akışı; hiyerarşik parent oluşturmaz.

Bir child yalnızca bir hiyerarşik parent taşır. İkinci parent isteği kullanıcı
onayıyla `stream` ilişkisine çevrilebilir. Self-loop, bozuk ID, duplicate edge
ve hiyerarşi döngüleri kabul edilmez veya güvenli biçimde normalize edilir.

## Sidecar klasörleri

- Map sidecar’ı: `nd_<başlık>__<map-id>`
- Node sidecar’ı: `inv_<başlık>__<node-id>`

Map altında oluşturulan `.node` dosyaları map sidecar klasöründe bulunur.
Node sidecar’ı da node dosyasıyla aynı klasörde oluşturulur. Klasör adı
başlık değişiminde aynı transaction içinde güncellenir.

KEDI yalnızca tam sidecar desenine uyan klasörleri Explorer’da gizler; sadece
`inv_` veya `nd_` ile başlayan normal kullanıcı klasörleri gizlenmez.

## Günlük ve takvim

KEDI tarafından yönetilen günlük klasörü proje kökündeki `diary/` klasörüdür
ve `.kedi-diary` marker dosyası taşır. Tarihli node dosya adı
`YYYY-MM-DD.node`, görünen başlığı `DD-MM-YYYY` biçimindedir.

Görevlerden üretilen günlük kopyaları iki marker arasında yönetilir:

```text
<!--KEDI_DIARY_MANAGED_START-->
...
<!--KEDI_DIARY_MANAGED_END-->
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

## Veri güvenliği kuralları

- Renderer yalnızca aktif projenin gerçek yolu altında işlem yapabilir.
- Symlink/junction üzerinden proje dışına çıkılamaz.
- KEDI kimlikleri katı `map_...` veya `node_...` deseninde olmalıdır.
- Yazımlar geçici dosya, `fsync` ve atomik rename ile yapılır.
- Rename, move, bağlantı metadata’sı ve silme akışları hata halinde geri alma
  uygular.
- Map/node silme işlemi dosya ve sidecar’ı birlikte sistem çöp kutusuna taşır.
- Bozuk/boş JSON otomatik olarak yeni boş dokümanla değiştirilmez.
- Uygulama kapanmadan ve proje değişmeden önce bekleyen editor kayıtları
  tamamlanır.
