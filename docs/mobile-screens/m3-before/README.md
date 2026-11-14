# M3 "önce" görüntüleri

`mobile5` dalının (Pisi Mobile 3.2.0, commit `e49f6fc`) Pixel 7 görünümünde, açık ve koyu temada, boş örnek veriyle alınmış ekran görüntüleridir (`docs/mobile-plan.md` M3, 1. adım). Görsel iyileştirme listesindeki (§5) maddelerin karşılaştırma noktasıdır.

Alınışı: `git worktree add ../Pisi-mobile5 origin/mobile5`, `npm ci`, `npx vite`, ardından Playwright ile alt menüdeki altı sekme sırayla açıldı. Saat 14-11-2026 09:30 (Europe/Istanbul) olarak sabitlendi. Dosyalar özgün boyutun üçte ikisine küçültüldü.

| Sekme     | Açık                    | Koyu                   |
| --------- | ----------------------- | ---------------------- |
| Notlar    | `light-01-notes.png`    | `dark-01-notes.png`    |
| Haritalar | `light-02-maps.png`     | `dark-02-maps.png`     |
| Görevler  | `light-03-tasks.png`    | `dark-03-tasks.png`    |
| Takvim    | `light-04-calendar.png` | `dark-04-calendar.png` |
| Pisi      | `light-05-pisi.png`     | `dark-05-pisi.png`     |
| Ayarlar   | `light-06-settings.png` | `dark-06-settings.png` |

"Sonra" görüntüleri depoda tutulmaz: **Mobile** iş akışının `pisi-mobile-screens` artifact'ındadır (`20-gallery.png` bileşen galerisidir).
