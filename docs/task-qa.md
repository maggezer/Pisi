# Pisi Görevler — cihazda kabul listesi

Bu belge yeni görev sisteminin gerçek masaüstü, gerçek telefon ve kullanıcının kendi senkron sunucusuyla elle uygulanan kabul listesidir
(`docs/task-plan.md` G10). Bütün maddeler işaretlenince ve bulunan hatalar `pisi-error.md`'ye yazılınca G10, dolayısıyla görev sisteminin
yeniden kurulması (G0–G10) kabul edilmiş olur.

Otomatik testler (`tests/shared-task-*.test.mjs`, `scripts/electron-tasks-*-e2e.mjs`, `tests/mobile-desktop-compat.test.mjs`, mobil Playwright,
senkron matrisi 18–22) her PR'da zaten geçiyor. Bu liste onların göremediğini denetler: gerçek pencere, klavye ve pano, sistem bildirimi,
günün değişmesi (dün, bugün, yarın), gerçek Android telefon ve gerçek internet bağlantısı.

## 0. Okumadan önce

### 0.1 Birkaç terim

| Terim           | Anlamı                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Görev kaydı     | Görevin bütün bilgisi (başlık, durum, tarih, öncelik, tekrar, hatırlatma, etiketler, yeri). Hepsi projedeki tek bir dosyada durur: `.pisi/tasks.json`.    |
| Görev bloğu     | Normal bir nottaki görev satırı. Notta yalnız görevin kimliği yazılıdır; başlık ve onay kutusu kayıttan çizilir.                                          |
| Görevin yeri    | Görevin durduğu not ya da günün günlüğü. Her görevin bir yeri vardır; Inbox (gelen kutusu) yoktur.                                                        |
| Görev bölümü    | Günlüğün en altındaki "Görevler" bölümü: o güne ait görevler. Bölümün içine yazılamaz; satırlar görev kayıtlarından çizilir.                              |
| Günün görevleri | Yeri o günün günlüğü olan, bitiş günü o gün olan ve o gün tamamlanan görevler. Günlük, takvim ve telefon aynı listeyi gösterir.                           |
| Gecikenler      | Bitiş günü geçmiş, açık görevler. Yalnız bugünün günlüğünde (masaüstünde "Gecikenler", telefonda "Gecikmiş") görev bölümünün üstünde görünür.             |
| Tekrar          | Tekrar eden görev tamamlanınca yeni görev açılmaz; aynı görev sonraki güne ilerler ve tamamlandığı gün görev ayrıntısındaki "Tamamlanan günler"e yazılır. |
| Proje bütünlüğü | Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**. Görev, not ve günlük arasındaki tutarsızlıkları bulur; görev bulgularında **Onar** düğmesi vardır.   |

Masaüstündeki kısayollar Windows ve Linux için yazılmıştır; macOS'ta **Ctrl** yerine **Cmd** kullanın.

### 0.2 Neyi paylaşmayın

Sonuçları yazarken **sunucu adresinizi, kurulum anahtarını, eşleştirme kodunu ve QR kodunun fotoğrafını** paylaşmayın (`docs/sync-qa.md` §0.2).
Görev başlıkları, not adları, cihaz modeli ve saat paylaşılabilir; özel bir görev başlığı ekran görüntüsünde görünüyorsa üstünü karalayın.

### 0.3 Liste üç güne yayılır

Tekrar, gecikme ve geçmiş günlük maddeleri günün değişmesini ister. Bilgisayarın ya da telefonun saatini **değiştirmeyin** (senkron ve
hatırlatmalar gerçek saatle çalışır). Bunun yerine liste üç bölüm hâlinde uygulanır:

- **1. gün:** §1–§12 ve §13'teki "1. gün" maddeleri.
- **2. gün:** §13'teki "2. gün" maddeleri (yalnız birkaç dakika).
- **3. gün:** §13'teki "3. gün" maddeleri ve §14 kapanış denetimi.

Günler art arda olmak zorunda değildir; önemli olan maddedeki "dün", "bugün", "yarın"ın doğru güne düşmesidir.

### 0.4 Bir madde geçmezse

Maddenin kutusunu boş bırakın, altına girintili bir satır ekleyin ve ne olduğunu yazın:

```text
- [ ] Görev bloğu nota hemen girer.
    - Sorun: blok bir saniye görünüp kayboldu. Not kapatılıp açılınca yok. (Windows 11, 14:32)
```

