# PISI canonical veri ve davranış tanımı

## Amaç

PISI; not alma, notları bağlamlandırma, ilişkileri haritalarda görselleştirme,
görevleri planlama ve proje verisini yerel dosyalar üzerinde taşınabilir biçimde
saklama amacıyla geliştirilmiş masaüstü uygulamasıdır.

Bu dosya **canonical mimariyi** tanımlar. Buradaki en önemli kural şudur:

> Aynı semantik veri için birden fazla kalıcı otorite oluşturulmaz.

Renderer görünümü, arama indeksi, diary görünümü, Todo markup'ı,
`connectionTypes` ve map üzerinde çizilen edge nesneleri gerektiğinde canonical
kaynaklardan üretilen **projection** verileridir. Projection verisi canonical
kaynağın yerine geçmez.

## Canonical otorite matrisi

- Node içeriği ve node property değerleri: canonical otorite `.node`; Editor DOM ve arama kayıtları projection'dır.
- Görevler: canonical otorite `.pisi/tasks.json`; Node Todo markup'ı, diary, Todo/Calendar görünümü ve task search records projection'dır.
- Semantik node ilişkileri: canonical otorite `.pisi/relationships.json`; map edge görünümü ve node `connectionTypes` projection'dır.
- Property tanımı, kimliği ve türü: canonical otorite `.pisi/properties.json`; node içindeki okunabilir `name` / `type` kopyaları otorite değildir.
- Map üyeliği, yerleşim, kamera ve presentation: canonical otorite `.map`; renderer map state'i projection'dır.
- Paint/Sheet ağır editor verisi: canonical otorite node sidecar içindeki content-addressed asset dosyalarıdır; renderer'daki `data-image` ve `data-pisi-sheet-model` transient hydration verisidir.
- Arama indeksi: kalıcı canonical otoritesi yoktur; bellek içi trigram/search index yeniden üretilebilir projection'dır.
- Version History: `.pisi-history/` recovery verisidir; canonical canlı uygulama durumu değildir.
- Reversible Trash: `.pisi/trash/items/` recovery verisidir; canonical canlı uygulama durumu değildir.
- Crash recovery: `.pisi/mutations/` geçici journal'dır; canonical semantik store değildir.

`.node`, `.map` ve `.pisi/*` store'ları birbirinin yerine veri üretmez. Bir
canonical store eksik veya bozuksa projection'lardan sessizce yeniden
oluşturulmaz.

## Uygulama katmanları

Canonical veri akışının yönü:

```text
UI / view
  -> renderer domain client
  -> preload / IPC transport
  -> main domain command-query dispatcher
  -> domain service / authority store
  -> project storage
  -> filesystem
```

Kurallar:

- Query işlemleri canonical veriyi bilinçli olarak değiştirmez.
- Command işlemleri mutasyonu semantik niyet olarak ifade eder.
- Yeni feature kodu mümkün olduğunda versioned domain command/query
  sözleşmelerini kullanır.
- Çok dosyalı semantik değişiklikler atomic mutation sınırı altında yürütülür.
- Storage katmanı bir veri otoritesi değildir; yalnız proje-scope I/O sınırıdır.
- Renderer aktif projenin gerçek yolu dışına çıkamaz; symlink/junction kaçışı
  reddedilir.

## Proje içindeki temel dosyalar

Basitleştirilmiş yapı:

```text
project/
  Note.node
  inv_Note__node_<id>/
    paint/
      <sha256>.png
    sheet/
      <sha256>.json
  Map.map
  nd_Map__map_<id>/
    Child.node
    inv_Child__node_<id>/
  diary/
    .pisi-diary
    YYYY-MM-DD.node
  .pisi/
    tasks.json
    relationships.json
    properties.json
    mutations/
    trash/
      items/
  .pisi-history/
    <node-id>/
      index.json
      <history-id>.json.gz
```

Dosya ve klasör adları kullanıcı başlığına göre değişebilir; kalıcı kimlik
`node_...`, `map_...`, `task_...` ve `edge_...` kimlikleridir.

## `.node` belgesi

`.node`, UTF-8 JSON'dur. Node'un canonical sorumluluğu:

- node kimliği ve belge metadata'sı,
- zengin metin içeriği,
- node'a ait property **değerleri**,
- fiziksel map sahipliği için `parentMap`.

Basitleştirilmiş canonical örnek:

```json
{
    "pisi": {
        "version": 1,
        "type": "node",
        "id": "node_00000000-0000-4000-8000-000000000000",
        "title": "Örnek Node",
        "sidecar": "inv_Örnek Node__node_00000000-0000-4000-8000-000000000000",
        "createdAt": "2026-10-04T12:00:00.000Z",
        "updatedAt": "2026-10-04T12:00:00.000Z",
        "parentMap": "none"
    },
    "properties": {
        "status_a": {
            "id": "status_a",
            "name": "Durum",
            "type": "multiselect",
            "value": ["Devam ediyor"]
        }
    },
    "content": "<div class=\"pisi-editor-block\" data-pisi-block-id=\"block_...\">Not içeriği</div>"
}
```

### Node'da kalıcı olmayan ilişkisel alanlar

`pisi.connectionTypes` canonical state değildir ve diske yazılmaz. İhtiyaç
olduğunda `.pisi/relationships.json` üzerinden query-time projection olarak
üretilir.

Aynı nedenle node dosyası semantik edge listesinin otoritesi değildir.

### `parentMap`

- standalone node: `none`
- günlük node: `diary`
- map sidecar'ında fiziksel child olan node: parent map kimliği

Bir standalone node başka bir map'te `map.references` üzerinden
görselleştirilebilir; bu durumda kaynak `.node` dosyası taşınmaz ve
`parentMap` değiştirilmez.

## Property sistemi

Property mimarisinde iki farklı veri katmanı vardır:

1. `.pisi/properties.json`: property kimliği, adı ve türünün project-level
   canonical şeması.
2. `.node` içindeki `properties`: o node'a ait değerler.

Canonical editable property türleri:

- `text`
- `number`
- `multiselect`
- `relation`

`rollup` mevcut runtime için internal persisted türdür; normal editable property
menüsünün parçası değildir.

Canonical rollup aggregate değerleri:

- `count`
- `sum`
- `average`
- `min`
- `max`
- `unique`
- `join`

Property rename kimliği değiştirmez. Project-level type değişimi bütün
kullanımlarda kayıpsız uyumluluk doğrulandıktan sonra atomik olarak yapılır.

Eksik property schema, node'lardaki eski biçimleri tarayıp otomatik olarak
canonical şemaya dönüştürmez. Canonical şema ayrı otoritedir; belirsiz veya
desteklenmeyen veri Project Integrity tarafından raporlanır.

## `.map` belgesi

`.map`, UTF-8 JSON'dur. Canonical sorumluluğu semantic relationship değildir;
şunlardır:

- map üyeliği,
- node yerleşimi ve node'a özel görsel customization,
- standalone node reference'ları,
- relationship presentation (`relationshipViews`),
- kamera,
- collapsed/operational görünüm durumu.

Basitleştirilmiş canonical örnek:

```json
{
    "pisi": {
        "version": 1,
        "type": "map",
        "id": "map_00000000-0000-4000-8000-000000000000",
        "title": "Örnek Map",
        "sidecar": "nd_Örnek Map__map_00000000-0000-4000-8000-000000000000",
        "createdAt": "2026-10-04T12:00:00.000Z",
        "updatedAt": "2026-10-04T12:00:00.000Z"
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
        "references": [
            {
                "id": "node_11111111-1111-4111-8111-111111111111",
                "path": "Notes/Standalone.node"
            }
        ],
        "relationshipViews": [
            {
                "relationshipId": "edge_00000000-0000-4000-8000-000000000000",
                "sourcePort": "bottom",
                "targetPort": "top"
            }
        ],
        "relationshipViewVersion": 1,
        "camera": {
            "x": 0,
            "y": 0,
            "zoom": 1
        },
        "collapsedHubs": []
    }
}
```

`map.nodes[]` içindeki `x`, `y`, `width`, `height` o map için canonical layout
durumudur. Aynı node farklı map'lerde farklı konumda bulunabilir.

`relationshipViews` yalnız presentation verisi tutabilir:

- `relationshipId`
- `sourcePort`
- `targetPort`
- opsiyonel görsel `customization`

Endpoint, ilişki türü, yön/role, label veya relationship property'leri
`relationshipViews` içinde canonical olarak tekrar tanımlanmaz.

### `map.edges` yoktur

Semantic `map.edges` / `.map.data.map.edges` current persistence contract'ın
parçası değildir ve map açılırken otomatik migration yapılmaz. Canonical
semantic ilişki `.pisi/relationships.json` içinde bulunmalıdır.

Renderer'ın çizdiği edge, canonical relationship ile map presentation
verisinin runtime projection'ıdır.

## Canonical semantic relationships

Project-wide ilişki otoritesi:

```text
.pisi/relationships.json
```

Basitleştirilmiş kayıt:

```json
{
    "version": 1,
    "relationships": [
        {
            "id": "edge_00000000-0000-4000-8000-000000000000",
            "sourceId": "node_A",
            "targetId": "node_B",
            "type": "down-hub",
            "sourceRole": "down-hub",
            "targetRole": "up-hub",
            "direction": "directed",
            "createdAt": "2026-10-04T12:00:00.000Z",
            "updatedAt": "2026-10-04T12:00:00.000Z"
        }
    ]
}
```

Desteklenen temel semantik ilişki davranışları:

- `down-hub`: hiyerarşik parent-child
- `co-level`: denk/undirected ilişki
- `stream`: süreç veya akış; hiyerarşik parent oluşturmaz

Canonical graph kuralları self-loop, bozuk ID, semantic duplicate, ikinci
hiyerarşik parent ve hierarchy cycle gibi geçersiz durumları reddeder veya
explicit kullanıcı/domain operasyonu üzerinden güvenli semantiğe dönüştürür.

Bir node'un `connectionTypes` görünümü bu store'dan türetilir; ayrı persisted
semantic authority değildir.

## Görevler ve Calendar / Diary

Canonical görev otoritesi:

```text
.pisi/tasks.json
```

Bir task; stabil `task_...` kimliği, başlık, durum, priority, tarih alanları,
repeat bilgisi, dependencies, order ve source referanslarını taşır.

Canonical priority aralığı **1-5**'tir.

Canonical durumlar:

- `todo`
- `doing`
- `waiting`
- `blocked`
- `done`

Repeat değerleri:

- `none`
- `daily`
- `weekdays`
- `weekly`
- `biweekly`
- `monthly`
- `after-completion`

Node editöründeki Todo markup'ı canonical task'ın düzenlenebilir
projection/reference katmanıdır. Bir görev projection'ı canonical task kimliği
taşımadan background scan ile yeni canonical göreve dönüştürülmez.

Current Todo etiketi temel olarak:

```text
todo.<1-5>.<DD-MM-YYYY>
todo.<1-5>.none
```

biçimindedir. UI içinde `..todo...`, `/todo...` veya `#todo...` gibi gösterim
önekleri normalize edilebilir; semantic priority yine 1-5'tir.

Quick Add / editor projection'ında aşağıdaki alanlar tutulabilir:

- scheduled time
- deadline
- reminder
- estimated duration
- actual duration
- repeat / completion offset
- dependency / subtask bilgisi

Calendar, diary, progress/statistics ve task search kayıtları
`.pisi/tasks.json` üzerinden türetilir. Bunlar görev otoritesi değildir.

### Diary

PISI diary klasörü proje kökündeki `diary/` klasörüdür ve `.pisi-diary`
marker'ı ile yönetilir. Tarihli node dosya adı `YYYY-MM-DD.node`, görünen
başlık `DD-MM-YYYY` biçimindedir.

Diary içindeki managed task görünümü canonical task store'un projection'ıdır.
Diary veya project-wide tarama canonical task store'u yeniden kurmak için
kullanılmaz.

## Paint ve Sheet sidecar asset modeli

Paint ve Sheet ağır verisi kalıcı node HTML'ine base64/JSON olarak gömülmez.

Node kaydı sırasında:

- Paint PNG bytes SHA-256 ile content-addressed dosyaya yazılır:
  `paint/<sha256>.png`
