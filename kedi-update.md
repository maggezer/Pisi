# KEDI Güncelleme Takip Dosyası
29-07-2026-1
w1,w2,w3 silindi.
Kedi-error.md ile hata takibi başlatıldı.

29-07-2026-2
**[Kritik · kesin] Paint çizimleri yeniden açıldığında yüklenmiyor ve sonradan tamamen silinebiliyor.**-hata düzeltildi.

29-07-2026-3
**[Kritik · kesin] Map silme sırası toplu veri kaybına açık.**-hata düzeltildi.
**[Kritik · kesin] Node silme de yanlış sırada ve geri alınamıyor.**-hata düzeltildi.
Map ve node silmeleri transaction düzenine alındı; dosyalar birlikte sistem çöp kutusuna taşınıyor ve hata halinde dosya ile bağlantı metadata değişiklikleri geri alınıyor.