Sonra listeye devam edin; bir sorun öteki maddeleri genelde engellemez. Çıkan sorunlar bir sonraki oturumda `pisi-error.md`'ye yazılır ya da düzeltilir.

## 1. Hazırlık

### 1.1 Masaüstü uygulaması

Masaüstü uygulaması depodan çalıştırılır: `docs/sync-qa.md` §1.2'deki dört komut (`git checkout main`, `git pull`, `npm ci`, `npm start`).
Hangi sürümle denediğinizi `git log -1 --format=%h` ile not edin.

### 1.2 Telefon uygulaması

`main` dalının son **Mobile** çalıştırmasındaki `Pisi-mobile-apk` kurulur (`docs/mobile-qa.md` §2, `docs/sync-qa.md` §1.3). APK G9'dan
(22-11-2026) yeni olmalıdır: Ayarlar → Hakkında → Uygulama sürümü satırındaki sürüm kodunu not edin.

### 1.3 Senkron

§12 için telefon ve masaüstü aynı sunucu alanına eşleşmiş olmalıdır (`docs/sync-qa.md` §3–§4). Sunucu G9 sonrasında değişmedi; protokol aynıdır.
`docs/sync-qa.md` tamamlanmadıysa önce onun §1–§5'ini uygulayın. §2–§11 sırasında iki cihaz eşleşmiş kalabilir; telefonun gösterdiği
değişiklikler o bölümlerde ayrıca denetlenmez.

### 1.4 Deneme projesi

