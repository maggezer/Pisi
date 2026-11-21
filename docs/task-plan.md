# Pisi Görevler — Claude Code iş tanımı

Sürüm: 1 · 21-11-2026 · Repo: `maggezer/Pisi` · Hedef: görevin bütün bilgisinin tek dosyada (`.pisi/tasks.json`) durması, notların yalnız görev kimliği taşıması ve görevin her yerde bu kayıttan gösterilmesi

Bu belge repoda `docs/task-plan.md` olarak durur. Görev sisteminin yeniden kurulmasını faz faz tanımlar (G0–G10).
Mobil fazında [`docs/mobile-plan.md`](mobile-plan.md), senkron fazında [`docs/sync-plan.md`](sync-plan.md) kuralları da geçerlidir.
Plan, 21-11-2026'da yapılan iki incelemeye dayanır. Bulgular Ek A'da, uygulamada çalıştırılan senaryolar Ek B'dedir.

---

## 0. Çalışma biçimi (her oturumda geçerli)

1. Oturumun başında şunları oku: `CLAUDE.md`, bu belge, `pisi-definition.md`, `docs/single-source-of-truth.md`, `docs/domain-command-query.md`,
   `docs/atomic-mutations.md`, `docs/reversible-trash.md`. Fazın ayrıca okunacak dosyaları her fazda listelenmiştir.
   Mobil fazında (G8) `docs/mobile-plan.md` §0, §2 ve §3.6'yı, senkron fazında (G9) `docs/sync-plan.md` §0, §2 ve §3.10'u da oku.
2. **Her oturumda tek faz.** Fazlar sırayla yapılır. Önceki faz birleştirilmeden (merge) sonraki başlamaz.
3. Her faz **tek PR**dır (CLAUDE.md kural 1). Başlık Conventional Commits biçimindedir; kapsam `tasks`, `editor`, `shared`, `mobile` ya da `sync` olur.
   Örnek: `feat(tasks): görev servisi ve tasks.json sürüm 2`. Açıklamada madde kimlikleri yazılır (ör. `G2, GV4, GB1`).
4. CLAUDE.md'deki "Definition of Done" görev işleri için de geçerlidir. Ek koşullar §3.8'dedir.
5. G0 ve G10 dışındaki bütün fazlar birden fazla modüle dokunur: önce kısa bir uygulama planı yaz ve onay bekle (CLAUDE.md kural 5).
6. **Karar belirsizse sor, varsayma.** Hedef biçim ve kurallar için bu belge esastır. Belgede yazmayan bir davranışta bugünkü masaüstü
   davranışı korunur ve PR'da belirtilir.
7. **Geçiş kodu yazılmaz** (§1.3). Eski görev işaretini notlardan okuyup göreve çeviren ya da eski `tasks.json` alanlarını yeni alanlara
   taşıyan kod yoktur. Ama eski veri bozulmaz: tanınmayan alanlar korunur (GV12), eski not işareti silinmez.
8. Bir araç, erişim ya da komut çalışmazsa etrafından dolanan geçici çözüm kurma. Önce asıl sorunu çöz ya da açıkça bildir.
9. **Yeni bağımlılık eklemeden önce sor.**
10. Her PR açıklamasının sonuna aşağıdaki **oturum raporunu** ekle.

```text
### Oturum raporu
- Madde(ler): G?, GV?, GB?/GK?
- Yapılanlar: (kısa maddeler)
- Testler: (çalıştırılan komutlar ve sonuçları)
- Ölçümler: (görev işleminde .node okuma/yazma sayısı, süreler; ölçüm yoksa "yok")
- Ekran görüntüleri: (arayüz değiştiyse; CI artifact adı yeterli)
- Belgede olmayan, benim verdiğim kararlar:
- Bilinen eksikler / riskler:
- Mobile / senkrona etkisi: (yok / şu dosyalar, şu testler)
```

---

## 1. Bağlam

### 1.1 Bugünkü yapı (21-11-2026)

Bir görev bugün dört yerde, dört ayrı biçimde durur:

1. **Not HTML'i:** görev bloğunda `todo.<öncelik>.<GG-AA-YYYY|none>` etiketi, `data-pisi-todo-*` öznitelikleri (durum, tekrar, saat, son tarih,
   hatırlatma anı, sıra, bağımlılık), tamamlandıysa ayrı bir `done` etiketi ve başlık metni (`.pisi-todo-source`). Hatırlatma türü bir CSS
   sınıfıdır (`pisi-todo-reminder-…`).
2. **`.pisi/tasks.json`:** aynı alanların bir kopyası ve kaynak bilgisi (`source.nodePath`, `blockId`, `mapPath`, `nodeTitle`, `mapTitle`).
3. **Renderer'daki `missionIndex`:** görev kayıtlarından üretilen sahte "bloklar" (`taskToPisiMissionBlock`). Panel bunları çizer.
4. **Günlük notlarının yönetilen bölümü** (`PISI_DIARY_MANAGED_START…END`): o günün görevlerinin bir kopyası. Her görev değişikliğinde bütün
   günlük dosyalarına yeniden yazılır.

`tasks.json`'a yazan yollar: Quick Add (`task.capture.v1`), editör girdisi (`task.sync-projection.v1`, budamasız), panel işlemlerinden sonra
bütün notların taranmasıyla yapılan yansıtma (`task.sync-projection.v1`, budamalı), görev komutları (günlük onay kutusu, hatırlatma paneli,
gezinme onarımı), senkron, çöp kutusu, sürüm geçmişinden geri yükleme ve mobil.

Panelden kapalı bir notun görevi tamamlanınca izlenen yol:

```text
kart → nottaki HTML değişir ve not dosyaya yazılır → bütün .node dosyaları okunur (missionIndex = not blokları)
→ bloklar tekrar göreve çevrilir (kimliği olmayan blokta hata, tur iptal) → task.sync-projection.v1 (budamalı)
→ tasks.json → missionIndex yeniden kayıtlardan üretilir → panel
```

Aynı bilgi birden çok yerde duruyor ve birbirinin üzerine yazan birden çok yazar var. Ek A'daki hataların çoğu buradan çıkıyor.

### 1.2 İncelemenin sonucu

İki incelemede 14 hata uygulamada (Electron, CDP) doğrulandı, 15 sorun kodda görüldü (Ek A). Öne çıkanlar:

- Panelden ya da günlükten yapılan değişiklik çoğu durumda `tasks.json`'a ulaşmıyor ya da sonradan geri alınıyor; kullanıcıya hata
  gösterilmiyor (GB1–GB7, GB12).
- Açık olan nota Quick Add yapılınca not içeriği kayboluyor (GB8).
- Görev işlemleri bütün projeyi tarıyor; günlük dosyaları kendiliğinden oluşuyor ve yeniden düzenleniyor (GB9, GB10, GB13).
- Notu olmayan görevler masaüstünde tamamlanamıyor ve aranamıyor; sahte kaynak yüzünden iki cihazda da düzenlenemez hâle geliyor
  (GB4, GB5, GB11).
- Editördeki "Görev bloğu" ve `[ ]` kısayolu hiç görev oluşturmuyor (GB14).

Bu sorunlar tek tek düzeltilmek yerine görev modeli değiştirilerek kapatılacak.

### 1.3 Verilmiş kararlar (21-11-2026)

| Konu     | Karar                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Otorite  | Görevin bütün bilgisi `.pisi/tasks.json`'dadır: kimlik, başlık, durum, öncelik, bitiş tarihi, tekrar, hatırlatma, bağımlılık, sıra, bulunduğu not ve zaman damgaları. Bütün görevler bu tek dosyadadır. |
| Not      | Not, görevin yalnız kimliğini taşıyan bir blok tutar. Başlık, durum, tarih ve öncelik notta yazılmaz.                                                                                                   |
| Gösterim | Görev her yerde (not, panel, çalışma alanı, takvim, günlük, harita, arama, hatırlatma, mobil) bu kayıttan çizilir.                                                                                      |
| Blok     | Her görev notta ayrı bir bloktur ve kolay düzenlenmesi için blok üzerinden düzenlenir.                                                                                                                  |
| Geçiş    | Yok. Uygulamayı aktif kullanan yok; eski not işareti ve eski kayıt alanları için dönüştürücü yazılmaz.                                                                                                  |

### 1.4 Bu planda önerilen kararlar (PR incelemesinde değiştirilebilir)

