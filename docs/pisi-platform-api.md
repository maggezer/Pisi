# Pisi Platform API 1.0

Pisi’nin kısa vadeli eklenti yüzeyi bir marketplace veya proje klasöründen
çalışan keyfi JavaScript yükleyicisi değildir. Yalnız uygulamayla birlikte
paketlenen ve güvenilen modüller etkinleştirilir. API sürümü major uyumluluğu
denetler ve her kayıt geri alınabilir bir disposer döndürür.

## Eklenti kaydı

```js
await window.Pisi.extensions.registerPlugin({
  id: 'ornek.araclar',
  name: 'Örnek Araçlar',
  version: '1.0.0',
  apiVersion: '1.0.0'
}, async (pisi) => {
  pisi.register('toolbarTool', {
    id: 'ornek.odak',
    label: 'Odağı kopyala',
    icon: '↗',
    run: () => navigator.clipboard.writeText(pisi.getActiveNodePath() || '')
  });

  return () => {
    // Provider bağlantıları ve eklentiye ait diğer kaynaklar burada kapatılır.
  };
});
```

`window.Pisi.extensions.apiVersion` değeri `1.0.0`’dır. Desteklenen uzantı
noktaları:

| Nokta | Amaç | Temel işleyici |
|---|---|---|
| `nodeType` | Özel node davranışı ve görünümü | `run(context)` |
| `exporter` | Yeni dışa aktarma biçimi | `run({ nodePath })` |
| `taskView` | Özel görev görünümü | `render(container, context)` |
| `toolbarTool` | Editör toolbar aracı | `run({ toolbar })` |
| `mapLayout` | Yerleşim algoritması | `run({ nodes })` |
| `rightPanel` | Özel sağ panel sekmesi | `render(container, context)` |

Kayıtlar `window.Pisi.extensions.list(point)`, `get(point, id)` ve
`invoke(point, id, context)` ile keşfedilip çalıştırılabilir. Markdown ve PDF
dışa aktarıcıları ile ızgara map yerleşimi çekirdek örnekleri olarak kayıtlıdır.

## Komutlar ve kısayollar

Eklenti bağlamındaki `pisi.registerCommand(...)`, komutu merkezi komut
paletine ve kısayol ayarlarına ekler:

```js
pisi.registerCommand({
  id: 'ornek.bugun',
  label: 'Bugün görünümünü aç',
  category: 'Örnek',
  defaultShortcut: 'Mod+Alt+B',
  handler: () => window.openPisiCommandCenter('tasks')
});
```

`Mod`, Windows/Linux’ta Ctrl; macOS’ta Command tuşudur. Kullanıcı atamaları
`pisi.shortcuts.v1` altında yerel olarak tutulur. Çakışma halinde önce mevcut
atamanın değiştirilmesi istenir.

## Team API

`window.Pisi.team` aşağıdaki kararlı yüzeyi sunar:

- `getConfig()` / `saveConfig(config, { expectedRevision })`
- `listEvents({ limit })` / `appendEvent(event)`
- `subscribe(listener)`
- `registerProvider(provider)` / `setProvider(id)` / `listProviders()`

Yerel provider `.pisi-team.json` içinde üyeleri ve revision değerini,
`.pisi-team-events.json` içinde son 1000 olayı tutar. Olay payload’ı 32 KB ile
sınırlıdır. Aynı revision üzerinden iki yazma yapılırsa ikinci işlem `conflict`
döndürür.

Gerçek zamanlı bir provider şu dört metodu sağlamalıdır:

```js
const dispose = window.Pisi.team.registerProvider({
  id: 'firma.sync',
  label: 'Firma Sync',
  capabilities: { realtimeSync: true, presenceTransport: true },
  getConfig: async (projectFolder) => ({ ok: true, config: {} }),
  saveConfig: async (projectFolder, config, options) => ({ ok: true, config }),
  listEvents: async (projectFolder, options) => ({ ok: true, events: [] }),
  appendEvent: async (projectFolder, event) => ({ ok: true, event })
});
```

Çekirdek sürüm ağ taşıması veya presence sunmaz; bunlar provider sorumluluğudur.
Bu ayrım yerel dosya modelini ve geri yükleme geçmişini tek doğruluk kaynağı
olarak korur.