Görev silinecek, not çöp kutusuna gidecek ve bilerek çakışma oluşturulacak. Bu yüzden **gerçek projenizin bir kopyasıyla** çalışın
(`docs/sync-qa.md` §1.4'teki gibi; ör. `Pisi Görev Kabul`). Kopyada şunlar olsun:

- iki normal not: **Not A** ve **Not B** (adları istediğiniz gibi olabilir; aşağıda böyle anılır),
- bugünün günlüğü,
- içinde Not A'nın bulunduğu bir harita.

Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**. Sonucu not edin (ör. "Hiç sorun bulunmadı." ya da bulgu sayısı). Her bölümün sonunda ve
§14'te aynı denetim bununla karşılaştırılır.

### 1.5 Sonuç satırı

Cihaz: · Android sürümü: · APK sürüm kodu: · Masaüstü işletim sistemi: · Masaüstü commit: · Tarihler (1. / 2. / 3. gün):

**Sonuç:** henüz uygulanmadı.

## 2. Masaüstünde görev oluşturma

Not A'yı açın. Her yolla oluşan görev hemen sağdaki **Görevler** sekmesinde de görünmelidir.

- [ ] **Slash komutu:** boş bir satıra `/todo` yazın ve menüden **Görev**'i seçin: satır onay kutulu bir görev olur, imleç başlık alanındadır. "Slash görevi" yazın.
- [ ] **Kısayol:** boş bir satıra `[ ]` (ya da `[]`) yazıp boşluğa basın: satır görev olur ve paragrafa geri dönmez. "Kısayol görevi" yazın.
- [ ] **Blok türü:** bir paragrafa "Blok türü görevi" yazın, blok türü menüsünden **Görev bloğu**'nu seçin: paragraf görev olur, metni görevin başlığıdır.
- [ ] **Araç çubuğu:** bir paragrafa "Araç çubuğu görevi" yazın, imleç oradayken araç çubuğundaki **☐** (Görev) düğmesine basın: paragraf görev olur.
- [ ] **Enter:** "Araç çubuğu görevi"nin sonunda Enter: altına yeni, boş bir görev açılır. Boş görevde yeniden Enter: görev kalkar, satır paragraf olur (madde listesindeki gibi).
- [ ] Başlığı hızlıca yazıp hemen başka bir nota geçin, sonra Not A'ya dönün: yazdığınız başlığın tamamı durur; paneldeki kartta da aynıdır.
- [ ] Pisi'yi kapatıp yeniden açın, Not A'yı açın: dört görev (Slash, Kısayol, Blok türü, Araç çubuğu) aynı sırayla ve aynı başlıklarla durur.
- [ ] (İsteğe bağlı) Not A'nın `.node` dosyasını bir metin düzenleyiciyle (Not Defteri, TextEdit) açın: görev başlıkları dosyada **geçmez**, yalnız `data-pisi-task-id="task_…"` taşıyan boş bloklar vardır. Dosyayı kaydetmeden kapatın.
- [ ] Bir görevin başlığına tıklayıp değiştirin ve Not A'yı kaydedin (Ctrl+S): "Kaydedilmemiş değişiklik" işareti kalmaz; panelde yeni başlık görünür.

**Günlükte:** bugünün günlüğünü açın (takvimde bugüne tıklayın).

- [ ] Günlüğün altında "Görevler" bölümü ve onun son satırı olarak "Görev ekle" görünür. Bölümün başlığına ya da satırlarının arasına metin yazılamaz.
- [ ] Günlüğün metin kısmında boş bir satıra `[ ]` + boşluk, sonra "Günlük görevi": görev yazdığınız yerde kalmaz, alttaki "Görevler" bölümüne girer; imleç yeni satırın başlığındadır; görevin tarih çipi bugünü gösterir.
- [ ] "Görev ekle" satırına "Günlük görevi 2" yazıp Enter: görev bölüme girer, alta yeni bir boş satır açılır.
- [ ] Ayarlar penceresinin **Tercihler** sayfasında **Dil**'i ENG yapın: bölümün başlığı "Tasks" olur; dili TR'ye geri alın. (Başlık dosyaya yazılmaz; yalnız ekranda çevrilir.)

Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**: §1.4'e göre yeni bulgu yoktur.

## 3. Quick Add (Ctrl+M)

- [ ] Not A açık ve en son onda çalışmışken Ctrl+M: "Görev ekle" penceresi açılır; **Hedef** alanında "Açık not: <Not A>" seçilidir.
- [ ] "Görev" alanına "QA hedef testi" yazın, **Türkçe tarih** alanını boş bırakın: önizlemede "Tarih yok: görev tarihsiz eklenir." yazar. **Görevi ekle**: görev Not A'nın sonunda **hemen** görünür (not kapatılıp açılmadan).
- [ ] Not A'ya bir harf yazıp kaydedin, notu kapatıp açın: "QA hedef testi" bloğu hâlâ notta durur ve görev panelde tarihsiz görünür.
- [ ] Not A ve Not B açıkken önce Not B'ye, sonra Not A'ya tıklayıp Ctrl+M: hedef "Açık not: <Not A>"dır. Not B'ye tıklayıp yeniden Ctrl+M: hedef Not B olur.
- [ ] Bütün not sekmelerini kapatın ve Ctrl+M: hedef "Bugünün günlüğü"dür. "QA günlük hedefi" ekleyin: bugünün günlüğünün görev bölümünde görünür. Gezgin'de "Inbox" ya da benzeri yeni bir not **oluşmaz**.
- [ ] Ctrl+M, **Hedef** listesinden Not B'yi seçin, "QA başka not" ekleyin: görev Not B'nin sonuna girer.
- [ ] "Türkçe tarih" alanına `yarın 14:00` yazın: önizlemede "Gün: <yarının tarihi> 14:00" görünür. Ekleyin: görevin tarih çipi yarını ve 14:00'ı gösterir; yarının günlüğü yoksa oluşur ve görev oradaki bölümde de görünür.
- [ ] "Türkçe tarih" alanına `her pazartesi` yazın: önizlemede "Tekrar: Her hafta" görünür ve **Tekrar** alanı kendiliğinden dolar. Ekleyin: görev ilk pazartesiye tarihlidir.
- [ ] Başlığı boş bırakıp **Görevi ekle**: "Görev metni boş olamaz." yazar, görev oluşmaz. **Vazgeç** ya da Esc: pencere kapanır, odak önceki yerine döner.

Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**: yeni bulgu yoktur.

## 4. Görev paneli ve ayrıntı penceresi

- [ ] Sağdaki **Görevler** sekmesinin varsayılan sıralaması "Öncelikli"dir: geciken görevler önce, sonra kalan güne ve önceliğe göre.
- [ ] Tarih süzgecinde **Bugün**: yalnız bugüne tarihli görevler kalır. **Tarihsiz**: "QA hedef testi" görünür. Süzgeci **Tümü**'ne alın.
- [ ] Bir kartın durumunu "Devam ediyor" yapın: kart hemen güncellenir. Notu açıp kapatın: durum aynı kalır.
- [ ] Kartın başlığına tıklayın: "Görev ayrıntısı" penceresi açılır. Önceliği değiştirip **Kaydet**: karttaki öncelik değişir, nottaki görev bloğunun çipi de değişir.
- [ ] Ayrıntıda **Etiketler** alanına `qa` ekleyin ve kaydedin: nottaki görevde `#qa` çipi görünür; Etiketler panelinde `qa` altında bu görev listelenir.
- [ ] Bir görevin başlığına `[[` yazın: not bağlantı menüsü açılır. Not B'yi seçin. Başlıktaki bağlantıya Ctrl+tıklayın: Not B açılır. Not B'nin Bağlantılar panelinde bu görev geri bağlantı olarak sayılır.
- [ ] Ayrıntıda **Yer** alanından Not B'yi seçip kaydedin: görev bloğu Not A'dan kalkar, Not B'nin sonuna girer; görevin başlığı, etiketi ve durumu aynıdır.
- [ ] Kartta **Aç**: görevin notu açılır ve imleç görev bloğuna gelir.
- [ ] **Çalışma alanı** düğmesi ortada görev sekmesini açar. **Kanban**, **Takvim**, **Zaman çizelgesi** ve **İlerleme** görünümleri açılır ve aynı görevleri gösterir. Kanban'da bir kartı başka sütuna sürükleyin: durumu değişir.
- [ ] Sıralamayı "Elle sıra" yapın, bir kartı sürükleyip başka yere bırakın (ya da Alt+↑/↓): sıra korunur; Pisi'yi kapatıp açınca da korunur.

## 5. Tamamlama

- [ ] Not A'da bir görevin onay kutusunu işaretleyin: görev ☑ olur, panelde tamamlanır (panelde "Tamamlananları göster" açık değilse kart kalkar).
- [ ] Not A'yı **kapatın**. Panelden Not A'daki başka bir görevi tamamlayın. Not A'yı açın: görev ☑ görünür. Notta "Kaydedilmemiş değişiklik" işareti yoktur.
- [ ] (İsteğe bağlı) Bir önceki maddeden önce Not A'nın `.node` dosyasının dosya yöneticisindeki "Değiştirilme tarihi"ni not edin: panelden tamamlama sonrasında da aynıdır (görev alanı değişikliği notu yazmaz).
- [ ] Panelde "Tamamlananları göster" ile tamamlanan görevi bulun ve onay kutusunu kaldırın: görev açılır; nottaki blok da ☐ olur.
- [ ] Bugünün günlüğündeki "Günlük görevi"ni bölümdeki onay kutusuyla tamamlayın: satır tamamlanma saatiyle ☑ görünür ve bölümde kalır.
- [ ] Bugünün günlüğünde, yeri Not A olan ama bugüne tarihli bir görev (gerekirse ayrıntıdan tarihini bugün yapın) bölümde görünür. Satırın menüsünde (⋯) **Notu aç** Not A'yı açar.

## 6. Tekrar eden görev (1. gün)

Bugünün günlüğünde "QA Spor" adlı bir görev yazın; ayrıntıdan **Tekrar**: "Her gün", tarih: bugün.

- [ ] "QA Spor"u günlükte tamamlayın: bugünün satırı tamamlanma saatiyle ☑ kalır. Yarının günlüğü yoksa oluşur; "QA Spor" orada ☐ görünür. Panelde görev yarına tarihlidir ve **tek** kayıttır (ikinci bir "QA Spor" oluşmaz).
- [ ] Ayrıntıdaki "Tamamlanan günler" listesinde bugünün tarihi vardır.
- [ ] Takvimde yarın "Tamamlanmamış görev var" belirteci taşır.
- [ ] Bugünün günlüğünde "QA Spor"un ☑'sini kaldırın (en son tamamlama olduğu için geri alınabilir): görev yeniden bugüne tarihlidir ve ☐'dir; yarının günlüğündeki satır kalkar; "Tamamlanan günler" boşalır ("Henüz tamamlanan gün yok."). Yarının günlük dosyası silinmez.
- [ ] "QA Spor"u yeniden tamamlayın (2. gün için ileri gitmiş olsun).

**Geciken tekrar:** Not A'da "QA Geciken" adlı bir görev yazın (günlükte değil: günlükte yazılan görev o günün bölümünde durur, gecikenlerde görünmez); ayrıntıdan **Tekrar**: "Her gün", tarih: **üç gün önce**.

- [ ] Bugünün günlüğünde görev bölümünün üstünde "Gecikenler" grubu görünür ve "QA Geciken" oradadır. (Bu grup dosyaya yazılmaz.)
- [ ] "QA Geciken"i gecikenler grubunda tamamlayın: gecikenlerden çıkar, bugünün bölümünde ☑ görünür ve yarına ilerler; geçmiş günler (üç gün önce, iki gün önce, dün) atlanır. Üç gün önceki günlüğü açın: "QA Geciken" orada artık yoktur (o gün yapılmadı). Ayrıntıdaki "Tamamlanan günler"de yalnız bugün vardır.

Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**: yeni bulgu yoktur.

## 7. Silme ve geri alma

- [ ] Not A'da bir görev bloğunu seçip Backspace ile silin ve kaydedin: görev panelden ve bütün günlüklerden kalkar. Ayarlar penceresinin **Çöp Kutusu** sayfasında görev bir öğe olarak görünür.
- [ ] Not A'da Ctrl+Z: blok geri gelir, görev panelde aynı başlık ve durumla yeniden görünür; Çöp Kutusu'ndaki öğe kalkar.
- [ ] Panelde bir kartın ayrıntısını açıp **Görevi sil**: "Görev çöp kutusuna taşınsın mı?" sorulur. Onaylayınca blok nottan da kalkar (not kapalıysa da). Çöp Kutusu'nda **Geri Yükle**: görev ve notundaki bloğu geri gelir.
- [ ] Bugünün günlüğünde "Günlük görevi 2"nin menüsünden (⋯) **Görevi sil**: görev bölümden ve panelden kalkar, Çöp Kutusu'na gider.
- [ ] Bugünün günlüğünde, yeri Not A olan bugüne tarihli görevin satırında başlığın başında Backspace (ya da satırı seçip Delete): satır **silinmez**. Menüde **Görevi sil** yoktur; **Bu günden kaldır** vardır. **Bu günden kaldır**: satır günlükten kalkar, görev Not A'da tarihsiz olarak kalır.
- [ ] Görev bloklu Not B'yi Gezgin'den Çöp Kutusu'na taşıyın: Not B'deki görevler panelden kalkar. Çöp Kutusu'nda Not B'yi **Geri Yükle**: not ve görevleri birlikte döner; başlıklar ve durumlar aynıdır.

Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**: yeni bulgu yoktur.

## 8. Kes, kopyala, yapıştır

- [ ] Not A'daki tamamlanmış ya da etiketli bir görevi seçip Ctrl+X, Not B'de bir satıra Ctrl+V; iki notu da kaydedin: görev Not B'de durur, başlığı, durumu ve etiketi aynıdır; panelde **tek** kart vardır ve **Aç** Not B'yi açar.
- [ ] Not B'deki bir görevi Ctrl+C ile kopyalayıp Not A'ya Ctrl+V: Not A'da **yeni** bir görev oluşur (panelde iki ayrı kart); birini tamamlamak öbürünü değiştirmez.
- [ ] Not A'daki bir görevi Not A'nın içinde başka bir yere kesip yapıştırın: panelde görev aynı kalır, iki kart oluşmaz.
- [ ] Görev bloklu bir paragraf grubunu kopyalayıp bir metin düzenleyiciye yapıştırın: görevin başlığı metin olarak gelir (kimlik ya da HTML parçası gelmez).
- [ ] Haritada görevli Not A'yı seçip Ctrl+C, sonra **Kopya not olarak yapıştır** (Ctrl+Alt+V): yeni notta aynı başlıklı görevler vardır ama **yeni** görevlerdir (panelde ayrı kartlar); kopyadaki bir görevi tamamlamak Not A'dakini değiştirmez.

Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**: yeni bulgu yoktur.

## 9. Günlük ve takvim

- [ ] Not A'da bir görevin tarihini (çipinden) **gelecek ay**ın bir gününe ayarlayın: o günün günlüğü yoksa oluşur. Takvimde gelecek aya geçin: o gün "Tamamlanmamış görev var" belirteci taşır.
- [ ] Takvimde o güne tıklayın: günün günlüğü açılır ve görev bölümünde görev görünür. Satırın menüsünden **Tarihi değiştir** ile bir gün sonrasını seçin: satır bu günlükten kalkar, takvimde belirteç bir gün kayar.
- [ ] O görevi tamamlayın: takvimde o gün "Tüm görevler tamamlandı" olarak işaretlenir.
- [ ] Takvimdeki belirteçler bir görevin tarihi değişince takvim yeniden açılmadan güncellenir.
- [ ] Bir görevin başlığını ya da önceliğini değiştirmek hiçbir günlüğü "kaydedilmemiş" yapmaz ve takvimde değişiklik oluşturmaz.

## 10. Arama, etiket ve harita

- [ ] Ctrl+P ile genel aramada bir görevin başlığından bir kelime yazın: görev sonuçlarda görünür. Seçince notu açılır ve görev bloğuna gidilir.
- [ ] Yeri bir günlük olan bir görevi (ör. "QA günlük hedefi") arayın: bulunur; seçince o günün günlüğü açılır.
- [ ] Aramaya `qa` etiketini yazın: etiketli görev etiketle de bulunur.
- [ ] Not A'da Ctrl+H (macOS'ta Cmd+Alt+F; Notta bul ve değiştir) ile bir görev başlığındaki kelimeyi değiştirin: başlık değişir, panelde de değişir; Ctrl+Z tek adımda geri alır.
- [ ] Haritada Not A'nın kartı açık görev sayısını gösterir (ör. "3 açık görev"); Not A'da bir görevi tamamlayınca sayı harita yeniden açılmadan azalır. Tarihi geçmiş bir görev varsa "gecikmiş" sayısı da görünür.