| Konu         | Öneri                                                                                                                                                                                                        | Neden                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tarih        | Görevin tek bir günü vardır: `dueDate` (bitiş tarihi, `YYYY-MM-DD`) ve isteğe bağlı saat `dueTime` (`HH:MM`). `scheduledAt`, `deadline` ve `todoTag` kalkar.                                                 | Bugün aynı görevin günü dört yerde dört kuralla belirleniyor (GK1). Masaüstü Quick Add arayüzü de zaten tek tarih alanı gösteriyor. |
| Tekrar       | Tekrar eden görev tamamlanınca yeni kayıt açılmaz. Aynı görev bir sonraki tarihe ilerler, tamamlanan gün `completions` listesine yazılır.                                                                    | Notta yeni blok gerekmez; iki cihaz aynı tekrarı tamamlarsa aynı sonuç çıkar; tekrara özel kimlik kuralı kalkar.                    |
| Notsuz görev | Görevin bir notu olmak zorunda değildir (`noteId: null`). Inbox notu artık oluşturulmaz; panelde "Notsuz" süzgeci olur.                                                                                      | Inbox yalnız her görevin bir notta durması gerektiği için vardı.                                                                    |
| Not bağı     | Görev notunu yoluyla değil, `node_…` kimliğiyle tutar.                                                                                                                                                       | Yeniden adlandırma ve taşıma görevlere dokunmaz; yol yeniden yazma kodu kalkar.                                                     |
| Kimlik       | Yeni görev `task_<uuid>` alır. Yoldan türeyen `task_source_…` ve tekrardan türeyen kimlikler kalkar.                                                                                                         | Tek kimlik kuralı (GK12).                                                                                                           |
| Silme        | Silinen görev (bloğu silinince ya da panelden) çöp kutusuna gider ve geri yüklenebilir. Nottaki geri alma da görevi geri getirir.                                                                            | Projenin geri alınabilir silme kuralı (`docs/reversible-trash.md`).                                                                 |
| Başlık       | Düz metin, tek satır. Etiketler ve not bağlantıları G6'da kayıt üzerinden geri gelir.                                                                                                                        | Biçim notta değil kayıtta durduğu için.                                                                                             |
| Enter        | Görev bloğunda Enter alta yeni bir görev açar; boş görevde Enter görevi kaldırır ve satırı paragraf yapar.                                                                                                   | Madde ve numaralı listeyle aynı kural (`docs/editor-keyboard-rules.md`).                                                            |
| Günlük       | Günlük notuna görev bölümü yazılmaz. O günün görevleri günlük açıkken notun dışında bir görünüm olarak gösterilir. Günlük dosyası görevin tarihi yüzünden oluşmaz; kullanıcı o günü açınca oluşur (bugünkü). | GB10, GB13, `pisi-error.md` §4a ve §4b.                                                                                             |

---

## 2. Değişmez kurallar

Bu kurallar her fazda geçerlidir. Bir PR bunlardan birini çiğniyorsa bitmiş sayılmaz. Mobilde `docs/mobile-plan.md` V1–V10, senkronda
`docs/sync-plan.md` SV1–SV13 de geçerlidir.

- **GV1 · Tek kaynak:** Bir görev alanı yalnız `tasks.json`'a yazılır. Not, günlük, harita ya da başka bir dosya görev alanı taşımaz. Bellekteki
  görev listeleri yalnız önbellektir ve dosyaya geri yazılmaz (V1).
- **GV2 · Not bloğu yalnız kimliktir:** Görev bloğu, blok kimliği ve `data-pisi-task-id` dışında görev bilgisi taşımaz (§3.2). Editörün blok
  içine çizdiği görünüm kayıtta temizlenir.
- **GV3 · Görünümler yazmaz:** Panel, çalışma alanı, takvim, günlük, harita, arama, hatırlatma ve mobil ekranlar okurken ve gezinirken hiçbir
  dosyaya yazmaz.
- **GV4 · Tek yazma yolu:** Masaüstünde görev değişikliği yalnız ana süreçteki görev servisinin `task.*.v1` komutlarıyla yazılır; mobilde
  `TaskRepo` ve `ProjectWriter` ile. Her yazmadan hemen önce dosya yeniden okunur ve yalnız ilgili kayıtlar değişir (V5). Değişmeyen kayıt ve
  dosya yazılmaz (V4).
- **GV5 · Proje taraması yok:** Hiçbir görev işlemi bütün notları okumaz. Bir notun görev bloklarıyla ilgili iş yalnız o notta yapılır. Görev
  alanı değişikliği (başlık, durum, tarih…) hiçbir `.node` dosyasını okumaz ya da yazmaz. Project Integrity denetimi bu kuralın dışındadır
  (kullanıcının başlattığı, salt okunur bir işlem).
- **GV6 · Not ile görev:** Görevin notu `noteId`'dir; nottaki blok görevin o nottaki yeridir. Bir görevin en çok bir bloğu olur ve o blok
  `noteId`'deki nottadır. Ayrıntılı kurallar §3.3'tedir.
- **GV7 · Kimlik:** Kopyalama yeni kimlik verir; taşıma (kes ve yapıştır, not değiştirme) kimliği korur. Aynı kimlik iki blokta bulunmaz.
- **GV8 · Atomiklik:** Bir komutun yazdığı dosyalar (`tasks.json`, gerekiyorsa bir ya da iki not, çöp kutusu) tek atomik mutation içinde
  yazılır (`docs/atomic-mutations.md`).
- **GV9 · Açık not:** Açık bir nottaki blok değişikliği (ekleme, kaldırma, taşıma) editör üzerinden yapılır ve editörün kayıt yoluyla yazılır;
  ana süreç açık notu yazmaz. Görev alanı değişikliği notu hiç değiştirmez (SV4 ile uyumlu).
- **GV10 · Silme geri alınabilir:** Görev silme çöp kutusuna gider. Telefon görev silmez (V9).
- **GV11 · Bozuk dosya:** Okunamayan `tasks.json` ezilmez. Görevler salt okunur gösterilir, not bloklarında "Görevler okunamadı" yazar ve
  bloklar korunur (V7, SV10).
- **GV12 · Bilinmeyeni koru:** Tanınmayan kayıt alanları ve üst düzey anahtarlar aynen geri yazılır (V3). Eski sürümden kalan alanlar
  (ör. `source`, `todoTag`, `scheduledAt`) okunmaz ama silinmez.
- **GV13 · Tek kural, iki platform:** Görevin günü, kovası, tekrar sonrası tarihi, bağımlılık döngüsü ve süzgeçler `shared/task-*.mjs`'ten gelir.
  Masaüstü ve mobil aynı kodu çalıştırır.
- **GV14 · Bütünlük:** Bir görev işleminden sonra Project Integrity yeni bulgu vermez; mobilin yazdığı proje de vermez (V10).

---

## 3. Hedef tasarım

### 3.1 `tasks.json` sürüm 2

```json
{
    "version": 2,
    "updatedAt": "2026-11-21T09:00:00.000Z",
    "tasks": [
        {
            "id": "task_6f1c2a0e-1b7d-4c55-9a1e-2f9d6c0b8a11",
            "title": "Raporu gönder",
            "status": "todo",
            "priority": 3,
            "dueDate": "2026-11-24",
            "dueTime": "14:00",
            "repeat": "weekly",
            "completionOffsetDays": null,
            "reminderMode": "none",
            "reminderAt": null,
            "dependencies": [],
            "manualOrder": 1732179600000,
            "noteId": "node_0b6a3c1e-7d2f-4a8b-9c5e-1f2a3b4c5d6e",
            "durationMinutes": 0,
            "actualMinutes": 0,
            "completions": [{ "date": "2026-11-17", "at": "2026-11-17T16:02:11.000Z" }],
            "createdAt": "2026-11-10T08:00:00.000Z",
            "updatedAt": "2026-11-17T16:02:11.000Z",
            "completedAt": null
        }
    ]
}
```

