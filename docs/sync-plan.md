# Pisi Sync — Claude Code iş tanımı

Sürüm: 1 · 16-11-2026 · Repo: `maggezer/Pisi` · Hedef: masaüstü ile Pisi Mobil arasında Pisi'nin kendi sunucusu üzerinden, uçtan uca şifreli ve metin kaybettirmeyen senkron

Bu belge repoda `docs/sync-plan.md` olarak durur. Pisi'nin kendi eşleştirme ve senkron sistemini faz faz tanımlar (S0–S8).
Tel üzerindeki biçim (uç noktalar, JSON'lar, hata kodları, şifreleme, tehdit modeli) ayrı belgededir: [`docs/sync-protocol.md`](sync-protocol.md).
Pisi Mobil'in kendisi [`docs/mobile-plan.md`](mobile-plan.md) ile geliştirildi; bu belge onun §8'indeki "aktarım planı"dır.

---

## 0. Çalışma biçimi (her oturumda geçerli)

1. Oturumun başında şunları oku: `CLAUDE.md`, bu belge, `docs/sync-protocol.md`, `pisi-definition.md`, `docs/single-source-of-truth.md`.
   Mobil fazlarda (S4, S5, S6) `docs/mobile-plan.md` §0, §2 ve §3.6'yı da oku. Fazın ilgili dosyaları her fazda listelenmiştir.
2. **Her oturumda tek faz.** Fazlar sırayla yapılır. Önceki faz birleştirilmeden (merge) sonraki başlamaz.
3. Her faz **tek PR**dır (CLAUDE.md kural 1). Başlık Conventional Commits biçimindedir; kapsam `sync`, `shared`, `server`, `mobile` veya `ci` olur.
   Örnek: `feat(server): senkron sunucusunun ilk sürümü`. Açıklamada ilgili madde kimlikleri yazılır (ör. `S2, SV4, SV9`).
4. CLAUDE.md'deki "Definition of Done" senkron işleri için de geçerlidir. Senkron PR'ları için ek koşullar §3.10'dadır.
5. Birden fazla modülü etkileyen fazlarda (**S1, S3, S4, S5, S6**) önce kısa bir uygulama planı yaz ve onay bekle (CLAUDE.md kural 5).
6. **Karar belirsizse sor, varsayma.** Masaüstü davranışı esastır. Bu belge ile masaüstü kodu çelişirse kodu esas al ve PR'da belirt.
   Bu belge ile `docs/sync-protocol.md` çelişirse dur ve sor; protokol değişikliği iki belgeyi birlikte değiştirir.
7. Bir araç, erişim ya da komut çalışmazsa etrafından dolanan geçici çözüm kurma. Önce asıl sorunu çöz ya da açıkça bildir.
8. **Yeni bağımlılık eklemeden önce sor** (QR kodlayıcı, QR okuyucu, kripto kütüphanesi vb.). Kripto için önce platformun kendi Web Crypto API'si kullanılır.
9. **Gerçek sunucu adresi, kurulum anahtarı, token ya da şifreleme anahtarı repoya, test çıktısına, log'a veya PR açıklamasına yazılmaz.**
10. Her PR açıklamasının sonuna aşağıdaki **oturum raporunu** ekle.

```text
### Oturum raporu
- Madde(ler): S?, SV?
- Yapılanlar: (kısa maddeler)
- Testler: (çalıştırılan komutlar ve sonuçları)
- Ekran görüntüleri: (arayüz değiştiyse; CI artifact adı yeterli)
- Belgede olmayan, benim verdiğim kararlar:
- Bilinen eksikler / riskler:
- Protokole etkisi: (yok / docs/sync-protocol.md şu bölümler; sürüm değişti mi)
- Masaüstüne / mobile etkisi: (yok / şu dosyalar, şu testler)
```

---

## 1. Bağlam

### 1.1 Eski klasör tabanlı senkron (kapalı)

- `main/functions/sync-core.js`, `sync-domain.js`, `sync-project-adapter.js` ve `renderer/sync/pisi-sync-settings.mjs` Google Drive/OneDrive gibi ortak bir klasör üzerinden çalışan bir senkron kuruyordu.
    - Proje, varlık (`node`, `map`, `task`, `config`) kayıtlarına çevriliyor; her cihaz `.pisi-sync/devices/` altına parçalı bir anlık görüntü yazıyor; kayıtlar sayaç + cihaz kimliğiyle (Lamport benzeri) birleştiriliyordu. Cihaza özel durum `.pisi/sync-state.json` içindeydi.
    - Her senkrondan sonra `window.loadProject()` çağrılıyor, açık not kapanıyor ve yazım sırasında metin kaybolabiliyordu (`pisi-error.md` §4).
- 05-11-2026'dan beri `PISI_LEGACY_SYNC_ENABLED = false` ile kapalıdır. IPC çağrıları `PISI_SYNC_DISABLED` döner; `.pisi-sync`, `.pisi/sync-state.json` ve ayarlar okunmaz, yazılmaz. Kullanıcı projelerinde bu dosyalar durabilir.
- **Yeni sistemde alınacaklar:** `stableStringify`; içerik adresli varlıkta "dosya adı = içeriğin SHA-256'sı" doğrulaması (`inspectPisiSyncEditorAsset`); sidecar yolu güvenlik kontrolleri; çakışma kopyasına yeni kimlik verme fikri (`makeConflictRecords`).
- **Alınmayacaklar:** varlık kaydı modeli, sayaç/cihaz sürüm saati, cihaz anlık görüntüleri, ortak klasör. Yeni sistemin birimi dosyadır ve sıralamayı sunucu verir.
- Eski kod yeni sistem uçtan uca çalışınca (S7) kaldırılır. Eski dosyaların yolları ise senkron dışında tutulmaya devam eder (SV7).

### 1.2 Mobil (M0–M10 tamam)

- Pisi Mobil `Directory.Data/projects/default/` altında masaüstüyle aynı biçimde bir proje tutar (`docs/mobile-plan.md` §3.3).
- Bütün yazmalar `mobile/src/data/project-writer.mjs` içindeki `ProjectWriter`'dan geçer: tek kuyruk, değişmeyen dosya yazılmaz, atomik yazma, her yazmadan sonra `fileChanged(key)`. Bugün diske senkron metadata'sı yazılmaz.
- Mobil not silmez, yeniden adlandırmaz, görev silmez (V9). Haritalar salt okunurdur. Not içinde yalnız paragraf, başlık 1–3 ve madde blokları düzenlenir; geri kalanı bayt bayt korunur (V8).
- Kaynağı not bloğu olan görevde mobil yalnız `tasks.json`'daki durumu değiştirir; nottaki işaret eski kalır (`pisi-error.md` §5d). Senkron bu riski gerçek hâle getirir (bkz. S3 adım 7).

### 1.3 Verilmiş kararlar

| Konu                  | Karar                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu                | Kullanıcının cPanel hosting'i: PHP 8.4, MariaDB 10.11. Sürekli çalışan süreç ve WebSocket yok. HTTPS (AutoSSL).                                                                                                     |
| Sunucu kodu           | Repoda `server/` klasörü, framework yok. Uygulama kodu, ayarlar, veri ve blob klasörü `public_html` dışında; web köküne yalnız ön denetleyici (`index.php`) ve `.htaccess` konur.                                   |
| Model                 | Sunucu proje alanı başına artan sıra numaralı bir **değişiklik günlüğü** ve içerik özetine göre adlandırılmış **blob**'lar tutar. Cihazlar "şu numaradan sonrasını ver" diye yoklar.                                |
| Yoklama               | Açılışta, uygulamaya dönüşte, yazmadan birkaç saniye sonra, masaüstünde aralıklı ve elle.                                                                                                                           |
| Şifreleme             | Uçtan uca. Sunucu yalnız şifreli içerik ve en az metadata görür; dosya yolları da açık gitmez. Anahtar eşleştirmede cihazdan cihaza geçer, sunucu anahtarı hiç görmez.                                              |
| Eşleştirme            | Masaüstü QR ve tek kullanımlık kısa yedek kod gösterir. Telefon QR'ı kamerayla okur ya da kodu elle girer. Kodla eşleşmede iki ekranda 6 haneli **doğrulama numarası** karşılaştırılır.                             |
| Cihaz yetkisi         | Cihaz başına token. Masaüstünden cihaz iptali.                                                                                                                                                                      |
| Sunucu alanları       | Sunucu birden çok proje alanı tutar. Yeni alan yalnız kurulumda sunucu ayarına yazılan **kurulum anahtarı** ile açılır. Telefon tek bir alana bağlanır.                                                             |
| Anahtar saklama       | Masaüstü: Electron `safeStorage`. Telefon: repo içindeki küçük bir Capacitor eklentisi; anahtar Android Keystore'daki bir anahtarla sarılır, sarılı hâli `Directory.Data` altında durur. Dış bağımlılık yok.        |
| Ekler                 | Görseller ve dosya ekleri telefona açılınca iner. Bağlantı yoksa yer tutucu görünür.                                                                                                                                |
| Senkron birimi        | Projeye göre yolu olan dosya.                                                                                                                                                                                       |
| `.node` birleştirme   | Temel sürüme göre üç yollu karşılaştırma. Uzlaşmayan değişiklikte çakışma kopyası; metin kaybı yok.                                                                                                                 |
| Otorite dosyaları     | `tasks.json`, `relationships.json`, `properties.json` kayıt kimliğine göre birleştirilir (mobile-plan V5).                                                                                                          |
| Silme                 | "Silindi" kaydıyla yayılır. Masaüstünde silinen dosya telefonda da kalkar. Telefon kendisi silme yapmaz (V9); sunucu da telefondan gelen silmeyi reddeder.                                                          |
| Senkron edilmeyenler  | `.pisi-sync/`, `.pisi-history/`, `.pisi/mutations/`, `.pisi/trash/`, `.pisi/reminder-state.json`, eski senkronun `.pisi/sync-state.json`'u, geçici dosyalar ve cihaza özel dosyalar (tam liste: §3.3).              |
| Yeniden yükleme yok   | Senkron sonrası proje baştan yüklenmez; yalnız değişen belge güncellenir, açık not ve imleç korunur (`pisi-error.md` §4).                                                                                           |
| İlk eşleşmede telefon | Telefondaki proje boş değilse kullanıcıya sorulur: "Telefondakileri projeye ekle" (boş temelle birleştirme) ya da "Telefondakileri kenara koy" (eski proje silinmeden ayrı klasöre taşınır, sunucudaki proje iner). |
| Kod yeri              | Saf kurallar `shared/sync-*.mjs`. Eski `sync-core.js`'teki uygun mantık taşınabilir. Eski kapalı sync kodu yeni sistem çalışınca kaldırılır.                                                                        |

---

## 2. Değişmez veri kuralları

Bu kurallar her fazda geçerlidir. Bir PR bunlardan birini çiğniyorsa bitmiş sayılmaz. `docs/mobile-plan.md` §2'deki V1–V10 senkron için de geçerlidir.

- **SV1 · Tek kaynak yine dosyalardır:** Senkron, proje dosyalarının yerine geçen bir veri kaynağı kurmaz. Sunucudaki günlük ve blob'lar, cihazdaki senkron durumu (temel kopyalar, indeks, imleç) yalnız aktarım ve birleştirme içindir. Senkron durumu silinirse cihaz yeniden eşleşerek ya da tam karşılaştırmayla toparlanır; proje dosyası kaybolmaz.
- **SV2 · Proje klasörüne senkron metadata'sı yazılmaz:** Cihaz durumu, token ve anahtar proje klasörünün dışında tutulur (masaüstü: uygulamanın kullanıcı veri klasörü; telefon: `Directory.Data/sync/`). Proje klasörünü kopyalamak eşleşmeyi ya da anahtarı kopyalamaz.
- **SV3 · Metin kaybı yok:** İki cihazın aynı temelden yaptığı değişiklikler uzlaşamıyorsa bir taraf sessizce ezilmez. `.node` için kaybeden sürüm **çakışma kopyası** olarak yeni bir not olur. Otorite dosyalarında aynı alan iki tarafta farklı değiştiyse kural §3.4'tedir ve kaybeden değer cihazın çakışma günlüğüne yazılır.
- **SV4 · Kaydedilmemiş değişikliğin üzerine yazılmaz:** Uzaktan gelen bir değişiklik, kaydedilmemiş düzenlemesi olan açık belgeye uygulanmaz. Önce bekleyen kayıt diske yazılır (flush), sonra üç yollu birleştirme yapılır. Kayıt yapılamıyorsa o dosya bu turda ertelenir.
- **SV5 · Baştan yükleme yok:** Senkron `loadProject` (masaüstü) ya da proje yeniden açılışı (mobil) çağırmaz. Yalnız değişen dosyalar ele alınır; açık not, sekmeler, modal, harita, kaydırma ve imleç korunur. Silinen ya da taşınan dosya açıksa yalnız o yüzey kapanır ve kullanıcıya söylenir.
- **SV6 · Biçim ve bütünlük:** Senkronun yazdığı her dosya `pisi-definition.md`'ye uyar. Birleştirme ya da çakışma kopyası Project Integrity'de **yeni bulgu** üretmez. Çakışma kopyası yeni `node_…` kimliği ve kendi sidecar'ıyla oluşur; aynı kimlik iki dosyada bulunmaz.
- **SV7 · Senkron dışı yollar:** §3.3'teki liste `shared/sync-paths.mjs` içinde tek yerde tanımlıdır ve sunucuya gitmez, sunucudan gelen değişiklikle de yazılmaz.
- **SV8 · Sunucuya açık veri yok:** Dosya içeriği, dosya yolu, başlık, proje adı ve cihaz adı sunucuya yalnız şifreli gider. Sunucunun gördüğü alanlar `docs/sync-protocol.md` §11.2'de tek tek listelidir; yeni bir açık alan protokol değişikliğidir.
- **SV9 · Doğrulanmayan veri uygulanmaz:** Çözülemeyen (AEAD doğrulaması tutmayan), şeması geçersiz, yolu güvensiz (`..`, mutlak yol, senkron dışı yol, sembolik bağlantı hedefi) ya da içerik adresli adı içeriğinin SHA-256'sıyla tutmayan bir değişiklik diske yazılmaz ve senkron durumunda gösterilir.
- **SV10 · Bozuk dosya yayılmaz:** JSON'u bozuk yerel dosya (`.node`, `.map`, `.pisi/*.json`, `.pisi-*.json`) ne gönderilir ne de uzaktan gelenle ezilir (V7). Uzaktan gelen ve çözüldükten sonra JSON olarak okunamayan içerik de yazılmaz.
- **SV11 · Atomik uygulama:** Masaüstünde bir senkron turunun yazdığı dosyalar tek bir atomik mutation içinde yazılır (`docs/atomic-mutations.md`); kesilirse proje turun öncesine ya da sonrasına döner. Mobilde her dosya `ProjectWriter` ile atomik yazılır; imleç (cursor) yalnız tur bütünüyle uygulanınca ilerler ve tur yeniden oynatılırsa aynı sonucu verir.
- **SV12 · Telefon silmez:** Telefon silme değişikliği üretmez (V9). Telefonda eksik bulunan dosya "silindi" sayılmaz, yeniden indirilir. Sunucu `member` rolündeki cihazdan gelen silmeyi `DELETE_NOT_ALLOWED` ile reddeder.
- **SV13 · Yansıtma yazmaları otoriteyi geri almaz:** Uzaktan gelen `tasks.json` uygulandıktan sonra masaüstündeki görev yansıtma eşitlemesi (not içi işaretten normalize etme) canonical durumu geri çeviremez (`pisi-error.md` §5d). Bu S3'te testle sabitlenir.

---

## 3. Hedef mimari

### 3.1 Klasör yapısı

```text
shared/
  sync-paths.mjs          yol normalizasyonu, senkron dışı liste, dosya sınıfı (node/map/authority/json/asset/other), fid girdisi
  sync-crypto.mjs         anahtar türetme, zarf (envelope) kodla/çöz, fid ve blob kimliği, doğrulama numarası (crypto dışarıdan verilir)
  sync-meta.mjs           şifreli değişiklik metadata'sının şeması ve doğrulaması
  sync-merge-json.mjs     genel üç yollu JSON birleştirme (nesne anahtarına ve kimlikli dizi öğesine göre)
  sync-merge-authority.mjs tasks/relationships/properties kayıt kimliğine göre birleştirme
  sync-merge-node.mjs     .node üç yollu birleştirme (blok kimliğine göre) ve çakışma kopyası içeriği
  sync-conflict.mjs       çakışma kopyası adı, başlığı, yeni kimliği ve sidecar'ı
  sync-reconcile.mjs      saf karar motoru: yerel indeks + temel + uzak değişiklikler → eylem listesi
  note-blocks.mjs         mobile/src/data/note-blocks.mjs (+ html-tokens.mjs) buraya TAŞINIR; mobil buradan import eder
server/                   PHP 8.4, framework yok
  public/                 web köküne giden tek kısım: index.php, .htaccess
  app/                    public_html DIŞINA kurulur: src/*.php, config.sample.php, schema/*.sql, bin/gc.php
  tests/                  sunucuya özel küçük denetimler (php -l, kurulum düzeni)
main/functions/
  sync-client-*.js        HTTP istemcisi, cihaz durumu, motorun masaüstü bağlantısı, uygulama (apply), domain sözleşmeleri
renderer/sync/            Ayarlar → Senkron, eşleştirme penceresi (QR + kod + doğrulama numarası), cihazlar, çakışma günlüğü
mobile/src/sync/          mobil senkron motoru bağlantısı: http, durum deposu, tetikleyiciler (Capacitor'ı DOĞRUDAN import etmez)
mobile/src/platform/      secrets.mjs (Keystore eklentisi köprüsü), QR okuyucu köprüsü, dosya açma köprüsü
mobile/android/app/src/main/java/…/PisiSecretsPlugin.java   repo içi Keystore eklentisi
tests/shared-sync-*.test.mjs, tests/sync-*.test.mjs, tests/sync-server-contract*.test.mjs
docs/sync-plan.md, docs/sync-protocol.md, docs/sync-server-cpanel.md (S2), docs/sync-qa.md (S8)
.github/workflows/sync-server.yml   PHP 8.4 + MariaDB 10.11 ile sunucu sözleşme testleri ve uçtan uca senaryolar
```

### 3.2 Senkron modeli

- **Proje alanı (space):** sunucuda bir projeye karşılık gelen alan (`sp_…`). Masaüstü kurulum anahtarıyla açar, proje anahtarını (`K`, 32 bayt) yerelde üretir.
- **Dosya kimliği (fid):** `fid = HMAC(K_fid, normalize(yol))`. Sunucu yolu görmez, yalnız bu opak kimliği görür. Yol normalizasyonu (NFC, `/`, büyük-küçük harf katlama) `shared/sync-paths.mjs`'tedir; büyük-küçük harf yüzünden çakışan iki yol senkron edilmez ve gösterilir.
- **Blob:** dosyanın şifreli içeriği. Kimliği `HMAC(K_blob, düz içerik)`'tir; aynı içerik bir kez saklanır ama sunucu bilinen bir dosyayı kimliğinden tanıyamaz. Çakışma kopyası gibi yeni yollar, var olan blob'u baytlarını indirmeden yeniden kullanabilir.
- **Değişiklik günlüğü:** her kayıt `{seq, fid, op: put|delete, blob, size, device, baseSeq, meta(şifreli)}`. `seq` alan içinde artan tam sayıdır ve tek sıralama kaynağıdır.
- **Başlık (head):** her fid için son kayıt. Gönderim (commit) karşılaştır-ve-değiştir ile yapılır: değişiklik, gönderenin gördüğü `baseSeq` sunucudaki başlıkla aynıysa kabul edilir; değilse tüm toplu gönderim `STALE_BASE` ile reddedilir ve hiçbir kayıt yazılmaz.
- **Cihazdaki durum (SV2):** sunucu adresi, alan, cihaz kimliği, imleç (son uygulanan `seq`), her yol için `{fid, seq, blob, size, mtime}` indeksi ve birleştirilebilir dosyaların **temel kopyası** (son senkronlanmış içerik; yalnız `.node`, `.map`, `.pisi/*.json`, `.pisi-*.json`). İçerik adresli ekler için temel kopya tutulmaz.
- **Silme:** masaüstünde silinen dosya `op: delete` kaydıdır. Yeniden adlandırma ve taşıma: eski yolda `delete` + yeni yolda `put`; ikisi aynı toplu gönderimdedir ve şifreli metadata'daki `nodeId`/`mapId` ile eşleştirilir.

Ayrıntılar ve tel biçimi: `docs/sync-protocol.md` §4–§8.

### 3.3 Neyin senkron edildiği

Proje kökünden itibaren her dosya, aşağıdakiler **dışında**, senkron edilir:

| Yol / desen                                                                    | Neden                                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `.pisi-sync/`, `.pisi/sync-state.json`                                         | kapalı eski senkronun dosyaları                                                 |
| `.pisi-history/`                                                               | sürüm geçmişi; cihaza özel kurtarma verisi                                      |
| `.pisi/mutations/`                                                             | atomik mutation günlüğü; geçici                                                 |
| `.pisi/backups/`, `.pisi/sync-trash/`                                          | atomik yazma ve bozuk dosya yedekleri, eski senkronun çöpü; cihaza özel (S3)    |
| `.pisi/trash/`                                                                 | çöp kutusu; cihaza özel kurtarma verisi (geri yükleme yalnız silen masaüstünde) |
| `.pisi/reminder-state.json`                                                    | hatırlatma sunum durumu; cihaza özel                                            |
| `*.tmp`, `.*.mobile-*.tmp`, `*.pisi-backup`, `.pisi.lock`                      | geçici dosyalar, atomik yazma artıkları, kilit                                  |
| `.git/`, `node_modules/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*`       | araç ve işletim sistemi dosyaları                                               |
| sembolik bağlantılar, proje dışına çözülen yollar                              | güvenlik (`path-security.js` ile aynı kural)                                    |
| sunucunun bildirdiği en büyük dosya boyutunu aşan dosyalar (varsayılan 64 MiB) | barındırma sınırı; Ayarlar'da "senkron edilmeyen dosyalar"                      |

Dosya sınıfları ve telefondaki indirme biçimi:

| Sınıf       | Örnek                                                                   | Birleştirme (§3.4)      | Telefonda                     |
| ----------- | ----------------------------------------------------------------------- | ----------------------- | ----------------------------- |
| `node`      | `*.node`, `diary/*.node`                                                | blok düzeyinde üç yollu | hemen iner                    |
| `map`       | `*.map`                                                                 | kimlikli JSON üç yollu  | hemen iner                    |
| `authority` | `.pisi/tasks.json`, `.pisi/relationships.json`, `.pisi/properties.json` | kayıt kimliğine göre    | hemen iner                    |
| `json`      | `.pisi-views.json`, `.pisi-templates.json`, diğer `.pisi/*.json`        | genel JSON üç yollu     | hemen iner                    |
| `marker`    | `diary/.pisi-diary`                                                     | yok (içerik sabit)      | hemen iner                    |
| `asset`     | sidecar içindeki `image/`, `file/`, `paint/`, `sheet/` dosyaları        | yok (ad = içerik özeti) | **açılınca iner**, yer tutucu |
| `other`     | kullanıcının proje klasörüne koyduğu diğer dosyalar                     | yok; çakışmada kopya    | indirilmez, listede görünür   |

### 3.4 Birleştirme kuralları

Her birleştirme saf ve belirlenimcidir (aynı girdi → aynı çıktı) ve `shared/` içindedir. Girdiler: **temel** (son senkronlanmış), **yerel** (diskteki), **uzak** (sunucudaki başlık).
Birleştirmeyi her zaman, gönderimi `STALE_BASE` ile reddedilen cihaz yapar; böylece aynı çakışma için iki cihaz iki kopya üretmez.

- **Ortak:** yerel = temel ise uzak alınır; uzak = temel ise yerel kalır; yerel = uzak ise değişiklik yoktur.
- **`.node`:**
    - `content` blok kimliğine (`data-pisi-block-id`) göre bölünür (`shared/note-blocks.mjs`).
    - Yalnız bir tarafın değiştirdiği, eklediği ya da sildiği blok o taraftan alınır. Sıra uzak tarafın sırasıdır; yalnız yerelde eklenen blok yereldeki önceki komşusunun arkasına konur.
    - İki tarafın **aynı bloğu farklı** değiştirmesi, bir tarafın değiştirip öbürünün silmesi ya da kimliksiz (eski) içeriğin iki tarafta değişmesi **çakışmadır**.
    - `pisi` ve `properties` alanları anahtar düzeyinde birleşir; `updatedAt` iki taraftan büyük olandır; aynı anahtar iki tarafta farklı değiştiyse çakışmadır.
    - Çakışmada dosya, uzak tarafın kazandığı birleşik sürüm olur; yerel tarafın **tam** sürümü çakışma kopyası olarak yanına yazılır (SV3, SV6).
- **Çakışma kopyası (`shared/sync-conflict.mjs`):**
    - Başlık: `<başlık> (çakışma DD-MM-YYYY HH.mm <cihaz adı>)`. Dosya adı ve sidecar `shared/document-naming.mjs` kurallarıyla; yeni `node_…` kimliği `shared/ids.mjs` ile.
    - Aynı klasöre ve aynı `parentMap` ile yazılır. Kopyanın başvurduğu ekler, kopyanın sidecar'ına **aynı blob kimliğiyle** yeni yollar olarak eklenir; telefon bunun için baytları indirmez.
    - Görev blokları kopyada salt metin olarak kalır; canonical görevin kaynağı değişmez. Kopya Project Integrity'de yeni bulgu üretmez (S1 kabulü).
    - Günlük dosyasında (`diary/YYYY-MM-DD.node`) çakışma kopyası günlük olamaz: proje köküne `Günlük çakışması DD-MM-YYYY (<cihaz>)` adlı normal not olarak yazılır.
- **Aynı yolda iki yeni dosya (temel yok):**
    - Günlükte aynı gün iki cihazda yazıldıysa uzak dosyanın kimliği korunur, bloklar birleşir (önce uzak, sonra yerel bloklar).
    - Başka `.node` dosyasında kimlikler farklıysa yerel dosya çakışma kopyasına dönüşür. Kimlikler aynıysa blok birleştirmesi boş temelle yapılır.
- **Otorite dosyaları (`shared/sync-merge-authority.mjs`):**
    - Kayıt listeleri (`tasks[]`, `relationships[]`, `definitions[]`) kimliğe göre üç yollu birleşir; kayıtta alan düzeyinde birleştirme yapılır.
    - Aynı alan iki tarafta farklı değiştiyse kaydın `updatedAt`'i büyük olan taraf kazanır; eşitse uzak taraf kazanır. Kaybeden değer cihazın çakışma günlüğüne yazılır (Ayarlar'da görünür).
    - Bir tarafta silinen, öbüründe değiştirilen kayıtta silme kazanır (silme yalnız masaüstünden gelir; kayıt masaüstü çöp kutusundadır) ve olay çakışma günlüğüne yazılır.
    - Tanınmayan kayıtlar ve alanlar korunur (V3). Dosyanın üst düzey `updatedAt`'i iki taraftan büyük olandır.
    - `relationships.json` birleşimi masaüstünün ilişki kurallarını (ikinci hiyerarşik ebeveyn, döngü, kendine bağlantı) çiğniyorsa kuralı çiğneten **yerel** değişiklik bırakılır ve çakışma günlüğüne yazılır. Kurallar saf değilse S1 planında nasıl paylaşılacağı önerilir.