## 11. Hatırlatma (masaüstü)

Telefonda hatırlatma bildirimi henüz yoktur ("Hatırlatma değerleri saklanır; mobilde bildirim henüz yok."); bu bölüm yalnız masaüstündedir.

- [ ] Not A'daki bir görevin ayrıntısında **Hatırlatma**: "Belirli bir an", zaman: **iki dakika sonrası**; kaydedin. Zamanı gelince işletim sisteminin bildirimi görev başlığıyla çıkar.
- [ ] Bildirime tıklayın: Pisi öne gelir, görevin notu açılır.
- [ ] Pisi penceresinde açılan **Hatırlatmalar** listesinde görev **Aç**, **10 dk ertele**, **Tamamlandı** ve **×** düğmeleriyle görünür. **Tamamlandı**: görev nottaki blokta ve panelde tamamlanır; not düzenlenip kaydedilince yeniden açılmaz.
- [ ] Başka bir görev için iki dakika sonraya hatırlatma kurun ve **10 dk ertele**: on dakika sonra yeniden bildirim gelir.
- [ ] Yeri bir günlük olan bir görev için hatırlatma kurun: bildirime tıklayınca o günün günlüğü açılır.
- [ ] Bir görev için bir dakika sonraya hatırlatma kurun ve Pisi'yi tamamen kapatın (sistem tepsisinde çalışma kapalıysa). Üç dakika sonra açın: "1 hatırlatma kaçırıldı" görünür ve görev listede durur.
- [ ] "Bitiş günü sabahı" hatırlatması olan, yarına tarihli bir görev ekleyin (2. gün sabahı denetlenir, §13).