| Alan                                    | Kural                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                    | `task_<uuid>`; değişmez.                                                                                                                                                                                                                 |
| `title`                                 | Düz metin, tek satır; boşluklar sadeleşir; en çok 500 karakter. Yeni yazılan görevde boş olabilir.                                                                                                                                       |
| `status`                                | `todo`, `doing`, `waiting`, `blocked`, `done`.                                                                                                                                                                                           |
| `priority`                              | 1–5.                                                                                                                                                                                                                                     |
| `dueDate`, `dueTime`                    | `YYYY-MM-DD` ve `HH:MM` ya da `null`. Saat yalnız tarih varken anlamlıdır. Görevin günü her yerde `dueDate`'tir.                                                                                                                         |
| `repeat`, `completionOffsetDays`        | `none`, `daily`, `weekdays`, `weekly`, `biweekly`, `monthly`, `after-completion`; sonuncusu için gün sayısı. Sonraki tarih bugünkü `getNextPisiTodoDate` kuralıyla `dueDate`'ten hesaplanır.                                             |
| `completions`                           | Yalnız tekrar eden görevde: tamamlanan her tekrarın günü (`date`) ve anı (`at`). Tekrarsız görevde boş liste.                                                                                                                            |
| `reminderMode`, `reminderAt`            | Bugünkü kural: `reminderAt` (yerel `YYYY-MM-DDTHH:MM`) önceliklidir; yoksa `due-morning`, `day-before`, `three-days-before` `dueDate`'ten Ayarlar'daki saatle türetilir. Tekrar ilerleyince `reminderAt` de aynı gün sayısı kadar kayar. |
| `dependencies`                          | Başka görevlerin kimlikleri; görevin kendisi ve döngü kabul edilmez.                                                                                                                                                                     |
| `manualOrder`                           | Elle sıralama değeri.                                                                                                                                                                                                                    |
| `noteId`                                | Görevin bulunduğu notun `node_…` kimliği ya da `null`.                                                                                                                                                                                   |
| `durationMinutes`, `actualMinutes`      | Tahmini ve gerçek süre (0 = yok).                                                                                                                                                                                                        |
| `createdAt`, `updatedAt`, `completedAt` | ISO zaman damgaları; `completedAt` yalnız tekrarsız ve `done` görevde doludur.                                                                                                                                                           |

Ana süreç ve mobil `version` 1 ve 2'yi okur, 2 yazar. Sürüm 1 kaydındaki eski alanlar (`source`, `todoTag`, `scheduledAt`, `deadline`) okunmaz
ve korunur (GV12); böyle bir kayıt notsuz bir görev olarak görünür.

### 3.2 Not içindeki görev bloğu

```html
<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_…" data-pisi-block-type="task" data-pisi-task-id="task_…" contenteditable="false"></div>
```

- Bloğun içi boştur. Editör notu açınca bloğun içini görev kaydından çizer (onay kutusu, başlık alanı, tarih/öncelik/tekrar/hatırlatma çipleri)
  ve kayıtta yukarıdaki biçime döndürür. Dosya ve görsel bloklarındaki gibi bu çizim geçicidir.
- Blok HTML'ini yalnız `shared/task-blocks.mjs` üretir ve okur. Masaüstü, mobil, dışa aktarma ve Integrity bu modülü kullanır.
- Kaydı bulunmayan blok "Görev bulunamadı" gösterir ve korunur (Integrity bulgusu verir). `tasks.json` okunamıyorsa bloklar "Görevler okunamadı"
  gösterir (GV11).
- Eski `todo.*` etiketi ve `data-pisi-todo-*` öznitelikleri görev olarak tanınmaz; eski bir notta sıradan etiket ve metin olarak görünür (§1.3).

### 3.3 Not ile görev ilişkisi

