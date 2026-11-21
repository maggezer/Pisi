# Pisi Görevler — Claude Code iş tanımı

Sürüm: 1 · 21-11-2026 · Repo: `maggezer/Pisi` · Hedef: görevin bütün bilgisinin tek dosyada (`.pisi/tasks.json`) durması, notların ve günlüklerin yalnız görev kimliği taşıması ve görevin her yerde bu kayıttan gösterilmesi

Bu belge repoda `docs/task-plan.md` olarak durur. Görev sisteminin yeniden kurulmasını faz faz tanımlar (G0–G10).
Mobil fazında [`docs/mobile-plan.md`](mobile-plan.md), senkron fazında [`docs/sync-plan.md`](sync-plan.md) kuralları da geçerlidir.
Plan, 21-11-2026'da yapılan iki incelemeye ve kullanıcının aynı gün verdiği kararlara dayanır. Bulgular Ek A'da, uygulamada çalıştırılan ve
fazlarda E2E'ye çevrilecek senaryolar Ek B'dedir.

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
4. **Günlük notlarının yönetilen bölümü** (`PISI_DIARY_MANAGED_START…END`): o günün görevlerinin başlık ve durumuyla bir kopyası. Bir görev
   değişince bütün günlük dosyaları okunur, bölümü değişen her günlük yeniden yazılır.

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

İki incelemede uygulamada (Electron, CDP) 14 davranış doğrulandı ve kodda 15 sorun görüldü (Ek A). Doğrulananlardan ikisi kullanıcı
kararıyla istenen davranıştır: görevin bitiş gününde günlüğün oluşması (GB10) ve günlükteki görevlerin notun altındaki bölümde toplanması
(GB13). Kalan 12'si hatadır. Öne çıkanlar:

- Panelden ya da günlükten yapılan değişiklik çoğu durumda `tasks.json`'a ulaşmıyor ya da sonradan geri alınıyor; kullanıcıya hata
  gösterilmiyor (GB1–GB7, GB12).
- Açık olan nota Quick Add yapılınca not içeriği kayboluyor (GB8).
- Görev işlemleri bütün projeyi tarıyor. Görevin başlığı ve durumu günlük dosyalarına da yazıldığı için başlık ya da durum değişikliği
  günlükleri de yeniden yazıyor (GB9, §1.1).
- Notu olmayan görevler masaüstünde tamamlanamıyor ve aranamıyor; sahte kaynak yüzünden iki cihazda da düzenlenemez hâle geliyor
  (GB4, GB5, GB11).
- Editördeki "Görev bloğu" ve `[ ]` kısayolu hiç görev oluşturmuyor (GB14).

Bu sorunlar tek tek düzeltilmek yerine görev modeli değiştirilerek kapatılacak.

### 1.3 Verilmiş kararlar (21-11-2026)

| Konu         | Karar                                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Otorite      | Görevin bütün bilgisi `.pisi/tasks.json`'dadır: kimlik, başlık, durum, öncelik, bitiş tarihi, tekrar, hatırlatma, bağımlılık, sıra, bulunduğu yer ve zaman damgaları. Bütün görevler bu tek dosyadadır.                                                                    |
| Not          | Not ve günlük, görevin yalnız kimliğini taşır. Başlık, durum, tarih ve öncelik notta yazılmaz.                                                                                                                                                                             |
| Gösterim     | Görev her yerde (not, günlük, panel, çalışma alanı, takvim, harita, arama, hatırlatma, mobil) bu kayıttan çizilir.                                                                                                                                                         |
| Blok         | Her görev notta ayrı bir bloktur ve kolay düzenlenmesi için blok üzerinden düzenlenir.                                                                                                                                                                                     |
| Geçiş        | Yok. Uygulamayı aktif kullanan yok; eski not işareti ve eski kayıt alanları için dönüştürücü yazılmaz.                                                                                                                                                                     |
| Görevin yeri | Inbox ya da benzeri bir kova yoktur; her görev bir notta ya da bir günün günlüğünde durur. Quick Add açılınca hedef son açık nottur; açık not yoksa bugünün günlüğüdür.                                                                                                    |
| Günlük       | Görevin bitiş günündeki günlük yoksa oluşturulur ve görev o günlüğün altındaki görev bölümünde görünür. Günlükte yazılan görevler de bu bölümde toplanır; günlük kompakt kalır. Takvimdeki belirteçten günlük açılarak takip edilir. GB10 ve GB13 bu yüzden hata sayılmaz. |
| Görev paneli | Masaüstünde sağdaki Görevler sekmesinin birinci amacı öncelikli görevleri göstermektir. Bugünün görevleri süzgeçle de görülür.                                                                                                                                             |
| Telefon      | Amaç en az sürtünmedir: uygulama açılınca, ek bir dokunuş gerekmeden, o günle ilgili her şey (günlük, günün görevleri, gecikenler) görünür. Görev listesi telefonda ikincildir.                                                                                            |
| Tarih        | Görevin tek bir günü vardır: `dueDate` (bitiş tarihi, `YYYY-MM-DD`) ve isteğe bağlı saat `dueTime` (`HH:MM`). `scheduledAt`, `deadline` ve `todoTag` kalkar.                                                                                                               |
| Tekrar       | Tekrar eden görev tamamlanınca yeni kayıt açılmaz. Aynı görev bir sonraki tarihe ilerler; tamamlanan günler `completions` listesinde tutulur. Tamamlandığı günün günlüğünde görev tamamlanmış olarak kalır (§3.2.3).                                                       |
| Silme        | Silinen görev (bloğu silinince ya da panelden) çöp kutusuna gider ve geri yüklenebilir. Nottaki geri alma da görevi geri getirir.                                                                                                                                          |
| Başlık       | Düz metin, tek satır. Etiketler ve not bağlantıları G6'da kayıt üzerinden geri gelir.                                                                                                                                                                                      |
| Enter        | Görev bloğunda Enter alta yeni bir görev açar; boş görevde Enter görevi kaldırır ve satırı paragraf yapar (madde listesiyle aynı kural).                                                                                                                                   |

### 1.4 Planla birlikte onaylanan ek kararlar (21-11-2026)

Bu kararlar planı yazarken verildi ve kullanıcı tarafından 21-11-2026'da onaylandı; §1.3'teki kararlar kadar bağlayıcıdır.

| Konu                     | Karar                                                                                                                                                                                                                           | Neden                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Yerin tutulması          | Normal nottaki görev notunu `noteId` (`node_…`) ile, günlükteki görev günlüğünü günüyle (`diaryDate`) tutar.                                                                                                                    | Günlük notunun kimliği rastgeledir; aynı günün günlüğü iki cihazda ayrı oluşsa da bağ kopmaz. Yeniden adlandırma görevlere dokunmaz. |
| Kimlik                   | Yeni görev `task_<uuid>` alır. Yoldan ve tekrardan türeyen kimlikler kalkar.                                                                                                                                                    | Tek kimlik kuralı (GK12).                                                                                                            |
| Günün görevleri          | D gününün görev bölümü: yeri D günlüğü olan, bitiş günü D olan ve D'de tamamlanmış görevler. Bugünün görünümünde ayrıca geciken açık görevler gösterilir; bunlar dosyaya yazılmaz.                                              | Kural tek yerdedir; günlük, takvim ve telefon aynı listeyi gösterir.                                                                 |
| Bölümün biçimi           | Görev bölümü günlüğün son bloğudur; düzenlenemez ve yalnız görev kimliklerini taşır. "Görevler" başlığı dosyaya yazılmaz, editör TR ya da ENG çizer. İçerik belirlenimcidir.                                                    | Başlık ya da durum değişikliği günlüğü yazmaz; iki cihaz aynı baytları üretir; `pisi-error.md` §4a kapanır.                          |
| Tamamlama günü           | Görev, tamamlandığı günün günlüğünde ☑ görünür. Tekrar eden görevde tamamlama o günle `completions`'a yazılır ve görev bitiş gününden ve bugünden sonraki ilk tekrara ilerler; geciken tekrarlar atlanır, tamamlanmış sayılmaz. | Kullanıcı bugünün günlüğünde yaptığını görür; geciken bir günlük görev tek tıkla güne gelir.                                         |
| Geçmiş işaretler         | Günlükte en son tamamlama geri alınabilir; görev tamamlamadan önceki bitiş gününe döner. Daha eski tamamlamalar günlükte kilitlidir; görev ayrıntısındaki "Tamamlanan günler" listesinden silinir.                              | Görev ilerledikten sonra geçmiş günlükler değişmez; bir işareti kaldırmak görevi beklenmedik bir yere götürmez.                      |
| Günlükte görev yazma     | Günlükte oluşturulan görev günlüğün görev bölümüne girer; bitiş günü varsayılan olarak o günlüğün günüdür; imleç yeni satırın başlığına geçer.                                                                                  | Bölüm kompakt kalır; görev sonradan yer değiştirmez.                                                                                 |
| Başka nottan gelen satır | Günlükte, yeri başka bir not olan görevin satırı klavyeyle silinmez; satır menüsünden tarihi değiştirilir ya da kaldırılır.                                                                                                     | Satırı silmek görevi silmemeli.                                                                                                      |
| Quick Add tarihi         | Quick Add'de tarih yazılmazsa görevin tarihi olmaz; görev hedef notta ya da bugünün günlüğünde durur.                                                                                                                           | Tarihsiz bir not almak da mümkün kalır.                                                                                              |
| Son açık not             | Quick Add'in hedefi en son odaklanan açık nottur (ortadaki editör ya da not penceresi). Form hedefi gösterir ve değiştirmeye izin verir.                                                                                        | Kararın uygulamadaki karşılığı.                                                                                                      |