## 12. Telefonda

Telefonda Pisi'yi son uygulamalardan kapatıp yeniden açın.

- [ ] **Açılış (S20):** ek bir dokunuş olmadan Pisi sekmesinde bugünün günlüğü, günün görevleri ve (varsa) "Gecikmiş" grubu görünür. Masaüstünde bugünün günlüğünde gördüğünüz görevlerle aynı görevlerdir.
- [ ] Pisi sekmesinde bugün tamamlanan görevler (ör. "QA Spor", "QA Geciken") ☑ görünür.
- [ ] Pisi sekmesinde **Görev ekle** ile "Telefon günlük görevi": görev günün listesinde hemen görünür.
- [ ] Bugün seçiliyken "Telefon yarın görevi yarın" ekleyin: "Görev eklendi; günü <yarın>." görünür. Görev bugünün listesinde tarih çipiyle durur (yeri bugünün günlüğüdür); tarih çarkında yarını seçince orada da görünür.
- [ ] Tarih çarkında iki gün sonrasını seçip "Telefon çark görevi" ekleyin: o günün listesinde görünür.
- [ ] Görevler sekmesinden "Telefon görevler sekmesi" ekleyin: görev bugünün günlüğünde durur (görev ayrıntısında **Yer**: "Günlük · <bugün>").
- [ ] Notlar sekmesinde Not A'yı açın: görev blokları masaüstündeki başlık ve durumla görünür. Bir görevin onay kutusuna dokunup tamamlayın.
- [ ] Not A'daki bir göreve dokunun: ayrıntıda başlık, durum, öncelik, tarih, saat, tekrar ve hatırlatma **düzenlenebilir** ("Masaüstünde nottan düzenlenir" yazmaz). Önceliği değiştirin.
- [ ] Not A'da bir paragrafa "Telefon not görevi" yazın ve araç çubuğundan **Göreve çevir**: paragraf görev olur.
- [ ] Telefonda hiçbir ekranda görev silme düğmesi yoktur.
- [ ] Takvim sekmesinde bugün ve yarın görev noktası taşır; hepsi biten gün ayrı görünür. Güne dokunmak Pisi sekmesini o günle açar.
- [ ] Ayarlar → Proje → Bütünlük "Sorun yok" yazar.

