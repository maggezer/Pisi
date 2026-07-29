KEDI adında bir not alma uygulaması geliştiriyorum.

Ana amaç not almak, bu notları düzenlemek ve bağlamlandırmak, bağlamlardan hedef oluşturmak ve bu hedeflere giden planlı bir akış içinde görev listeleri oluşturmak.

Yazılım şu an için 6 ekran öğesinden ve 2 temel yapıdan oluşuyor.

1-Üst logo çubuğu.

Burada logoya tıklayınca açılan menüden tercih ve ayarlar yapılıyor.

2-Sol alan

Burası kullanılan / oluşturulan dosyaların bulunduğu yer. İki temel dosya türü var. Canva yani zihin haritaları ve nodelar yani notlar. Düğümler sadece canva içinde oluşturulabilir.

3-orta üst araç çubuğu

Burası kullanılacak özelliklerin barındırıldığı yer

4-orta alan

burası dosyaların görüntülendiği yer.

canva üzerine eklenen not sol alanda ortaya çıkmalı ve sol alanda yapılan değişiklik.

5-sağ alan

burası ileride bağlam için kullanılacak

6-takvim

sağ veya sol alanın altında yada float özelliği olan bir takvim. 


Canva tipi dosyaların 3 temel özelliği var.

1-Infocard

burada dosyayla ilgili temel notlar tutuluyor.

2-Tag searcher

dosya içerisindeki nodeların taglarına göre aratılıp sıralanabilmesi ve erişilmesi sağlanıyor.

Node tipi dosyalar ise notların tutulduğu bir dosya.

Node dosyası iki temel özelliğe sahip.

3-bağlamlar

canva içerisinde nodelar birbirine bağlanabilir. Bu alt-üst ilişkisi, karşılıklı bağlamlık veya süreç ilişkisi şeklinde olabilir. alt-üst ilişkisinde sol alanda node birbirinin altında gözükürken, karşılıklı bağlamlıkta seviyeleri denktir. süreç ilişkisinde ise alt node sol alanda gözükmez. Çünkü bir sonraki zaman adımıdır.

1-.md dosyası, bu .md dosyasında yazılan kaydedilen veriler saklanıyor.

2.res klasörü, her md dosyasının ilgili dosya_adi_res adında bir klasörü var. bu klasörde gerekli resim, tablo vs saklanıyor.

.md dosyasında ileride geliştirilecek dil sayesinde res klasöründeki kaynaklar uygulamada gösterilebilecek.

Takvim

İlgili güne tıklandığında daily canvası altında o gününün notunu oluşturuyor. Bu not bir taşıyıcı not. Yani bu nota yazılanlar etiketlendirilerek başka canvalardaki notlara gönderilebiliyor Aynı zamanda başka canvada o gün yapılanlar o tarihli diary notuna ekleniyor. ama bu not hard code eklemek yerine ilgili gün etiketlerini okuyarak yapıyor.