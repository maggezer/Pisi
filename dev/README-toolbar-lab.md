# Pisi Text Toolbar Lab

Bu klasör, Pisi'nin metin araç çubuğunu Pinegrow içinde tek seferlik görsel olarak düzenlemek içindir.

## Açma

1. Pisi deposunu Pinegrow'da mevcut proje olarak aç.
2. `dev/toolbar-lab.html` dosyasını aç.
3. Pinegrow'un **Tree / DOM** panelinde `data-toolbar-export-root` öğesini bul.
4. Metin araçları `data-toolbar-group` alanları altında dört gruba ayrılmıştır:
   - `typography`
   - `emphasis`
   - `lists`
   - `alignment`

Grupları topluca veya `data-lab-control-id` taşıyan kontrolleri tek tek sürükleyebilirsin.

## Stil düzenleme

Deneme CSS kurallarını yalnızca `dev/toolbar-lab.css` dosyasının sonundaki **USER DESIGN AREA** bölümüne yaz.

Şimdilik şu üretim dosyalarını değiştirme:

- `renderer/editor/pisi-editor-paint.mjs`
- `styles/60-customization.css`
- `index.html`

Tasarım tamamlandığında laboratuvardaki sıra, HTML ve CSS gerçek toolbar üreticisine aktarılacaktır.

## Önizleme

Sayfanın üstündeki Geniş, Normal ve Dar seçenekleri toolbarı farklı kullanılabilir alanlarda gösterir. Bu seçim JavaScript kullanmaz ve Pinegrow Design görünümünde çalışır.

## Kaydetme

Pinegrow içinde HTML ve CSS dosyalarını kaydet. Ardından Git değişikliklerini commit etme zorunluluğu yoktur; değişen `dev/toolbar-lab.html` ve `dev/toolbar-lab.css` dosyaları incelenerek gerçek uygulamaya aktarılabilir.

## Paketleme

`dev/` klasörü `package.json` içindeki Electron build dosya listesinde bulunmadığı için laboratuvar kurulu Pisi uygulamasına paketlenmez.