## 13. İki cihaz

Telefon ve masaüstü eşleşmiş ve eşit olmalıdır (`docs/sync-qa.md` §0.3: telefonda uygulamaya dönün ya da **Şimdi eşitle**; masaüstünde en çok bir dakika bekleyin).

### 1. gün

- [ ] §12'de telefonda eklenen beş görev masaüstünün panelinde, doğru günlüklerde ve takvimde görünür; telefonda tamamlanan Not A görevi masaüstünde ☑'dir; telefonda değiştirilen öncelik masaüstünde aynıdır.
- [ ] Masaüstünde "Telefon günlük görevi"ni Ctrl+P ile arayın: bulunur (S10). Masaüstünde başlığını değiştirip tamamlayın: telefonda yeni başlıkla ☑ görünür ve telefonda **düzenlenebilir** kalır (S4).
- [ ] Masaüstünde Not A'ya eklenen bir görev, telefonda Not A açıkken eşitlemeden sonra blok olarak görünür; telefonda yazdığınız metin kaybolmaz.
- [ ] **Telefon tamamlar, masaüstü başlığı değiştirir:** masaüstünde Not A'ya "QA İki cihaz" görevini yazın (Tekrar: "Her gün", tarih: bugün) ve telefonda görünmesini bekleyin. Telefonda uçak modunu açın, görevi telefonda tamamlayın; masaüstünde aynı görevin başlığını "QA İki cihaz yeni" yapın. Uçak modunu kapatıp eşitleyin: iki cihazda görev yeni başlıklıdır, bugün ☑, yarına ilerlemiştir; ikinci kayıt ya da çakışma kopyası yoktur.
- [ ] **Aynı tekrar iki cihazda:** masaüstünde Not A'ya "QA Aynı tekrar" görevini yazın (Tekrar: "Her gün", tarih: bugün) ve telefonda görünmesini bekleyin. Uçak modu açıkken görevi iki cihazda da tamamlayın; eşitleyin: görev **bir kez** ilerler (yarına); "Tamamlanan günler"de bugün **bir kez** vardır.
- [ ] **Silme kazanır:** uçak modu açıkken masaüstünde bir görev bloğunu silip notu kaydedin; telefonda aynı görevin önceliğini değiştirin. Eşitleyin: görev iki cihazda da yoktur (masaüstünde Çöp Kutusu'ndadır); masaüstünde Ayarlar → Senkron → **Çakışma günlüğü**'nde bu görev için bir satır vardır.
- [ ] **Aynı yeni gün:** iki cihazda da günlüğü olmayan bir gün seçin (ör. dört gün sonrası). Uçak modu açıkken telefonda o güne "Telefon aynı gün", masaüstünde o güne "Masaüstü aynı gün" görevi ekleyin. Eşitleyin: o gün için **tek** günlük vardır ve görev bölümünde iki görev de durur.
- [ ] **İleri tarih:** telefonda iki hafta sonrasına bir görev ekleyin. Eşitleyin: o günün günlüğü masaüstünde de oluşur, görev bölümündedir; masaüstünde o günü açınca "Kaydedilmemiş değişiklik" işareti çıkmaz.
- [ ] Çakışma kopyası oluşursa (ör. `docs/sync-qa.md` §9 sırasında), kopyada görev bloğu ve görev bölümü **yoktur**; görevler asıl notta kalır.

### 2. gün

- [ ] Masaüstünde bugünün (2. gün) günlüğünde "QA Spor" ☐ görünür; dünün günlüğünde ☑ ve tamamlanma saatiyle kalır. Telefonda Pisi sekmesinde aynısı görünür.
- [ ] Dünün "Bitiş günü sabahı" hatırlatması (§11) bu sabah masaüstünde bildirim olarak geldi (ya da Pisi kapalıysa açılınca kaçırılmış olarak görünür).
- [ ] "QA Spor"u **telefonda** tamamlayın. Masaüstünde dünün günlüğünü açın: dünün ☑'si **kilitlidir** (onay kutusu devre dışı, üstüne gelince "Bu tamamlama kilitli: görev daha sonra yeniden tamamlandı."). Telefonda dünü seçin: dünün satırı da kilitlidir ("Bu tamamlama geri alınamaz: görev daha sonra yeniden tamamlandı.").
- [ ] Masaüstünde bugünün ☑'sini kaldırın: görev bugüne döner; telefonda eşitleyince de bugüne döner. Dünün ☑'si artık en son tamamlama olduğu için kilitli değildir (onay kutusu etkin); ona dokunmayın. "QA Spor"u bugün yeniden tamamlayın: dünün ☑'si yeniden kilitlenir.

### 3. gün

- [ ] Hiçbir şey yapmadan iki cihazda da uygulamayı açın: gün kendiliğinden değişir (bugün 3. gündür); "QA Spor" bugünde ☐'dir, dün ve önceki gün ☑ kalır.
- [ ] Masaüstünde "QA Spor"un ayrıntısında "Tamamlanan günler"den **1. günü** silin ("Bir günü silmek görevin tarihini değiştirmez."): görev bugünde kalır. 1. günün günlüğünde satır kalır (görevin yeri o günlüktür) ama ☑ değil, görevin tarih çipiyle görünür. Telefonda eşitleyip 1. günü seçince aynı görünür.
- [ ] 2. gün tamamlanmadan bırakılan "QA İki cihaz yeni" bugünün "Gecikenler" grubundadır (2. gün onu tamamlamayın); telefonda "Gecikmiş" altında görünür. Telefonda tamamlayın: iki cihazda da bugün ☑, yarına ilerler, dünün günlüğünden kalkar.

## 14. Kapanış denetimi

§2–§13 bittikten sonra, iki cihaz eşitken:

- [ ] Masaüstünde Ayarlar → **Proje bütünlüğü** → **Projeyi denetle**: §1.4'teki sonuca göre **yeni** bir bulgu yoktur. Bulgu varsa her birinin adını ve önerilen onarımı yazın; **Onar**'a basmadan önce ekran görüntüsünü alın.
- [ ] Telefonda Ayarlar → Proje → Bütünlük "Sorun yok" yazar; görev, not, günlük ve harita sayıları masaüstündekiyle aynıdır.
- [ ] Masaüstünün ve telefonun **Çakışma günlüğü** yalnız §13'te bilerek oluşturduğunuz çakışmaları gösterir.
- [ ] Deneme projesindeki `.pisi/tasks.json` dosyasının boyutunu yazın (dosya yöneticisinde): · KB

## 15. Bu listede elle denenmeyenler

Aşağıdakiler projeyi ya da dosyaları bilerek bozmayı gerektirir; otomatik testlerde sınanır ve bu listede işaretlenmez:

- Okunamayan `tasks.json` ("Görevler okunamadı", salt okunur görevler; GV11): `tests/task-service-*.test.mjs`, mobil vitest.
- Kaydı olmayan görev bloğu ("Görev bulunamadı"), çift referans, evsiz görev ve kurala uymayan günlük bölümü bulgularının onarımları: `scripts/electron-tasks-integrity-e2e.mjs`.
- `tasks.json` geçmişinden geri yükleme ve "Bu nota ait N görev notta görünmüyor." + **Sona ekle**: `scripts/electron-tasks-surfaces-e2e.mjs`.
- 2.000 not ve 5.000 görevle ölçüm: `scripts/electron-tasks-scale-e2e.mjs`, sonuçlar `docs/task-scale-timing.json`.
- Masaüstü ve telefonun aynı `tasks.json`'dan aynı günlük baytlarını üretmesi (GV15): `tests/mobile-desktop-compat.test.mjs`.
- Senkron birleşiminin rastgele düzenlemelerle sınanması ve iki cihaz matrisi 18–22: `tests/shared-sync-merge-random.test.mjs`, `scripts/sync-e2e-matrix.mjs`.

## 16. Sorun kaydı

Bir madde geçmezse §0.4'teki gibi yazın ve mümkünse şunları ekleyin (sunucu adresi ve anahtar olmadan):

- ne yaptığınız, ne beklediğiniz, ne gördüğünüz ve saat;
- ekran görüntüsü;
- masaüstü günlük dosyası (`docs/sync-qa.md` §17'deki klasörler);
- görev kaydıyla ilgiliyse deneme projesinin `.pisi/tasks.json` dosyası (özel başlıklar varsa paylaşmadan önce silin ya da değiştirin);
- telefon için USB hata ayıklama açıksa `adb logcat` çıktısı (`docs/mobile-qa.md` §5).

Doğrulanan her sorun `pisi-error.md`'ye "tasks" etiketiyle ayrı bir madde olarak yazılır (CLAUDE.md kural 6); düzeltilen sorun
`pisi-update.md`'ye tarihli girişle geçer.
