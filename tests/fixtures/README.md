# Test fixture'ları

## `desktop-project/`

Gerçek masaüstü uygulamasının oluşturduğu küçük bir Pisi projesi.
`tests/mobile-desktop-compat.test.mjs` mobil veri katmanını bu projenin bir
kopyası üzerinde çalıştırır ve sonucu masaüstünün kendi koduyla denetler
(`docs/mobile-plan.md` M4, kural V10).

İçinde şunlar var:

- `Toplantı Notları.node`: iki paragraf, bir Sheet, bir Paint/canvas, bir görsel
  ve bir dosya eki. Varlıklar notun `inv_…` klasöründe.
- `Proje Planı.node`: üç paragraf.
- `Inbox.node`: Quick Add'in yazdığı dört görev bloğu.
- `Yol Haritası.map`: iki alt not ve aralarında bir `down-hub` ilişkisi.
- `diary/`: editörde yazılmış iki gün ve masaüstünün görev bölümü eklediği iki gün.
- `.pisi/tasks.json` (altı görev; ikisi tekrar eden, biri tamamlanmış),
  `.pisi/relationships.json` ve `.pisi-history/`.

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
bloklarını editörün kendi işlevleriyle ekler, görevleri Quick Add komutuyla,
haritayı ve ilişkiyi domain komutlarıyla oluşturur. Kimlikler ve zaman damgaları
her çalıştırmada yenidir, bu yüzden `--write` bütün fixture'ı değiştirir.
`--write` olmadan betik yalnız üretip denetler; `npm run test:e2e` onu böyle
çalıştırır.

Masaüstünün bu proje için verdiği tek bütünlük bulgusu
(`property-schema-authority-missing`) uyumluluk testinde taban çizgisi olarak
kayıtlıdır; ayrıntı `pisi-error.md` §5c'de.