| Olay                                                                              | Ne olur                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Notta yeni görev (slash komutu, `[ ]`, blok türü, Enter, Quick Add'de not seçmek) | Önce `task.create.v1` (`noteId` = not), sonra blok nota girer. Not açıksa bloğu editör ekler ve kaydeder; kapalıysa ana süreç aynı komutta yazar.                                    |
| Görev bloğu silinir (Backspace, seçip silme, kesme)                               | Not kaydında ana süreç kayıttan önceki ve sonraki içerikteki görev kimliklerini karşılaştırır. Nottan çıkan ve `noteId`'si bu not olan görev aynı mutation'da çöp kutusuna gider.    |
| Kes ve başka nota yapıştır                                                        | Yapıştırılan kimlik çöp kutusundaysa geri gelir ve `noteId` yeni not olur. Kimlik korunur.                                                                                           |
| Kopyala ve yapıştır, blok çoğaltma                                                | Pano görev kaydını da taşır. Yapıştırılan kimlik canlıysa yeni kimlikle bir kopya görev açılır (bugünkü yapıştırma kimlik kuralı, `docs/editor-paste-rules.md`).                     |
| Not içinde blok taşıma                                                            | Görev değişmez.                                                                                                                                                                      |
| Panelden "Nota taşı" ya da "Nottan çıkar"                                         | `task.move.v1`: iki notun bloğu ve kaydın `noteId`'si birlikte değişir.                                                                                                              |
| Not çöp kutusuna gider                                                            | `noteId`'si o not olan görevler notla aynı çöp kutusu öğesine arşivlenir ve geri yüklemede birlikte döner (bugünkü davranış; yola göre değil kimliğe göre).                          |
| Not yeniden adlandırılır ya da taşınır                                            | Görev değişmez.                                                                                                                                                                      |
| Not kopyalanır (haritada kopya)                                                   | Kopyadaki her görev yeni kimlikle kopyalanır; aynı mutation.                                                                                                                         |
| Senkron çakışma kopyası                                                           | Kopyaya görev blokları girmez; görevler asıl notta kalır. Bloklarda metin olmadığı için metin kaybı olmaz (SV3).                                                                     |
| Not sürüm geçmişinden geri yükleme                                                | Geri gelen bloğun görevi canlıysa ve başka bir notta değilse blok olduğu gibi kalır; çöp kutusundaysa görev geri gelir; hiçbir yerde yoksa blok "Görev bulunamadı" gösterir.         |
| `tasks.json` geçmişinden geri yükleme                                             | Kayıtlar geri gelir, notlara yazılmaz. Notunda bloğu olmayan görev için not açılınca "Bu nota ait N görev notta görünmüyor" uyarısı ve "Sona ekle" / "Notsuz yap" seçenekleri çıkar. |
| Aynı kimlik başka bir notta da varsa (yapıştırma kuralını atlayan bir yol)        | Kayıt reddedilmez, görev taşınmaz; Integrity "çift referans" bulgusu verir ve onarım önerir.                                                                                         |

Uzlaştırma yalnız kullanıcının not kaydında (editör kaydı) çalışır. Senkronla gelen not değişikliğinde çalışmaz; görev değişikliği o turda
`tasks.json` ile zaten gelir.

### 3.4 Görev komutları

| Sözleşme                              | Tür     | Ne yapar                                                                                                         |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `task.list.v1`                        | query   | Bütün görevler, dosya sürümü ve `readOnly` bilgisi.                                                              |
| `task.create.v1`                      | command | Yeni görev. `noteId` ile `notePath` ve `afterBlockId` verilirse ve not kapalıysa blok da eklenir. Kimliği döner. |
| `task.update.v1`                      | command | Alan değişikliği (`noteId` dışında).                                                                             |
| `task.complete.v1` / `task.reopen.v1` | command | Tekrar kuralıyla tamamlar ya da geri açar; geri alma bilgisi döner.                                              |
| `task.move.v1`                        | command | Notunu değiştirir ya da notsuz yapar; kapalı notlarda blokları taşır.                                            |
| `task.delete.v1`                      | command | Görevi çöp kutusuna taşır; not kapalıysa bloğu kaldırır.                                                         |
| `task.batch.v1`                       | command | Birden çok alan değişikliği tek yazmada (sıralama, geri alma).                                                   |

Notu değiştiren komutlar notun yolunu ve kimliğini birlikte alır; ana süreç dosyadaki `pisi.id` ile doğrular (`path-security.js` kuralları
geçerlidir).

Ana süreç her yazmadan sonra renderer'a `pisi:tasks-changed` olayını yollar: `{ version, changedIds, removedIds, source }`. `source` değeri
`local`, `sync` ya da `external` olur.

Kalkanlar: `task.capture.v1`, `task.upsert.v1`, `task.sync-projection.v1`, `window.pisiProject.quickAddTask` ve onun `op` seçicisi,
`project:sync-diary-missions`.

### 3.5 Önbellek ve güncelleme

- Ana süreç `tasks.json`'u okur ve bellekte tutar. Kendi yazmasında ve izleyicinin bildirdiği dış değişiklikte (senkron dahil) yeniler.
- Renderer görev deposu (`renderer/tasks/pisi-task-store.mjs`) açılışta bir kez listeler. Sonra yalnız `pisi:tasks-changed` olayındaki kayıtları
  günceller ve `pisi:task-store-updated` olayını `{ changedIds }` ile yayar.
- Yüzeyler yalnız etkilenen öğeleri yeniden çizer: açık nottaki ilgili bloklar, paneldeki ilgili kartlar, takvimin ilgili günleri.
- Not kimliğinden yola ve başlığa çeviri renderer'da belge dizininden (ağaç ve arama dizini) gelir. Ana süreç bunun için ayrı bir dizin tutmaz;
  notu değiştiren komutlar yolu ve kimliği birlikte alır.

### 3.6 Yüzeyler

| Yüzey                                                                            | Okur                                                                                          | Yazar                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Not editörü                                                                      | Görev bloğunu kayıttan çizer                                                                  | Başlık, durum, çipler: `task.update` / `task.complete`; blok ekleme ve silme: §3.3 |
| Görev paneli ve çalışma alanı (liste, kanban, takvim, zaman çizelgesi, ilerleme) | `shared/task-views.mjs`                                                                       | `task.*` komutları                                                                 |
| Görev ayrıntısı (pencere)                                                        | Bütün alanlar                                                                                 | `task.update`, `task.move`, `task.delete`                                          |
| Quick Add                                                                        | —                                                                                             | `task.create` (notsuz ya da seçilen not)                                           |
| Takvim                                                                           | Ortak gün kuralı; geçmiş günlerde `completions` de sayılır                                    | —                                                                                  |
| Günlük                                                                           | O günün görevleri, notun dışında bir görünüm                                                  | Onay kutusu: `task.complete`                                                       |
| Harita                                                                           | Not başına açık, geciken ve engelli görev sayısı ve bağımlılık katmanı (`noteId`)             | —                                                                                  |
| Arama                                                                            | Notsuz olanlar dahil her görev, tek kayıt üreticisinden                                       | —                                                                                  |
| Hatırlatma (ana süreç ve panel)                                                  | `reminderAt`, `reminderMode`, `dueDate`                                                       | Tamamla: `task.complete`                                                           |
| Dışa aktarma                                                                     | Görev bloğu kayıttan yazılır (Markdown'da `- [ ] Başlık`, HTML/PDF/DOCX'te onay kutulu satır) | İçe aktarmada `- [ ]` satırları görev olur                                         |
| Bul ve değiştir                                                                  | Nottaki görev başlıkları da bulunur                                                           | Değiştirme `task.update` ile; tek geri alma adımı                                  |
| Mobil                                                                            | Aynı kayıtlar; not görünümünde blok kimlikle bulunur                                          | `TaskRepo`                                                                         |
| Senkron                                                                          | `tasks.json` alan alan birleşir                                                               | `completions` tamamlanan güne göre birleşir (G9)                                   |

### 3.7 Modüller

Yeni:

- `shared/task-model.mjs` (sürüm 2: kayıt kuralları, tamamlama ve geri açma, bağımlılık döngüsü, alan doğrulama), `shared/task-views.mjs`
  (görev günü, kovalar, süzgeç ve sıralama, takvim özeti, ilerleme), `shared/task-blocks.mjs` (blok HTML'i, nottaki görev kimlikleri, üyelik
  farkı, blok ekleme ve kaldırma; DOM'suz, `shared/html-tokens.mjs` üstünde).
- `main/functions/task-store.js` (sürüm 2 dosya okuma ve yazma) ve `main/functions/task-service.js` (komutlar, atomik yazma, olaylar, not
  kaydında uzlaştırma, çöp kutusu).
- `renderer/tasks/`: `pisi-task-store.mjs`, `pisi-task-actions.mjs` (açık ve kapalı not ayrımı, GV9), `pisi-task-block.mjs` (editör bloğu ve
  klavye kuralları), `pisi-task-panel.mjs`, `pisi-task-views.mjs` (kanban, takvim, zaman çizelgesi, ilerleme), `pisi-task-detail.mjs`,
  `pisi-task-quick-add.mjs`, `pisi-task-diary.mjs`.

Kalkacaklar (G2–G7):

- `renderer/tags/pisi-todo-*.mjs` (11 dosya), `renderer/tags/pisi-task-store.mjs`, `renderer/tags/pisi-source-of-truth.mjs`; `pisi-tag-panels.mjs`,
  `pisi-tag-index.mjs`, `pisi-tag-editor.mjs` ve `pisi-editor-blocks.mjs` içindeki görev kodu.
- `renderer/productivity/pisi-quick-add-repeat-policy.mjs`; `pisi-quick-capture.mjs`'teki görev formu `renderer/tasks/`'a taşınır.
- `renderer/calendar/pisi-calendar-diary.mjs`'teki yönetilen bölüm tıklamaları; `pisi-calendar-ui.mjs`'teki `missionIndex` yolu.
- `main/functions/task-capture.js`, `source-of-truth.js`, `task-reference-integrity.js`, `task-reference-operation-hooks.js`;
  `document-store-diary.js`'teki yönetilen bölüm (`syncDiaryMissions`); `store-history.js`'teki görev bloğu üretimi; `map-node-copy-core.js`'teki
  kimlik silme; `sync-client-desktop.js`'teki görev durumu koruması (SV13).
- Görev işaretini regex ile okuyan testler (`tests/todo-*.test.js` ve benzerleri); yerlerine davranış testleri gelir.

### 3.8 Görev PR'ları için ek "bitti" koşulları

- Kökte `npm run validate` geçer. Masaüstü arayüzüne dokunulduysa `xvfb-run -a npm run test:e2e` geçer. Mobile dokunulduysa
  `npm --prefix mobile run validate` ve `npm --prefix mobile run e2e` geçer. Senkron davranışı değiştiyse `npm run test:sync-server` (G9'da matris
  de) geçer.
- Her faz kendi Electron E2E'sini `scripts/electron-tasks-<konu>-e2e.mjs` olarak yazar ve `package.json` `test:e2e` listesine ekler. Fazın
  kapattığı Ek B senaryoları bu E2E'dedir.
- E2E, bir görev alanı değişikliği sırasında `.node` okuma ve yazma sayısını sayar; sayı 0 olmalıdır (GV5).
- E2E her senaryodan sonra Project Integrity'nin yeni bulgu vermediğini denetler (GV14).
- Dokunulan dosyayı kapsayan regex testleri davranış testine çevrilir ya da silinir (CLAUDE.md kural 3).
- Dosya biçimi değişen fazda `pisi-definition.md` ve `docs/single-source-of-truth.md` aynı PR'da güncellenir. Masaüstü fixture'ı
  (`tests/fixtures/desktop-project/`) README'deki yolla yeniden üretilir; elle düzenlenmez.
- Kapanan bulgu `pisi-error.md`'den çıkarılır ve `pisi-update.md`'ye tarihli girişle yazılır; girişte bunun görev işi olduğu ve faz kimliği
  belirtilir.
- Yeni ya da değişen kullanıcı metinleri TR ve ENG locale'lere eklenir.

---

## 4. Fazlar

Her faz: amaç → okunacaklar → yapılacaklar → kabul kriterleri. Madde kimlikleri PR'larda kullanılır.

### G0 · Planı repoya ekle

- `docs/task-plan.md` (bu belge) eklenir. `CLAUDE.md`'ye kısa bir "Görevler" bölümü, `pisi-error.md`'ye incelemenin doğrulanan bulguları (§5h),
  `pisi-update.md`'ye tarihli bir giriş yazılır.
- **Kabul:** yalnız belge değişikliği olur; `npm run validate` geçer.

### G1 · Saf görev çekirdeği: `shared/task-*.mjs`

**Amaç:** iki platformun kullanacağı sürüm 2 kurallarını, G/Ç olmadan ve test edilmiş olarak kurmak.

**Oku:** `shared/task-model.mjs`, `shared/task-views.mjs`, `shared/ids.mjs`, `shared/note-blocks.mjs`, `shared/html-tokens.mjs`,
`shared/date-parser.mjs`, `scripts/shared-purity.js`, `mobile/src/data/task-repo.mjs`, `mobile/src/screens/notes/note.mjs` (`drawTask`).

**Önce plan yaz, onay bekle.**

1. `task-model.mjs`: §3.1'deki kayıt kuralları (`normalizePisiTask(payload, existing, { now, makeUuid })`); bilinmeyen alanlar korunur.
2. `completePisiTask(task, { now })` ve `reopenPisiTask(task, undo)`: tekrarsız görev `done` olur; tekrar eden görev `completions`'a yazılır,
   `dueDate` sonraki tarihe ilerler, `reminderAt` kayar ve durum `todo` kalır. Dönüş geri alma bilgisini içerir.
3. `findPisiTaskDependencyCycle(tasks, taskId, dependencyIds)`.
4. `task-views.mjs`: görevin günü (`dueDate`), kovalar (geciken, bugün, yaklaşan, sonra, tarihsiz), süzgeçler (bunlar ve notsuz, tamamlanan),
   sıralamalar (iş sırası, öncelik, elle sıra), takvim özeti (`completions` dahil) ve ilerleme sayıları.
5. `task-blocks.mjs`: `makePisiTaskBlockHtml`, `listPisiTaskBlocks(html)`, `diffPisiTaskMembership(before, after)`,
   `insertPisiTaskBlock(html, block, { afterBlockId })`, `removePisiTaskBlock(html, taskId)`, `stripPisiTaskBlocks(html)` (çakışma kopyası için).
6. `note-blocks.mjs`: §3.2'deki blok korumalı bir `task` segmentidir ve `segment.taskId` taşır. Mobilin not görünümü görevi bu kimlikle bulur.
7. Eski dışa açık fonksiyonlar (görev etiketi dilbilgisi vb.) bu fazda silinmez; kullanan kod G2 ve G8'de kalkınca silinir.

**Kabul:**

- `npm run validate` ve `npm --prefix mobile run validate` geçer; `check:architecture` shared saflığını onaylar.
- Her kural örnekli testle sınanır (`tests/shared-task-*.test.mjs`). Tohumlu rastgele 1.000 durumda: tamamla ve geri aç kaydı aynen geri verir;
  `diffPisiTaskMembership` ile `insertPisiTaskBlock` / `removePisiTaskBlock` birbirini tutar; blok dışındaki baytlar değişmez.
- `tests/mobile-desktop-compat.test.mjs` değişmeden geçer.

### G2 · Görev servisi ve `tasks.json` sürüm 2

**Amaç:** bütün görev yazmalarının tek servisten, atomik ve doğru geçmesi; yansıtma yollarının, Inbox'ın ve günlük yönetilen bölümünün kalkması.

**Oku:** `main/functions/task-store.js`, `task-capture.js`, `source-of-truth.js`, `domain-command-query.js`, `atomic-mutation*.js`,
`atomic-domain-hardening.js`, `trash-store.js`, `project-integrity-authorities.js`, `reminder-*.js`, `store-history*.js`,
`document-store-diary.js`, not kaydı yolu (`document-store*.js`), `sync-client-desktop.js` (görev koruması), `preload.js`,
`renderer/domain/pisi-domain-client.mjs`, `renderer/productivity/pisi-quick-capture.mjs`, `scripts/electron-mobile-fixture-e2e.mjs`,
`tests/fixtures/README.md`.

**Önce plan yaz, onay bekle.** Bu planın en büyük fazıdır.

1. `task-store.js`: sürüm 1 ve 2 okunur, 2 yazılır; bozuk dosya salt okunur (GV11).
2. `task-service.js`: §3.4 komutları; her biri tek atomik mutation (GV8); `pisi:tasks-changed` olayı; kapalı nota blok ekleme ve kaldırma
   `shared/task-blocks.mjs` ile.
3. Not kaydında üyelik uzlaştırması (§3.3): nottan çıkan görev çöp kutusuna gider, çöp kutusundaki bir kimlik nota gelirse görev geri döner.
   Senkron uygulamasında çalışmaz.
4. Çöp kutusu: tek görevlik öğe türü; not silmede `noteId`'ye göre arşiv; geri yükleme.
5. Project Integrity görev bulguları: kaydı olmayan blok (yetim), bloğu olmayan görev (evsiz), olmayan not, çift referans, bağımlılık döngüsü,
   geçersiz alan. Onarım arayüzü G7'dedir.
6. Hatırlatma servisi sürüm 2 alanlarıyla çalışır; hatırlatma girdisi `nodePath` ve `blockId` yerine `noteId` taşır.
7. `tasks.json` sürüm geçmişi sürüm 2 kayıtlarla çalışır; geri yükleme notlara blok yazmaz (§3.3).
8. Günlük yönetilen bölümü kalkar (`syncDiaryMissions`, `project:sync-diary-missions`, bölüm üreticisi). Eski günlüklerdeki bölümlere dokunulmaz.
9. Inbox oluşturma ve `task-capture.js` kalkar. Quick Add formu `task.create.v1`'e bağlanır; `pisi-quick-add-repeat-policy.mjs` kalkar ve formun
   Türkçe tarih alanı geri gelir (ayrıştırılan gün `dueDate`, saat `dueTime` olur). Açık bir not seçilirse görev G3'e kadar notsuz oluşturulur
   ve kullanıcıya söylenir (GV9).
10. Kalkanlar (§3.4, §3.7): eski komutlar, `quickAddTask` ve `op` seçicisi, `source-of-truth.js`, yol yeniden yazma kancaları,
    `sync-client-desktop.js` görev durumu koruması. `docs/sync-plan.md` SV13 "yansıtma yazması yoktur" diye yeniden yazılır.
11. Renderer: eski görev modülleri bootstrap'tan çıkarılır ve silinir. Yerine `renderer/tasks/pisi-task-store.mjs` gelir; sağ panelde geçici,
    sade bir liste (başlık, gün, onay kutusu, notu aç) ve not editöründe görev bloğunun salt okunur geçici çizimi (onay kutusu ve başlık) olur.
    Tam panel G4'te, düzenlenebilir blok G3'tedir. Editörün eski görev komutları (`todo` etiketi seçicisi, `done` komutu) kapatılır.
12. `pisi-definition.md` görev bölümü, `docs/single-source-of-truth.md` ve `docs/domain-command-query.md` güncellenir. Masaüstü fixture'ı
    yeniden üretilir; görevler `task.create.v1` ile oluşturulur (notta, notsuz, tekrar eden, tamamlanmış).

**Kabul:**

- `scripts/electron-tasks-service-e2e.mjs`: Ek B'deki S1–S6, S9 ve S17 komut düzeyinde geçer.
- Görev alanı değişikliğinde `.node` okuma ve yazma sayısı 0'dır; 1.000 notluk projede tamamlama tam tarama yapmaz (S8).
- Ortasında hata enjekte edilen bir komut projeyi komut öncesi ya da sonrası durumda bırakır.
- `tests/mobile-desktop-compat.test.mjs` yeni fixture'la geçer; mobilin sürüm 1 yazdığı dosya Integrity'de yeni bulgu vermez.
- Kapanan bulgular: GB1–GB7, GB9, GB10, GB13, GK4, GK5, GK11, GK12, GK14; `pisi-error.md` §4a ve §4b.

### G3 · Editörde görev bloğu

**Amaç:** görevin notta tek bir blok olarak oluşturulması, düzenlenmesi ve silinmesi; not dosyasına yalnız kimliğin yazılması.

**Oku:** `renderer/editor/pisi-block-editor.mjs`, `pisi-task-block-keyboard.mjs`, `pisi-block-keyboard-*.mjs`, `pisi-editor-history*.mjs`,
`pisi-editor-input-policy.mjs`, `pisi-find-replace.mjs`, `renderer/tags/pisi-paste-*.mjs`, `renderer/editor/pisi-editor-file-block.mjs`
(geçici çizim örneği), `renderer/map/pisi-map-workspace.mjs` (`getPisiEditorContent`), `renderer/sync/pisi-sync-live.mjs`,
`docs/editor-keyboard-rules.md`, `docs/editor-paste-rules.md`.

**Önce plan yaz, onay bekle.**

1. `renderer/tasks/pisi-task-block.mjs`: blok çizimi (onay kutusu, başlık alanı, çipler), kayıtta temizleme ve `pisi:task-store-updated` ile
   yerinde güncelleme. Çipe tıklayınca tarih, öncelik, tekrar ya da hatırlatma seçicisi açılır.
2. Oluşturma: `/görev` (`todo`) komutu, `[ ]` ve `[]` kısayolu, blok türü menüsü, araç çubuğu ve paragrafı göreve çevirme (metin başlık olur).
3. Başlık: tek satır; yazdıkça gecikmeli, odak çıkınca hemen `task.update.v1`; Türkçe ve IME bileşim kuralları (`pisi-editor-input-policy.mjs`).
4. Klavye: §1.4'teki Enter kararı; Backspace, Delete ve oklar blok sınırında. `docs/editor-keyboard-rules.md`'deki görev satırı yeniden yazılır.
5. Geri al ve yinele: not geçmişi o nottaki görevlerin alanlarını da saklar. Bir adım geri alınınca o adımda değişen alanlar `task.batch.v1` ile
   geri yazılır; silinen blok geri gelince görev çöp kutusundan döner.
6. Kopyala, kes, yapıştır ve blok çoğaltma (§3.3). Pano görev kaydını taşır (`application/x-pisi-tasks`); başka projeye yapıştırmada yeni kimlik
   verilir. `docs/editor-paste-rules.md` güncellenir.
7. Bul ve değiştir görev başlıklarında çalışır (§3.6).
8. Açık nota dışarıdan gelen blok değişikliği (`task.create`, `task.move`, `task.delete`, Quick Add) editör yolundan yapılır (GV9). Senkronla gelen
   not değişikliği (`pisi-sync-live.mjs`) görev bloklarını korur.
9. Not açılınca evsiz görev uyarısı (§3.3); "Görev bulunamadı" ve "Görevler okunamadı" görünümleri.

**Kabul:**

- `scripts/electron-tasks-editor-e2e.mjs`: S7, S13–S15. Başlık yazılıp kaydedilince not dosyasında yalnız §3.2 biçimi, `tasks.json`'da başlık
  bulunur; geri al tamamlamayı ve silmeyi geri getirir.
- `scripts/electron-editor-keyboard-e2e.mjs` ve `scripts/electron-editor-paste-e2e.mjs` yeni kurallarla geçer.
- Kapanan bulgular: GB8, GB14, GK2.

### G4 · Görev paneli, çalışma alanı ve Quick Add

**Amaç:** görevlerin bütün görünümlerde kayıttan çizilmesi ve her işlemin tek komutla yazılması.

**Oku:** G2'de silinen `renderer/tags/pisi-todo-*.mjs` modüllerinin davranışı (git geçmişi), `renderer/productivity/pisi-quick-capture.mjs`,
`shared/date-parser.mjs`, `styles/50-productivity.css` (görev stilleri), `pisi-error.md` §5e.

**Önce plan yaz, onay bekle.**

1. `pisi-task-panel.mjs`: sağ panel ve görev çalışma alanı aynı bileşendir. Süzgeçler (bugün, yaklaşan, geciken, tarihsiz, notsuz,
   tamamlananları göster), sıralama, durum seçimi, onay kutusu ve notu açma. Yalnız değişen kartlar yeniden çizilir; `MutationObserver` ile
   sonradan süsleme yoktur.
2. `pisi-task-views.mjs`: kanban (sütun değişince `task.update`), takvim, zaman çizelgesi ve ilerleme (`completions` dahil).
3. `pisi-task-detail.mjs`: bütün alanlar; bağımlılıkta döngü engeli; not seçimi (`task.move`); silme.
4. Sürükle ve bırakla sıralama tek bir `task.batch.v1` yazmasıdır.
5. Quick Add tek formdur: başlık, Türkçe tarih ifadesi ve önizlemesi, öncelik, not (isteğe bağlı), tekrar, hatırlatma. Gözlemci ya da
   `domain.command` sarmalayıcısı yoktur. Tarih ayrıştırıcı başlıktaki sayıları tarih saymaz (`pisi-error.md` §5e; düzeltme
   `shared/date-parser.mjs`'tedir, mobil de kullanır).
6. Erişilebilirlik: onay kutularının adları, klavyeyle gezinme; TR ve ENG metinler.

**Kabul:**

- `scripts/electron-tasks-panel-e2e.mjs`: S1–S4 arayüzden; kanbanda sütun değiştirme; ayrıntıda bağımlılık döngüsünün engellenmesi;
  sürükleyip sıralamada tek `tasks.json` yazması.
- 5.000 görevlik projede panelin ilk çizimi ve bir tamamlamanın ekrana yansıması ölçülür ve PR'a yazılır. Hedef: ilk çizim ≤ 300 ms,
  tamamlama ≤ 150 ms.
- Kapanan bulgular: GK6, GK7, GK8; `pisi-error.md` §5e.

### G5 · Görevleri gösteren diğer yüzeyler

**Amaç:** günlük, takvim, harita, arama, hatırlatma, gezinme, dışa aktarma ve kopyalamanın aynı kaydı kullanması.

**Oku:** `renderer/calendar/*`, `renderer/map/pisi-map-operational-render.mjs`, `renderer/search/pisi-search-enhanced-index.mjs`,
`renderer/search/pisi-search-index.mjs`, `renderer/tags/pisi-reminder-panel.mjs`, gezinme modülü (`pisi-todo-navigation.mjs`'in yerine
gelen), `main/functions/portability.js`, `main/functions/map-node-copy*.js`, `main/functions/store-history*.js`,
`renderer/portability/pisi-store-history-panel.mjs`.

**Önce plan yaz, onay bekle.**

1. `pisi-task-diary.mjs`: günlük açıkken o günün görevleri notun dışında gösterilir; onay kutusu `task.complete`. Günlük dosyası görev yüzünden
   oluşmaz ya da değişmez.
2. Takvim ortak özetten çizilir; `missionIndex` yolu kalkar.
3. Harita rozetleri ve bağımlılık katmanı `noteId`'ye göre çalışır; rozet metni TR ve ENG.
4. Arama: tek görev kaydı üreticisi; notsuz görevler dahil. Sonuçtan görev ayrıntısına ya da nottaki bloğa gidilir.
5. Hatırlatma paneli: "Tamamla" `task.complete`; açma `noteId` ve görev kimliğiyle.
6. Gezinme `noteId` ve `data-pisi-task-id` ile kesindir; tahmin ve yazma yoktur.
7. Dışa aktarma ve içe aktarma (§3.6).
8. Not kopyalama görevleri yeni kimlikle kopyalar.
9. Not sürüm geçmişinden geri yükleme §3.3'e uyar.

**Kabul:**

- `scripts/electron-tasks-surfaces-e2e.mjs`: S9–S12 ve S16; günlükten tamamlanan tekrar eden görev ilerler; arama notsuz görevi bulur; dışa
  aktarılan Markdown görev satırlarını içerir ve geri içe aktarılınca görev olur.
- `scripts/electron-reminders-e2e.mjs` ve `scripts/electron-store-history-e2e.mjs` yeni modelle geçer.
- Kapanan bulgular: GB10–GB13 (arayüz düzeyinde), GK3, GK9, GK10.

### G6 · Görevlerde etiket ve not bağlantısı

**Amaç:** başlık düz metne geçince kaybolan iki yeteneği kayıt üzerinden geri getirmek.

**Önce plan yaz, onay bekle.**

1. `tags` alanı (ör. `["proje", "acil"]`): görev bloğunda ve ayrıntıda çip olarak düzenlenir. Etiketler paneli etiketli görevleri de listeler
   (`tasks.json`'dan; tarama yok).
2. Başlıkta `[[Not]]` yazımı bağlantı olarak gösterilir. Bağlantılar paneli ve geri bağlantılar görevleri de sayar. Not yeniden adlandırılınca
   görev başlığındaki bağlantı da güncellenir (`shared/wiki-link-core.mjs`).

**Kabul:** etiket ve bağlantı için davranış testleri ve E2E; yeniden adlandırmada notlar ve görev başlıkları tek atomik mutation'da güncellenir.

### G7 · Bütünlük, onarım, ölçüm ve temizlik

**Önce plan yaz, onay bekle.**

1. Integrity arayüzünde görev bulgularının onarımları: yetim blok (çöp kutusundan geri getir ya da bloğu kaldır), evsiz görev (sona ekle ya da
   notsuz yap), olmayan not (notsuz yap), çift referans (kopyayı yeni göreve çevir), döngü (bağımlılığı kaldır).
2. Büyük proje ölçümü (`scripts/generate-project-fixture.mjs`'e notlarda görev bloğu seçeneği eklenir): 2.000 not ve 5.000 görevle proje açılışı,
   panel, 200 görev bloklu bir notun açılışı, tamamlama ve `completions` ile `tasks.json` boyutu. Sonuçlar bir zamanlama dosyasına yazılır.
3. Kalan eski kod, kullanılmayan CSS ve regex testleri kaldırılır; `module-manifest.json` dosyaları temizlenir.

**Kabul:** onarım E2E'si; ölçüm sonuçları PR'da; `check:architecture` ve `check:types` eski bağlamaları göstermez. Kapanan bulgular: GK1, GK13,
GK15.

### G8 · Mobil: sürüm 2 görevler

**Amaç:** mobilin aynı kayıt kurallarıyla çalışması ve not görevlerinde tam düzenleme.

**Oku:** `docs/mobile-plan.md` §0, §2, §3.6; `mobile/src/data/task-repo.mjs`, `mobile/src/screens/tasks/*`, `mobile/src/screens/pisi/*`,
`mobile/src/screens/notes/note.mjs`, `mobile/src/ui/task-add.mjs`, `mobile/src/screens/calendar/calendar-model.mjs`.

**Önce plan yaz, onay bekle.**

1. `TaskRepo` sürüm 2: kayıt kuralları ve tamamlama `shared/task-model.mjs`'ten gelir; tekrar eden görev yerinde ilerler; geri alma aynı bilgiyle
   yapılır; dosya `version: 2` yazılır.
2. Not görevlerinde bütün alanlar düzenlenir; `isNoteTask` kısıtı ve "Masaüstünde nottan düzenlenir" metni kalkar. `pisi-error.md` §5d kapanır.
3. Not görünümü görev bloğunu kimlikle çizer (G1). Not editöründe görev bloğu ekleme: önce `tasks.json`, sonra blok; öbür bloklar bayt bayt aynı
   kalır (V8).
4. Hızlı ekle G4'teki ayrıştırıcı düzeltmesiyle çalışır.
5. Günlük yönetilen bölümüyle ilgili artık gereksiz kod kalkar.

**Kabul:** `npm --prefix mobile run validate` ve `npm --prefix mobile run e2e` geçer; `tests/mobile-desktop-compat.test.mjs` geçer ve mobilin
yazdığı proje masaüstü Integrity'de yeni bulgu vermez; telefon görev silmez (V9). Kapanan bulgular: GB5 (mobil tarafı).

### G9 · Senkron

**Amaç:** yeni modelin iki cihazda metin ve görev kaybettirmeden birleşmesi.

**Oku:** `docs/sync-plan.md` §0, §2, §3.4, §3.10; `shared/sync-merge-authority.mjs`, `shared/sync-conflict.mjs`, `scripts/sync-e2e-matrix.mjs`,
`scripts/generate-sync-vectors.mjs`.

**Önce plan yaz, onay bekle.**

1. `completions` birleşimi: iki tarafın listesi tamamlanan güne göre birleşir; aynı günün iki tamamlaması çakışma sayılmaz. Test vektörleri
   yenilenir.
2. Çakışma kopyası görev bloklarını almaz (`stripPisiTaskBlocks`, §3.3).
3. Matris senaryoları: telefon tekrar eden görevi tamamlar ve masaüstü başlığını değiştirir; iki cihaz aynı tekrarı tamamlar (tek ilerleme);
   masaüstü görev bloğunu siler ve telefon aynı görevi düzenler (silme kazanır, kaybeden değer çakışma günlüğüne yazılır); telefon nota görev
   ekler; ileri tarihli görev iki cihazda da günlük dosyası oluşturmaz.
4. `docs/sync-plan.md` §3.4 güncellenir. Birleştirme kuralı istemcidedir; protokol sürümü değişmez.

**Kabul:** `npm run test:sync-server` ve `PISI_SYNC_MATRIX_E2E=1 npm run test:sync-server` geçer; iki cihaz en çok 4 turda durulur; her
senaryodan sonra iki tarafta Integrity yeni bulgu vermez.

### G10 · Cihazda kabul

- `docs/task-qa.md`: gerçek masaüstü, gerçek telefon ve kullanıcının sunucusuyla elle uygulanan kabul listesi (oluşturma yolları, tamamlama,
  tekrar, silme ve geri alma, kes ve yapıştır, günlük, takvim, arama, hatırlatma, iki cihaz).
- **Kabul:** kullanıcı listeyi uygular; bulunan hata `pisi-error.md`'ye yazılır.

---

## 5. Kapsam dışı

- Eski görev işaretini ve eski `tasks.json` alanlarını dönüştüren geçiş adımı (§1.3).
- Bir görevi birden çok notta blok olarak gösterme (yansıma bloğu). Görevin tek bir bloğu vardır; notun dışındaki yerlerde görünümler gösterir.
- Alt görev hiyerarşisi (girintiyle iç içe görev); bağımlılık listesi yeterlidir.
- Bases, özellikler ve rollup'larda görev sorgusu.
- Görev başlığında zengin metin (kalın, italik).
- Telefonda görev silme (V9).
- Tamamlanmış görevlerin ayrı bir arşiv dosyasına taşınması. `tasks.json` boyutu G7'de ölçülür; gerekirse ayrı bir kararla ele alınır.

---

## 6. Oturum başlatma metinleri

**Sonraki her oturum:**

```text
maggezer/Pisi reposunda çalışıyoruz. Önce CLAUDE.md ve docs/task-plan.md dosyalarını oku.
Sıradaki faz: G<numara>. Belgenin §0'daki çalışma kurallarına uy. Bu faz birden fazla modüle dokunuyorsa
önce uygulama planını yaz ve onayımı bekle. Bitince PR'ı oturum raporuyla aç ve dur.
```

**Mobil fazı (G8) için ek satır:**

```text
Bu faz mobil iştir: docs/mobile-plan.md §0, §2 ve §3.6'yı da oku ve uy.
```

**Senkron fazı (G9) için ek satır:**

```text
Bu faz senkron işidir: docs/sync-plan.md §0, §2 ve §3.10'u da oku ve uy.
```

---

## Ek A. İnceleme bulguları (21-11-2026)

**GB:** uygulamada (Electron, CDP) doğrulandı. **GK:** kodda görüldü, çalıştırılmadı.

| Kimlik | Bulgu                                                                                                                                                                                                                                                                                                                                                | Kapatan faz |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| GB1    | Kapalı nottaki (Inbox dahil) Quick Add görevi panelden tamamlanınca nota "done" yazılıyor, `tasks.json` "todo" kalıyor; panel işareti geri alıyor ve hata göstermiyor. Neden: tarama yansıtması kimliği olmayan Quick Add bloğunda duruyor.                                                                                                          | G2, G4      |
| GB2    | Kapalı nottaki tekrar eden görev tamamlanınca notta sonraki tekrarın bloğu oluşuyor; `tasks.json`'da ne tamamlama ne sonraki tekrar var.                                                                                                                                                                                                             | G2          |
| GB3    | Kapalı nottaki görevin panelden değişen durumu `tasks.json`'a ancak not açılıp düzenlenince geçiyor.                                                                                                                                                                                                                                                 | G2          |
| GB4    | Notu olmayan görev (mobilde oluşturulan) masaüstü panelinden tamamlanamıyor: "Görev node yolu bulunamadı."                                                                                                                                                                                                                                           | G2, G4      |
| GB5    | Başka bir panel işleminden sonra notu olmayan göreve sahte kaynak yazılıyor (`blockId: task-block-…`, `nodeTitle: Task`). Mobil bunu not görevi sayıp salt okunur yapıyor; görev iki cihazda da düzenlenemiyor. Masaüstü fixture'ındaki iki görev bu durumda.                                                                                        | G2, G8      |
| GB6    | Hatırlatmadan tamamlanan görev, not sonradan düzenlenince yeniden "todo" oluyor (`'done'` panelin durum listesinde yok; nottaki işaret eski kalıyor).                                                                                                                                                                                                | G2          |
| GB7    | Projede kimliksiz bir Quick Add bloğu varken notta silinen görev bloğu `tasks.json`'da ve panelde kalıyor (yetim görev).                                                                                                                                                                                                                             | G2          |
| GB8    | Açık olan nota Quick Add: editör bloğu göstermiyor; kullanıcı yazıp kaydedince blok dosyadan siliniyor ve görev yetim kalıyor (not içeriği kaybı).                                                                                                                                                                                                   | G3          |
| GB9    | Her panel işlemi ve not kaydı bütün notları yeniden okuyor; 1.000 notta tarama ~1,5 sn sürüyor.                                                                                                                                                                                                                                                      | G2          |
| GB10   | Tarihi olan her görev o gün için bir günlük dosyası oluşturuyor (2027 ve 2028 tarihli görevler için `diary/2027-03-15.node` ve `diary/2028-01-02.node`).                                                                                                                                                                                             | G2, G5      |
| GB11   | Notu olmayan görevler masaüstü aramasında görünmüyor.                                                                                                                                                                                                                                                                                                | G5          |
| GB12   | Günlükteki onay kutusuyla tamamlanan tekrar eden görevin sonraki tekrarı oluşmuyor; görev tekrar etmeyi bırakıyor.                                                                                                                                                                                                                                   | G2, G5      |
| GB13   | Günlük eşitlemesi, günlük notundaki kullanıcı görev bloğunu yerinden alıp dosyaya yazdığı sabit Türkçe "Görevler" başlığının altına taşıyor.                                                                                                                                                                                                         | G2, G5      |
| GB14   | `[ ]` kısayolu ve blok türünü "Görev bloğu" yapma, girdi hattında (`cleanupOrphanPisiTodoBlock`) hemen paragrafa dönüyor; görev oluşmuyor.                                                                                                                                                                                                           | G3          |
| GK1    | Görevin günü dört kuralla belirleniyor: panel etiket tarihi; takvim, günlük ve mobil `scheduledAt → dueDate → deadline`; hatırlatma `dueDate → deadline`; arama `deadline → dueDate → scheduledAt`. Editörde etiket tarihi değişince `scheduledAt` eski kalıyor. `scheduledAt` bazen yalnız tarih, bazen tarih ve saat.                              | G1, G2, G7  |
| GK2    | Not içinde blok bulunamazsa `findPisiMissionBlockInContainer` aynı etiketli başka bir bloğu seçiyor; başka bir görev işaretlenebiliyor.                                                                                                                                                                                                              | G3          |
| GK3    | Gezinmede blok bulunamazsa proje genelinde benzer metinli bir blok seçilip görevin kaynağı olarak `tasks.json`'a yazılıyor (`repairPisiCanonicalTaskSource`).                                                                                                                                                                                        | G5          |
| GK4    | Tam tarama eksik blok kimliklerini notlara yazıyor (`persistPisiAssignedBlockIds`); senkronda gereksiz değişiklik üretiyor.                                                                                                                                                                                                                          | G2          |
| GK5    | Yansıtma yazmasına 3,5 saniyelik "yazma niyeti" penceresinde izin veriliyor.                                                                                                                                                                                                                                                                         | G2          |
| GK6    | Quick Add politikası (`pisi-quick-add-repeat-policy.mjs`) bütün `body`'yi izleyen bir `MutationObserver` ile formu değiştiriyor; Türkçe tarih ve süre alanlarını siliyor, kartlardaki tekrar düğmelerini kaldırıyor ve `domain.command`'ı sarıp `deadline`, `reminderAt` ve süreleri boşaltıyor. Arayüzden eklenen görevde hatırlatma ayarlanamıyor. | G2, G4      |
| GK7    | Panel üç katmanla çiziliyor; ikinci ve üçüncü katman listeyi `MutationObserver` ile sonradan süslüyor; kart görünümü çizilmiş metni regex'le okuyup yeniden biçimliyor.                                                                                                                                                                              | G4          |
| GK8    | Sürükle ve bırakla sıralama listedeki her görev için ayrı bir not kaydı yapıyor.                                                                                                                                                                                                                                                                     | G4          |
| GK9    | Haritada not kopyalama görev kimliklerini siliyor; kopyadaki görevler not düzenlenene kadar görev değil, sonra rastgele kimlik alıyor.                                                                                                                                                                                                               | G5          |
| GK10   | Takvim, görev deposu boşken eski `missionIndex` ayrıştırmasına düşüyor.                                                                                                                                                                                                                                                                              | G5          |
| GK11   | Ana süreçte `quickAddPisiTask` iki kez sarmalanıyor; preload tek fonksiyonla `op` alanına göre beş iş seçiyor; görev bloğu HTML'i dört ayrı yerde üretiliyor (Quick Add, renderer, sürüm geçmişi, günlük).                                                                                                                                           | G2          |
| GK12   | Görev kimliği iki kuralla üretiliyor (`task_source_<yol, blok ve etiket özeti>` ve `task_<uuid>`); yoldan türeyen kimlik yeniden adlandırmada anlamını yitiriyor.                                                                                                                                                                                    | G2          |
| GK13   | Integrity yalnız dosya varlığına ve kendine bağımlılığa bakıyor: yetim blok, evsiz görev, çift referans, uzun bağımlılık döngüsü ve alan geçerliliği denetlenmiyor.                                                                                                                                                                                  | G2, G7      |
| GK14   | Hatırlatma türü bir CSS sınıfında (`pisi-todo-reminder-…`) saklanıyor.                                                                                                                                                                                                                                                                               | G2          |
| GK15   | Görev testlerinin çoğu kaynak kodu regex ile okuyor; yukarıdaki hataların hiçbirini yakalamıyor.                                                                                                                                                                                                                                                     | G2–G7       |

## Ek B. Doğrulama senaryoları

İncelemede bu senaryolar geçici CDP betikleriyle uygulamada çalıştırıldı (21-11-2026). Fazlar bunları kalıcı E2E'ye çevirir. Her senaryonun
sonunda Integrity yeni bulgu vermemelidir.

| Kimlik | Senaryo                                                  | Beklenen (yeni model)                                                  | 21-11-2026 sonucu |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------- |
| S1     | Notta ve notsuz iki görev; panelden biri tamamlanır      | `tasks.json`'da `done`; panel işaretli; hiçbir `.node` yazılmaz        | GB1               |
| S2     | Tekrar eden görev tamamlanır                             | Aynı görev sonraki güne ilerler; `completions` bir artar; not değişmez | GB2               |
| S3     | Paneldeki durum değiştirilir                             | `tasks.json` hemen değişir                                             | GB3               |
| S4     | Notsuz görev masaüstünde tamamlanır ve düzenlenir        | Olur; kayda kaynak eklenmez; mobilde düzenlenebilir kalır              | GB4, GB5          |
| S5     | Hatırlatmadan tamamlanır, sonra not düzenlenir           | `done` kalır                                                           | GB6               |
| S6     | Görev bloğu silinir ve not kaydedilir; sonra geri alınır | Görev çöp kutusuna gider; geri alınca döner                            | GB7               |
| S7     | Açık nota Quick Add                                      | Blok editörde hemen görünür; kayıttan sonra dosyada kalır              | GB8               |
| S8     | 1.000 not ve 5.000 görev; tamamlama                      | Tarama yok; `.node` okuma ve yazma 0; süre PR'a yazılır                | GB9               |
| S9     | İleri tarihli görev oluşturulur                          | Günlük dosyası oluşmaz                                                 | GB10              |
| S10    | Notsuz görev aranır                                      | Bulunur                                                                | GB11              |
| S11    | Günlükte tekrar eden görev tamamlanır                    | İlerler                                                                | GB12              |
| S12    | Günlük notunun ortasındaki görev bloğu                   | Yerinde kalır; dosyaya başlık yazılmaz                                 | GB13              |
| S13    | `[ ]`, slash komutu ve blok türüyle görev oluşturma      | Üçü de görev oluşturur                                                 | GB14              |
| S14    | Başlık editörde yazılır ve kaydedilir                    | Not dosyasında yalnız §3.2 biçimi; başlık `tasks.json`'da              | —                 |
| S15    | Kes ve başka nota yapıştır; kopyala ve yapıştır          | Kesmede kimlik aynı kalır, `noteId` değişir; kopyada yeni kimlik       | —                 |
| S16    | Haritada not kopyalanır                                  | Görevler yeni kimlikle kopyalanır                                      | GK9               |
| S17    | Not çöp kutusuna gider ve geri yüklenir                  | Görevleri birlikte gider ve döner                                      | —                 |