- **`.map` ve genel JSON:** nesneler anahtara göre, kimlikli diziler (`nodes[]`, `references[]` için `id`; `relationshipViews[]` için `relationshipId`) kimliğe göre birleşir. `camera` ve diğer skaler alanlarda iki taraf farklıysa uzak kazanır. Haritayı yalnız masaüstü değiştirir; çakışma yalnız iki masaüstü arasında olur.
- **Düzenle–sil:** masaüstünde silinen bir dosya başka bir cihazda değiştirildiyse:
    - Aynı toplu gönderimde aynı `nodeId` ile yeni bir yol varsa (yeniden adlandırma/taşıma) değişiklik yeni yola birleştirilir.
    - Yoksa yerel sürüm çakışma kopyası olarak kalır, asıl yol silinir.
- **Ekler ve `other`:** içerik adresli ekler çakışmaz (ad = özet). `other` dosyada iki taraf farklıysa yerel sürüm `ad (çakışma …).uzantı` olur.

### 3.5 Şifreleme ve anahtar (özet)

- Proje anahtarı `K` alan açılırken masaüstünde üretilir. HKDF-SHA256 ile içerik, fid ve blob kimliği anahtarları türetilir. İçerik AES-256-GCM ile şifrelenir; metadata da öyle. Bütün işlemler platformun Web Crypto API'siyle yapılır (Node 24 `globalThis.crypto.subtle`, Android WebView `crypto.subtle`); `shared/sync-crypto.mjs` `subtle`'ı parametre olarak alır.
- Eşleştirmede `K`, iki cihazın geçici ECDH P-256 anahtarlarından türetilen bir anahtarla sarılıp sunucu üzerinden aktarılır.
    - **QR yolu:** QR'daki masaüstü açık anahtarı ve 256 bitlik eşleştirme sırrı ortadaki adama (sunucu dâhil) karşı korur.
    - **Kod yolu:** iki ekranda aynı 6 haneli doğrulama numarası görünür ve kullanıcı masaüstünde "Aynı" der.
    - Her iki yolda masaüstü bağlanmak isteyen cihazın adını gösterir ve onay ister.
