

16. **[Orta · eksik] Satır/sütun ekleme üst sınırı yalnızca ilk tablo oluşturulurken uygulanıyor.** `+ Satır` ve `+ Sütun` işlemleri [`app.js:998-1022`](https://github.com/maggezer/Kedi/blob/main/app.js#L998-L1022) üzerinden sınırsız büyüyebiliyor. Satır/sütun silme, hücre biçimlendirme, referans güncelleme ve çoklu seçim de yok.

74. **[Orta · kesin] Node sidecar klasörleri oluşturuluyor fakat Paint/Excel kaynakları oraya yazılmıyor.** Paint PNG’si doğrudan node JSON’una base64 gömülüyor; bu yüzden sidecar klasörleri çoğunlukla boş. Dokümanda anlatılan kaynak klasörü mimarisi uygulanmamış.


102. **[Yüksek · bağımlılık] Kilitli paketlerle `npm audit` sonucu 1 kritik ve 11 yüksek riskli dependency kaydı.** Doğrudan riskli paketler `electron@30.5.1` ve `electron-builder@24.13.3`; transitive tarafta `tar` kritik seviyede. Bunların çoğu build zinciri olsa da Electron doğrudan runtime bağımlılığı. Major upgrade ve tekrar audit gerekiyor.


104. **[Yüksek · kalite] Test, lint, format ve typecheck komutu yok.** `package.json` yalnızca start/dist scriptleri içeriyor. Depoda test dosyası ve GitHub Actions workflow’u da yok. Paint ve proje geçişi gibi veri kaybı hatalarının fark edilmemesinin temel sebeplerinden biri bu.

105. **[Orta · release] Build yalnızca Windows x64 NSIS/portable hedefli.** ARM64, macOS/Linux paketleri, code signing, SmartScreen itibarı, artifact naming ve otomatik güncelleme ayarları yok.