- Sheet database snapshot SHA-256 ile content-addressed dosyaya yazılır:
  `sheet/<sha256>.json`

Persisted HTML yalnız referansı taşır:

```html
<canvas data-pisi-canvas="1" data-pisi-asset="paint/<sha256>.png"></canvas>

<table data-pisi-sheet="1" data-pisi-sheet-asset="sheet/<sha256>.json"></table>
```

Node açılırken renderer için transient hydration yapılır:

- Paint: `data-image="data:image/png;base64,..."`
- Sheet: `data-pisi-sheet-model="..."`

Bu hydrated alanlar canonical disk formatı değildir; save sırasında yeniden
sidecar referansına normalize edilir.

Aynı içerik aynı hash dosyasını tekrar kullanır. Değişen içerik yeni immutable
asset üretir. Canlı node veya korunan history snapshot'ları tarafından artık
referans verilmeyen canonical Paint/Sheet asset dosyaları garbage collection ile
silinir. Bilinmeyen/manual sidecar dosyaları bu GC tarafından keyfi olarak
silinmez.

### Sheet modeli

Sheet, project property sisteminden ayrı bir embedded database modelidir.
Canonical Sheet snapshot; stable database/field/item/view kimliklerini,
değer/formül/format kayıtlarını ve view-level filtre/sort/pagination gibi
ayarları taşır.

Current Sheet field türleri:

- `text`
- `number`
- `date`
- `select`
- `mSelect`
- `checkbox`
- `formula`

Sheet modeli eksik veya bozuksa renderer DOM'dan eski bir tablo modelini
otomatik reconstruct/migrate etmez.

## Sidecar klasörleri

Managed sidecar desenleri:

- node: `inv_<başlık>__<node-id>`
- map: `nd_<başlık>__<map-id>`

Map sidecar'ı fiziksel child `.node` dosyalarını taşır. Node sidecar'ı Paint,
Sheet ve node'a ait diğer managed asset'leri taşır.

Başlık rename edildiğinde document ve managed sidecar aynı mutation akışı
içinde hizalanır.

Explorer yalnız tam managed sidecar desenine uyan klasörleri gizler; sırf
`inv_` veya `nd_` ile başlayan normal kullanıcı klasörleri sidecar kabul
edilmez.

## Arama, link ve projection mimarisi

Search index kullanıcı verisinin otoritesi değildir.

Canonical kaynaklar:

- `.pisi/tasks.json`
- `.pisi/relationships.json`
- `.pisi/properties.json`
- `.node`
- `.map`

üzerinden rebuildable search projection üretilir.

Aktif driver `memory-trigram-v1` tabanlıdır. Index:

- silinebilir,
- yeniden kurulabilir,
- stale/failed olduğunda authority repair için kullanılmaz,
- canonical store'a geri yazılmaz.

Bounded `.node` / `.map` watcher değişiklikleri incremental projection delta
uygulayabilir; belirsiz veya büyük değişiklikler full rebuild'e döner.

Unsaved editor içeriği de yalnız transient search overlay'dir.

Metin linkleri (`[[...]]`, block references vb.) ve UI backlink görünümleri
canonical document/relationship verilerinden türetilir; ayrı semantic authority
oluşturmaz.

## Block identity ve kaynak referansları

Editor blokları stabil `data-pisi-block-id` ve `data-pisi-block-type`
kimlikleri taşır. Paragraf, başlık, alıntı, kod, liste ve görev blokları
WYSIWYG görünüm ile Markdown kaynak görünümü arasında dönüştürülebilir.

Block referansları node yolu + block kimliğiyle çözümlenir. Örnek:

```text
relative/path.node#block-id
[[Node#^block-id]]
((block-id))
```

Web/source node'ları `pisi.systemRole = "source"` ile işaretlenebilir. URL,
erişim tarihi, yazar, yayın tarihi, DOI ve citation metadata'sı node property
değerleri olarak tutulur; property kimliği/türü yine project schema'ya tabidir.

## Version History

Version History recovery katmanıdır; canonical live authority değildir.

Current format:

```text
.pisi-history/
  <node-id>/
    index.json
    <epoch>-<iso-zaman>-<hash>.json.gz
```

Kurallar:

- yeni snapshot'lar gzip full-document snapshot'tır;
- delta chain kullanılmaz;
- node başına en fazla 50 version;
- retained history byte bütçesi 24 MiB;
- en yeni snapshot tek başına bütçeyi aşsa bile korunur;
- content-identical save yeni version üretmez;
- restore öncesi `before-restore` snapshot alınır;
- history başka node kimliğine restore edilemez;
- history canonical task/relationship/property store'un yerine kullanılmaz.

Atomic sibling `.pisi-backup` dosyası Version History'den ayrı recovery
mekanizmasıdır.

## Reversible Trash

Normal project delete işlemleri OS Recycle Bin yerine project-local reversible
Trash kullanır:

```text
.pisi/trash/items/trash_<id>/
  manifest.json
  payload/
```

Trash manifest; restore için gereken canonical task kayıtlarını, semantic
relationships'leri, dependency/reference bilgilerini ve map presentation
referanslarını arşivleyebilir.

Delete/restore domain operasyonları atomic mutation altında yürütülür.
Restore full-project rollback değildir; archived payload/state current projeye
conflict kontrolleriyle delta olarak geri birleştirilir.

Permanent delete ve Empty Trash ayrı explicit komutlardır.

## Atomic mutation ve crash recovery

Çok dosyalı semantic değişikliklerde `.pisi/mutations/` altında crash-recovery
journal kullanılır.

Temel sıra:

```text
domain command
  -> validation
  -> atomic mutation journal
  -> authority/document writes
  -> commit
  -> cleanup
```

Başarısız veya yarım mutation canlı state'e sessizce karıştırılmaz. Startup /
recovery gate journal durumunu ele alır.

Tek dosya document yazımlarında geçici dosya + `fsync` + atomic rename
kullanılır. Uygulamanın kendi write event'leri watcher tarafında ayrı
işaretlenir.

## Project Integrity

Project Integrity canonical sınırları denetler. Örnek kontroller:

- geçersiz/duplicate node ve map ID,
- eksik managed sidecar,
- canonical task store sorunları,
- canonical relationship endpoint/graph sorunları,
- property schema/value drift,
- bozuk map references/layout/relationshipViews,
- stale persisted `connectionTypes`,
- current contract dışı `map.edges`,
- eksik attachment/sidecar asset,
- Trash manifest/payload sorunları,
- unfinished/invalid atomic mutation journal'ları.

Integrity projection'dan authority reconstruct etmez. Belirsiz semantic durum
varsa bunu otomatik olarak "yeşile çevirmek" yerine review/manual issue olarak
raporlar.

## Canonical-only / migration politikası

PISI pre-release canonical-only mimaride çalışır. Aktif runtime'da eski veri
biçimlerini canonical authority'ye sessizce yükselten genel legacy migration
akışları tutulmaz.

Özellikle:

- `map.edges` semantic authority'ye otomatik migrate edilmez;
- persisted node `connectionTypes` semantic authority değildir;
- task index/mission scan canonical task store'a background import yapmaz;
- Sheet modeli DOM'dan reconstruct edilmez;
- missing property schema node'lardan otomatik türetilmez;
- Trash restore current contract dışı legacy map edge'lerini canlandırmaz.

Eski veya desteklenmeyen bir state görülürse doğru davranış; canonical store'u
projection'dan uydurmak değil, Project Integrity üzerinden durumu görünür
kılmak ve gerekiyorsa explicit repair/import kararı almaktır.

## Veri güvenliği özeti

- PISI kimlikleri türlerine uygun stabil pattern kullanır.
- Proje dışı path traversal ve symlink/junction escape reddedilir.
- Canonical semantic veri yalnız kendi authority store'u üzerinden değiştirilir.
- Projection taramaları authority üzerinde serbestçe write yapamaz.
- Rename/move/delete gibi çoklu değişiklikler atomic domain akışlarına tabidir.
- Bozuk/boş `.node` veya `.map` sessizce boş document ile ezilmez.
- Kapanış/proje değişimi öncesi bekleyen editor save işlemleri tamamlanır.
- Search/cache/history/trash/recovery katmanları canlı canonical authority gibi
  davranmaz.
