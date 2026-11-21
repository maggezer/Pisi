# Test fixture'ları

## `desktop-project/`

Gerçek masaüstü uygulamasının oluşturduğu küçük bir Pisi projesi.
`tests/mobile-desktop-compat.test.mjs` mobil veri katmanını bu projenin bir
kopyası üzerinde çalıştırır ve sonucu masaüstünün kendi koduyla denetler
(`docs/mobile-plan.md` M4, kural V10).

İçinde şunlar var:

- `Toplantı Notları.node`: iki paragraf, bir Sheet, bir Paint/canvas, bir görsel,
  bir dosya eki ve bir görev bloğu. Varlıklar notun `inv_…` klasöründe.
- `Proje Planı.node`: üç paragraf ve iki görev bloğu (not editörde açıkken
  eklendi: blokları editör ekleyip kaydetti).
- `Yol Haritası.map`: iki alt not ve aralarında bir `down-hub` ilişkisi.
- `diary/`: editörde yazılmış iki gün (12 ve 13 Kasım) ve görev servisinin
  oluşturduğu günler. Her günlüğün son bloğu görev bölümüdür (yalnız görev
  kimlikleri, `docs/task-plan.md` §3.2.2).
- `.pisi/tasks.json` sürüm 2 (altı görev, `task.create.v1` ile: üçü notta, üçü
  fixture'ın "bugün"ü sayılan 14 Kasım'ın ve 12 Kasım'ın günlüğünde; ikisi tekrar
  eden, biri ileri tarihli ve hatırlatmalı, biri tamamlanmış), `.pisi/relationships.json`
  ve `.pisi-history/`.

Betik görev servisinin saatini fixture'ın "bugün"üne (14 Kasım 2026, 09:30)
sabitler; tamamlama ve oluşturma zamanları betiğin çalıştığı günden bağımsızdır.

**Elle düzenlenmez.** Dosyaların baytları test verisidir; bu yüzden klasör
`.prettierignore` içindedir. Hiçbir HTML ya da JSON elle yazılmadı: hepsini
masaüstü uygulaması üretti.

### Yeniden üretme

Masaüstünün dosya biçimi değiştiğinde:

```bash
npm ci
xvfb-run -a node scripts/electron-mobile-fixture-e2e.mjs --write
npm test
```

Betik uygulamayı CDP ile sürer: notları editörde yazar, Sheet/Paint/görsel/dosya
bloklarını editörün kendi işlevleriyle ekler, görevleri görev servisinin
komutlarıyla (`task.create.v1`, `task.complete.v1`), haritayı ve ilişkiyi domain
komutlarıyla oluşturur. Kimlikler ve zaman damgaları
her çalıştırmada yenidir, bu yüzden `--write` bütün fixture'ı değiştirir.
`--write` olmadan betik yalnız üretip denetler; `npm run test:e2e` onu böyle
çalıştırır.

Masaüstünün Project Integrity denetimi bu proje için hiçbir bulgu vermez;
uyumluluk testi taban çizgisinin boş olduğunu da sınar.