- Tam tanım, kodlamalar, test vektörleri ve tehdit modeli: `docs/sync-protocol.md` §4, §6.6 ve §11.

### 3.6 İstemci senkron motoru

Masaüstü ve mobil aynı saf karar motorunu (`shared/sync-reconcile.mjs`) kullanır; platforma özgü kısım G/Ç (dosya, HTTP, gizli anahtar deposu) ve yüzeylerin güncellenmesidir. Bir tur:

1. **Çek (pull):** `GET head`; imleçten büyükse `GET changes?after=<imleç>` sayfa sayfa. `CURSOR_EXPIRED` gelirse `GET heads` ile tam karşılaştırmaya geçilir.
2. **Yereli tara:** masaüstünde değişen dosyalar (iç yazma olayları + izleyici + boyut/mtime taraması), mobilde `fileChanged` ile kirlenen anahtarlar + açılışta hızlı tarama.
3. **Karar ver:** her yol için uzak değişikliği uygula, yerel değişikliği gönder, birleştir, çakışma kopyası üret ya da ertele (SV4). Uzak silme telefonda uygulanır; telefonda yerel silme üretilmez (SV12).
4. **Uygula:** önce ekler, sonra belgeler, en son otorite dosyaları. Masaüstünde tek atomik mutation (SV11). Yalnız değişen belgelerin yüzeyleri güncellenir (SV5).
5. **Gönder (push):** eksik blob'lar (`POST blobs/check`) parça parça yüklenir; sonra tek `commit` (en çok 200 değişiklik; fazlası sıradaki gönderime). İstemci her gönderime bir `commitId` verir; ağ hatasında aynı `commitId` ile yeniden denemek çift kayıt üretmez.
6. **`STALE_BASE`:** 1'e dön (bir turda en çok 3 kez); sonra hata gösterilir ve bir sonraki tetikleyicide yeniden denenir.

