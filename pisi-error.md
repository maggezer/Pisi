

16. **[Orta · eksik] Satır/sütun ekleme üst sınırı yalnızca ilk tablo oluşturulurken uygulanıyor.** `+ Satır` ve `+ Sütun` işlemleri [`app.js:998-1022`](https://github.com/maggezer/Kedi/blob/main/app.js#L998-L1022) üzerinden sınırsız büyüyebiliyor. Satır/sütun silme, hücre biçimlendirme, referans güncelleme ve çoklu seçim de yok.

74. **[Orta · kesin] Node sidecar klasörleri oluşturuluyor fakat Paint/Excel kaynakları oraya yazılmıyor.** Paint PNG’si doğrudan node JSON’una base64 gömülüyor; bu yüzden sidecar klasörleri çoğunlukla boş. Dokümanda anlatılan kaynak klasörü mimarisi uygulanmamış.


92. **[Düşük · kesin] Kullanılmayan kodlar var.** Lint; main’de `getConnectionRoleFromPort`, `getEdgeVisualTypeFromRoles`, `getNodeDocByIdInMap`; renderer’da `getDirectTreeRow`, `updateTreeAfterSavedConnection`, `updateMapBoxAfterRename`, `getEditableBaseName`, `getBaseName` gibi kullanılmayan fonksiyonları buldu.


98. **[Orta · bakım] CSS yoğun biçimde üst üste yama yapılmış durumda.** Statik taramada en az 38 tek-satır selector birden fazla kez tanımlı; `#right-panel` 5, `.map-node-box` 4 kez geçiyor. Ayrıca 32 `!important` kullanımı var. Cascade davranışı tahmin edilmesi zorlaşıyor.


100. **[Orta · mimari] Global script yükleme sırası kırılgan.** `app.js`, tree, map, tags, calendar ve connections klasik scriptler olarak aynı global scope’u paylaşıyor. İsim çakışmalarının sessizce fonksiyon ezmesi bunun gerçekleşmiş örneği. ES modules veya en azından gerçek namespace/modül sınırları gerekli.

101. **[Orta · bakım] Ana dosyalar hâlâ çok büyük.** `main.js` 2669, `app.js` 2152, tags 1806, tree 1540 satır. Dosyalar ayrılmış olsa da domain bağımlılıkları ve global state hâlâ iç içe.

102. **[Yüksek · bağımlılık] Kilitli paketlerle `npm audit` sonucu 1 kritik ve 11 yüksek riskli dependency kaydı.** Doğrudan riskli paketler `electron@30.5.1` ve `electron-builder@24.13.3`; transitive tarafta `tar` kritik seviyede. Bunların çoğu build zinciri olsa da Electron doğrudan runtime bağımlılığı. Major upgrade ve tekrar audit gerekiyor.



104. **[Yüksek · kalite] Test, lint, format ve typecheck komutu yok.** `package.json` yalnızca start/dist scriptleri içeriyor. Depoda test dosyası ve GitHub Actions workflow’u da yok. Paint ve proje geçişi gibi veri kaybı hatalarının fark edilmemesinin temel sebeplerinden biri bu.

105. **[Orta · release] Build yalnızca Windows x64 NSIS/portable hedefli.** ARM64, macOS/Linux paketleri, code signing, SmartScreen itibarı, artifact naming ve otomatik güncelleme ayarları yok.

