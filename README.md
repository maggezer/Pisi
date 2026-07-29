# KEDI Refactor 02 - app.js parçalama

Bu patch, çalışan `app.js` dosyasını davranışı değiştirmeden parçalara böler.
Bu aşamada ES module/import-export kullanılmadı. Bunun sebebi, mevcut kodun çok sayıda global state ve karşılıklı fonksiyon bağımlılığı kullanmasıdır. İlk aşamada amaç çalışan sürümü bozmadan dosyaları domain bazında ayırmaktır.

## Dosya yapısı

```text
app.js                              # Bootstrap: DOMContentLoaded, pencere kontrolleri, proje başlangıcı
renderer/kedi-tree.js               # Sol ağaç, proje yenileme, map-node tree senkronizasyonu
renderer/kedi-map-workspace.js      # Map açma, node box, drag/resize, modal açma/kaydetme
renderer/kedi-tags.js               # Editor block sistemi, tag paneli, tag menüsü, tag yardımcıları
renderer/kedi-node-modal.js         # Modal kapatma, overlay, Escape davranışı
renderer/kedi-map-connections.js    # Edge tipi, portlar, path çizimi, pan/zoom, selection, connection delete
```

## index.html değişikliği

Mevcut:

```html
<script src="app.js"></script>
```

Bununla değiştir:

```html
<script src="app.js"></script>
<script src="renderer/kedi-tree.js"></script>
<script src="renderer/kedi-map-workspace.js"></script>
<script src="renderer/kedi-tags.js"></script>
<script src="renderer/kedi-node-modal.js"></script>
<script src="renderer/kedi-map-connections.js"></script>
```

## Test sırası

1. Uygulama açılıyor mu?
2. Son proje klasörü açılıyor mu?
3. Yeni `.map` oluşturuluyor mu?
4. `.map` açılınca node boxlar geliyor mu?
5. Node oluşturma, silme, rename çalışıyor mu?
6. Node box sürükleme/resize çalışıyor mu?
7. Modal açma, yazma, kapatınca kaydetme çalışıyor mu?
8. Tag menüsü ve tag paneli çalışıyor mu?
9. Connection oluşturma/silme çalışıyor mu?
10. Zoom/pan/multi-selection çalışıyor mu?

## Sonraki refactor aşaması

Bu patch sadece fiziksel parçalama yapar. Bir sonraki aşamada `state` nesnesi çıkarılmalı:

```js
window.Kedi = {
  state: {},
  api: window.kediProject,
  ui: {},
  tree: {},
  map: {},
  tags: {},
  connections: {}
};
```

Böylece global `let activeMapPath`, `let activeMapNodes`, `let activeMapEdges` gibi alanlar kontrollü hale gelir.