Tetikleyiciler:

| Tetikleyici      | Masaüstü                               | Telefon                                          |
| ---------------- | -------------------------------------- | ------------------------------------------------ |
| Açılış           | proje açılınca                         | uygulama açılınca, Pisi ekranı çizildikten sonra |
| Uygulamaya dönüş | pencere odağı                          | Capacitor `resume`                               |
| Yazmadan sonra   | son yazmadan 3 sn sonra                | son `fileChanged`'den 3 sn sonra                 |
| Aralıklı         | odaktayken 60 sn, arka plandayken 5 dk | yok (arka plan senkronu kapsam dışı)             |
| Elle             | Ayarlar → Senkron → "Şimdi eşitle"     | Ayarlar → Senkron → "Şimdi eşitle"               |

Aynı anda tek tur çalışır; tur sürerken gelen tetikleyici bir sonraki tura birleşir. Ağ yoksa tur sessizce ertelenir, durum "çevrimdışı" olur. `RATE_LIMITED`'da `Retry-After` beklenir.

### 3.7 Masaüstü bağlantısı

- Senkron bir uzantı alanı olarak kendi domain sözleşmelerini kaydeder (`sync.status.v1`, `sync.space.create.v1`, `sync.pairing.start.v1`, `sync.pairing.confirm.v1`, `sync.devices.list.v1`, `sync.device.revoke.v1`, `sync.run.v1`, `sync.conflicts.list.v1` …; `docs/domain-command-query.md`). Paralel depolama biçimli IPC yolu açılmaz.
- HTTP main süreçte (Node 24 `fetch`) yapılır. Token ve `K` `safeStorage` ile şifrelenmiş olarak kullanıcı veri klasöründe durur; renderer'a hiç geçmez.
- Proje ↔ alan bağı kullanıcı veri klasöründe proje yoluna göre tutulur. Proje klasörü taşınırsa kullanıcı yeniden bağlar.
- Uzak değişiklik uygulanırken yazmalar iç dosya değişikliği olarak işaretlenir. Renderer'a değişen yollar bildirilir ve `reloadPisiWorkspaceAfterExternalChange(changedPaths)` ile yalnız ilgili belge yenilenir (`renderer/shell/pisi-tabs.mjs`). Ağaç yalnız dosya eklenip silindiyse yenilenir. Main taraftaki önbellekler (görev deposu, ilişki deposu, arama projeksiyonu) yalnız değişen otorite için geçersizlenir.
- Açık belge için SV4: senkron turu, uygulamadan önce `flushPisiPendingSaves()` ile bekleyen kayıtları yazar; yerel değişiklik birleştirmeye girer. Birleşik içerik açık editöre imleç (blok kimliği + konum) ve kaydırma korunarak yüklenir. Kullanıcıya "Diskteki sürüm yüklensin mi?" sorusu senkron yüzünden çıkmaz; çünkü kaydedilmemiş değişiklik yoktur.

### 3.8 Mobil bağlantısı

- `mobile/src/data` Capacitor'ı yine doğrudan import etmez. `mobile/src/sync/` motoru sürücüyü, HTTP'yi ve gizli anahtar deposunu parametre olarak alır.
- `ProjectWriter`'a **dış değişiklik** girişi eklenir (S4): `applyExternal(key, text)` ve `removeExternal(key)`. İkisi de kuyruğa girer, V4/V6/V7'ye uyar ve `fileChanged(key, { source: 'sync' })` yayınlar. Motor `source: 'sync'` olayını gönderilecekler listesine almaz.
- Ekranlar `fileChanged`'i dinleyip yalnız değişen belgeyi yerinde günceller (`update()` kalıbı). Açık not: editör temizse yalnız değişen bloklar yeniden çizilir, imleç bloğu değişmediyse imleç yerinde kalır. Editör kirliyse motor o dosyayı erteler (SV4).
- Mobil cihaz durumu `Directory.Data/sync/<alan>/` altında, token ve `K` Keystore eklentisiyle sarılı olarak durur.
- Ekler: not ekranı bir görsel ya da dosya bloğu gösterirken eki motordan ister. İndirme, çözme ve özet doğrulaması (SV9) sonrası ek `applyExternal` ile sidecar'a yazılır. Bağlantı yoksa ya da indirme sürerken yer tutucu görünür. Dosya eki, repo içi eklentinin `openFile` yöntemiyle (Android FileProvider) varsayılan uygulamada açılır.

### 3.9 Sunucu