---

## 2. Değişmez kurallar

Bu kurallar her fazda geçerlidir. Bir PR bunlardan birini çiğniyorsa bitmiş sayılmaz. Mobilde `docs/mobile-plan.md` V1–V10, senkronda
`docs/sync-plan.md` SV1–SV13 de geçerlidir.

- **GV1 · Tek kaynak:** Bir görev alanı yalnız `tasks.json`'a yazılır. Not, günlük, harita ya da başka bir dosya görev alanı taşımaz. Bellekteki
  görev listeleri yalnız önbellektir ve dosyaya geri yazılmaz (V1).
- **GV2 · Notta yalnız kimlik:** Nottaki görev bloğu ve günlüğün görev bölümü, blok kimliği ve görev kimlikleri dışında görev bilgisi taşımaz
  (§3.2). Editörün çizdiği görünüm kayıtta temizlenir.
- **GV3 · Görünümler yazmaz:** Panel, çalışma alanı, takvim, harita, arama, hatırlatma ve mobil ekranlar okurken ve gezinirken hiçbir dosyaya
  yazmaz. Günlüğün görev bölümü bir görünüm değil, görevin günlükteki yeridir; yalnız GV5'teki durumda yazılır.
- **GV4 · Tek yazma yolu:** Masaüstünde görev değişikliği yalnız ana süreçteki görev servisinin `task.*.v1` komutlarıyla yazılır; mobilde
  `TaskRepo` ve `ProjectWriter` ile. Her yazmadan hemen önce dosya yeniden okunur ve yalnız ilgili kayıtlar değişir (V5). Değişmeyen kayıt ve
  dosya yazılmaz (V4).
- **GV5 · Proje taraması yok:** Hiçbir görev işlemi bütün notları okumaz. Görev alanı değişikliği (başlık, durum, öncelik, saat, hatırlatma…)
  hiçbir `.node` dosyasını okumaz ya da yazmaz. Görevin günleri (yeri, bitiş günü, tamamlandığı günler) değişince yalnız o günlerin günlükleri
  yazılır ve gerekiyorsa o günün günlüğü oluşturulur. Project Integrity denetimi bu kuralın dışındadır (kullanıcının başlattığı, salt okunur bir
  işlem).
- **GV6 · Görevin yeri:** Her görevin bir yeri vardır: bir not (`noteId`) ya da bir günün günlüğü (`diaryDate`). Notta yerin karşılığı tek bir
  görev bloğudur; günlükte görev, günlüğün görev bölümündedir. Görev ayrıca bitiş gününün ve tamamlandığı günlerin günlüklerinde bölüm satırı
  olarak görünür. Ayrıntılar §3.3'tedir.
- **GV7 · Kimlik:** Kopyalama yeni kimlik verir; taşıma (kes ve yapıştır, yer değiştirme) kimliği korur. Bir görevin notlarda en çok bir bloğu
  olur; bir günlüğün görev bölümünde bir kimlik en çok bir kez bulunur.
- **GV8 · Atomiklik:** Bir komutun yazdığı dosyalar (`tasks.json`, notlar, günlükler, çöp kutusu) tek atomik mutation içinde yazılır
  (`docs/atomic-mutations.md`).
- **GV9 · Açık belge:** Açık bir not ya da günlükte blok ya da görev bölümü değişikliği editör üzerinden yapılır ve editörün kayıt yoluyla
  yazılır; ana süreç açık belgeyi yazmaz. Görev alanı değişikliği notu hiç değiştirmez (SV4 ile uyumlu).
- **GV10 · Silme geri alınabilir:** Görev silme çöp kutusuna gider. Telefon görev silmez (V9).
- **GV11 · Bozuk dosya:** Okunamayan `tasks.json` ezilmez. Görevler salt okunur gösterilir, not bloklarında ve günlük bölümlerinde "Görevler
  okunamadı" yazar; bloklar ve bölümler korunur, yeniden üretilmez (V7, SV10).
- **GV12 · Bilinmeyeni koru:** Tanınmayan kayıt alanları ve üst düzey anahtarlar aynen geri yazılır (V3). Eski sürümden kalan alanlar
  (ör. `source`, `todoTag`, `scheduledAt`) okunmaz ama silinmez.
- **GV13 · Tek kural, iki platform:** Görevin günü, günün görevleri, görev bölümünün baytları, öncelik sırası, tekrar sonrası tarih, bağımlılık
  döngüsü ve süzgeçler `shared/task-*.mjs`'ten gelir. Masaüstü ve mobil aynı kodu çalıştırır.
- **GV14 · Bütünlük:** Bir görev işleminden sonra Project Integrity yeni bulgu vermez; mobilin yazdığı proje de vermez (V10).
- **GV15 · Türetilmiş bölüm:** Günlüğün görev bölümü `tasks.json`'dan belirlenimci olarak üretilir. Okunup göreve çevrilmez, otorite sayılmaz;
  eski ya da bozuk bölüm kuraldan yeniden üretilir. Aynı `tasks.json`'dan masaüstü ve mobil aynı baytları üretir.

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
            "title": "Spor",
            "status": "todo",
            "priority": 3,
            "dueDate": "2026-11-22",
            "dueTime": "07:30",
            "repeat": "daily",
            "completionOffsetDays": null,
            "reminderMode": "none",
            "reminderAt": null,
            "dependencies": [],
            "manualOrder": 1732179600000,
            "noteId": "node_0b6a3c1e-7d2f-4a8b-9c5e-1f2a3b4c5d6e",
            "diaryDate": null,
            "durationMinutes": 0,
            "actualMinutes": 0,
            "completions": [{ "date": "2026-11-21", "dueDate": "2026-11-21", "at": "2026-11-21T06:52:11.000Z" }],
            "createdAt": "2026-11-10T08:00:00.000Z",
            "updatedAt": "2026-11-21T06:52:11.000Z",
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
| `repeat`, `completionOffsetDays`        | `none`, `daily`, `weekdays`, `weekly`, `biweekly`, `monthly`, `after-completion`; sonuncusu için gün sayısı. Sonraki tarih §3.2.3'teki kuralla bulunur.                                                                                  |
| `completions`                           | Yalnız tekrar eden görevde, tamamlanan her tekrar için: tamamlandığı gün (`date`), tamamlanan tekrarın bitiş günü (`dueDate`) ve an (`at`). Tekrarsız görevde boş liste.                                                                 |
| `reminderMode`, `reminderAt`            | Bugünkü kural: `reminderAt` (yerel `YYYY-MM-DDTHH:MM`) önceliklidir; yoksa `due-morning`, `day-before`, `three-days-before` `dueDate`'ten Ayarlar'daki saatle türetilir. Tekrar ilerleyince `reminderAt` de aynı gün sayısı kadar kayar. |
| `dependencies`                          | Başka görevlerin kimlikleri; görevin kendisi ve döngü kabul edilmez.                                                                                                                                                                     |
| `manualOrder`                           | Elle sıralama değeri.                                                                                                                                                                                                                    |
| `noteId`, `diaryDate`                   | Görevin yeri: normal notun `node_…` kimliği ya da günlüğün günü (`YYYY-MM-DD`). İkisinden tam biri doludur.                                                                                                                              |
| `durationMinutes`, `actualMinutes`      | Tahmini ve gerçek süre (0 = yok).                                                                                                                                                                                                        |
| `createdAt`, `updatedAt`, `completedAt` | ISO zaman damgaları; `completedAt` yalnız tekrarsız ve `done` görevde doludur.                                                                                                                                                           |

Ana süreç ve mobil `version` 1 ve 2'yi okur, 2 yazar. Sürüm 1 kaydındaki eski alanlar (`source`, `todoTag`, `scheduledAt`, `deadline`) okunmaz
ve korunur (GV12). Böyle bir kaydın yeri yoktur: G8'e kadar (mobilin eski sürümü yersiz görev yazdığı için) bitiş gününün günlüğünde ve panelde
görünür ve Integrity bulgusu sayılmaz; G8'den sonra Integrity onu "yeri olmayan görev" olarak gösterir ve bugünün günlüğüne bağlamayı önerir.

