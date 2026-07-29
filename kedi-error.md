`legacy-clean` artık `main` oldu. İki dal da aynı committe: [`c5372c72`](https://github.com/maggezer/Kedi/commit/c5372c72c803873f564decab4b40efb360845f36).

Önceki `main` silinmedi; [`backup/main-before-legacy-restore-20260729`](https://github.com/maggezer/Kedi/tree/backup/main-before-legacy-restore-20260729) dalında, `2aef1bf4` commitinde duruyor. Kaynak kodda henüz düzeltme yapmadım.

Aşağıdakiler önem sırasına göre, doğrulayabildiğim hata ve eksiklerdir:

1. **[Kritik · kesin] Paint çizimleri yeniden açıldığında yüklenmiyor ve sonradan tamamen silinebiliyor.** [`app.js:541-679`](https://github.com/maggezer/Kedi/blob/main/app.js#L541-L679) içinde kaydedilen tuvale hem `data-image` hem `data-image-loaded` aynı PNG verisi yazılıyor. Dosya tekrar açıldığında kod bunları eşit gördüğü için PNG’yi tuvale çizmiyor. Tuval boş görünüyor. Daha sonra herhangi bir kayıt sırasında [`getKediEditorContent`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-map-workspace.js#L706-L725) boş tuvali tekrar PNG’ye çevirerek eski çizimin üstüne yazabiliyor. Yükleme durumunu dosyaya kaydetmemek, bağlama sırasında PNG’yi her zaman çizmek ve geçici `bound/loaded` niteliklerini kayıttan temizlemek gerekiyor.

2. **[Kritik · kesin] Map silme sırası toplu veri kaybına açık.** [`main.js:2160-2166`](https://github.com/maggezer/Kedi/blob/main/main.js#L2160-L2166) önce map’in bütün node klasörünü `rmSync(...recursive)` ile siliyor, sonra `.map` dosyasını siliyor. İkinci işlem hata verirse map dosyası kalırken içindeki bütün node’lar kayboluyor. İşlem geri dönüşümlü çöp kutusu, geçici taşıma veya transaction benzeri bir düzenle yapılmalı.

3. **[Kritik · kesin] Node silme de yanlış sırada ve geri alınamıyor.** [`main.js:2175-2187`](https://github.com/maggezer/Kedi/blob/main/main.js#L2175-L2187) önce parent map bağlantılarını değiştiriyor, sonra node’un sidecar klasörünü siliyor, en son node dosyasını siliyor. Son adım başarısız olursa node kalıyor fakat bağlantıları ve kaynak klasörü kaybolmuş oluyor.

4. **[Kritik · güvenlik] Renderer’dan gelen dosya yolları aktif proje klasörüyle sınırlandırılmıyor.** [`main.js:2538-2648`](https://github.com/maggezer/Kedi/blob/main/main.js#L2538-L2648) içindeki okuma, yazma, taşıma, yeniden adlandırma ve silme IPC’leri renderer’ın gönderdiği mutlak yolu doğrudan kullanıyor. `activeProjectFolder` yalnızca watcher için tutuluyor; güvenlik sınırı değil. Her işlemde `realpath`, proje kökü kontrolü, dosya türü kontrolü ve symlink/reparse-point kontrolü gerekli.

5. **[Kritik · güvenlik] Dosyadan okunan `kedi.id` değeri yol oluştururken temizlenmiyor.** [`main.js:226-250`](https://github.com/maggezer/Kedi/blob/main/main.js#L226-L250) ve [`main.js:444-550`](https://github.com/maggezer/Kedi/blob/main/main.js#L444-L550) ham ID’yi dosya ve klasör adına ekliyor. İçeri aktarılmış kötü niyetli bir JSON’daki `/`, `\` ve `..` parçaları proje dışına sidecar/dosya oluşturulmasına yol açabilir. ID yalnızca katı bir UUID/alfanümerik desen kabul etmeli.

6. **[Kritik · kesin] Uygulama kapanırken editör autosave kuyruğu boşaltılmıyor.** [`main.js:2517-2519`](https://github.com/maggezer/Kedi/blob/main/main.js#L2517-L2519) pencereyi doğrudan kapatıyor. Center editor 800 ms gecikmeli kaydedildiği için son yazılanlar kaybolabilir. Modal açıkken yapılan değişikliklerin tamamı kaybolabilir. Renderer–main arasında “kaydı tamamla, sonra kapat” el sıkışması gerekiyor.

7. **[Kritik · kesin] Proje değiştirirken eski editör kapatılmıyor veya kaydedilmiyor.** [`kedi-tree.js:81-107`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L81-L107) sekmeleri ve map’i sıfırlıyor fakat `activeCenterNode`, center editor ve açık modalı temizlemiyor. Eski proje içeriği yeni proje seçildikten sonra ekranda kalabilir; autosave eski proje yoluna yazmaya devam edebilir.

8. **[Yüksek · kesin] Bozuk veya boş `.node/.map` dosyası tanımsız değişken hatası oluşturuyor.** [`main.js:577-580`](https://github.com/maggezer/Kedi/blob/main/main.js#L577-L580) içindeki `visibleTitle` hiçbir yerde tanımlı değil. ESLint bunu doğrudan `no-undef` hatası olarak doğruladı. Tek bir bozuk dosya `safeListFolder` işleminin tamamını düşürerek klasördeki diğer sağlam dosyaların da Explorer’da görünmemesine neden olabilir.

9. **[Yüksek · veri güvenliği] Önceki hatayı yalnızca değişken ekleyerek düzeltmek de tehlikeli olur.** Aynı blok bozuk JSON’u yeni ve boş bir dokümanla değiştirmeye hazırlanmış. Kurtarma işlemi bozuk dosyanın üstüne yazmamalı; dosyayı yedekleyip kullanıcıya kurtarma seçeneği göstermeli.

10. **[Yüksek · kesin] Formül sistemi mevcut CSP nedeniyle çalışmıyor.** [`index.html:5-8`](https://github.com/maggezer/Kedi/blob/main/index.html#L5-L8) `unsafe-eval` izni vermiyor, fakat [`app.js:862-890`](https://github.com/maggezer/Kedi/blob/main/app.js#L862-L890) formülleri `Function(...)` ile çalıştırıyor. Electron/Chromium bunu reddeder ve formüller `#ERR` olur. Formül ayrıştırıcısı `Function` kullanmadan yazılmalı; CSP gevşetilmemeli.

11. **[Kritik · kesin] Formül aralıklarında boyut sınırı yok.** [`app.js:909-927`](https://github.com/maggezer/Kedi/blob/main/app.js#L909-L927) kullanıcı tarafından yazılan başlangıç/bitiş hücreleri arasında koşulsuz döngü kuruyor. `=SUM(A1:ZZZ999999)` gibi bir formül renderer’ı uzun süre kilitleyebilir veya uygulamayı çökertir. Aralıklar gerçek tablo sınırlarına ve makul hücre sayısına sıkıştırılmalı.

12. **[Yüksek · kesin] Kaydedilmiş Excel tabloları yeniden açıldığında olayları bağlanmıyor.** [`app.js:750-787`](https://github.com/maggezer/Kedi/blob/main/app.js#L750-L787) `data-kedi-sheet-bound="1"` niteliğini tabloya yazıyor; bu nitelik node HTML’iyle birlikte kaydediliyor. Yeniden açılışta kod tabloyu zaten bağlı sanıyor. Hücre seçimi, blur commit’i ve otomatik hesaplama kısmen devre dışı kalıyor.

13. **[Yüksek · kesin] Elle yazılan hücre değeri eski formülü temizlemiyor.** [`app.js:837-845`](https://github.com/maggezer/Kedi/blob/main/app.js#L837-L845) hücrede `data-formula` varsa düz metin yazıldığında niteliği bırakıyor. Sonraki hesaplama kullanıcının yeni değerini eski formül sonucuyla eziyor.

14. **[Orta · kesin] `COUNT` ve `AVG` boş hücreleri sıfır kabul ediyor.** [`app.js:866-906`](https://github.com/maggezer/Kedi/blob/main/app.js#L866-L906) boş ve sayısal olmayan hücreleri `0` döndürüyor. Böylece `COUNT` boş hücreleri sayıyor, `AVG` boş hücreleri ortalamaya sıfır olarak katıyor.

15. **[Orta · kesin] Aralık içindeki döngüsel formül hataları gizlenebiliyor.** [`app.js:909-927`](https://github.com/maggezer/Kedi/blob/main/app.js#L909-L927) `NaN` değerlerini filtreliyor. Bir range içindeki döngü hata vermek yerine sessizce hesap dışı kalabilir.

16. **[Orta · eksik] Satır/sütun ekleme üst sınırı yalnızca ilk tablo oluşturulurken uygulanıyor.** `+ Satır` ve `+ Sütun` işlemleri [`app.js:998-1022`](https://github.com/maggezer/Kedi/blob/main/app.js#L998-L1022) üzerinden sınırsız büyüyebiliyor. Satır/sütun silme, hücre biçimlendirme, referans güncelleme ve çoklu seçim de yok.

17. **[Yüksek · kesin] Dosya yazımları atomik değil.** [`main.js:507-509`](https://github.com/maggezer/Kedi/blob/main/main.js#L507-L509) bütün JSON’u doğrudan hedef dosyaya yazıyor. Elektrik kesintisi, çökme veya disk hatası dosyayı yarım bırakabilir. Aynı klasöre geçici dosya yazıp `fsync + rename` ve önceki sürüm yedeği kullanılmalı.

18. **[Yüksek · kesin] Rename ve move işlemleri transaction değil.** [`main.js:1136-1201`](https://github.com/maggezer/Kedi/blob/main/main.js#L1136-L1201) ile [`main.js:1236-1393`](https://github.com/maggezer/Kedi/blob/main/main.js#L1236-L1393) dosya, metadata ve sidecar’ı farklı adımlarda değiştiriyor; rollback yok. Ortadaki bir hata proje ağacını tutarsız bırakabilir.

19. **[Yüksek · kesin] Sekme kapatılırken kayıt hatası olsa bile sekme kapanıyor.** [`app.js:1335-1362`](https://github.com/maggezer/Kedi/blob/main/app.js#L1335-L1362) save fonksiyonunu bekliyor ancak save fonksiyonu başarı/başarısızlık sonucu döndürmüyor; hatayı gösterip bitiyor. Ardından sekme yine kaldırılıyor.

20. **[Yüksek · kesin] Save işlemleri sürüm veya sıra kontrolü olmadan çakışabiliyor.** Timer autosave, Ctrl+S, sekme değiştirme ve modal kapatma aynı node için paralel tam-dosya yazımı başlatabilir. Daha eski başlayan bir işlem daha sonra biterek yeni içeriğin üstüne yazabilir. Belge başına seri kuyruk/revision gerekli.

21. **[Yüksek · kesin] Map yeniden adlandırıldığında içindeki açık node yolları bozuluyor.** Map rename sidecar klasörünü de yeniden adlandırıyor, ancak açık child node sekmeleri ve `activeMapNodes.fullPath` değerleri güncellenmiyor. [`updateKediOpenTabAfterRename`](https://github.com/maggezer/Kedi/blob/main/app.js#L1426-L1467) yalnızca map sekmesini güncelliyor. Map kutularına tıklamak ve child node kaydetmek map tekrar açılana kadar başarısız olabilir.

22. **[Yüksek · kesin] Açık dosyaları içeren bir klasör taşındığında descendant sekmeler güncellenmiyor.** [`kedi-tree.js:277-327`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L277-L327) sadece doğrudan taşınan öğe dosyaysa sekmeyi değiştiriyor. Klasörün altındaki bütün açık node/map sekmeleri eski mutlak yolları tutuyor.

23. **[Yüksek · kesin] Silinen node sekmeleri ve editörü kapatılmıyor.** [`kedi-tree.js:715-757`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L715-L757) map görünümünü güncelliyor ancak açık node sekmesini ve center editor’ü temizlemiyor. Autosave daha sonra artık bulunmayan yola yazmaya çalışıyor.

24. **[Yüksek · kesin] Map silmek child node sekmelerini ve açık modalı temizlemiyor.** Yalnızca map sekmesi kaldırılıyor. Sidecar’la birlikte silinen child node’ların sekmeleri, center editor veya modalı ölü yollarla açık kalabiliyor.

25. **[Yüksek · kullanım] Map silme onayı child node’ların da kalıcı silineceğini söylemiyor.** [`kedi-tree.js:659-689`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L659-L689) yalnızca `"Map adı" silinsin mi?` diyor. Bir map’in bütün node’larının silineceği açıkça belirtilmeli ve node sayısı gösterilmeli.

26. **[Yüksek · kesin] Tree üzerinde parent değiştirme işlemi önce eski bağlantıyı siliyor.** [`kedi-tree.js:223-265`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L223-L265) tüm eski parent edge’lerini tek tek siliyor, hata sonuçlarını kontrol etmiyor, sonra yeni parent oluşturuyor. Yeni bağlantı başarısız olursa node parentsız kalıyor.

27. **[Yüksek · kesin] Map ve node bağlantı metadata’ları ayrı yazılıyor.** [`main.js:1726-1810`](https://github.com/maggezer/Kedi/blob/main/main.js#L1726-L1810) önce map edges’i, sonra her node’un `connectionTypes` alanını yazıyor. Yarıda kalan işlem iki veri kaynağını farklı durumda bırakıyor.

28. **[Yüksek · kesin] Mevcut/import edilmiş edge verisi yeterince doğrulanmıyor.** [`normalizeMapEdge`](https://github.com/maggezer/Kedi/blob/main/main.js#L349-L392) self-loop, duplicate edge, bir child için birden fazla parent ve type/role uyumsuzluklarını temizlemiyor. UI yeni self-loop’u engellese de elle düzenlenmiş dosyadaki bozuk edge’ler kalıyor.

29. **[Yüksek · kesin] Hiyerarşi döngüsü sol ağaçtaki bütün node’ları görünmez yapabilir.** [`kedi-tree.js:1408-1486`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L1408-L1486) A→B ve B→A durumunda iki node’u da “child” işaretliyor; root listesi boş kaldığı için map altında hiçbir node gösterilmiyor.

30. **[Orta · kesin] İki node arasında yalnızca tek ilişki tutulabiliyor.** [`main.js:1894-1908`](https://github.com/maggezer/Kedi/blob/main/main.js#L1894-L1908) aynı veya ters yöndeki tüm eski bağlantıları kaldırıyor. İki node arasında hem süreç hem co-level gibi bağımsız ilişkiler modellenemiyor.

31. **[Orta · kesin] İkinci parent bağlantısı kullanıcıya sorulmadan stream’e çevriliyor.** Renderer ve main bunu otomatik yapıyor; kullanıcı yalnızca çizgi rengindeki değişimden anlayabilir. Açık bir uyarı/karar ekranı olmalı.

32. **[Yüksek · kesin] Layout ve kamera sayıları doğrulanmıyor.** [`main.js:1552-1624`](https://github.com/maggezer/Kedi/blob/main/main.js#L1552-L1624) `NaN`, `Infinity`, aşırı zoom, negatif veya devasa boyutları kabul ediyor. JSON’da `NaN/Infinity` `null` olur; map görünümü bozulabilir.

33. **[Orta · kesin] Silinmiş node’ların map layout kayıtları temizlenmiyor.** [`main.js:1450-1531`](https://github.com/maggezer/Kedi/blob/main/main.js#L1450-L1531) bulunan node’lara layout ekliyor ancak sidecar’da artık olmayan node ID’lerini `map.nodes` listesinden çıkarmıyor.

34. **[Orta · kesin] İlk node yerleşimi deterministik değil.** Sidecar `readdirSync` sonucu sıralanmadan index’e göre konum veriliyor. Farklı Windows/disk sıralarında başlangıç düzeni değişebilir.

35. **[Yüksek · kesin] Aynı ID’ye sahip iki node tespit edilmiyor.** `Map` nesnesine ID anahtarıyla ekleme yapıldığı için son okunan node öncekinin üstüne yazabiliyor. Sidecar arama da ilk rastladığı klasörü kullanıyor. ID benzersizliği açılışta doğrulanmalı.

36. **[Orta · kesin] ID üretimi `Date.now + Math.random` kullanıyor.** [`main.js:269-274`](https://github.com/maggezer/Kedi/blob/main/main.js#L269-L274) çakışma ihtimalini gereksiz yere açık bırakıyor. `crypto.randomUUID()` tercih edilmeli.

37. **[Yüksek · kesin] Aktif map açıkken bütün filesystem değişiklikleri görmezden geliniyor.** [`app.js:1707-1719`](https://github.com/maggezer/Kedi/blob/main/app.js#L1707-L1719) `activeMapPath` varsa doğrudan dönüyor. VS Code’dan yapılan dış değişiklikler map açık kaldığı sürece uygulamaya yansımıyor.

38. **[Orta · kesin] Sabit süreli watcher baskılama gerçek dış değişiklikleri de yutuyor.** Rename/delete işlemleri 1,5–8 saniyelik global bastırma uyguluyor. Bu aralıkta VS Code’dan gelen meşru değişiklikler kayboluyor.

39. **[Orta · kesin] `fs.watch` alt klasörleri yalnızca Windows’ta izliyor.** [`main.js:2315-2334`](https://github.com/maggezer/Kedi/blob/main/main.js#L2315-L2334) Linux/macOS’ta recursive izleme yapmıyor. Sidecar ve alt klasörlerdeki dış değişiklikler görülmez.

40. **[Yüksek · kesin] Calendar tarih yenilemesi proje değişimiyle yarışabiliyor.** Tek global `diaryDatesRefreshInProgress` kullanılıyor. A projesinin isteği sürerken B’ye geçilirse B yenilemesi atlanabilir ve A’nın tarihleri B’nin takvim durumuna yazılabilir.

41. **[Orta · kesin] Calendar/diary sync imzası proje yolunu içermiyor.** [`kedi-calendar.js:570-604`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-calendar.js#L570-L604) aynı signature’ı farklı projelerde aynı kabul edebiliyor. Özellikle iki projede de görev listesi boşsa B projesindeki eski managed görev blokları temizlenmeyebilir.

42. **[Yüksek · kesin] Diary sync başarısızlığı yeniden denenmiyor.** `lastDiarySyncSignature` işlem başarılı olmadan önce güncelleniyor. `ok:false` veya exception sonrasında aynı içerik tekrar sync edilmiyor.

43. **[Orta · kesin] Sync devam ederken gelen yeni görev durumu tamamen düşürülüyor.** `diarySyncInProgress` true olduğunda istek kuyruğa alınmadan `null` dönüyor.

44. **[Yüksek · veri güvenliği] Diary sync bütün managed alanları mevcut index ile yeniden oluşturuyor.** [`main.js:998-1060`](https://github.com/maggezer/Kedi/blob/main/main.js#L998-L1060) geçici okuma hatasıyla eksik index gelirse bütün diary notlarındaki managed görev kopyaları silinebilir. Son başarılı index veya transaction kullanılmalı.

45. **[Orta · kesin] Diary sync kullanıcının manuel içeriğini `trim()` ile değiştiriyor.** [`stripKediDiaryManagedSection`](https://github.com/maggezer/Kedi/blob/main/main.js#L864-L870) managed kısmı çıkarırken manuel içeriğin başındaki/sonundaki boşlukları da siliyor.

46. **[Orta · kesin] Diary node başlığı oluşturulduktan hemen sonra farklı başlığa dönüyor.** Kod `DD-MM-YYYY` başlığı oluşturuyor fakat dosya adı `YYYY-MM-DD.node`; metadata ensure işlemi başlığı dosya adından tekrar türeterek ISO biçimine çeviriyor.

47. **[Orta · kesin] Var olan diary node’un `parentMap` alanı her zaman düzeltilmiyor.** [`main.js:833-838`](https://github.com/maggezer/Kedi/blob/main/main.js#L833-L838) `parentMap='diary'` düzeltmesini yalnızca `diaryDate` değişmişse yapıyor.

48. **[Düşük · kesin] Mission sync görevi olmasa bile `diary/` klasörü oluşturuyor.** Uygulama açılışındaki boş sync bile projede kullanıcı istemeden klasör yaratabiliyor.

49. **[Orta · kesin] Calendar durumu proje bazlı değil.** Dock, ay, seçili gün ve float konumu tek bir `localStorage` anahtarında tutuluyor; bütün projeler aynı state’i paylaşıyor.

50. **[Orta · kesin] Float calendar tamamen ekranda tutulmuyor.** [`kedi-calendar.js:281-282`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-calendar.js#L281-L282) takvimin gerçek genişlik/yüksekliği yerine yalnızca 80×60 px sınırı kullanıyor. Büyük kısmı ekran dışında kalabilir; resize sırasında da yeniden sıkıştırılmıyor.

51. **[Orta · kesin] Sağ/sol panelde takvim her zaman 300 px alan ayırıyor.** [`style.css:2090-2111`](https://github.com/maggezer/Kedi/blob/main/style.css#L2090-L2111) küçük pencere yüksekliğinde görev ve tag alanını ciddi biçimde daraltıyor.

52. **[Yüksek · performans] Varsayılan Missions sekmesi açıkken her yazı girişinden 250 ms sonra bütün proje taranıyor.** [`kedi-tags.js:123-155`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tags.js#L123-L155) klasörleri, map’leri ve node’ları IPC üzerinden yeniden okuyor; ardından diary sync çalıştırıyor. Büyük projelerde yazarken takılma ve yoğun disk erişimi oluşturur.

53. **[Orta · kesin] Tags sekmesi açık standalone node’un etiketlerini göstermiyor.** [`buildKediTagBlockIndex`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tags.js#L469-L495) yalnızca aktif map node’larını ve diary node’larını topluyor. Map dışında açılmış center node listeye eklenmiyor.

54. **[Orta · kesin] Diary’deki managed görev kopyaları tag sonuçlarını çoğaltabiliyor.** Orijinal map node ve diary kopyası farklı dosya yolları olduğu için aynı blok iki sonuç/count olarak gösterilebilir.

55. **[Orta · kesin] Eski dokümanlarda block ID kararlı değil.** [`kedi-tags.js:497-522`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tags.js#L497-L522) ID’siz kapalı node’a geçici UUID veriyor ama dosyaya kaydetmiyor. Sonraki taramada ID değişiyor; diary sync gereksiz yazılabilir ve sonuç tıklanınca doğru blok bulunamayabilir.

56. **[Düşük · kesin] `highlightKediEditorBlock` bloğa highlight sınıfı eklemiyor.** [`kedi-tags.js:1173-1201`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tags.js#L1173-L1201) eski highlight’ı kaldırıp scroll yapıyor fakat `kedi-block-highlight` sınıfını hiç eklemiyor. CSS efekti bu nedenle kullanılmıyor.

57. **[Orta · kesin] Görevi tamamlamak bütün bloğu tamamlıyor.** Aynı blokta iki `todo.*` etiketi varsa `done` eklendiğinde ikisi de Missions listesinden kayboluyor. Görev başına kimlik/durum gerekli.

58. **[Orta · kesin] “Done” kaydı başarısız olursa editör DOM’u geri alınmıyor.** Center/modal bloğuna önce `done` ekleniyor, sonra disk kaydı deneniyor. Save hata verirse checkbox geri alınsa bile DOM işaretli kalıyor ve sonraki autosave bunu kalıcılaştırabilir.

59. **[Düşük · eksik] Tamamlanan görevi geri açma arayüzü yok.** Görev kayboluyor; kullanıcı `done` chip’ini elle düzenlemek zorunda.

60. **[Düşük · kesin] Todo yılı yalnızca iki basamak ve zorla 2000–2099 aralığında.** [`kedi-tags.js:713-752`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tags.js#L713-L752) uzun dönem tarihleri desteklemiyor.

61. **[Orta · kesin] Proje değişince kullanıcı tag öneri önbelleği temizlenmiyor.** `KEDI_USER_TAG_CACHE` global state’te kalıyor; eski projedeki etiketler yeni projede öneriliyor.

62. **[Yüksek · performans] Her map node kutusu ayrı ayrı global mousemove/mouseup listener’ları ekliyor.** [`kedi-map-workspace.js:416-529`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-map-workspace.js#L416-L529) yüzlerce node’da yüzlerce window listener’ı oluşturuyor. Tek merkezi pointer controller kullanılmalı.

63. **[Yüksek · performans] Her node sürükleme hareketinde bütün edge DOM’u silinip yeniden kuruluyor.** [`drawMapConnections`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-map-connections.js#L918-L981) her mousemove’da tüm SVG path ve butonlarını yeniden yaratıyor. `requestAnimationFrame`, mevcut path güncelleme ve dirty-edge yaklaşımı gerekli.

64. **[Orta · kesin] Node resize zoom oranını hesaba katmıyor.** [`kedi-map-workspace.js:509-519`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-map-workspace.js#L509-L519) pointer farkını `zoom` değerine bölmüyor. %50 veya %200 zoom’da resize hareketi imleçle uyuşmuyor.

65. **[Orta · kesin] Node preview uzunluğu sınırsız.** Bütün node metni map kutusunun DOM’una konuyor; CSS yalnızca görünümü kesiyor. Büyük notlar her map açılışında gereksiz bellek ve DOM yükü oluşturuyor.

66. **[Orta · kesin] Map açma başarısız olduğunda aktif state yarım kalıyor.** [`kedi-map-workspace.js:28-68`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-map-workspace.js#L28-L68) `activeMapPath`, sekme ve boş board’u API sonucu gelmeden değiştiriyor. Yükleme hatasında eski görünüm kayboluyor ve başarısız map aktif kalıyor.

67. **[Orta · kesin] Kamera autosave timer’ı map yolunu yakalamıyor.** [`kedi-map-connections.js:372-392`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-map-connections.js#L372-L392) timer çalıştığında o anki global `activeMapPath/activeMapCamera` değerlerini kullanıyor. Hızlı map değişiminde eski map kamerası kaybolabilir veya yeni map’e gereksiz kayıt yapılabilir.

68. **[Orta · kesin] Collapse edilen hub bilgisi diske kaydedilmiyor.** Uygulama yeniden açıldığında kayboluyor. Aynı oturumda map yeniden kurulduğunda edge gizli kalabilmesine rağmen yeni port DOM’una collapse sınıfı tekrar uygulanmıyor.

69. **[Orta · kesin] `refreshCurrentProjectTree()` gerçek yenilemeyi await etmiyor.** [`kedi-tree.js:59-68`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L59-L68) yalnızca `setTimeout` kurup hemen dönüyor. `await refreshCurrentProjectTree()` kullanan move/drop akışları ağaç yenilenmiş sanarak eski DOM’u sorguluyor.

70. **[Orta · kesin] Windows basename yardımcı fonksiyonu backslash ayırmıyor.** [`kedi-tree.js:157-160`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L157-L160) yalnızca `/` ile bölüyor. `C:\project\node.node` için tüm yolu döndürüyor.

71. **[Orta · platform] Path karşılaştırmaları bütün işletim sistemlerinde küçük harfe çevriliyor.** [`main.js:2349-2356`](https://github.com/maggezer/Kedi/blob/main/main.js#L2349-L2356) Linux’taki `/Foo` ve `/foo` gibi gerçekten farklı yolları aynı kabul ediyor. Case folding yalnızca case-insensitive platformlarda yapılmalı.

72. **[Orta · Windows] Dosya adı temizleme Windows reserved adlarını engellemiyor.** `CON`, `PRN`, `AUX`, `NUL`, `COM1` gibi adlar ve maksimum yol uzunluğu kontrol edilmiyor. Create/rename işlemleri kullanıcıya ham filesystem hatası verebilir.

73. **[Orta · kesin] `inv_` veya `nd_` ile başlayan kullanıcı klasörleri koşulsuz gizleniyor.** [`main.js:168-175`](https://github.com/maggezer/Kedi/blob/main/main.js#L168-L175) gerçekten KEDI sidecar’ı olup olmadığını doğrulamıyor. Kullanıcının normal klasörü Explorer’dan görünmez hale gelebilir. Aynı durum normal `diary` klasörü için de geçerli.

74. **[Orta · kesin] Node sidecar klasörleri oluşturuluyor fakat Paint/Excel kaynakları oraya yazılmıyor.** Paint PNG’si doğrudan node JSON’una base64 gömülüyor; bu yüzden sidecar klasörleri çoğunlukla boş. Dokümanda anlatılan kaynak klasörü mimarisi uygulanmamış.

75. **[Yüksek · performans/veri boyutu] Her Paint kaydında PNG iki kez node JSON’una gömülüyor.** `data-image` ve `data-image-loaded` aynı büyük data URL’yi taşıyor. 1600×1200 tuval node dosyasını hızla büyütebilir; pointer-up sırasında bütün canvas ve bütün node tekrar serialize ediliyor.

76. **[Orta · performans] Paint pointer-down bütün tuvalin `ImageData` kopyasını alıyor.** Maksimum tuvalde her çizgi başlangıcında birkaç MB bellek kopyalanıyor. Büyük çizimlerde UI takılması beklenir.

77. **[Orta · kesin] Metadata okuma işlemi dosya sistemini değiştirebiliyor.** [`ensureKediFileMetadata`](https://github.com/maggezer/Kedi/blob/main/main.js#L561-L683) yalnızca listeleme sırasında bile sidecar oluşturuyor/yeniden adlandırıyor ve dosyayı migrate edebiliyor. Salt-okunur listeleme ile onarım ayrı işlemler olmalı.

78. **[Düşük · kesin] `updatedAt` her okumada bellekte “şimdi” yapılıyor fakat her zaman diske yazılmıyor.** [`main.js:624`](https://github.com/maggezer/Kedi/blob/main/main.js#L624) `changed=true` demeden tarihi değiştiriyor. API’nin döndürdüğü metadata ile disk metadata’sı farklı olabiliyor.

79. **[Orta · kesin] Project lock gerçek bir kilit değil.** `.kedi.lock` yalnızca açıklama dosyası; PID/owner/timeout yok ve uygulama kapanınca silinmiyor. İki KEDI süreci aynı projeyi aynı anda açabilir. `app.requestSingleInstanceLock()` ve belge/proje kilidi gerekli.

80. **[Düşük · kesin] `process.chdir(projectFolder)` kilit olarak kullanılıyor.** [`main.js:2387-2407`](https://github.com/maggezer/Kedi/blob/main/main.js#L2387-L2407) Windows’ta klasör silinmesini engelliyor fakat gerçek eşzamanlı erişim koruması sağlamıyor ve process’in çalışma klasörünü değiştiriyor.

81. **[Yüksek · güvenlik] Electron renderer sandbox kapalı.** [`main.js:2445-2450`](https://github.com/maggezer/Kedi/blob/main/main.js#L2445-L2450) `sandbox:false`. `nodeIntegration:false` ve `contextIsolation:true` doğru ayarlanmış olsa da sandbox mümkünse açılmalı.

82. **[Yüksek · güvenlik/kullanım] DevTools her production açılışında otomatik açılıyor.** [`main.js:2455-2457`](https://github.com/maggezer/Kedi/blob/main/main.js#L2455-L2457) koşulsuz `openDevTools` çağırıyor. Bu hem kullanıcı deneyimini bozuyor hem de güçlü filesystem API’lerinin konsoldan kolayca çağrılmasına izin veriyor.

83. **[Yüksek · güvenlik] HTML sanitizer allowlist kullanmıyor.** [`kedi-map-workspace.js:749-768`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-map-workspace.js#L749-L768) yalnızca birkaç etiketi ve `on*` niteliklerini kaldırıyor; diğer etiketler, URL’ler ve nitelikler kalıyor. DOMPurify benzeri sıkı bir allowlist ve URL protokol filtresi gerekli.

84. **[Orta · güvenlik] Navigation, popup ve permission politikaları tanımlı değil.** `setWindowOpenHandler`, `will-navigate` engeli ve permission request handler yok. Zengin içerikte link desteği genişletilirse bu eksik doğrudan güvenlik problemine dönüşür.

85. **[Orta · kesin] CSP ile HTML’deki inline style çelişiyor.** [`index.html:61`](https://github.com/maggezer/Kedi/blob/main/index.html#L61) inline `style="display:none"` kullanıyor fakat CSP inline style’a izin vermiyor. Chromium konsol ihlali üretir; başlangıç görünümü JS çalışana kadar yanlış olabilir.

86. **[Orta · kesin] Preload’da karşılığı olmayan API var.** [`preload.js:24`](https://github.com/maggezer/Kedi/blob/main/preload.js#L24) `project:delete-path` çağırıyor fakat main process handler’ı yok. Çağrılırsa promise reddedilir.

87. **[Düşük · kesin] Preload’da `deleteNodeFromMap` anahtarı iki kez tanımlı.** [`preload.js:41-49`](https://github.com/maggezer/Kedi/blob/main/preload.js#L41-L49) ikinci tanım birinciyi eziyor. ESLint bunu `no-dupe-keys` hatası olarak doğruladı.

88. **[Orta · kesin] Preload event abonelikleri unsubscribe döndürmüyor.** `onMaximized`, `onUnmaximized` ve `onFileSystemChanged` listener’ları kaldırılamıyor. Yeniden başlangıç/hot reload durumunda listener birikebilir.

89. **[Orta · kesin] Aynı scope içinde fonksiyonlar tekrar tanımlanmış.** `main.js` içinde `findParentMapPathForNode` [`1987`](https://github.com/maggezer/Kedi/blob/main/main.js#L1987) ve [`2024`](https://github.com/maggezer/Kedi/blob/main/main.js#L2024); tree içinde `getDirectTreeChildrenContainer` ve `refreshActiveMapTreeBranch` ikişer kez var. Son tanım öncekini eziyor.

90. **[Orta · davranış] İkinci `refreshActiveMapTreeBranch` daha iyi olan ilk sürümü etkisiz bırakıyor.** İlk sürüm expanded alt dalları hatırlıyor; [`ikinci sürüm`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-tree.js#L930-L949) bu adımı atlıyor. Bağlantı/rename sonrası açık tree dalları kapanabilir.

91. **[Orta · kalite] Aynı-scope tekrarları modern lint parser’ında parsing error oluşturuyor.** Kaynak Node tarafından çalıştırılabilse de standart ESLint denetimi ikinci fonksiyon bildiriminde duruyor. Bu nedenle CI lint tabanı kurulmadan önce tekrarlar kaldırılmalı.

92. **[Düşük · kesin] Kullanılmayan kodlar var.** Lint; main’de `getConnectionRoleFromPort`, `getEdgeVisualTypeFromRoles`, `getNodeDocByIdInMap`; renderer’da `getDirectTreeRow`, `updateTreeAfterSavedConnection`, `updateMapBoxAfterRename`, `getEditableBaseName`, `getBaseName` gibi kullanılmayan fonksiyonları buldu.

93. **[Orta · kesin] Modal kapatma butonu kodda aranıyor fakat HTML’de yok.** [`kedi-node-modal.js:1-14`](https://github.com/maggezer/Kedi/blob/main/renderer/kedi-node-modal.js#L1-L14) `node-modal-close` bekliyor; HTML bu elementi içermiyor. Kullanıcı yalnızca overlay’e tıklayarak veya Escape ile, ikisinde de kaydederek kapatabiliyor.

94. **[Düşük · kesin] Başlık/save için eski DOM kodu ve CSS kalmış.** `node-modal-title`, `center-node-editor-title`, `center-node-editor-save` HTML’de yok fakat JS/CSS hâlâ bunları kullanmaya çalışıyor. Bunlar ya geri getirilmeli ya da ölü kod temizlenmeli.

95. **[Orta · erişilebilirlik] Tree ve map kontrolleri klavyeyle kullanılamıyor.** Tree satırları, node kutuları ve portlar `div/span`; `tabindex`, `role`, ok tuşu navigasyonu veya klavye bağlantı işlemi yok.

96. **[Orta · erişilebilirlik] Custom confirm gerçek dialog semantiği taşımıyor.** [`app.js:1870-1963`](https://github.com/maggezer/Kedi/blob/main/app.js#L1870-L1963) `role="dialog"`, `aria-modal`, focus trap ve önceki odağa dönüş uygulamıyor. Enter tuşu odak hangi butonda olursa olsun onay veriyor.

97. **[Düşük · kullanım] Editörlerde spellcheck kapalı.** Her iki `contenteditable` alan `spellcheck="false"` kullanıyor; uzun notlarda yazım desteği yok.

98. **[Orta · bakım] CSS yoğun biçimde üst üste yama yapılmış durumda.** Statik taramada en az 38 tek-satır selector birden fazla kez tanımlı; `#right-panel` 5, `.map-node-box` 4 kez geçiyor. Ayrıca 32 `!important` kullanımı var. Cascade davranışı tahmin edilmesi zorlaşıyor.

99. **[Düşük · kesin] Sağ panel tab scroll’u kendi kendine iptal ediliyor.** [`style.css:986-1002`](https://github.com/maggezer/Kedi/blob/main/style.css#L986-L1002) önce `overflow-x:auto`, sonra aynı blokta `overflow:hidden` ayarlıyor. Dar alanda tablar kaydırılmak yerine kesilebilir.

100. **[Orta · mimari] Global script yükleme sırası kırılgan.** `app.js`, tree, map, tags, calendar ve connections klasik scriptler olarak aynı global scope’u paylaşıyor. İsim çakışmalarının sessizce fonksiyon ezmesi bunun gerçekleşmiş örneği. ES modules veya en azından gerçek namespace/modül sınırları gerekli.

101. **[Orta · bakım] Ana dosyalar hâlâ çok büyük.** `main.js` 2669, `app.js` 2152, tags 1806, tree 1540 satır. Dosyalar ayrılmış olsa da domain bağımlılıkları ve global state hâlâ iç içe.

102. **[Yüksek · bağımlılık] Kilitli paketlerle `npm audit` sonucu 1 kritik ve 11 yüksek riskli dependency kaydı.** Doğrudan riskli paketler `electron@30.5.1` ve `electron-builder@24.13.3`; transitive tarafta `tar` kritik seviyede. Bunların çoğu build zinciri olsa da Electron doğrudan runtime bağımlılığı. Major upgrade ve tekrar audit gerekiyor.

103. **[Orta · kesin] Dört production dependency kodda hiç kullanılmıyor.** `@panzoom/panzoom`, `lunar-javascript`, `moment` ve `moment-hijri` yalnızca [`package.json`](https://github.com/maggezer/Kedi/blob/main/package.json) içinde var. Yaklaşık 6,3 MB açılmış dependency yükü ve gereksiz supply-chain yüzeyi oluşturuyor.

104. **[Yüksek · kalite] Test, lint, format ve typecheck komutu yok.** `package.json` yalnızca start/dist scriptleri içeriyor. Depoda test dosyası ve GitHub Actions workflow’u da yok. Paint ve proje geçişi gibi veri kaybı hatalarının fark edilmemesinin temel sebeplerinden biri bu.

105. **[Orta · release] Build yalnızca Windows x64 NSIS/portable hedefli.** ARM64, macOS/Linux paketleri, code signing, SmartScreen itibarı, artifact naming ve otomatik güncelleme ayarları yok.

106. **[Düşük · kesin] Runtime ve build app ID’leri farklı.** Package build `com.mumin.kedi`, [`main.js:9-10`](https://github.com/maggezer/Kedi/blob/main/main.js#L9-L10) ise `com.kedi.app` kullanıyor. Windows görev çubuğu/notification kimliği tutarsız olabilir.

107. **[Orta · depo yapısı] Root dışında `w1`, `w2`, `w3` adında üç ayrı uygulama kopyası var.** Root build bunları paketlemiyor fakat VS Code’da yanlış klasörde `npm start` çalıştırmak çok kolay. Bu, daha önce yaşadığın “özellikler kayboldu/eski sürüm değil” karışıklığının doğrudan kaynağı.

108. **[Orta · kesin] `w2` ve `w3` bağımsız çalıştırılırsa assets eksik.** `kedi.png`, pencere butonları ve `kedi.ico` referansları var fakat klasörlerde `assets/` yok. Görseller kırılır ve Windows build icon adımında hata verir.

109. **[Orta · kesin] `w1` ve `w2` calendar modülünü içermiyor.** Root ve `w3` calendar kullanırken bu iki kopya eski davranışta. Dört klasörde aynı `1.0.0` package sürümünün bulunması hangi kopyanın güncel olduğunu anlaşılmaz hale getiriyor.

110. **[Orta · bakım] Eski sürümler klasör olarak değil Git branch/tag/release olarak tutulmalı.** `w1/w2/w3` toplamda yaklaşık 840 bin karakter tekrar kaynak taşıyor ve dört ayrı lock/package seti oluşturuyor. Bunları sürüm tag’lerine dönüştürmek depo ana ağacını belirgin biçimde sadeleştirir.

111. **[Orta · dokümantasyon] README mevcut yapıyı anlatmıyor.** Calendar scriptini saymıyor; `window.Kedi.state` yapısını “sonraki aşama” diye gösteriyor fakat kodda zaten var. Test listesi manuel ve sonuç kaydı yok.

112. **[Orta · dokümantasyon] `kedi-definition.md` gerçek dosya biçimiyle çelişiyor.** Doküman `.md` ve `_res` klasörlerinden söz ediyor; uygulama JSON tabanlı `.node/.map` ve `inv_/nd_` klasörleri kullanıyor.

113. **[Düşük · dokümantasyon] Güncelleme dosyası v0.2.5’te bitiyor fakat package 1.0.0.** Calendar, Excel, Paint, Missions ve diğer sonraki özellikler changelog’da yok.

114. **[Düşük · depo] Package `ISC` lisansı söylüyor fakat LICENSE dosyası yok.** Dağıtım yapılacaksa gerçek lisans metni depoya eklenmeli.

115. **[Düşük · depo] `.gitignore` çok dar.** `*.log`, coverage, `.DS_Store`, `Thumbs.db`, editor dosyaları ve ek build cache’leri yok. `node_modules/` ve `dist/` doğru biçimde hariç tutulmuş.

Kontrol sırasında kilitli dependency’lerle `npm ci --ignore-scripts`, bütün JS dosyalarında `node --check`, seçilmiş ESLint güvenlik/kalite kuralları ve `npm audit` çalıştırdım. Tam Electron GUI smoke testi bu çalışma ortamında Electron/Chromium ikilisi bulunmadığı ve binary indirmesi engellendiği için tamamlanamadı; bu nedenle toolbar drag gibi yalnızca gerçek pointer etkileşimiyle kesinleşebilecek birkaç davranışı hata listesine kesin bulgu olarak eklemedim.