- Tek ön denetleyici: `public/index.php` → `app/src/bootstrap.php` (yolu `public/index.php` içindeki tek bir sabitten gelir). Yönlendirme `/v1/...` yollarını elle eşler; framework ve Composer çalışma zamanı bağımlılığı yoktur.
- MariaDB tabloları: `spaces`, `devices`, `pairings`, `heads`, `changes`, `blobs`, `uploads`, `commits` (idempotens), `rate_limits`, `schema_migrations`. Ayrıntı: `docs/sync-protocol.md` §12.
- Blob'lar `app/data/blobs/<alan>/<aa>/<bb>/<blob>` altında, yüklemeler `app/data/tmp/` altında. İkisi de `public_html` dışındadır.
- Temizlik (eski günlük kayıtları, başvurusuz blob'lar, süresi dolan eşleştirme ve yüklemeler) cPanel Cron Jobs'tan `php app/bin/gc.php` ile yapılır. Cron kurulmamışsa istekler sırasında küçük, süre sınırlı fırsatçı temizlik yapılır.
- Sunucu dosya içeriğini, yolu ya da adları açık hâliyle hiç görmez (SV8). Token'ları yalnız SHA-256 özetleriyle, kurulum anahtarını yalnız `password_hash` çıktısıyla saklar.

### 3.10 Senkron PR'ları için ek "bitti" koşulları

- Kökte `npm run validate` geçer. Mobile dokunulduysa `npm --prefix mobile run validate` ve `npm --prefix mobile run e2e` de geçer (mobile-plan §3.6). Masaüstü arayüzüne dokunulduysa `xvfb-run -a npm run test:e2e` geçer.
- `server/` ya da protokol değiştiyse `npm run test:sync-server` (S2'de tanımlanır: PHP 8.4 + MariaDB 10.11 ile sözleşme testleri) geçer; CI'da `.github/workflows/sync-server.yml`.
- Protokol değiştiyse `docs/sync-protocol.md` aynı PR'da güncellenir, gerekiyorsa sürüm artırılır (§10) ve test vektörleri (`tests/fixtures/sync-vectors.json`) yenilenir.
- Şifreleme, kimlik doğrulama ya da sunucuya giden alanlar değiştiyse PR açıklamasında tehdit modeline (`docs/sync-protocol.md` §11) etkisi yazılır.
- Kullanıcı verisine dokunan her değişiklikte `tests/mobile-desktop-compat.test.mjs` ve senkronun bütünlük testi geçer: senkron sonrası iki tarafta Project Integrity yeni bulgu üretmez.
- `pisi-update.md` dosyasına tarihli bir giriş eklenir; girişte bunun senkron işi olduğu belirtilir.

---

## 4. Fazlar

Her faz: amaç → okunacaklar → yapılacaklar → kabul kriterleri. Madde kimlikleri PR'larda kullanılır.

### S0 · Planı ve protokolü repoya ekle

- `docs/sync-plan.md` (bu belge) ve `docs/sync-protocol.md` eklenir; `CLAUDE.md`'ye kısa bir "Sync" bölümü yazılır; `docs/mobile-plan.md` §8 bu belgeye bağlanır.
- **Kabul:** yalnız belge değişikliği olur; `npm run validate` geçer.

### S1 · Saf senkron çekirdeği: `shared/sync-*.mjs`

**Amaç:** iki platformun paylaşacağı bütün senkron kurallarını, G/Ç olmadan ve test edilmiş olarak kurmak.

**Oku:** `docs/sync-protocol.md` §4–§8, `main/functions/sync-core.js`, `main/functions/sync-project-adapter.js` (`makeConflictRecords`, sidecar yolları), `mobile/src/data/note-blocks.mjs`, `mobile/src/data/html-tokens.mjs`, `mobile/src/data/note-patch.mjs`, `shared/document-naming.mjs`, `shared/ids.mjs`, `shared/task-model.mjs`, `main/functions/map-semantic-core.js`, `scripts/shared-purity.js`, `docs/project-integrity.md`.

**Önce plan yaz, onay bekle.**

1. §3.1'deki `shared/sync-*.mjs` modüllerini yaz. Saflık kuralı (`scripts/shared-purity.js`): `crypto.subtle`, saat ve rastgelelik çağırandan gelir.
2. `mobile/src/data/note-blocks.mjs` ve `html-tokens.mjs`'i `shared/`'a **taşı** (yeniden yazma); mobil buradan import eder, davranış değişmez.
3. `sync-crypto.mjs`: HKDF türetmeleri, zarf biçimi, fid, blob kimliği, eşleştirme anahtar sarma, doğrulama numarası. `tests/fixtures/sync-vectors.json` test vektörlerini üret; testler bunları Node Web Crypto ile doğrular.
4. `sync-merge-*.mjs` ve `sync-conflict.mjs`: §3.4'teki her kural için örnekli test. Ayrıca tohumlu rastgele üretilen 1.000 düzenleme çifti için şu değişmezleri sınayan bir test:
    - `merge(t, t, t) = t`; `merge(temel, a, temel) = a`; `merge(temel, temel, b) = b`.
    - **Metin kaybı yok:** iki tarafın eklediği ya da değiştirdiği her blok metni birleşik dosyada ya da çakışma kopyasında bayt bayt bulunur.
    - Belirlenimcilik: aynı girdi aynı çıktıyı verir.
5. `sync-reconcile.mjs`: indeks + temel + uzak değişiklikler → eylemler (uygula, gönder, birleştir, kopya, ertele, telefonda silme yok). Tablo güdümlü testler.
6. **Tekrar eden görevlerin kimliği:** aynı tekrar iki cihazda tamamlanınca sonraki tekrar iki kez oluşmasın diye (`pisi-error.md` §5d) sonraki tekrarın kimliğinin önceki görev kimliği ve yeni tarihten belirlenimci türetilmesini plana koy. Bu masaüstü davranışını değiştirir; planda ayrıca onay iste.
7. `sync-core.js`'ten taşınabilecekleri (ör. `stableStringify`) taşı; eski modül çalışmaya devam eder (silme S7'de).
8. Kökte bir test, birleştirme ve çakışma kopyası çıktılarını `tests/fixtures/desktop-project/` kopyasına yazıp masaüstü Project Integrity denetimini çalıştırır.

**Kabul:**

- `npm run validate` ve `npm --prefix mobile run validate` geçer; `check:architecture` shared saflığını onaylar.
- Test vektörleri Node'da geçer. Mobil vitest de aynı vektörleri doğrular.
- 1.000 rastgele durumda metin kaybı değişmezi geçer.
- Birleşik dosyalar ve çakışma kopyaları fixture'da **sıfır yeni** Integrity bulgusu üretir.
- `tests/mobile-desktop-compat.test.mjs` değişmeden geçer.

### S2 · PHP sunucusu ve cPanel kurulum rehberi

**Amaç:** protokolü eksiksiz uygulayan, paylaşımlı barındırmada çalışan, framework'süz sunucu.

**Oku:** `docs/sync-protocol.md` (tamamı), bu belge §3.9.

1. `server/` yapısı (§3.1). PHP 8.4 `declare(strict_types=1)`; yalnız çekirdek eklentiler: `pdo_mysql`, `json`, `mbstring`, `openssl`/`random`, `hash`.
2. `app/schema/001-initial.sql` ve sıralı göç (migration) uygulayıcısı (`schema_migrations`). Uygulama açılışta şema sürümünü denetler, eksikse `MAINTENANCE` döner; göçler yalnız `php app/bin/migrate.php` ile çalışır.
3. `config.sample.php`: veritabanı, veri klasörü, kurulum anahtarı özeti, CORS kaynakları (varsayılan `https://localhost`), sınırlar (en büyük blob, parça boyutu, alan kotası, hız sınırları).
4. Bütün uç noktalar, hata kodları, idempotens (`commitId`), karşılaştır-ve-değiştir, parçalı yükleme, `Range` ile indirme, hız sınırları, temizlik (`bin/gc.php`).
5. `Authorization` başlığını PHP'ye geçirmeyen barındırmalar için `.htaccess` (`CGIPassAuth On` ve `RewriteRule … E=HTTP_AUTHORIZATION`) ve yedek `X-Pisi-Token` başlığı.
6. **Sözleşme testleri** (Node `node:test`, `tests/sync-server-contract*.test.mjs`): `php -S` + MariaDB 10.11 üzerinde her uç noktayı istemci gözüyle sınar. Kök `npm test` bunları çalıştırmaz; `npm run test:sync-server` çalıştırır. `scripts/start-sync-test-server.mjs` test sunucusunu kurar ve kaldırır (S3–S7 de kullanır).
7. `.github/workflows/sync-server.yml`: PHP 8.4 (`shivammathur/setup-php`), MariaDB 10.11 servis konteyneri, `php -l`, göç, sözleşme testleri. Tetikleyici: `server/**`, `shared/sync-*`, `docs/sync-protocol.md`, iş akışının kendisi.
8. `docs/sync-server-cpanel.md` (Türkçe kurulum rehberi):
    - Alt alan adı ve belge kökü; MultiPHP Manager ile PHP 8.4; MySQL Database Wizard ile veritabanı ve kullanıcı.
    - Dosyaların yüklenmesi (File Manager ya da cPanel Git Version Control + `.cpanel.yml`); `app/`'in `public_html` dışına konması.
    - `config.php`; kurulum anahtarının üretilmesi ve özetinin yazılması; göç komutu (Terminal yoksa Cron Jobs'ta tek seferlik).
    - AutoSSL'in doğrulanması; Cron Jobs ile `gc.php`.
    - `curl https://…/v1/info` ile deneme; `Authorization` sorununun teşhisi; yedekleme (veritabanı dökümü + `app/data/`); güncelleme ve geri alma adımları.

**Kabul:**

- `npm run test:sync-server` CI'da geçer. Protokoldeki her uç nokta ve her hata kodu için en az bir test vardır (test, protokoldeki tabloyla karşılaştırarak eksik kodu bulursa düşer).
- 20 MB'lık blob, `post_max_size = 8M` ayarlı test sunucusunda 4 MiB parçalarla yüklenir, `Range` ile parça parça indirilir ve özeti tutar.
- Aynı `commitId` ile iki kez gönderilen commit tek kayıt üretir. `baseSeq`'i eski commit `STALE_BASE` döner ve **hiçbir** kaydı yazmaz.
- Veritabanında düz token, düz kurulum anahtarı, dosya yolu ya da cihaz adı bulunmaz (test tabloları tarar).
- `server/public/` yalnız `index.php` ve `.htaccess` içerir. Blob ve ayar dosyalarına web kökünden erişilemez (test).
- `member` rolünden gelen `delete` reddedilir. İptal edilen cihazın her isteği `DEVICE_REVOKED` döner.
- Rehber, temiz bir cPanel hesabında kullanıcı tarafından uygulanır ve `GET /v1/info` yanıt verir. Sonuç PR'a ya da S7'ye yazılır; sunucu adresi yazılmaz.
- **Kabul (17-11-2026):** rehber kullanıcının paylaşımlı cPanel hesabında uygulandı (Git Version Control ile dağıtım; CloudLinux `alt-php84`, PHP 8.4.27; MariaDB 10.11.19; Let's Encrypt sertifikası).
    - `GET /v1/info` yanıt verdi. Token'sız `head` `AUTH_REQUIRED`, sahte token'lı `head` `TOKEN_INVALID` döndü; yani `Authorization` başlığı PHP'ye ulaşıyor.
    - `bin/check.php`'nin bütün satırları `[ OK ]` (şema 1/1, kurulum anahtarı, veri klasörü web kökü dışında, cron ile temizlik).
    - Kurulumda çıkan sorunlar düzeltildi: ev klasörü yolu ve PHP komut yolu, depoda kalan `error_log` yüzünden kilitlenen Git dağıtımı ([maggezer/Pisi#171](https://github.com/maggezer/Pisi/pull/171)); sertifika doğrulamasını engelleyen `.htaccess` ([maggezer/Pisi#172](https://github.com/maggezer/Pisi/pull/172)); rehberde Windows'ta çalışmayan tek tırnaklı `curl` örnekleri (bu kabulle aynı PR).

### S3 · Masaüstü istemcisi

**Amaç:** masaüstünün alan açması, cihaz eşleştirmesi, senkron turlarını çalıştırması ve uzak değişikliği yeniden yükleme yapmadan uygulaması.

**Oku:** `pisi-error.md` §4 ve §5d, `renderer/shell/pisi-tabs.mjs` (`reloadPisiWorkspaceAfterExternalChange`, `handlePisiExternalFileSystemChange`), `renderer/tree/pisi-project-reload.mjs`, `main/functions/project-watcher-core.js`, `main/functions/atomic-mutation*.js`, `main/functions/domain-command-query.js`, `docs/domain-command-query.md`, `renderer/tags/pisi-source-of-truth.mjs`, `main/functions/sync-domain.js` (eski IPC'nin kapatılma biçimi).

**Önce plan yaz, onay bekle.** QR kodlayıcı için bağımlılık önerisini (ya da bağımlılıksız kodlayıcıyı) planda yaz ve onay al.

1. `main/functions/sync-client-*.js`: HTTP istemcisi (zaman aşımı, yeniden deneme, `Retry-After`), cihaz durumu deposu (kullanıcı veri klasörü, `safeStorage`), motor bağlantısı, uygulama katmanı. Manifest kayıtları.
2. Domain sözleşmeleri (§3.7) ve preload cephesi; renderer gizli bilgiyi hiç görmez.
3. Ayarlar → **Senkron**: sunucu adresi + kurulum anahtarıyla alan açma ya da bağlanma, durum (son senkron, çevrimdışı, hata), "Şimdi eşitle", cihaz listesi ve iptal, çakışma günlüğü, senkron edilmeyen dosyalar. TR/ENG metinleri.
4. **Eşleştirme penceresi:** QR + kısa kod + geri sayım. Telefon bağlanınca adı görünür. Kod yolunda 6 haneli doğrulama numarası ve "Aynı / Farklı" düğmeleri. Pencere kapanınca eşleştirme iptal edilir.
5. Tetikleyiciler (§3.6). Aynı anda tek tur.
6. Uygulama: tek atomik mutation, iç yazma işareti, değişen yolların renderer'a bildirilmesi, yalnız ilgili belgenin yenilenmesi, imleç ve kaydırma korunur (SV4, SV5, SV11). Senkron yolu `loadProject`'i hiç çağırmaz.
7. **§5d riski:** uzaktan gelen bir "tamamlandı" durumunun, masaüstünde görev paneli açılıp kapanınca ve not açılıp kaydedilince geri dönmediğini sınayan E2E yaz. Dönüyorsa bu fazda düzelt (SV13).
8. İkinci masaüstü: yalnız **boş** bir klasöre ya da yeni projeye bağlanır; dolu bir klasörü alana bağlama reddedilir (kapsam dışı, §5).
9. E2E (`scripts/electron-sync-*-e2e.mjs`), S2'nin test sunucusuyla:
    - Alan aç → proje yüklenir; ikinci bir "cihaz" (testteki saf istemci) bir notun başka bloğunu değiştirir.
    - Masaüstünde aynı not açıkken ve yazılırken tur çalışır: imleç aynı blokta ve konumda kalır, yazılan metin durur, sekmeler kapanmaz.
    - Aynı blok iki tarafta değişir: çakışma kopyası oluşur, ağaçta görünür, Integrity yeni bulgu vermez.

**Kabul:**

- `npm run validate`, `xvfb-run -a npm run test:e2e` ve `npm run test:sync-server` (masaüstü senaryolarıyla) geçer.
- Senkron turunda `loadProject` çağrı sayısı 0'dır (E2E sayar). Açık notun imleci ve kaydırması tur öncesi ve sonrası aynıdır.
- Uzak değişiklik yalnız değişen belgeyi yeniler: değişmeyen açık sekme yeniden çizilmez (E2E sayar).
- Bir tur kesilirse (hata enjeksiyonu: uygulamanın ortasında) proje turun öncesi ya da sonrası olur.
- Sunucuya giden her istek gövdesinde dosya yolu, başlık ya da düz içerik bulunmaz (test isteği dinler ve tarar).
- §5d E2E'si geçer.
- **Uygulandı (17-11-2026):**
    - Modüller: `main/functions/sync-client-{http,state,engine,actions,files,pairing,desktop}.js`, `renderer/sync/pisi-sync-{live,panel,pairing,qr}.mjs`, preload `window.pisiSyncClient`.
    - Testler: `tests/sync-client-http.test.mjs`, `tests/sync-client-apply.test.mjs`, `tests/sync-qr.test.mjs` (kök `npm test`); `tests/sync-server-contract-desktop.test.mjs` ve `scripts/electron-sync-client-e2e.mjs` (`npm run test:sync-server`; Electron E2E `PISI_SYNC_ELECTRON_E2E=1` ile, CI'da xvfb altında).
    - Verilen kararlar: QR kodlayıcı repo içinde, doğrulaması yalnız geliştirme bağımlılığı `jsqr` ile; ikinci masaüstü kod yoluyla katılır ve masaüstü platformlu cihaz `admin` rolü alır; Linux'ta anahtarlık yoksa `safeStorage` düz metin yedeğiyle çalışılır ve Ayarlar uyarır; test sunucusu için loopback HTTP yalnız paketlenmemiş uygulamada `PISI_SYNC_ALLOW_LOOPBACK_HTTP=1` ile; masaüstünün tekrar eden görevi de belirlenimci kimlik alır (S1 adım 6).
    - Belgeyle kod arasındaki farklar: `.pisi/backups/` ve `.pisi/sync-trash/` senkron dışı listeye eklendi (§3.3); klasörler senkron edilmediği için inen not ve haritanın boş yönetilen yan klasörünü istemci oluşturur (SV6). Var olan bir blob'un şifreli boyutu bilinmiyorsa `Range: bytes=0-0` ile öğrenilir (protokol değişmedi).
    - Tetikleyiciler: proje açılışı, pencere odağı (10 sn'de bir), uygulamanın son yazmasından 3 sn sonra, odaktayken 60 sn ve arka planda 5 dk, elle. Dosya silme gibi atomik yazma olmayan değişiklikler en geç aralıklı turda gider.

### S4 · Mobil veri katmanının dış değişikliği alması

**Amaç:** sunucu olmadan, mobil veri katmanı ve ekranların dışarıdan gelen dosya değişikliğini yerinde, yazma döngüsü yaratmadan ve metin kaybettirmeden alması.

**Oku:** `docs/mobile-plan.md` §2 ve §3.3, `mobile/src/data/project-writer.mjs`, `project-repo.mjs`, `project-index.mjs`, `search-index.mjs`, `note-repo.mjs`, `diary-repo.mjs`, `task-repo.mjs`, `map-repo.mjs`, `mobile/src/screens/*/` (`update()` kalıbı), `mobile/src/screens/notes/note-editor.mjs`.

**Önce plan yaz, onay bekle.**

1. `ProjectWriter.applyExternal(key, text)` ve `removeExternal(key)`: kuyrukta, atomik, değişmeyen içerikte yazmasız. `fileChanged(key, { source })` olayına kaynak bilgisi eklenir; eski dinleyiciler çalışmaya devam eder.
2. Silme sonrası boş kalan sidecar ve harita klasörlerinin kaldırılması (yalnız `removeExternal` yolunda; kullanıcı silmesi hâlâ yoktur, V9).
3. İndeks ve arama dizini `source: 'sync'` olaylarıyla artımlı güncellenir. Okunamayan uzak dosya salt okunur işaretlenir (V7).
4. **Açık belge kiralaması:** not editörü ve günlük alanı açık oldukları dosyayı "kirli/temiz" olarak bildirir. Motor (S5) kirli dosyayı erteler. `flush` sonrası temizlenince ertelenen dosya bir sonraki turda birleşir.
5. Ekranlar yerinde güncellenir:
    - Pisi sekmesi: günlük ve görevler.
    - Görevler, Takvim (noktalar), Notlar listesi.
    - Açık not: yalnız değişen bloklar; imleç bloğu değişmediyse imleç yerinde.
    - Harita görüntüleyici: açık harita ya da üyesi değiştiyse kamera korunarak.
    - Açık not silindiyse "Bu not masaüstünde silindi" snackbar'ı ve listeye dönüş.
6. Testler: vitest'te bir "dış kaynak" yardımcısı `applyExternal` çağırır; Playwright e2e aynı yardımcıyı geliştirici köprüsünden çağırır.

**Kabul:**

- `npm --prefix mobile run validate` ve `npm --prefix mobile run e2e` geçer; `tests/mobile-desktop-compat.test.mjs` geçer.
- Dış değişiklik başına yazma sayısı 1'dir; `source: 'sync'` olayından sonra hiçbir repo aynı dosyayı yeniden yazmaz (test sayar).
- E2E: not A açıkken ve 3. blok yazılırken 5. blok dışarıdan değişir → 5. blok güncellenir, imleç 3. blokta aynı konumda kalır, yazılan metin durur. Kirli 3. bloğa dış değişiklik gelirse uygulanmaz ve ertelenmiş görünür.
- E2E: not B dışarıdan değişince açık not A'nın DOM'u yeniden kurulmaz.
- Dışarıdan silinen açık not kullanıcıya bildirilir; uygulama çökmez, veri yazılmaz.
- **Uygulandı (17-11-2026):**
    - Veri katmanı: `ProjectWriter.applyExternal(key, text, { expected })` / `removeExternal(key, { expected })`. Hiçbir zaman fırlatmayan bir sonuç döner: `{ written, reason }`; neden `unchanged`, `dirty`, `changed`, `read-only` ya da `invalid` olur. Açık belge kiralaması `project.documents` (`data/open-documents.mjs`): `hold`, `flush`, `onClean`, ertelenenler. Sürücülere `removeDirectory` eklendi (yalnız boş klasör). İndeks değişen dosyayı sırayla yeniden okur (`index.settled()`); arama katlamayı not kaydına göre önbelleğe alır.
    - Ekranlara dağıtım `app/external-changes.mjs` üzerinden yapılır. Açık not blokları `screens/notes/note-rebase.mjs` ile kimliğe göre eşler; `NoteEditor.applyContent`. Günlük `diary.setText(…, { expectedText })` ve `mergeDiaryText` kullanır.
    - Test yardımcısı: `data/external-source.mjs`. Debug derlemesinde `window.pisiDeveloper.external` köprüsünden çağrılır.
    - Verilen kararlar (onaylı):
        - `applyExternal`/`removeExternal` için isteğe bağlı `expected` (karşılaştır-ve-değiştir).
        - Kirli dosya korumasını yazıcı da uygular.
        - Yazma ile ekranın onu işlemesi arasında aynı blok yazılırsa yerel metin uzak sürümün altında ayrı bir blok olarak kalır.
        - `NOTE_CHANGED`'de yazılan metin atılmaz, disktekiyle birleşir.
        - Silinen açık not ekranı kapanır, açıldığı yere dönülür.
        - Gelen not ve harita boş yönetilen yan klasörüyle oluşur (S3 ile aynı). Uzak silmeden sonra yalnız hiçbir belgenin sahiplenmediği boş yönetilen klasörler kalkar.

### S5 · Mobil eşleştirme ve senkron motoru

**Amaç:** telefonun masaüstüyle eşleşmesi ve sunucu üzerinden çift yönlü senkron.

**Oku:** `docs/sync-protocol.md` §4–§9 ve §11, `mobile/src/app/` (yaşam döngüsü), `mobile/src/platform/`, `mobile/src/screens/settings/`, `mobile/android/`, `docs/mobile-qa.md`.

**Önce plan yaz, onay bekle.** QR okuyucu için Capacitor 8 ile uyumlu, audit'i temiz bir resmî eklenti (ör. `@capacitor/barcode-scanner`) öner ve onay al. Uygun eklenti yoksa sor. Kod yolu kamerasız da çalışmalıdır.

1. **Keystore eklentisi** (`PisiSecretsPlugin.java` + `platform/secrets.mjs`): `put/get/remove`. Değer Android Keystore'daki AES anahtarıyla sarılır; sarılı hâli `Directory.Data/sync/` altında durur. Web/e2e derlemesi için bellek içi sahte uygulama.
2. `mobile/src/sync/`: HTTP (`fetch`; sunucu CORS'u `https://localhost`'a izin verir), durum deposu, motor bağlantısı (`shared/sync-reconcile.mjs`), tetikleyiciler (§3.6). Telefon silme göndermez (SV12).
3. **Eşleştirme ekranı** (Ayarlar → Senkron → "Masaüstüyle eşleştir"):
    - QR okut ya da sunucu adresi + kod gir.
    - Kod yolunda doğrulama numarasını göster: "Masaüstünde de bu sayı görünüyor mu?"
    - Bekleme, süre dolması, yanlış kod ve iptal durumları; geri tuşu kuralları (mobile-plan M2).
4. Ayarlar → Senkron: bağlı alan (çözülmüş proje adı), son senkron, "Şimdi eşitle", çakışma günlüğü, "Bu cihazın bağlantısını kaldır". "Cihazlar arası aktarım: yakında" satırı kalkar.
5. Durum göstergesinin ekrandaki yeri (Pisi ekranında mı, yalnız Ayarlar'da mı) planda önerilir ve onaylanır.
6. İptal edilen cihaz: `DEVICE_REVOKED` sonrası motor durur, gizli bilgiler silinir, proje dosyaları kalır, kullanıcıya söylenir.
7. Testler:
    - vitest: motor, `mobile/tests/helpers/` altındaki protokol uyumlu bellek içi sahte sunucuya karşı.
    - Sözleşme: aynı motor S2'nin gerçek PHP test sunucusuna karşı (`npm run test:sync-server` kapsamında).
    - Playwright: kodla eşleştirme ve doğrulama numarası ekranı, açık/koyu tema görüntüleri.

**Kabul:**

- `npm --prefix mobile run validate`, `npm --prefix mobile run e2e`, `npm run test:sync-server` geçer; CI APK üretir.
- Telefonda yazılan görev ve günlük, masaüstünde bir sonraki turda görünür; masaüstündeki not değişikliği telefona gelir. Bunu sahte sunucu ve gerçek test sunucusuyla birer test doğrular.
- Telefonun ürettiği hiçbir commit `delete` içermez (test).
- Gizli bilgiler `Directory.Data` altında düz metin olarak bulunmaz (test, web sahtesinde değil eklentinin birim testinde ya da cihaz kabulünde, S8).
- Uygulama kapatılıp açılınca eşleşme ve imleç korunur; yarım kalan tur yeniden oynatıldığında aynı sonucu verir.
- **Uygulandı (17-11-2026):**
    - Ortak çekirdek: masaüstünün motoru `shared/sync-engine.mjs` ve `shared/sync-actions.mjs`'e, HTTP istemcisi `shared/sync-http.mjs`'e, eşleştirmenin katılan tarafı (kod ve yeni QR yolu) `shared/sync-pairing-claim.mjs`'e taşındı. `main/functions/sync-client-{engine,actions,http,pairing}.js` yollarını ve export adlarını koruyan sarmalayıcılardır; masaüstü davranışı değişmedi.
    - Motora iki ek (masaüstünde kapalı): `lazy(path)` ile telefonda ekler ve `other` dosyalar taranmaz ve indirilmez, uzak başlıkları `state.remoteOnly`'de durur (S6 açılınca indirir); telefonda oluşan çakışma kopyasının ekleri bayt indirilmeden sunucudaki blob kimliğiyle gönderilir (§3.4, SV6).
    - Mobil: `mobile/src/sync/{sync-service,project-files,state-store,pairing,codec}.mjs`, `platform/{secrets,qr-scanner}.mjs`, `screens/sync/pair.mjs`, `screens/settings/sync-section.mjs`. Android: `PisiSecretsPlugin.java` + `SecretBox.java` (Keystore AES-256-GCM, ad AAD'ye bağlı) ve JUnit `SecretBoxTest` (CI'da `testDebugUnitTest`).
    - Testler: `mobile/tests/sync-{engine,pairing,merge-phone,pair-screen}.test.mjs` (bellek içi sahte sunucu `mobile/tests/helpers/fake-sync-server.mjs`), `mobile/e2e/sync.spec.mjs`, kökte `tests/sync-server-contract-mobile.test.mjs`.
    - Verilen kararlar (onaylı): QR okuyucu resmî `@capacitor/barcode-scanner` 3.1.3 ve bunun için `minSdkVersion` 24 → 26; durum yalnız Ayarlar → Senkron'da, önemli olaylar (iptal, sunucu geri sarıldı, çakışma kopyası) snackbar ile; telefonda veri varken ilk eşleşme S6'ya kadar "ekle" gibi çalışır (boş temelle birleştirme); bağlantı çevrimdışıyken de yerelde kaldırılır ve kullanıcıya masaüstünden iptal etmesi söylenir; cihaz adı formda düzenlenir, varsayılanı "Android telefon".
    - Telefonun tetikleyicileri: açılış (Pisi ekranı çizildikten sonra), `resume`, son yerel `fileChanged`'den 3 sn sonra, açık belge temizlenince (`documents.onClean`) ve elle. Tur öncesi ekranlar bekleyen kayıtlarını yazar (SV4); kirli dosya ertelenir ve Ayarlar'da "n dosya bekliyor" görünür.

### S6 · İlk aktarım ve ekler

**Amaç:** gerçek bir projenin masaüstünden sunucuya, oradan telefona ilk kez taşınması ve eklerin isteğe bağlı inmesi.

**Oku:** `scripts/generate-project-fixture.mjs`, `mobile/e2e/large-project.spec.mjs`, `mobile/src/screens/notes/block-views.mjs`, `pisi-definition.md` § görsel ve dosya ekleri.

**Önce plan yaz, onay bekle.**

1. **Masaüstü ilk yükleme:** ilerleme (dosya/bayt), iptal, kesilirse kaldığı yerden sürme (yüklenmiş blob'lar `blobs/check` ile atlanır), en çok 200 değişiklikli commit'ler.
2. **Telefon ilk indirme:** `GET heads` ile tam liste; önce otorite dosyaları ve Pisi ekranının ihtiyacı (bugünün günlüğü, `tasks.json`), sonra notlar ve haritalar. Ekler indirilmez.
3. **Telefonda veri varken ilk eşleşme** (§1.3):
    - Proje yalnız iskeletse (boş `.pisi/` dosyaları, `diary/.pisi-diary`) soru sorulmadan sunucudaki proje iner.
    - Değilse iki seçenek sunulur:
        - "Telefondakileri projeye ekle": boş temelle birleştirme (§3.4). Görevler kimliğe göre eklenir, aynı günün günlüğü birleşir, aynı yoldaki farklı kimlikli not çakışma kopyası olur.
        - "Telefondakileri kenara koy": `projects/default` silinmeden `projects/default-oncesi-<tarih>/` klasörüne taşınır, yeni proje sunucudan iner. Kenara konan proje Ayarlar'da adıyla görünür; geri alma kapsam dışıdır.
4. **Ekler:** görsel bloğu yer tutucuyla çizilir ("Görsel bağlantı gelince iner"); görünür olunca iner. Dosya bloğu ad ve boyutu gösterir; dokununca iner ve `openFile` ile açılır. Bağlantı yoksa yer tutucu ve "Yeniden dene". İnen ek proje dosyasıdır ve kalır.
5. Büyük proje ölçümü: 2.000 not, 5.000 görev, 60 günlük ve toplam ~200 MB 300 görsel içeren üretilmiş projeyle ilk yükleme ve ilk indirme süresi, istek sayısı ve sunucuda kaplanan alan. Sonuç `sync-initial-transfer.json` artifact'ı.

**Kabul:**

- Kesilen ilk yükleme ve ilk indirme (süreç %50'de öldürülür) yeniden başlatılınca tamamlanır; sonuç kesilmeyen aktarımla bayt bayt aynıdır (test).
- İlk indirmeden sonra telefondaki proje, eklerin henüz inmemiş olması dışında masaüstüyle bayt bayt aynıdır. Masaüstü Integrity denetimi telefondaki kopyada yeni bulgu vermez; inmemiş ekler "eksik ek" olarak sayılmaz.
- "Ekle" ve "Kenara koy" yollarının ikisi de e2e ile sınanır; hiçbirinde telefondaki görev ya da günlük metni kaybolmaz.
- Çevrimdışıyken açılan görselli not çökmez, yer tutucu gösterir; bağlantı gelince görsel iner ve özeti doğrulanır.
- Büyük proje ölçümleri PR'da raporlanır. Telefonda ilk indirme sırasında Pisi ekranı en geç otorite dosyaları indikten sonra görünür.
- **Uygulandı (18-11-2026):**
    - Motor: gönderim `shared/sync-engine-push.mjs`'e ayrıldı ve akışlı oldu (commit grubu planlanır, blob kimlikleri hesaplanır, `blobs/check` sorulur, eksik blob'lar tek tek okunup şifrelenip yüklenir; her commit'ten sonra durum kaydedilir). `onProgress({ phase, files, bytes })`, `runTurn({ signal })` / `engine.cancel()` (`CANCELLED`), hiç dosya uygulamamış cihazda `GET heads` ile ilk indirme (heads'teki en büyük `dseq` cihaz başına `lastDseq`'e yazılır), `applyBatch` ile partili yazma (telefon; ilk indirmede önce `isPisiSyncFirstPriorityPath`) ve `fetchLazy(path)`. Saf kurallar `shared/sync-initial.mjs`'te (iskelet denetimi, öncelik, partiler).
    - Masaüstü: `sync.cancel.v1`, `sync.resume.v1`; ilerleme `pisi:sync-status` ile (en sık 250 ms); Ayarlar → Senkron'da ilerleme satırı, Durdur ve Sürdür.
    - Mobil: `sync/initial-transfer.mjs` (iskelet, ekle, kenara koy), `sync/attachments.mjs`, `screens/notes/attachment-views.mjs`, `ProjectWriter.applyExternalBytes`, sürücülerde `writeBase64`, `platform/file-opener.mjs` + Android `PisiFilesPlugin.java`/`OpenFile.java` (JUnit `OpenFileTest`).
    - Testler: `mobile/tests/sync-initial.test.mjs`, `note-attachments.test.mjs`, `sync-pair-screen.test.mjs`, `mobile/e2e/sync-initial.spec.mjs`; kökte `tests/sync-initial-transfer.test.mjs` (masaüstü fixture'ı telefona iner; Integrity), `shared-sync-initial.test.mjs`, `mobile-attachment-policy.test.mjs`; gerçek sunucuya karşı `tests/sync-server-contract-transfer.test.mjs` (kesilen aktarım ve ölçüm; CI'da tam boyut, `sync-initial-transfer` artifact'ı); `scripts/electron-sync-client-e2e.mjs` adım 6 (Durdur/Sürdür).
    - Verilen kararlar (onaylı): Durdur otomatik turları "Sürdür"e, "Şimdi eşitle"ye ya da uygulamanın yeniden açılmasına kadar duraklatır; ilk indirmede otorite dosyaları belgelerden önce iner (§3.6 sırasına bilinçli istisna, yalnız telefonun ilk indirmesi); ekle/kenara koy sorusu eşleştirmeden önce sorulur ve onaydan sonra uygulanır; kenara koy kopyala → doğrula → `removeExternal` ile kaldır biçimindedir, uygulama yeniden yüklenmez; dosya açma repo içi eklentiyle; tam boyutlu ölçüm her PR'da `sync-server.yml` içinde.
    - Belgede olmayan kararlar: yalnız iskelet olan projenin iskelet dosyaları ilk indirmeden önce kaldırılır, böylece sunucudaki proje bayt bayt iner (boş temelle birleştirme `updatedAt` yüzünden `properties.json`'ı yeniden gönderirdi); kenara konan klasör `default-oncesi-YYYY-MM-DD` (aynı gün `-2`, `-3`); masaüstü ilk indirmesi (ikinci masaüstü) partilere bölünmez, çünkü bir tur tek atomik mutation'dır (SV11); telefonda ilerleme yalnız en az 10 dosyalık turda gösterilir.

### S7 · İki cihaz ve gerçek sunucuyla uçtan uca test; eski kodun kaldırılması

**Amaç:** gerçek PHP sunucusu, gerçek masaüstü (Electron) ve mobil web derlemesiyle bütün senaryoların otomatik doğrulanması; eski senkronun kaldırılması.

**Oku:** bu belge §2–§3, `docs/sync-protocol.md` §7 ve §11, `tests/sync-*.test.js`, `scripts/electron-sync-reload-e2e.mjs`.

1. Senaryo matrisi (`scripts/sync-e2e-matrix.mjs` ya da eşdeğeri; masaüstü Electron + mobil Playwright + PHP test sunucusu):
    1. Aynı notun farklı bloklarını iki cihaz eşzamanlı değiştirir → iki değişiklik de kalır, kopya yok.
    2. Aynı bloğu iki cihaz değiştirir → tek çakışma kopyası, iki metin de var.
    3. Telefon görevi tamamlar, masaüstü aynı görevin başlığını değiştirir → iki alan da kalır.
    4. Aynı gün iki cihaz günlük yazar (dosya ikisinde de yeni) → tek günlük, iki metin.
    5. Masaüstü notu siler → telefondan kalkar; telefonda açıksa kullanıcıya söylenir.
    6. Masaüstü siler, telefon çevrimdışıyken aynı notu düzenler → çakışma kopyası.
    7. Masaüstü yeniden adlandırır, telefon çevrimdışıyken düzenler → düzenleme yeni ada gider.
    8. Masaüstü görsel ekler → telefonda yer tutucu, açınca iner.
    9. Telefon günlerce çevrimdışı kalıp 50 değişiklikle döner → hepsi gider, günlük budandıysa tam karşılaştırmaya geçilir.
    10. Yükleme ortasında bağlantı kesilir → kaldığı yerden sürer, çift kayıt yok.
    11. Masaüstü telefonu iptal eder → telefon durur, verisi kalır, yeniden eşleşebilir.
    12. Sunucu geri sarılır (veritabanı eski yedeğe döner) → istemciler `SERVER_ROLLBACK` gösterir, yazmaz.
    13. Sunucu bir blob'u bozar ya da başka fid'e taşır → istemci uygulamaz (SV9).
    14. Masaüstünde açık not yazılırken tur çalışır → imleç ve metin korunur, `loadProject` çağrılmaz.
    15. Her senaryodan sonra iki tarafta Project Integrity yeni bulgu vermez.
2. Gerçek barındırma için duman testi: `npm run sync:smoke -- --server <adres>`. Kullanıcı kendi bilgisayarında çalıştırır; kurulum anahtarı ortam değişkeninden okunur, hiçbir yere yazılmaz. Test geçici bir alan açar, senaryo 1, 2, 5 ve 8'i çalıştırır ve alanı siler.
3. **Eski senkronu kaldır:**
    - Kaldırılacaklar: `main/functions/sync-core.js`, `sync-domain.js`, `sync-project-adapter.js`, `renderer/sync/pisi-sync-settings.mjs`, `preload.js`'teki eski `pisiSync` cephesi ve eski IPC kanalları, manifest kayıtları, kullanılmayan locale anahtarları, `tests/sync-core.test.js`, `tests/sync-domain-*.test.js`, `tests/sync-project-adapter.test.js`, `scripts/electron-sync-reload-e2e.mjs` (yeni E2E bunu kapsıyorsa) ve `docs/pisi-sync-guide-tr.md`.
    - Eski dosya yolları (`.pisi-sync/`, `.pisi/sync-state.json`) senkron dışında kalmaya devam eder (SV7). Kullanıcının projesindeki bu dosyalar silinmez.
    - `pisi-error.md` §4 güncellenir.

**Kabul:**

- Matristeki 15 senaryo CI'da (`sync-server.yml`) geçer.
- Duman testi kullanıcının cPanel sunucusunda geçer; çıktı (adres olmadan) PR'a eklenir.
- Eski kod kaldırıldıktan sonra `npm run validate`, `xvfb-run -a npm run test:e2e` ve mobil doğrulamalar geçer. `check:architecture` kaldırılan bağlamaları manifestte bulmaz.
- **Uygulandı (18-11-2026):**
    - Matris: `scripts/sync-e2e-matrix.mjs` ve `scripts/sync-e2e/{desktop,phone,fault-proxy,server-tools,desktop-audit}.mjs`. Masaüstü gerçek Electron (CDP), telefon mobil derlemenin Playwright'ta Pixel 7 görünümü; telefonun `https://sync.test` istekleri Playwright route'uyla, masaüstünün istekleri doğrudan aynı hata enjeksiyonlu iletene, oradan PHP test sunucusuna gider. İki cihaz kendi ekranlarından kodla eşleşir; 14 senaryo sırayla aynı alanda çalışır (iptal ve geri sarma en sonda), her birinden sonra iki tarafta Integrity denetlenir (15). Yardımcıların hiçbiri uygulamaya kod eklemez.
    - Senaryoların gerçekleştirilişi: çevrimdışı telefon route'un isteği kesmesidir; "günlerce çevrimdışı" alanın değişiklik kayıtlarının 120 gün yaşlandırılıp gerçek `gc.php` ile budanmasıdır; sunucunun geri sarılması alanın `spaces/heads/changes/commits/blobs` satırlarının yedeğe döndürülmesidir; blob bozma diskte bir baytın değişmesi, taşıma bir başlığın başka bir blob'u göstermesidir; yükleme kopması iletende parça yüklemelerinin (masaüstü) ve commit yanıtının (telefon) düşürülmesidir.
    - `npm run test:sync-server` matrisi `PISI_SYNC_MATRIX_E2E=1` ile çalıştırır; CI'da `sync-server.yml` (mobil paket, Playwright Chromium; `sync-e2e-matrix` raporu). Duman testi `scripts/sync-smoke.mjs` (`npm run sync:smoke`), yerel test sunucusuna karşı `tests/sync-server-contract-smoke.test.mjs` ile sınanır.
    - Matrisin bulduğu ve bu fazda düzeltilenler: cihaz kendi commit'inin öncesine geri sarılan sunucuyu fark etmiyordu (`knownSeq`, protokol §7.4; tel biçimi değişmedi); değişmeyen görev yansıtması `tasks.json`'u yeniden yazıyordu; açılışta günlük görev bölümleri silinip geri yazılıyor ve ayraçlar her seferinde yeni kimlik alıyordu. Kalanlar `pisi-error.md` §4a ve §4b'de.
    - Verilen kararlar (onaylı): `electron-sync-reload-e2e.mjs`'in elle yeniden yükleme kısmı `scripts/electron-project-reload-e2e.mjs` olarak kaldı; matris Playwright'ı mobil paketten alır (yeni bağımlılık yok); matris her PR'da `sync-server.yml` içinde çalışır.
    - Belgede olmayan kararlar: iki cihazın bir senaryodan sonra "aynı proje"ye varması için masaüstünün yansıtma yazmaları beklenir ve en çok 4 değiş-tokuş turu kabul edilir (bir turda durulma şart koşulmadı, §4b); telefonun "uygulamaya dönüş" tetikleyicisi web derlemesinde `visibilitychange` olayıyla verilir; 3. senaryodaki görev tarihsizdir, çünkü bugüne tarihli görev masaüstünde bugünün günlüğünü oluşturur ve 4. senaryonun "iki tarafta da yeni günlük" koşulunu bozar.

### S8 · Cihazda kabul

**Amaç:** gerçek telefon, gerçek masaüstü ve kullanıcının sunucusuyla elle kabul.

1. `docs/sync-qa.md` cihaz kabul listesini yaz. En az şunlar bulunur:
    - cPanel kurulumu ve `/v1/info`.
    - Masaüstünde alan açma ve ilk yükleme.
    - QR ile ve kodla eşleştirme (doğrulama numarası).
    - Telefonda ilk indirme ve "ekle / kenara koy".
    - Her iki yönde not, görev ve günlük değişikliği.
    - Çakışma kopyası.
    - Masaüstünde silme ve yeniden adlandırma.
    - Görsel ve dosya ekinin açılınca inmesi; uçak modunda yer tutucu.
    - Uygulamayı arka plana alıp dönme.
    - Cihaz iptali ve yeniden eşleşme.
    - Açık not ve imlecin korunması.
    - Pil ve veri kullanımı gözlemi (bir gün).
2. `docs/mobile-qa.md`'ye senkronlu test APK'sı notu eklenir.
3. Kullanıcı listeyi uygular; çıkan sorunlar düzeltilir ya da `pisi-error.md`'ye yazılır.

**Kabul:** `docs/sync-qa.md`'deki bütün maddeler işaretlidir; `pisi-error.md`'de senkron için "yüksek" önemde açık madde yoktur.

---

## 5. Kapsam dışı

Aşağıdakiler bu planın ilk sürümüne girmez. Her biri ayrı bir karar ve plan gerektirir.

- Telefonda arka plan senkronu (Android WorkManager), bildirimle senkron, anlık itme (push).
- Anahtar yenileme (rotation) ve iptal sonrası yeniden şifreleme. İptal sunucu erişimini keser; iptal edilen cihazın elindeki veri ve anahtar kalır (`docs/sync-protocol.md` §11.4).
- Uzaktan silme (kaybolan telefondaki veriyi silme).
- Dolu bir masaüstü klasörünü var olan bir alana bağlayıp birleştirme (ikinci masaüstü yalnız boş klasöre iner).
- Çöp kutusu ve sürüm geçmişinin senkronu; masaüstünde silineni başka cihazdan geri yükleme.
- Telefonda silme, yeniden adlandırma, harita düzenleme (mobile-plan V9).
- Çakışma kopyasını uygulama içinde birleştirme arayüzü (kopya normal not olarak düzenlenir).
- Proje paylaşımı (birden çok kullanıcı), web arayüzü, sunucuda arama.
- iOS.
- Telefonda kaydedilen eklerin temizlenmesi ve depolama yönetimi.
- `pisi-error.md` §5d'nin kalıcı çözümü (mobilin görev bloğu işaretini güncellemesi). Bu planda yalnız SV13 ve S1 adım 6 vardır.

---

## 6. Oturum başlatma metinleri

**Sonraki her oturum:**

```text
maggezer/Pisi reposunda çalışıyoruz. Önce CLAUDE.md, docs/sync-plan.md ve docs/sync-protocol.md dosyalarını oku.
Sıradaki faz: S<numara>. Belgenin §0'daki çalışma kurallarına uy. Bu faz birden fazla modüle dokunuyorsa
önce uygulama planını yaz ve onayımı bekle. Bitince PR'ı oturum raporuyla aç ve dur.
```

**Mobil fazlar (S4, S5, S6) için ek satır:**

```text
Bu faz mobil iştir: docs/mobile-plan.md §0, §2 ve §3.6'yı da oku ve uy.
```

**Sunucu fazı (S2) için ek satır:**

```text
Gerçek sunucu adresimi ve kurulum anahtarımı repoya, test çıktısına ve PR'a yazma. cPanel rehberini ben uygulayacağım.
```