### 3.2 Notta ve günlükte görev

#### 3.2.1 Görev bloğu (normal not)

```html
<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_…" data-pisi-block-type="task" data-pisi-task-id="task_…" contenteditable="false"></div>
```

- Bloğun içi boştur. Editör notu açınca bloğun içini görev kaydından çizer (onay kutusu, başlık alanı, tarih/öncelik/tekrar/hatırlatma çipleri)
  ve kayıtta yukarıdaki biçime döndürür. Dosya ve görsel bloklarındaki gibi bu çizim geçicidir.
- Blok HTML'ini yalnız `shared/task-blocks.mjs` üretir ve okur. Masaüstü, mobil, dışa aktarma ve Integrity bu modülü kullanır.
- Kaydı bulunmayan blok "Görev bulunamadı" gösterir ve korunur (Integrity bulgusu verir). `tasks.json` okunamıyorsa bloklar "Görevler okunamadı"
  gösterir (GV11).
- Eski `todo.*` etiketi ve `data-pisi-todo-*` öznitelikleri görev olarak tanınmaz; eski bir notta sıradan etiket ve metin olarak görünür (§1.3).

#### 3.2.2 Günlüğün görev bölümü

```html
<div class="pisi-editor-block pisi-diary-tasks" data-pisi-block-id="blk_diary-tasks-2026-11-21" data-pisi-block-type="diary-tasks" contenteditable="false">
    <div data-pisi-task-ref="task_…"></div>
    <div data-pisi-task-ref="task_…"></div>
</div>
```

- Günün görevleri (`shared/task-diary.mjs`): yeri bu günlük olan görevler (`diaryDate`), bitiş günü bu gün olan görevler ve bu gün tamamlanmış
  görevler (tekrarsızda `completedAt`, tekrar edende `completions[].date`).
- Bölüm günlüğün son bloğudur ve tektir; günün görev listesi boşsa bölüm yoktur. Kimlikler `createdAt`, eşitlikte kimlik sırasıyla dizilir;
  blok kimliği günden türer. Böylece aynı `tasks.json`'dan her cihaz aynı baytları üretir (GV15).
- Bölüm görevin günleri değişince yazılır (GV5): görev oluşturulunca, yeri ya da bitiş günü değişince, silinince ya da geri gelince ve
  tamamlanınca ya da geri açılınca. Tamamlamada tekrar eden görev ilerlediği için sonraki günün bölümü her zaman değişir; tekrarsız görevde
  bölüm yalnız görev bitiş gününden başka bir gün tamamlanınca değişir. O gün için günlük yoksa oluşturulur. Başlık, durum, öncelik, saat ya
  da hatırlatma değişikliği bölümü değiştirmez.
- Editör bölümü "Görevler" başlığıyla (TR ve ENG) çizer. Satırın durumu o güne göredir: o gün tamamlanan görev ☑ ve tamamlanma saatiyle;
  bitiş günü bu gün olan görev kendi durumuyla; yeri bu günlük olup başka güne tarihli görev kendi tarih çipiyle. Ekrandaki sıra (açıklar önce,
  sonra saat ve öncelik) dosyaya yazılmaz.
- Bugünün günlüğünde bölümün üstünde geciken açık görevler ayrı bir grup olarak çizilir; dosyaya yazılmaz.
- Bölümün içine yazılamaz; günlükte oluşturulan görev bölüme girer (§1.4). `pisi-error.md` §4a'daki ayraç sorunu böylece kalkar.

#### 3.2.3 Tamamlama ve günlük

Tekrarsız görev tamamlanınca `done` olur ve bitiş gününün günlüğünde ☑ görünür. Geç tamamlanırsa tamamlandığı günün günlüğünde de ☑ görünür.

Tekrar eden görev için örnek: her gün tekrar eden "Spor", bitiş günü 21-11.

1. 21-11'de tamamlanır: `completions`'a `{ "date": "2026-11-21", "dueDate": "2026-11-21", "at": "…" }` yazılır; görev 22-11'e ilerler, durumu
   `todo` kalır.
2. 21-11 günlüğünde satır kalır ve tamamlanma saatiyle ☑ görünür. 22-11 günlüğü yoksa oluşturulur; satır orada ☐ görünür. Takvimde 21-11
   tamamlanmış, 22-11 açık gün sayılır.
3. 21-11 günlüğünde ☑ kaldırılırsa (en son tamamlama olduğu için) tamamlama geri alınır: kayıt `completions`'tan çıkar, görev kaydın
   `dueDate`'ine (21-11) döner, 22-11 günlüğündeki satır kalkar. Oluşan günlük dosyası silinmez.
4. Görev 22-11'de de tamamlanmışsa 21-11'deki ☑ kilitlidir. Düzeltme görev ayrıntısındaki "Tamamlanan günler" listesinden yapılır.
5. 22-11'deki tekrar yapılmadan 24-11 gelirse görev bugünün görünümünde gecikenlerdedir. 24-11'de tamamlanınca kayıt
   `{ "date": "2026-11-24", "dueDate": "2026-11-22" }` olur; 22-11 ve 23-11 atlanır ve görev 25-11'e ilerler. Satır 24-11 günlüğünde ☑ görünür
   ve 22-11 günlüğünden kalkar (o gün yapılmadı).

