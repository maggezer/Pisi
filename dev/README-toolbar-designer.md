# Pisi Text Toolbar Designer

Bu araç Pinegrow kullanmadan metin toolbarını görsel olarak sıralamak içindir.

## Açma

1. Depoyu güncelle.
2. Windows Gezgini veya tarayıcıdan `dev/toolbar-designer.html` dosyasını aç.
3. Her araç kartındaki turuncu `⠿` tutamacını sürükleyerek sırayı değiştir.
4. Sürükleme zor gelirse kartın altındaki sol ve sağ okları kullan.
5. Üstteki sürgülerle toolbar yüksekliği, kontrol yüksekliği, araç aralığı ve select genişliğini ayarla.
6. `Düzeni kopyala` düğmesine basıp oluşan JSON metnini sohbete yapıştır.

Düzen `localStorage` içinde otomatik saklanır. `Varsayılana dön` düğmesi hem sırayı hem ölçüleri ilk haline getirir.

Bu geliştirme aracı `dev/` klasöründedir ve Electron build dosya listesine dahil değildir; kurulu Pisi uygulamasına paketlenmez.