Kural (`completePisiTask`): tamamlama günü bugündür; sonraki bitiş günü, tekrar kuralının bitiş gününden ve bugünden sonraki ilk tarihidir
(`after-completion`'da bugün + gün sayısı). Geri alma, kayıttaki `dueDate`'i geri koyar.

### 3.3 Görevin yeri ve notlar

| Olay                                                                   | Ne olur                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal notta yeni görev (slash komutu, `[ ]`, blok türü, Enter)        | Önce `task.create.v1` (yer: `noteId`), sonra blok nota girer. Not açıksa bloğu editör ekler ve kaydeder; kapalıysa ana süreç aynı komutta yazar. Bitiş günü varsa o günün günlüğüne satır eklenir.                                    |
| Günlükte yeni görev                                                    | Yer: o günün günlüğü (`diaryDate`); bitiş günü varsayılan olarak o gün. Görev günlüğün görev bölümüne girer (§1.4).                                                                                                                   |
| Quick Add                                                              | Hedef son açık not; açık not yoksa bugünün günlüğü (§1.3). Form hedefi gösterir ve değiştirmeye izin verir.                                                                                                                           |
| Bitiş günü değişir                                                     | Görev eski günün bölümünden çıkar (o güne başka bir kuralla bağlı değilse) ve yeni günün bölümüne girer; o günün günlüğü yoksa oluşturulur.                                                                                           |
| Görev tamamlanır ya da geri açılır                                     | §3.2.3.                                                                                                                                                                                                                               |
| Görev bloğu silinir (Backspace, seçip silme, kesme)                    | Not kaydında ana süreç kayıttan önceki ve sonraki içerikteki görev kimliklerini karşılaştırır. Nottan çıkan ve yeri bu not olan görev aynı mutation'da çöp kutusuna gider ve bütün günlük bölümlerinden çıkar.                        |
| Günlükte satır silinir                                                 | Yeri bu günlük olan görev çöp kutusuna gider. Yeri başka bir not olan görevin satırı klavyeyle silinmez (§1.4).                                                                                                                       |
| Kes ve başka nota yapıştır                                             | Yapıştırılan kimlik çöp kutusundaysa geri gelir ve yeri yeni not olur. Kimlik korunur.                                                                                                                                                |
| Kopyala ve yapıştır, blok çoğaltma                                     | Pano görev kaydını da taşır. Yapıştırılan kimlik canlıysa yeni kimlikle bir kopya görev açılır (bugünkü yapıştırma kimlik kuralı, `docs/editor-paste-rules.md`).                                                                      |
| Not içinde blok taşıma                                                 | Görev değişmez.                                                                                                                                                                                                                       |
| Panelden "Nota taşı"                                                   | `task.move.v1`: eski ve yeni yerin bloğu ya da bölümü ve kaydın yeri birlikte değişir.                                                                                                                                                |
| Not ya da günlük çöp kutusuna gider                                    | Yeri o not ya da günlük olan görevler aynı çöp kutusu öğesine arşivlenir ve geri yüklemede birlikte döner (bugünkü davranış; yola göre değil yere göre). Silinen günlük, o güne yeni bir görev girene kadar yeniden oluşturulmaz.     |
| Not yeniden adlandırılır ya da taşınır                                 | Görev değişmez.                                                                                                                                                                                                                       |
| Not kopyalanır (haritada kopya)                                        | Kopyadaki her görev yeni kimlikle kopyalanır; aynı mutation.                                                                                                                                                                          |
| Senkron çakışma kopyası                                                | Kopyaya görev blokları ve görev bölümü girmez; görevler asıl notta kalır. Bloklarda metin olmadığı için metin kaybı olmaz (SV3).                                                                                                      |
| Not sürüm geçmişinden geri yükleme                                     | Geri gelen bloğun görevi canlıysa ve başka bir notta değilse blok olduğu gibi kalır; çöp kutusundaysa görev geri gelir; hiçbir yerde yoksa blok "Görev bulunamadı" gösterir. Günlüğün görev bölümü geri yüklenmez, kuraldan üretilir. |
| `tasks.json` geçmişinden geri yükleme                                  | Kayıtlar geri gelir ve günlük bölümleri kuraldan üretilir. Notunda bloğu olmayan görev için not açılınca "Bu nota ait N görev notta görünmüyor" uyarısı ve "Sona ekle" seçeneği çıkar.                                                |
| Aynı kimlik başka bir notta da varsa (yapıştırma kuralını atlayan yol) | Kayıt reddedilmez, görev taşınmaz; Integrity "çift referans" bulgusu verir ve onarım önerir.                                                                                                                                          |

Not kaydındaki karşılaştırma yalnız kullanıcının kaydında (editör kaydı) çalışır; senkronla gelen not değişikliğinde çalışmaz, çünkü görev
değişikliği o turda `tasks.json` ile gelir. Senkronla `tasks.json` değişince masaüstü etkilenen günlerin bölümünü kuraldan üretir; dosya zaten
doğruysa yazmaz (V4).

### 3.4 Görev komutları

| Sözleşme                              | Tür     | Ne yapar                                                                                                                                                                      |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.list.v1`                        | query   | Bütün görevler, dosya sürümü ve `readOnly` bilgisi.                                                                                                                           |
| `task.create.v1`                      | command | Yeni görev. Hedef `{ noteId, notePath, afterBlockId }` ya da `{ diaryDate }`. Kapalı nota blok ekler, günlük bölümlerini günceller, gereken günlüğü oluşturur. Kimliği döner. |
| `task.update.v1`                      | command | Alan değişikliği (yer dışında). Bitiş günü değişince günlük bölümleri güncellenir. "Tamamlanan günler"den kayıt silme de buradadır.                                           |
| `task.complete.v1` / `task.reopen.v1` | command | §3.2.3 kuralıyla tamamlar ya da geri açar; geri alma bilgisi döner.                                                                                                           |
| `task.move.v1`                        | command | Yeri değiştirir (not ya da günlük); kapalı notlarda bloğu taşır.                                                                                                              |
| `task.delete.v1`                      | command | Görevi çöp kutusuna taşır; kapalı nottan bloğu ve günlüklerden satırları kaldırır.                                                                                            |
| `task.batch.v1`                       | command | Birden çok alan değişikliği tek yazmada (sıralama, geri alma).                                                                                                                |

Notu değiştiren komutlar notun yolunu ve kimliğini birlikte alır; ana süreç dosyadaki `pisi.id` ile doğrular (`path-security.js` kuralları
geçerlidir). Günlüğün yolu günden bellidir (`shared/diary-rules.mjs`).

Ana süreç her yazmadan sonra renderer'a `pisi:tasks-changed` olayını yollar: `{ version, changedIds, removedIds, source }`. `source` değeri
`local`, `sync` ya da `external` olur.

Kalkanlar: `task.capture.v1`, `task.upsert.v1`, `task.sync-projection.v1`, `window.pisiProject.quickAddTask` ve onun `op` seçicisi,
`project:sync-diary-missions`.

### 3.5 Önbellek ve güncelleme

- Ana süreç `tasks.json`'u okur ve bellekte tutar. Kendi yazmasında ve izleyicinin bildirdiği dış değişiklikte (senkron dahil) yeniler.
- Renderer görev deposu (`renderer/tasks/pisi-task-store.mjs`) açılışta bir kez listeler. Sonra yalnız `pisi:tasks-changed` olayındaki kayıtları
  günceller ve `pisi:task-store-updated` olayını `{ changedIds }` ile yayar.
- Yüzeyler yalnız etkilenen öğeleri yeniden çizer: açık nottaki ilgili bloklar ve satırlar, paneldeki ilgili kartlar, takvimin ilgili günleri.
- Not kimliğinden yola ve başlığa çeviri renderer'da belge dizininden (ağaç ve arama dizini) gelir. Ana süreç bunun için ayrı bir dizin tutmaz;
  notu değiştiren komutlar yolu ve kimliği birlikte alır.

### 3.6 Yüzeyler

| Yüzey                                                                            | Okur                                                                                                                                                                                           | Yazar                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Not editörü                                                                      | Görev bloğunu kayıttan çizer                                                                                                                                                                   | Başlık, durum, çipler: `task.update` / `task.complete`; blok ekleme ve silme: §3.3 |
| Günlük                                                                           | Görev bölümü (§3.2.2); bugünde gecikenler                                                                                                                                                      | Satırda onay kutusu `task.complete`, başlık `task.update`                          |
| Görev paneli ve çalışma alanı (liste, kanban, takvim, zaman çizelgesi, ilerleme) | `shared/task-views.mjs`. Varsayılan görünüm "Öncelikli": açık görevler öncelik sırasıyla (gecikenler önce; kalan gün ve öncelik). Süzgeçler: bugün, yaklaşan, geciken, tarihsiz, tamamlananlar | `task.*` komutları                                                                 |
| Görev ayrıntısı (pencere)                                                        | Bütün alanlar ve "Tamamlanan günler"                                                                                                                                                           | `task.update`, `task.move`, `task.delete`                                          |
| Quick Add                                                                        | Hedef: son açık not, yoksa bugünün günlüğü                                                                                                                                                     | `task.create`                                                                      |
| Takvim                                                                           | Gün kuralı (§3.2.2): açık ve tamamlanmış görevler; güne tıklayınca o günün günlüğü açılır (yoksa oluşur, bugünkü davranış)                                                                     | —                                                                                  |
| Harita                                                                           | Not başına açık, geciken ve engelli görev sayısı ve bağımlılık katmanı (`noteId`)                                                                                                              | —                                                                                  |
| Arama                                                                            | Her görev, tek kayıt üreticisinden                                                                                                                                                             | —                                                                                  |
| Hatırlatma (ana süreç ve panel)                                                  | `reminderAt`, `reminderMode`, `dueDate`                                                                                                                                                        | Tamamla: `task.complete`                                                           |
| Dışa aktarma                                                                     | Görev bloğu ve günlük bölümü kayıttan yazılır (Markdown'da `- [ ] Başlık`, HTML/PDF/DOCX'te onay kutulu satır)                                                                                 | İçe aktarmada `- [ ]` satırları görev olur                                         |
| Bul ve değiştir                                                                  | Nottaki görev başlıkları da bulunur                                                                                                                                                            | Değiştirme `task.update` ile; tek geri alma adımı                                  |
| Mobil açılış ekranı (Pisi sekmesi)                                               | Seçili günün günlüğü, görev bölümü (aynı kural) ve bugünse gecikenler                                                                                                                          | `TaskRepo`; ekleme satırı o günün günlüğüne                                        |
| Mobil Görevler sekmesi                                                           | Aynı kayıtlar ve süzgeçler (ikincil)                                                                                                                                                           | `TaskRepo`; ekleme bugünün günlüğüne                                               |
| Senkron                                                                          | `tasks.json` alan alan birleşir                                                                                                                                                                | `completions` tekrara göre birleşir; günlük bölümü yeniden üretilir (G9)           |

### 3.7 Modüller

Yeni:

- `shared/task-model.mjs` (sürüm 2: kayıt kuralları, yer doğrulama, tamamlama ve geri açma, bağımlılık döngüsü, alan doğrulama),
  `shared/task-views.mjs` (görevin günü, öncelik sırası, kovalar, süzgeç ve sıralama, takvim özeti, ilerleme), `shared/task-blocks.mjs` (görev
  bloğu HTML'i, nottaki görev kimlikleri, üyelik farkı, blok ekleme ve kaldırma), `shared/task-diary.mjs` (günün görevleri, görev bölümünün
  HTML'i ve okunması, bir görevin o gündeki durumu). Hepsi DOM'suz, `shared/html-tokens.mjs` üstünde.
- `main/functions/task-store.js` (sürüm 2 dosya okuma ve yazma) ve `main/functions/task-service.js` (komutlar, atomik yazma, olaylar, not
  kaydında karşılaştırma, günlük bölümlerinin yazılması ve günlük oluşturma, çöp kutusu).
- `renderer/tasks/`: `pisi-task-store.mjs`, `pisi-task-actions.mjs` (açık ve kapalı belge ayrımı, GV9), `pisi-task-block.mjs` (editör bloğu ve
  klavye kuralları), `pisi-task-diary.mjs` (günlük bölümünün çizimi ve satırları), `pisi-task-panel.mjs`, `pisi-task-views.mjs` (kanban, takvim,
  zaman çizelgesi, ilerleme), `pisi-task-detail.mjs`, `pisi-task-quick-add.mjs`.

Kalkacaklar (G2–G7):

- `renderer/tags/pisi-todo-*.mjs` (11 dosya), `renderer/tags/pisi-task-store.mjs`, `renderer/tags/pisi-source-of-truth.mjs`; `pisi-tag-panels.mjs`,
  `pisi-tag-index.mjs`, `pisi-tag-editor.mjs` ve `pisi-editor-blocks.mjs` içindeki görev kodu.
- `renderer/productivity/pisi-quick-add-repeat-policy.mjs`; `pisi-quick-capture.mjs`'teki görev formu `renderer/tasks/`'a taşınır.
- `renderer/calendar/pisi-calendar-diary.mjs`'teki yönetilen bölüm tıklamaları; `pisi-calendar-ui.mjs`'teki `missionIndex` yolu.
- `main/functions/task-capture.js` (Inbox dahil), `source-of-truth.js`, `task-reference-integrity.js`, `task-reference-operation-hooks.js`;
  `document-store-diary.js`'teki eski yönetilen bölüm (`syncDiaryMissions`, `organizeDiaryManualTasks`, ayraçlar; günlük oluşturma kalır);
  `store-history.js`'teki görev bloğu üretimi; `map-node-copy-core.js`'teki kimlik silme; `sync-client-desktop.js`'teki görev durumu koruması
  (SV13).
- Görev işaretini regex ile okuyan testler (`tests/todo-*.test.js` ve benzerleri); yerlerine davranış testleri gelir.

### 3.8 Görev PR'ları için ek "bitti" koşulları

- Kökte `npm run validate` geçer. Masaüstü arayüzüne dokunulduysa `xvfb-run -a npm run test:e2e` geçer. Mobile dokunulduysa
  `npm --prefix mobile run validate` ve `npm --prefix mobile run e2e` geçer. Senkron davranışı değiştiyse `npm run test:sync-server` (G9'da matris
  de) geçer.
- Her faz kendi Electron E2E'sini `scripts/electron-tasks-<konu>-e2e.mjs` olarak yazar ve `package.json` `test:e2e` listesine ekler. Fazın
  kapattığı Ek B senaryoları bu E2E'dedir.
- E2E, bir görev alanı değişikliği sırasında `.node` okuma ve yazma sayısını sayar; sayı 0 olmalıdır (GV5). Görevin günleri değişince yalnız
  ilgili günlükler yazılır; E2E bunu da sayar.
- E2E her senaryodan sonra Project Integrity'nin yeni bulgu vermediğini denetler (GV14).
- Günlük bölümünü değiştiren PR'da ortak bir test, masaüstünün ve mobilin aynı `tasks.json`'dan aynı baytları ürettiğini doğrular (GV15).
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

- `docs/task-plan.md` (bu belge) eklenir. `CLAUDE.md`'ye kısa bir "Görevler" bölümü, `pisi-error.md`'ye incelemenin doğrulanan hataları (§5h),
  `pisi-update.md`'ye tarihli bir giriş yazılır.
- **Kabul:** yalnız belge değişikliği olur; `npm run validate` geçer.

### G1 · Saf görev çekirdeği: `shared/task-*.mjs`

**Amaç:** iki platformun kullanacağı sürüm 2 kurallarını, G/Ç olmadan ve test edilmiş olarak kurmak.

**Oku:** `shared/task-model.mjs`, `shared/task-views.mjs`, `shared/ids.mjs`, `shared/diary-rules.mjs`, `shared/note-blocks.mjs`,
`shared/html-tokens.mjs`, `shared/date-parser.mjs`, `scripts/shared-purity.js`, `mobile/src/data/task-repo.mjs`, `mobile/src/screens/pisi/day-model.mjs`,
`mobile/src/screens/notes/note.mjs` (`drawTask`).

**Önce plan yaz, onay bekle.**

1. `task-model.mjs`: §3.1'deki kayıt kuralları (`normalizePisiTask(payload, existing, { now, makeUuid })`); yer doğrulama (`noteId` ya da
   `diaryDate`); bilinmeyen alanlar korunur.
2. `completePisiTask(task, { now })` ve `reopenPisiTask(task, completion)`: §3.2.3'teki kural; geri alma, kayıttaki `dueDate`'i geri koyar.
3. `findPisiTaskDependencyCycle(tasks, taskId, dependencyIds)`.
4. `task-views.mjs`: görevin günü (`dueDate`), öncelik sırası (gecikenler önce, kalan gün ve öncelik; bugünkü iş sırası), kovalar (geciken, bugün,
   yaklaşan, sonra, tarihsiz), süzgeçler, sıralamalar (öncelik sırası, öncelik, elle sıra), takvim özeti ve ilerleme sayıları.
5. `task-blocks.mjs`: `makePisiTaskBlockHtml`, `listPisiTaskBlocks(html)`, `diffPisiTaskMembership(before, after)`,
   `insertPisiTaskBlock(html, block, { afterBlockId })`, `removePisiTaskBlock(html, taskId)`, `stripPisiTaskBlocks(html)` (çakışma kopyası için).
6. `task-diary.mjs`: `listPisiDiaryTaskIds(date, tasks)` (günün görevleri), `getPisiTaskStateOnDay(task, date)` (☑, ☐ ya da tarih çipi; kilit
   bilgisiyle), `makePisiDiaryTaskSectionHtml(date, ids)`, `readPisiDiaryTaskSection(html)`, `replacePisiDiaryTaskSection(html, date, ids)` ve bir
   görev değişikliğinin hangi günleri etkilediğini veren `getPisiTaskDayChanges(before, after)`.
7. `note-blocks.mjs`: görev bloğu (§3.2.1) ve günlük bölümü (§3.2.2) korumalı segmentlerdir ve görev kimliklerini taşır. Mobilin not görünümü
   görevi bu kimlikle bulur.
8. Eski dışa açık fonksiyonlar (görev etiketi dilbilgisi vb.) bu fazda silinmez; kullanan kod G2 ve G8'de kalkınca silinir.

**Kabul:**

- `npm run validate` ve `npm --prefix mobile run validate` geçer; `check:architecture` shared saflığını onaylar.
- Her kural örnekli testle sınanır (`tests/shared-task-*.test.mjs`). §3.2.3'teki beş adım tablo güdümlü bir testtir. Tohumlu rastgele 1.000
  durumda: tamamla ve geri al kaydı aynen geri verir; `diffPisiTaskMembership` ile `insertPisiTaskBlock` / `removePisiTaskBlock` birbirini tutar;
  bölüm baytları aynı girdiden aynı çıkar; blok ve bölüm dışındaki baytlar değişmez.
- `tests/mobile-desktop-compat.test.mjs` değişmeden geçer.

### G2 · Görev servisi ve `tasks.json` sürüm 2

**Amaç:** bütün görev yazmalarının tek servisten, atomik ve doğru geçmesi; yansıtma yollarının ve Inbox'ın kalkması; günlük bölümünün yalnız
kimlik taşıyan yeni biçime geçmesi.

**Oku:** `main/functions/task-store.js`, `task-capture.js`, `source-of-truth.js`, `domain-command-query.js`, `atomic-mutation*.js`,
`atomic-domain-hardening.js`, `trash-store.js`, `project-integrity-authorities.js`, `reminder-*.js`, `store-history*.js`,
`document-store-diary.js`, not kaydı yolu (`document-store*.js`), `sync-client-desktop.js` (görev koruması), `preload.js`,
`renderer/domain/pisi-domain-client.mjs`, `renderer/productivity/pisi-quick-capture.mjs`, `renderer/calendar/pisi-calendar-diary.mjs`,
`scripts/electron-mobile-fixture-e2e.mjs`, `tests/fixtures/README.md`.

**Önce plan yaz, onay bekle.** Bu planın en büyük fazıdır.

1. `task-store.js`: sürüm 1 ve 2 okunur, 2 yazılır; bozuk dosya salt okunur (GV11).
2. `task-service.js`: §3.4 komutları; her biri tek atomik mutation (GV8); `pisi:tasks-changed` olayı; kapalı nota blok ekleme ve kaldırma; görev
   değişikliğinin etkilediği günlerin bölümünü yazma ve gereken günlüğü oluşturma (`shared/task-diary.mjs`).
3. Not kaydında karşılaştırma (§3.3): nottan çıkan görev çöp kutusuna gider; çöp kutusundaki bir kimlik nota gelirse görev geri döner.
   Senkron uygulamasında çalışmaz. Senkronla gelen `tasks.json` değişikliğinde etkilenen günlerin bölümü kuraldan üretilir; değişmiyorsa yazılmaz.
4. Çöp kutusu: tek görevlik öğe türü; not ya da günlük silmede yere göre arşiv; geri yükleme.
5. Project Integrity görev bulguları: kaydı olmayan blok (yetim), notunda bloğu olmayan görev (evsiz), olmayan not, çift referans, bağımlılık
   döngüsü, geçersiz alan, kurala uymayan günlük bölümü. "Yeri olmayan görev" G8'e kadar bulgu sayılmaz (§3.1). Onarım arayüzü G7'dedir.
6. Hatırlatma servisi sürüm 2 alanlarıyla çalışır; hatırlatma girdisi `nodePath` ve `blockId` yerine görevin yerini taşır.
7. `tasks.json` sürüm geçmişi sürüm 2 kayıtlarla çalışır; geri yükleme notlara blok yazmaz, günlük bölümlerini kuraldan üretir (§3.3).
8. Eski günlük yönetilen bölümü (`syncDiaryMissions`, `organizeDiaryManualTasks`, ayraçlar, `project:sync-diary-missions`) kalkar; yerine §3.2.2
   bölümü gelir ve onu yalnız görev servisi yazar. Görevin bitiş gününde günlük oluşturma korunur.
9. Inbox ve `task-capture.js` kalkar. Quick Add `task.create.v1`'e bağlanır; hedef son açık not, yoksa bugünün günlüğüdür (§1.3, §1.4).
   `pisi-quick-add-repeat-policy.mjs` kalkar ve formun Türkçe tarih alanı geri gelir (ayrıştırılan gün `dueDate`, saat `dueTime` olur).
10. Açık not ya da günlük için blok ve bölüm değişikliği editör yolundan yapılır (GV9, `pisi-task-actions.mjs`): editör bloğu ya da bölümü yerinde
    günceller ve kendi kayıt yoluyla yazar.
11. Kalkanlar (§3.4, §3.7): eski komutlar, `quickAddTask` ve `op` seçicisi, `source-of-truth.js`, yol yeniden yazma kancaları,
    `sync-client-desktop.js` görev durumu koruması. `docs/sync-plan.md` SV13 "yansıtma yazması yoktur" diye yeniden yazılır.
12. Renderer: eski görev modülleri bootstrap'tan çıkarılır ve silinir. Yerine `renderer/tasks/pisi-task-store.mjs` gelir. Sağ panelde geçici,
    sade bir liste (öncelik sırasıyla başlık, gün, onay kutusu, notu aç); not editöründe görev bloğunun ve günlük bölümünün geçici çizimi (onay
    kutusu ve başlık; onay kutusu `task.complete` çalıştırır). Tam panel G4'te, düzenlenebilir blok ve satırlar G3'tedir. Editörün eski görev
    komutları (`todo` etiketi seçicisi, `done` komutu) kapatılır.
13. `pisi-definition.md` görev ve günlük bölümleri, `docs/single-source-of-truth.md` ve `docs/domain-command-query.md` güncellenir. Masaüstü
    fixture'ı yeniden üretilir; görevler `task.create.v1` ile oluşturulur (notta, bugünün günlüğünde, ileri tarihli, tekrar eden, tamamlanmış).

**Kabul:**

- `scripts/electron-tasks-service-e2e.mjs`: Ek B'deki S1–S9, S11, S17, S19 ve S21 komut düzeyinde geçer.
- Görev alanı değişikliğinde `.node` okuma ve yazma sayısı 0'dır; görevin günü değişince yalnız ilgili günlükler yazılır; 1.000 notluk projede
  tamamlama tam tarama yapmaz (S8).
- Ortasında hata enjekte edilen bir komut projeyi komut öncesi ya da sonrası durumda bırakır.
- `tests/mobile-desktop-compat.test.mjs` yeni fixture'la geçer; mobilin sürüm 1 yazdığı dosya Integrity'de yeni bulgu vermez.
- Kapanan bulgular: GB1–GB9, GB12, GK4, GK5, GK11, GK12, GK14; `pisi-error.md` §4a ve §4b.

### G3 · Editörde görev bloğu ve günlük bölümü

**Amaç:** görevin notta tek bir blok, günlükte bölümün bir satırı olarak oluşturulması, düzenlenmesi ve silinmesi; dosyaya yalnız kimliğin
yazılması.

**Oku:** `renderer/editor/pisi-block-editor.mjs`, `pisi-task-block-keyboard.mjs`, `pisi-block-keyboard-*.mjs`, `pisi-editor-history*.mjs`,
`pisi-editor-input-policy.mjs`, `pisi-find-replace.mjs`, `renderer/tags/pisi-paste-*.mjs`, `renderer/editor/pisi-editor-file-block.mjs`
(geçici çizim örneği), `renderer/map/pisi-map-workspace.mjs` (`getPisiEditorContent`), `renderer/sync/pisi-sync-live.mjs`,
`docs/editor-keyboard-rules.md`, `docs/editor-paste-rules.md`.

**Önce plan yaz, onay bekle.**

1. `renderer/tasks/pisi-task-block.mjs`: blok çizimi (onay kutusu, başlık alanı, çipler), kayıtta temizleme ve `pisi:task-store-updated` ile
   yerinde güncelleme. Çipe tıklayınca tarih, öncelik, tekrar ya da hatırlatma seçicisi açılır.
2. `renderer/tasks/pisi-task-diary.mjs`: günlük bölümü (§3.2.2): "Görevler" başlığı, satırlar ve o güne göre durumları, bugünde geciken grubu,
   bölümün sonunda görev ekleme satırı, geçmiş tamamlamaların kilidi (§3.2.3), başka nottan gelen satırın menüsü (§1.4).
3. Oluşturma: `/görev` (`todo`) komutu, `[ ]` ve `[]` kısayolu, blok türü menüsü, araç çubuğu ve paragrafı göreve çevirme (metin başlık olur).
   Günlükte oluşturulan görev bölüme girer.
4. Başlık: tek satır; yazdıkça gecikmeli, odak çıkınca hemen `task.update.v1`; Türkçe ve IME bileşim kuralları (`pisi-editor-input-policy.mjs`).
5. Klavye: §1.3'teki Enter kararı (günlük satırında Enter aynı güne yeni görev açar); Backspace, Delete ve oklar blok sınırında.
   `docs/editor-keyboard-rules.md`'deki görev satırı yeniden yazılır.
6. Geri al ve yinele: not geçmişi o nottaki görevlerin alanlarını da saklar. Bir adım geri alınınca o adımda değişen alanlar `task.batch.v1` ile
   geri yazılır; silinen blok geri gelince görev çöp kutusundan döner.
7. Kopyala, kes, yapıştır ve blok çoğaltma (§3.3). Pano görev kaydını taşır (`application/x-pisi-tasks`); başka projeye yapıştırmada yeni kimlik
   verilir. `docs/editor-paste-rules.md` güncellenir.
8. Bul ve değiştir görev başlıklarında çalışır (§3.6).
9. Açık belgeye dışarıdan gelen değişiklik (başka yüzeyden `task.create`, `task.move`, `task.delete`, günlük bölümünün değişmesi) yerinde
   uygulanır (GV9). Senkronla gelen not değişikliği (`pisi-sync-live.mjs`) görev bloklarını ve bölümünü korur.
10. Not açılınca evsiz görev uyarısı (§3.3); "Görev bulunamadı" ve "Görevler okunamadı" görünümleri.

**Kabul:**

- `scripts/electron-tasks-editor-e2e.mjs`: S12–S15 ve S18. Başlık yazılıp kaydedilince not dosyasında yalnız §3.2.1 biçimi, `tasks.json`'da
  başlık bulunur; geri al tamamlamayı ve silmeyi geri getirir; günlükte geçmiş tamamlama kilitlidir, en son tamamlama geri alınır.
- `scripts/electron-editor-keyboard-e2e.mjs` ve `scripts/electron-editor-paste-e2e.mjs` yeni kurallarla geçer.
- Kapanan bulgular: GB14, GK2.

### G4 · Görev paneli, çalışma alanı ve Quick Add

**Amaç:** panelin öncelikli görevleri göstermesi; görevlerin bütün görünümlerde kayıttan çizilmesi ve her işlemin tek komutla yazılması.

**Oku:** G2'de silinen `renderer/tags/pisi-todo-*.mjs` modüllerinin davranışı (git geçmişi), `renderer/productivity/pisi-quick-capture.mjs`,
`shared/date-parser.mjs`, `styles/50-productivity.css` (görev stilleri), `pisi-error.md` §5e.

**Önce plan yaz, onay bekle.**

1. `pisi-task-panel.mjs`: sağ panel ve görev çalışma alanı aynı bileşendir. Varsayılan görünüm "Öncelikli" (§3.6). Süzgeçler (bugün, yaklaşan,
   geciken, tarihsiz, tamamlananları göster), sıralama, durum seçimi, onay kutusu ve görevin yerini açma. Yalnız değişen kartlar yeniden çizilir;
   `MutationObserver` ile sonradan süsleme yoktur.
2. `pisi-task-views.mjs`: kanban (sütun değişince `task.update`), takvim, zaman çizelgesi ve ilerleme (`completions` dahil).
3. `pisi-task-detail.mjs`: bütün alanlar; bağımlılıkta döngü engeli; yer seçimi (`task.move`); "Tamamlanan günler" listesi ve kayıt silme; silme.
4. Sürükle ve bırakla sıralama tek bir `task.batch.v1` yazmasıdır.
5. Quick Add tek formdur: başlık, Türkçe tarih ifadesi ve önizlemesi, öncelik, hedef (son açık not ya da bugünün günlüğü; değiştirilebilir),
   tekrar, hatırlatma. Gözlemci ya da `domain.command` sarmalayıcısı yoktur. Tarih ayrıştırıcı başlıktaki sayıları tarih saymaz
   (`pisi-error.md` §5e; düzeltme `shared/date-parser.mjs`'tedir, mobil de kullanır).
6. Erişilebilirlik: onay kutularının adları, klavyeyle gezinme; TR ve ENG metinler.

**Kabul:**

- `scripts/electron-tasks-panel-e2e.mjs`: S1–S4 ve S19 arayüzden; panel açılınca öncelik sırası; kanbanda sütun değiştirme; ayrıntıda bağımlılık
  döngüsünün engellenmesi; sürükleyip sıralamada tek `tasks.json` yazması.
- 5.000 görevlik projede panelin ilk çizimi ve bir tamamlamanın ekrana yansıması ölçülür ve PR'a yazılır. Hedef: ilk çizim ≤ 300 ms,
  tamamlama ≤ 150 ms.
- Kapanan bulgular: GK6, GK7, GK8; `pisi-error.md` §5e.

### G5 · Görevleri gösteren diğer yüzeyler

**Amaç:** takvim, harita, arama, hatırlatma, gezinme, dışa aktarma ve kopyalamanın aynı kaydı ve aynı gün kuralını kullanması.

**Oku:** `renderer/calendar/*`, `renderer/map/pisi-map-operational-render.mjs`, `renderer/search/pisi-search-enhanced-index.mjs`,
`renderer/search/pisi-search-index.mjs`, `renderer/tags/pisi-reminder-panel.mjs`, gezinme modülü (`pisi-todo-navigation.mjs`'in yerine
gelen), `main/functions/portability.js`, `main/functions/map-node-copy*.js`, `main/functions/store-history*.js`,
`renderer/portability/pisi-store-history-panel.mjs`.

**Önce plan yaz, onay bekle.**

1. Takvim belirteçleri gün kuralından (§3.2.2) çizilir; güne tıklayınca o günün günlüğü açılır. `missionIndex` yolu kalkar.
2. Harita rozetleri ve bağımlılık katmanı `noteId`'ye göre çalışır; rozet metni TR ve ENG.
3. Arama: tek görev kaydı üreticisi; mobilde oluşturulan ve günlükteki görevler dahil. Sonuçtan görev ayrıntısına ya da görevin yerine gidilir.
4. Hatırlatma paneli: "Tamamla" `task.complete`; açma görevin yeri ve kimliğiyle.
5. Gezinme yer ve görev kimliğiyle kesindir; tahmin ve yazma yoktur.
6. Dışa aktarma ve içe aktarma (§3.6).
7. Not kopyalama görevleri yeni kimlikle kopyalar.
8. Not sürüm geçmişinden geri yükleme §3.3'e uyar.

**Kabul:**

- `scripts/electron-tasks-surfaces-e2e.mjs`: S10 ve S16; takvim belirteçleri günlük bölümüyle aynı günleri gösterir; arama mobilde
  oluşturulan görevi bulur; dışa aktarılan Markdown görev satırlarını içerir ve geri içe aktarılınca görev olur.
- `scripts/electron-reminders-e2e.mjs` ve `scripts/electron-store-history-e2e.mjs` yeni modelle geçer.
- Kapanan bulgular: GB11, GK3, GK9, GK10.

### G6 · Görevlerde etiket ve not bağlantısı

**Amaç:** başlık düz metne geçince kaybolan iki yeteneği kayıt üzerinden geri getirmek.

**Önce plan yaz, onay bekle.**

1. `tags` alanı (ör. `["proje", "acil"]`): görev bloğunda, günlük satırında ve ayrıntıda çip olarak düzenlenir. Etiketler paneli etiketli görevleri
   de listeler (`tasks.json`'dan; tarama yok).
2. Başlıkta `[[Not]]` yazımı bağlantı olarak gösterilir. Bağlantılar paneli ve geri bağlantılar görevleri de sayar. Not yeniden adlandırılınca
   görev başlığındaki bağlantı da güncellenir (`shared/wiki-link-core.mjs`).

**Kabul:** etiket ve bağlantı için davranış testleri ve E2E; yeniden adlandırmada notlar ve görev başlıkları tek atomik mutation'da güncellenir.

### G7 · Bütünlük, onarım, ölçüm ve temizlik

**Önce plan yaz, onay bekle.**

1. Integrity arayüzünde görev bulgularının onarımları: yetim blok (çöp kutusundan geri getir ya da bloğu kaldır), evsiz görev (sona ekle),
   olmayan not (bugünün günlüğüne bağla), çift referans (kopyayı yeni göreve çevir), döngü (bağımlılığı kaldır), kurala uymayan günlük bölümü
   (yeniden üret).
2. Büyük proje ölçümü (`scripts/generate-project-fixture.mjs`'e notlarda görev bloğu ve günlük bölümü seçeneği eklenir): 2.000 not ve 5.000 görevle
   proje açılışı, panel, 200 görev bloklu bir notun açılışı, tamamlama, oluşan günlük sayısı ve `completions` ile `tasks.json` boyutu. Sonuçlar
   bir zamanlama dosyasına yazılır.
3. Kalan eski kod, kullanılmayan CSS ve regex testleri kaldırılır; `module-manifest.json` dosyaları temizlenir.

**Kabul:** onarım E2E'si; ölçüm sonuçları PR'da; `check:architecture` ve `check:types` eski bağlamaları göstermez. Kapanan bulgular: GK1, GK13,
GK15.

### G8 · Mobil: sürüm 2 görevler ve açılışta gün

**Amaç:** mobilin aynı kurallarla çalışması, açılışta o günle ilgili her şeyi göstermesi ve not görevlerinde tam düzenleme.

**Oku:** `docs/mobile-plan.md` §0, §2, §3.6; `mobile/src/data/task-repo.mjs`, `mobile/src/data/diary-repo.mjs`, `mobile/src/screens/pisi/*`,
`mobile/src/screens/tasks/*`, `mobile/src/screens/notes/note.mjs`, `mobile/src/ui/task-add.mjs`, `mobile/src/screens/calendar/calendar-model.mjs`.

**Önce plan yaz, onay bekle.**

1. `TaskRepo` sürüm 2: kayıt kuralları ve tamamlama `shared/task-model.mjs`'ten gelir (§3.2.3); geri alma aynı bilgiyle yapılır; dosya
   `version: 2` yazılır.
2. Her görevin yeri olur: Pisi sekmesindeki ekleme satırı seçili günün günlüğüne, Görevler sekmesindeki ekleme bugünün günlüğüne yazar. Görevin
   günleri değişince mobil de günlük bölümünü ve gereken günlüğü aynı ortak kodla yazar (GV15; öbür bloklar bayt bayt aynı kalır, V8).
3. Açılış ekranı (Pisi sekmesi): bugünün günlüğü, günün görev bölümü (aynı kural) ve gecikenler ek dokunuş olmadan görünür. Geçmiş günde
   tamamlama kilidi §3.2.3'e uyar. Görevler sekmesi ikincil kalır.
4. Not görevlerinde bütün alanlar düzenlenir; `isNoteTask` kısıtı ve "Masaüstünde nottan düzenlenir" metni kalkar. `pisi-error.md` §5d kapanır.
5. Not görünümü görev bloğunu kimlikle çizer (G1). Not editöründe görev bloğu ekleme: önce `tasks.json`, sonra blok.
6. Hızlı ekle G4'teki ayrıştırıcı düzeltmesiyle çalışır. Günlük yönetilen bölümüyle ilgili eski kod kalkar.
7. Integrity "yeri olmayan görev" denetimini açar; onarımı görevi bugünün günlüğüne bağlar (§3.1).

**Kabul:** `npm --prefix mobile run validate` ve `npm --prefix mobile run e2e` (S20 dahil) geçer; `tests/mobile-desktop-compat.test.mjs` geçer ve
mobilin yazdığı proje masaüstü Integrity'de yeni bulgu vermez; masaüstü ve mobil aynı `tasks.json`'dan aynı günlük bölümünü üretir; telefon görev
silmez (V9). Kapanan bulgular: GB5 (mobil tarafı).

### G9 · Senkron

**Amaç:** yeni modelin iki cihazda metin ve görev kaybettirmeden birleşmesi.

**Oku:** `docs/sync-plan.md` §0, §2, §3.4, §3.10; `shared/sync-merge-authority.mjs`, `shared/sync-merge-node.mjs`, `shared/sync-conflict.mjs`,
`scripts/sync-e2e-matrix.mjs`, `scripts/generate-sync-vectors.mjs`.

**Önce plan yaz, onay bekle.**

1. `completions` birleşimi: kayıtlar tamamlanan tekrarın bitiş gününe (`dueDate`) göre birleşir; aynı tekrar iki tarafta tamamlanmışsa önce
   tamamlanan kalır, öbürü çakışma günlüğüne yazılır. Test vektörleri yenilenir.
2. Günlük görev bölümü birleştirilmez: iki taraf farklıysa çakışma kopyası açılmaz, bölüm birleşik `tasks.json`'dan yeniden üretilir (GV15).
   Aynı gün için iki cihazda ayrı oluşan günlük (matris senaryosu 4) tek günlük ve tek bölüm bırakır; günlükteki görevlerin yeri (`diaryDate`)
   korunur.
3. Çakışma kopyası görev bloklarını ve görev bölümünü almaz (`stripPisiTaskBlocks`, §3.3).
4. Matris senaryoları: telefon tekrar eden görevi tamamlar ve masaüstü başlığını değiştirir; iki cihaz aynı tekrarı tamamlar (tek ilerleme);
   masaüstü görev bloğunu siler ve telefon aynı görevi düzenler (silme kazanır, kaybeden değer çakışma günlüğüne yazılır); iki cihaz aynı güne
   çevrimdışı görev ekler (tek günlük, iki satır); telefonda ileri tarihli görev o günün günlüğünü iki cihazda aynı baytlarla oluşturur.
5. `docs/sync-plan.md` §3.4 güncellenir. Birleştirme kuralı istemcidedir; protokol sürümü değişmez.

**Kabul:** `npm run test:sync-server` ve `PISI_SYNC_MATRIX_E2E=1 npm run test:sync-server` geçer; iki cihaz en çok 4 turda durulur; her
senaryodan sonra iki tarafta Integrity yeni bulgu vermez.

### G10 · Cihazda kabul

- `docs/task-qa.md`: gerçek masaüstü, gerçek telefon ve kullanıcının sunucusuyla elle uygulanan kabul listesi (oluşturma yolları, Quick Add hedefi,
  tamamlama, tekrar ve geçmiş günlükler, silme ve geri alma, kes ve yapıştır, günlük ve takvim, telefonda açılış, arama, hatırlatma, iki cihaz).
- **Kabul:** kullanıcı listeyi uygular; bulunan hata `pisi-error.md`'ye yazılır.

---

## 5. Kapsam dışı

- Eski görev işaretini ve eski `tasks.json` alanlarını dönüştüren geçiş adımı (§1.3).
- Bir görevi günlükler dışında birden çok notta blok olarak gösterme (yansıma bloğu).
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
| GB8    | Açık olan nota Quick Add: editör bloğu göstermiyor; kullanıcı yazıp kaydedince blok dosyadan siliniyor ve görev yetim kalıyor (not içeriği kaybı).                                                                                                                                                                                                   | G2          |
| GB9    | Her panel işlemi ve not kaydı bütün notları yeniden okuyor; 1.000 notta tarama ~1,5 sn sürüyor.                                                                                                                                                                                                                                                      | G2          |
| GB10   | Tarihi olan her görev o gün için bir günlük dosyası oluşturuyor (2027 ve 2028 tarihli görevler için `diary/2027-03-15.node` ve `diary/2028-01-02.node`). **İstenen davranış; hata değil** (§1.3). Yeni modelde korunur.                                                                                                                              | —           |
| GB11   | Notu olmayan görevler masaüstü aramasında görünmüyor.                                                                                                                                                                                                                                                                                                | G5          |
| GB12   | Günlükteki onay kutusuyla tamamlanan tekrar eden görevin sonraki tekrarı oluşmuyor; görev tekrar etmeyi bırakıyor.                                                                                                                                                                                                                                   | G2          |
| GB13   | Günlük eşitlemesi, günlük notundaki kullanıcı görev bloğunu notun altındaki görev bölümüne taşıyor. **İstenen davranış; hata değil** (§1.3). Yeni modelde görev oluşturulurken doğrudan bölüme girer; dosyaya yazılan sabit Türkçe "Görevler" başlığı kalkar (§3.2.2).                                                                               | —           |
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

S1–S14 ve S16 incelemede geçici CDP betikleriyle uygulamada çalıştırıldı (21-11-2026); öbürleri yeni modelin senaryolarıdır. Fazlar bunları
kalıcı E2E'ye çevirir. Her senaryonun sonunda Integrity yeni bulgu vermemelidir.

| Kimlik | Senaryo                                                           | Beklenen (yeni model)                                                          | 21-11-2026 sonucu                    |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| S1     | Notta ve günlükte birer görev; panelden biri zamanında tamamlanır | `tasks.json`'da `done`; panel işaretli; hiçbir `.node` yazılmaz                | GB1                                  |
| S2     | Tekrar eden görev tamamlanır                                      | §3.2.3 adım 1–2: görev ilerler, `completions` bir artar; o gün ☑, ertesi gün ☐ | GB2                                  |
| S3     | Paneldeki durum değiştirilir                                      | `tasks.json` hemen değişir; dosya yazılmaz                                     | GB3                                  |
| S4     | Mobilde oluşturulan görev masaüstünde tamamlanır ve düzenlenir    | Olur; kayda sahte kaynak eklenmez; mobilde düzenlenebilir kalır                | GB4, GB5                             |
| S5     | Hatırlatmadan tamamlanır, sonra not düzenlenir                    | `done` kalır                                                                   | GB6                                  |
| S6     | Görev bloğu silinir ve not kaydedilir; sonra geri alınır          | Görev çöp kutusuna gider ve günlüklerden çıkar; geri alınca döner              | GB7                                  |
| S7     | Açık nota Quick Add                                               | Blok editörde hemen görünür; kayıttan sonra dosyada kalır                      | GB8                                  |
| S8     | 1.000 not ve 5.000 görev; tamamlama                               | Tarama yok; `.node` okuma ve yazma 0; süre PR'a yazılır                        | GB9                                  |
| S9     | İleri tarihli görev oluşturulur                                   | O günün günlüğü yoksa oluşur; görev bölümünde görünür; takvimde belirteç çıkar | Günlük oluşuyor (istenen, GB10)      |
| S10    | Mobilde oluşturulan görev aranır                                  | Bulunur                                                                        | GB11                                 |
| S11    | Günlükte tekrar eden görev tamamlanır                             | §3.2.3 adım 1–2                                                                | GB12                                 |
| S12    | Günlükte `[ ]` ile görev yazılır                                  | Görev hemen bölüme girer; bitiş günü o gün; dosyaya başlık yazılmaz            | Eşitlemede taşınıyor (istenen, GB13) |
| S13    | Normal notta `[ ]`, slash komutu ve blok türüyle görev oluşturma  | Üçü de görev oluşturur                                                         | GB14                                 |
| S14    | Başlık editörde yazılır ve kaydedilir                             | Not dosyasında yalnız §3.2.1 biçimi; başlık `tasks.json`'da                    | —                                    |
| S15    | Kes ve başka nota yapıştır; kopyala ve yapıştır                   | Kesmede kimlik aynı kalır, yer değişir; kopyada yeni kimlik                    | —                                    |
| S16    | Haritada not kopyalanır                                           | Görevler yeni kimlikle kopyalanır                                              | GK9                                  |
| S17    | Not ve günlük çöp kutusuna gider ve geri yüklenir                 | Yeri orası olan görevler birlikte gider ve döner                               | —                                    |
| S18    | Geçmiş günlükte tamamlanmış tekrarın işareti kaldırılmak istenir  | §3.2.3 adım 3–4: en son tamamlama geri alınır, daha eskisi kilitli             | —                                    |
| S19    | Quick Add açılır                                                  | Açık not varken hedef o not; açık not yokken bugünün günlüğü; Inbox oluşmaz    | Inbox'a yazıyor                      |
| S20    | Telefonda uygulama açılır (G8, Playwright)                        | Bugünün günlüğü, günün görevleri ve gecikenler ek dokunuş olmadan görünür      | —                                    |
| S21    | Geciken tekrar tamamlanır                                         | §3.2.3 adım 5: tamamlama bugün; görev bugünden sonraki ilk tekrara ilerler     | —                                    |
