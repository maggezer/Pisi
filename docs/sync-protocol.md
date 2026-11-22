# Pisi Sync protokolü — sürüm 1

Sürüm: 1 (S2: sunucuyla sınandı) · 17-11-2026 · Plan: [`docs/sync-plan.md`](sync-plan.md)

Bu belge Pisi istemcileri (masaüstü, mobil) ile Pisi senkron sunucusu (`server/`, PHP 8.4 + MariaDB 10.11) arasındaki tel biçimini tanımlar: uç noktalar, istek/yanıt JSON'ları, şifreleme, hata kodları, sürümleme ve tehdit modeli.
Sunucu ve istemci bu belgeye göre yazılır; belge ile kod çelişirse kod yanlıştır. Protokolü değiştiren her PR bu belgeyi de değiştirir (`docs/sync-plan.md` §3.10).

"ZORUNLU", "YAPILMAZ" ve "YAPILABİLİR" sözcükleri bağlayıcıdır.

---

## 1. Terimler

| Terim               | Anlamı                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Alan (space)        | Sunucuda bir Pisi projesine karşılık gelen bölüm. Kimliği `sp_…`.                                                 |
| Cihaz (device)      | Alana bağlı bir istemci kurulumu. Kimliği `dv_…`, rolü `admin` (masaüstü) ya da `member` (telefon).               |
| Proje anahtarı `K`  | Alanın 32 baytlık simetrik anahtarı. Yalnız cihazlarda bulunur; sunucu hiç görmez.                                |
| fid                 | Bir dosya yolunun anahtarlı, opak kimliği (§4.5).                                                                 |
| Blob                | Bir dosya içeriğinin şifreli hâli. Kimliği `b_…` (§4.6).                                                          |
| Değişiklik (change) | Günlükteki bir kayıt: bir fid için `put` (içerik bu blob'dur) ya da `delete`.                                     |
| `seq`               | Alan içinde sunucunun verdiği, 1'den başlayıp artan, boşluklu olabilen değişiklik numarası. Tek sıralama kaynağı. |
| Başlık (head)       | Bir fid'in en son değişikliği.                                                                                    |
| İmleç (cursor)      | Cihazın uyguladığı en büyük `seq`.                                                                                |
| Zarf (envelope)     | Şifreli içeriğin ikili biçimi (§4.2).                                                                             |

---

## 2. Taşıma

- **Yalnız HTTPS.** Sunucu düz HTTP isteğini `400 HTTPS_REQUIRED` ile reddeder (yönlendirme yapmaz, çünkü yönlendirme token'ı açıkta göndermiş olur). İstemciler sertifika doğrulamasını hiçbir koşulda kapatmaz.
- **Temel adres:** kullanıcının girdiği adres, ör. `https://sync.ornek.com` ya da `https://ornek.com/pisi`. Bütün yollar bunun altında `/v1/…` biçimindedir. Sondaki `/` yok sayılır.
- **İstek başlıkları:**
    - `Pisi-Sync-Protocol: 1`: `GET /v1/info` dışında ZORUNLU. Eksik ya da desteklenmeyen değer `426 PROTOCOL_UNSUPPORTED` döner (`details.min`, `details.max`).
    - `Authorization: Bearer <token>`: cihaz isteklerinde ZORUNLU. `Authorization`'ı PHP'ye geçirmeyen barındırmalar için aynı değer `X-Pisi-Token: <token>` olarak da gönderilebilir; ikisi birden gelirse aynı olmalıdır, değilse `TOKEN_INVALID`.
    - `Pisi-Setup-Key: <kurulum anahtarı>`: yalnız `POST /v1/spaces`.
    - `User-Agent: Pisi-Sync/1`: istemci sürümü, işletim sistemi ya da cihaz modeli GÖNDERİLMEZ.
    - `Content-Type: application/json` (JSON gövdeler) ya da `application/octet-stream` (blob parçaları).
- **Yanıt başlıkları:** `Content-Type: application/json; charset=utf-8` (blob indirme dışında), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Çerez YAZILMAZ. Sunucu ayarıyla `Strict-Transport-Security` eklenebilir.
- **CORS:** mobil uygulama WebView'den (`https://localhost`) istek yapar. Sunucu yalnız ayardaki kaynaklara (varsayılan `https://localhost`) `Access-Control-Allow-Origin` döner, `OPTIONS` ön isteğini yanıtlar ve `Access-Control-Allow-Credentials` göndermez. Kimlik doğrulama çerezle değil token'la yapıldığı için CORS bir yetki sınırı değildir.
- **JSON:** UTF-8, gövde bir JSON nesnesidir ve en çok `limits.maxRequestJsonBytes` (varsayılan 1 MiB) olur; aşan gövde `413 PAYLOAD_TOO_LARGE` döner. Bilinmeyen alanlar her iki tarafta yok sayılır (§10). Zamanlar ISO 8601 UTC (`2026-11-16T10:00:00.000Z`). İkili değerler JSON içinde dolgusuz base64url'dir (RFC 4648 §5).
- **Zaman aşımı:** istemci JSON isteklerinde 20 sn, blob parçalarında 120 sn bekler. Paylaşımlı barındırmada PHP'nin `max_execution_time` sınırı nedeniyle sunucu tek bir istekte uzun iş yapmaz; yükleme ve listeleme parçalıdır.

---

## 3. Kimlikler ve kodlamalar

| Değer              | Biçim                                                                                                               | Üreten                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Alan               | `sp_` + 22 karakter base64url (16 rastgele bayt)                                                                    | masaüstü (alan açarken)                       |
| Cihaz              | `dv_` + 22 karakter                                                                                                 | masaüstü (kendisi ve eşleştirdiği cihaz için) |
| Eşleştirme         | `pr_` + 22 karakter                                                                                                 | masaüstü                                      |
| Commit             | `cm_` + 22 karakter                                                                                                 | gönderen istemci                              |
| Yükleme            | `up_` + 22 karakter                                                                                                 | sunucu                                        |
| Cihaz token'ı      | `pst_` + 43 karakter (32 rastgele bayt)                                                                             | cihazın kendisi                               |
| fid                | `f_` + 43 karakter (32 baytlık HMAC)                                                                                | istemci (§4.5)                                |
| Blob               | `b_` + 43 karakter (32 baytlık HMAC)                                                                                | istemci (§4.6)                                |
| Kısa kod           | 8 karakter Crockford base32 (`0-9 A-Z`, `I L O U` yok), `XXXX-XXXX` gösterilir; büyük-küçük harf ve `-` yok sayılır | sunucu                                        |
| ECDH açık anahtarı | P-256, sıkıştırılmamış `raw` (65 bayt) → 87 karakter base64url                                                      | istemci                                       |

- İstemcinin ürettiği kimlikler kriptografik rastgelelikten gelir. Sunucu biçimi doğrular ve başka bir kayıtla çakışırsa `409 ID_TAKEN` döner.
- Sunucu token'ı yalnız `SHA-256(token)` özeti olarak saklar ve karşılaştırmayı sabit zamanlı yapar.

---

## 4. Kriptografi

Bütün işlemler Web Crypto API ile yapılır (Node 24 `globalThis.crypto.subtle`, Android WebView `crypto.subtle`). Sunucu şifre çözmez; yalnız şifreli baytların SHA-256'sını doğrular.

### 4.1 Anahtar hiyerarşisi

`K` (32 bayt) alan açılırken masaüstünde üretilir. Alt anahtarlar HKDF-SHA256 ile türetilir:

```text
salt = UTF8("pisi-sync/1|" + spaceId)
K_content = HKDF(K, salt, info = UTF8("content"), 32)   AES-256-GCM  blob içeriği
K_meta    = HKDF(K, salt, info = UTF8("meta"),    32)   AES-256-GCM  değişiklik metadata'sı
K_label   = HKDF(K, salt, info = UTF8("label"),   32)   AES-256-GCM  alan adı, cihaz adı
K_fid     = HKDF(K, salt, info = UTF8("fid"),     32)   HMAC-SHA256  dosya kimliği
K_blob    = HKDF(K, salt, info = UTF8("blob"),    32)   HMAC-SHA256  blob kimliği
```

`keyEpoch` bu sürümde her zaman `1`'dir. Anahtar yenileme kapsam dışıdır; alan ileride kullanılmak üzere zarfta durur.

### 4.2 Zarf biçimi

```text
offset  boyut  alan
0       4      sihirli değer: ASCII "PISE"
4       1      zarf sürümü: 0x01
5       1      bayraklar: bit0 = gzip ile sıkıştırıldı, bit1 = dolgulu (§4.4), diğer bitler 0
6       4      keyEpoch (uint32, big-endian)
10      12     nonce (rastgele, her şifrelemede yeni)
22      n+16   AES-256-GCM şifreli metin + 16 baytlık etiket
```

- **AAD** = zarfın ilk 22 baytı ‖ `UTF8("pisi-sync/1|" + spaceId + "|" + amaç + "|" + bağ)`.
- Aynı anahtarla aynı nonce YAPILMAZ. Nonce rastgele 96 bittir; alan başına 2³² şifrelemenin çok altında kalınır.
- Bilinmeyen sihirli değer, sürüm ya da bayrak: istemci `DECRYPT_FAILED` sayar ve uygulamaz.

| Amaç           | Anahtar     | Bağ (binding)                               | Düz içerik                                      |
| -------------- | ----------- | ------------------------------------------- | ----------------------------------------------- |
| `blob`         | `K_content` | blob kimliği                                | dosyanın baytları                               |
| `meta`         | `K_meta`    | `fid + "\|" + op + "\|" + (blob ya da "-")` | metadata JSON'u (§4.7)                          |
| `space-name`   | `K_label`   | alan kimliği                                | `{"v":1,"name":"Pisi Projem"}`                  |
| `device-label` | `K_label`   | cihaz kimliği                               | `{"v":1,"name":"Pixel 7","platform":"android"}` |
| `pair-label`   | `KEK`       | eşleştirme kimliği                          | cihaz etiketi (yukarıdakiyle aynı JSON)         |
| `pair-key`     | `KEK`       | eşleştirme kimliği                          | anahtar paketi (§6.6)                           |

Bağ, sunucunun bir şifreli parçayı başka bir dosyaya, blob'a ya da cihaza taşımasını engeller.

### 4.3 Şifre çözme sonrası doğrulama (ZORUNLU)

- `blob`: çözülen baytların `HMAC(K_blob, …)` değeri blob kimliğine eşit olmalıdır.
- İçerik adresli ek (`image/<sha256>.<uzantı>` vb.): çözülen baytların SHA-256'sı dosya adındaki özete eşit olmalıdır.
- `meta`: şema (§4.7) geçerli, `path` güvenli (§4.5) ve `fid` yeniden hesaplandığında aynı olmalıdır.
- Biri tutmazsa değişiklik uygulanmaz (plan SV9) ve istemci `DECRYPT_FAILED`, `META_INVALID`, `PATH_UNSAFE` ya da `HASH_MISMATCH_LOCAL` gösterir (§9.3).

### 4.4 Sıkıştırma ve dolgu

- **Sıkıştırma:** `node`, `map`, `authority` ve `json` sınıfındaki dosyalar şifrelemeden önce `gzip` (`CompressionStream('gzip')`) ile sıkıştırılır; bayrak bit0. Ekler sıkıştırılmaz.
- **Dolgu:** boyut sızıntısını azaltmak için sıkıştırmadan sonra, şifrelemeden önce dolgu yapılır; bayrak bit1. Biçim ISO/IEC 7816-4'tür: veri ‖ `0x80` ‖ `0x00…`. Hedef uzunluk `max(256, Padmé(L + 1))`:

```text
Padmé(L): E = floor(log2 L); S = floor(log2 E) + 1; z = E - S; m = 2^z - 1; sonuç = (L + m) & ~m
```

- Sürüm 1 istemcileri **her** amacın zarfını dolgular (bit1 = 1). Okuyan taraf bayrağa bakar; dolgusuz zarfı da açar.
- Sürüm 1'de `keyEpoch` 1 değilse zarf açılmaz (`DECRYPT_FAILED`).

### 4.5 Yol normalizasyonu ve fid

**Yol (`path`):**

- Proje köküne göre, `/` ayırıcılı, başında ve sonunda `/` olmayan, NFC'ye çevrilmiş göreli yol.
- Boş, `.` ya da `..` parça; NUL ya da denetim karakteri; `\`; Windows'ta geçersiz `<>:"|?*` karakterleri; sonu boşluk ya da nokta olan parça; 255 bayttan uzun parça ve 1024 bayttan uzun yol **güvensizdir**.
- Güvensiz yol gönderilmez, gelirse uygulanmaz; yerelde böyle bir dosya varsa "senkron edilmeyen dosyalar" listesinde gösterilir.
- Senkron dışı yollar (`docs/sync-plan.md` §3.3) gönderilmez ve gelirse uygulanmaz.

**fid:**

```text
pathKey = NFC( NFC(path).toLowerCase() )          // JavaScript'in yerelden bağımsız toLowerCase'i
fid     = "f_" + base64url( HMAC-SHA256(K_fid, UTF8(pathKey)) )
```

Büyük-küçük harf katlaması, Windows ve macOS'ta aynı dosyayı gösteren yolların aynı fid'i almasını sağlar. Yerelde aynı `pathKey`'e düşen iki ayrı dosya varsa ikisi de gönderilmez ve gösterilir.

### 4.6 Blob kimliği

```text
blob = "b_" + base64url( HMAC-SHA256(K_blob, dosyanın düz baytları) )
```

Aynı içerik her cihazda aynı blob kimliğini verir. Sunucu bir kez saklar; ikinci yükleme `exists: true` alır. Şifreli metinler nonce yüzünden farklı olsa da çözülen içerik aynıdır. Anahtarlı olduğu için sunucu bilinen bir dosyayı blob kimliğinden tanıyamaz.

### 4.7 Değişiklik metadata'sı

Her değişiklik, sunucunun göremediği bir `meta` taşır (`meta` amaçlı zarf, base64url):

```json
{
    "v": 1,
    "path": "Toplantı Notları.node",
    "class": "node",
    "op": "put",
    "size": 18234,
    "sha256": "9f2c…64 hex…",
    "docId": "node_829ebade-0cb6-4470-8dc8-1407ff6b103c",
    "dev": "dv_9cK2…",
    "dseq": 57,
    "at": "2026-11-16T10:00:00.000Z",
    "renamedFrom": null,
    "conflictOf": null
}
```

| Alan          | Zorunlu        | Açıklama                                                                                        |
| ------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `v`           | evet           | metadata ana sürümü. Bilinmeyen `v` uygulanmaz ve `PROTOCOL_UNSUPPORTED` gösterilir.            |
| `path`        | evet           | §4.5'e uyan yol.                                                                                |
| `class`       | evet           | `node`, `map`, `authority`, `json`, `marker`, `asset`, `other` (`docs/sync-plan.md` §3.3).      |
| `op`          | evet           | değişikliğin `op`'u ile aynı.                                                                   |
| `size`        | `put`'ta       | düz içeriğin bayt sayısı.                                                                       |
| `sha256`      | `put`'ta       | düz içeriğin SHA-256'sı (hex).                                                                  |
| `docId`       | `.node`/`.map` | belgenin `pisi.id`'si. Yeniden adlandırma ve düzenle-sil eşleştirmesi için.                     |
| `dev`         | evet           | gönderen cihaz. Değişikliğin sunucudaki `device` alanıyla aynı olmalıdır.                       |
| `dseq`        | evet           | gönderen cihazın her değişiklikte bir artırdığı sayaç (§7.4).                                   |
| `at`          | evet           | cihaz saati; yalnız gösterim için.                                                              |
| `renamedFrom` | hayır          | yeniden adlandırma ya da taşımada eski yolun fid'i. Aynı commit'te o fid için `delete` bulunur. |
| `conflictOf`  | hayır          | çakışma kopyasında asıl dosyanın fid'i.                                                         |

---

## 5. Değişiklik günlüğü modeli

- Her alan için sunucu, `seq`'e göre sıralı bir günlük ve her fid için bir başlık tutar.
- **`put`:** fid'in içeriği artık `blob`'dur. Blob, commit'ten önce yüklenmiş olmalıdır.
- **`delete`:** fid silindi. Başlık bir silme kaydı olarak kalır (tombstone); sonraki bir `put` dosyayı yeniden oluşturabilir.
- **`baseSeq`:** gönderenin o fid için gördüğü başlığın `seq`'i; fid'i hiç görmediyse `0`. Sunucu her değişiklik için `baseSeq == başlık.seq` (başlık yoksa `0`) koşulunu arar (§7.1).
- Geçerli geçişler: yok → `put`; `put` → `put` | `delete`; `delete` → `put`. Başka geçiş `422 INVALID_CHANGE` döner.
- `member` rolündeki cihaz `delete` gönderemez (`403 DELETE_NOT_ALLOWED`).

---

## 6. Uç noktalar

Özet (`A` = yalnız `admin`, `C` = herhangi bir etkin cihaz, `—` = kimlik doğrulamasız):

| Yöntem   | Yol                                             | Yetki            | Amaç                                             |
| -------- | ----------------------------------------------- | ---------------- | ------------------------------------------------ |
| `GET`    | `/v1/info`                                      | —                | sürüm ve sınırlar                                |
| `POST`   | `/v1/spaces`                                    | kurulum anahtarı | alan açma                                        |
| `GET`    | `/v1/spaces/{space}`                            | C                | alan bilgisi                                     |
| `DELETE` | `/v1/spaces/{space}`                            | A                | alanı bütünüyle silme                            |
| `GET`    | `/v1/spaces/{space}/head`                       | C                | ucuz yoklama                                     |
| `GET`    | `/v1/spaces/{space}/changes`                    | C                | imleçten sonraki değişiklikler                   |
| `GET`    | `/v1/spaces/{space}/heads`                      | C                | bütün başlıklar (ilk indirme, tam karşılaştırma) |
| `POST`   | `/v1/spaces/{space}/commit`                     | C                | toplu gönderim                                   |
| `POST`   | `/v1/spaces/{space}/blobs/check`                | C                | eksik blob'ları sorma                            |
| `POST`   | `/v1/spaces/{space}/blobs/{blob}/uploads`       | C                | yükleme başlatma                                 |
| `PUT`    | `/v1/spaces/{space}/uploads/{upload}/parts/{n}` | C                | parça yükleme                                    |
| `POST`   | `/v1/spaces/{space}/uploads/{upload}/complete`  | C                | yüklemeyi bitirme                                |
| `DELETE` | `/v1/spaces/{space}/uploads/{upload}`           | C                | yüklemeyi bırakma                                |
| `GET`    | `/v1/spaces/{space}/blobs/{blob}`               | C                | blob indirme (`Range` destekli)                  |
| `GET`    | `/v1/spaces/{space}/devices`                    | A                | cihaz listesi                                    |
| `GET`    | `/v1/spaces/{space}/devices/me`                 | C                | bu cihaz                                         |
| `PATCH`  | `/v1/spaces/{space}/devices/me`                 | C                | cihaz etiketini değiştirme                       |
| `DELETE` | `/v1/spaces/{space}/devices/{device}`           | A (ya da `me`)   | cihaz iptali / ayrılma                           |
| `POST`   | `/v1/spaces/{space}/pairings`                   | A                | eşleştirme başlatma                              |
| `GET`    | `/v1/spaces/{space}/pairings/{pairing}`         | A                | eşleştirme durumu                                |
| `POST`   | `/v1/spaces/{space}/pairings/{pairing}/grant`   | A                | onay ve anahtar paketi                           |
| `POST`   | `/v1/spaces/{space}/pairings/{pairing}/reject`  | A                | ret                                              |
| `DELETE` | `/v1/spaces/{space}/pairings/{pairing}`         | A                | iptal                                            |
| `POST`   | `/v1/pairings/lookup`                           | —                | kısa kodla eşleştirmeyi bulma                    |
| `POST`   | `/v1/pairings/{pairing}/claim`                  | —                | eşleştirmeye katılma                             |
| `GET`    | `/v1/pairings/{pairing}/result`                 | bekleyen token   | sonucu alma                                      |

Bir cihazın yetkisi her istekte veritabanından okunur. Başka bir alanın kaynağına erişim `404 NOT_FOUND` döner; alanın varlığı sızdırılmaz.

### 6.1 `GET /v1/info`

```json
{
    "service": "pisi-sync",
    "protocol": { "min": 1, "max": 1, "revision": 1 },
    "server": { "version": "1.0.0" },
    "limits": {
        "maxBlobBytes": 67108864,
        "partBytes": 4194304,
        "maxCommitChanges": 200,
        "maxChangesPage": 1000,
        "maxHeadsPage": 1000,
        "maxRequestJsonBytes": 1048576,
        "maxCheckBlobs": 500,
        "pairingTtlSeconds": 600,
        "spaceQuotaBytes": null
    },
    "time": "2026-11-16T10:00:00.000Z"
}
```

`maxBlobBytes` şifreli boyuttur. İstemci, dosyanın şifrelenmiş ve dolgulanmış boyutu bunu aşacaksa dosyayı göndermez ve "senkron edilmeyen dosyalar"da gösterir. `partBytes`, sunucunun `post_max_size` değerinin altında seçilir.

`/v1/info` veritabanına dokunmaz: şema göçü beklenirken ya da veritabanı yokken de `200` döner. `MAINTENANCE` ve `DB_UNAVAILABLE` yalnız öteki uç noktalarda görülür.

### 6.2 Alanlar

**`POST /v1/spaces`** (başlık `Pisi-Setup-Key`):

```json
{
    "spaceId": "sp_Q0x3mVt2Yk1pR8sA0bC9dE",
    "deviceId": "dv_8h1Lq0Zx2Wc7Vb3Nm5Kp4J",
    "tokenHash": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
    "spaceName": "<base64url zarf: space-name>",
    "deviceLabel": "<base64url zarf: device-label>"
}
```

`201`:

```json
{ "spaceId": "sp_Q0x3mVt2Yk1pR8sA0bC9dE", "deviceId": "dv_8h1Lq0Zx2Wc7Vb3Nm5Kp4J", "role": "admin", "head": 0, "createdAt": "2026-11-16T10:00:00.000Z" }
```

`tokenHash`, cihazın ürettiği token'ın SHA-256'sıdır (hex). Sunucu token'ın kendisini bu istekte görmez. Hatalar: `SETUP_KEY_INVALID`, `ID_TAKEN`, `RATE_LIMITED`, `QUOTA_EXCEEDED` (sunucudaki alan sayısı sınırı).

**`GET /v1/spaces/{space}`** → `200`:

```json
{
    "spaceId": "sp_…",
    "spaceName": "<zarf>",
    "keyEpoch": 1,
    "head": 1287,
    "prunedThrough": 0,
    "usageBytes": 183402112,
    "quotaBytes": null,
    "createdAt": "2026-11-16T10:00:00.000Z"
}
```

**`DELETE /v1/spaces/{space}`** (A), gövde `{"confirm": "sp_…"}` (yol ile aynı olmalı) → `204`. Bütün kayıtlar, cihazlar ve blob'lar silinir; alanın token'ları bundan sonra `TOKEN_INVALID` alır. Geri alınamaz.

### 6.3 Değişiklikler

**`GET /v1/spaces/{space}/head`** → `200 {"head": 1287, "prunedThrough": 0}`. Yoklamanın ucuz yoludur. İstemci `head` imleçten büyükse `changes` ister.

**`GET /v1/spaces/{space}/changes?after=<seq>&limit=<n>`** (`limit` ≤ `maxChangesPage`) → `200`:

```json
{
    "changes": [
        {
            "seq": 1288,
            "fid": "f_…",
            "op": "put",
            "blob": "b_…",
            "size": 18688,
            "device": "dv_…",
            "commit": "cm_…",
            "at": "2026-11-16T10:00:03.120Z",
            "meta": "<zarf: meta>"
        },
        { "seq": 1289, "fid": "f_…", "op": "delete", "blob": null, "size": 0, "device": "dv_…", "commit": "cm_…", "at": "…", "meta": "<zarf>" }
    ],
    "head": 1301,
    "more": true
}
```

- Kayıtlar `seq`'e göre artan sıradadır. Bir commit'in kayıtları ardışık ve bütündür: sayfa bir commit'in ortasında bitmez (sayfa gerekirse `limit`'i aşar).
- `after < prunedThrough` ise `410 CURSOR_EXPIRED`; istemci `heads` ile tam karşılaştırmaya geçer.

**`GET /v1/spaces/{space}/heads?after=<fid>&limit=<n>`** → `200`:

```json
{
    "asOfSeq": 1301,
    "heads": [{ "fid": "f_…", "seq": 1290, "op": "put", "blob": "b_…", "size": 2048, "device": "dv_…", "at": "…", "meta": "<zarf>" }],
    "next": "f_…"
}
```

- Silme başlıkları da listelenir. Sıralama fid'e göredir; `next: null` son sayfadır. `asOfSeq` ilk sayfanın alındığı andaki `head`'dir.
- İstemci listeyi bitirince `changes?after=<ilk sayfanın asOfSeq'i>` ile arada olanları alır; aynı değişikliği iki kez uygulamak sonucu değiştirmez.

**`POST /v1/spaces/{space}/commit`:**

```json
{
    "commitId": "cm_V2c8Qm1Zp0Lx7Nk3Tb5Rw9",
    "changes": [
        { "fid": "f_…", "op": "put", "blob": "b_…", "size": 18688, "baseSeq": 1290, "meta": "<zarf>" },
        { "fid": "f_…", "op": "put", "blob": "b_…", "size": 4096, "baseSeq": 0, "meta": "<zarf>" },
        { "fid": "f_…", "op": "delete", "baseSeq": 1102, "meta": "<zarf>" }
    ]
}
```

`200`:

```json
{ "commitId": "cm_V2c8Qm1Zp0Lx7Nk3Tb5Rw9", "seqs": [1302, 1303, 1304], "head": 1304 }
```

- 1 ile `maxCommitChanges` arası değişiklik (boş liste `INVALID_FIELD`, fazlası `422 BATCH_TOO_LARGE`); aynı fid bir commit'te bir kez (`422 DUPLICATE_FID`).
- `delete` değişikliğinde `blob` gönderilmez ya da `null`'dır; `size` gönderilmez ya da `0`'dır. `meta` her iki işlemde ZORUNLU'dur.
- `put`'un `blob`'u alanda var olmalı ve `size` blob'un şifreli boyutuna eşit olmalıdır (`422 BLOB_MISSING`, `422 SIZE_MISMATCH`).
- Bütün commit tek veritabanı işleminde yazılır: ya hepsi ya hiçbiri.
- Aynı `commitId` ile tekrar gelen istek, ilk sonucu aynen döner ve yeni kayıt yazmaz (§7.3). Aynı `commitId` farklı gövdeyle ya da başka bir cihazdan gelirse `409 COMMIT_ID_REUSED`.
- Denetim sırası: alan biçimleri → `DELETE_NOT_ALLOWED` → idempotens (`commitId`) → `STALE_BASE` → `INVALID_CHANGE` → `BLOB_MISSING` / `SIZE_MISMATCH`.
- `409 STALE_BASE`:

```json
{
    "error": {
        "code": "STALE_BASE",
        "message": "Bazı dosyaların sunucudaki sürümü değişti.",
        "retryable": true,
        "details": { "head": 1310, "stale": [{ "fid": "f_…", "baseSeq": 1290, "headSeq": 1307 }] }
    }
}
```

### 6.4 Blob'lar

**`POST /v1/spaces/{space}/blobs/check`**: `{"blobs": ["b_…", "b_…"]}` (≤ `maxCheckBlobs`) → `200 {"missing": ["b_…"]}`.

**`POST /v1/spaces/{space}/blobs/{blob}/uploads`**: `{"size": 18688, "sha256": "<şifreli baytların SHA-256'sı, hex>"}`

- Blob zaten varsa `200 {"exists": true}`.
- Yoksa `201`:

```json
{ "uploadId": "up_…", "partBytes": 4194304, "parts": 1, "expiresAt": "2026-11-17T10:00:00.000Z" }
```

- Hatalar: `PAYLOAD_TOO_LARGE` (`size > maxBlobBytes`), `QUOTA_EXCEEDED`.

**`PUT /v1/spaces/{space}/uploads/{upload}/parts/{n}`** (`n` 1'den başlar):

- Gövde ham baytlardır (`application/octet-stream`); başlık `Pisi-Part-Sha256: <hex>`.
- Son parça dışında her parça tam `partBytes`'tır.
- Aynı parça yeniden gönderilebilir (son gelen geçerlidir).
- `200 {"part": 1, "received": 18688}`; `received` şimdiye kadar alınan parçaların toplam baytıdır.
- Hatalar: `HASH_MISMATCH` (parça özeti), `PAYLOAD_TOO_LARGE` (parça beklenenden büyük), `BAD_REQUEST` (parça numarası `1…parts` dışında, parça beklenenden küçük ya da `Pisi-Part-Sha256` yok), `UNSUPPORTED_MEDIA_TYPE`, `UPLOAD_NOT_FOUND`, `UPLOAD_EXPIRED`.
- Yükleme 24 saat geçerlidir (`expiresAt`).

**`POST /v1/spaces/{space}/uploads/{upload}/complete`**: gövde `{}` → `201 {"blob": "b_…", "size": 18688}`.

- Sunucu parçaları birleştirir, toplam boyutu ve SHA-256'yı doğrular, dosyayı `public_html` dışındaki blob klasörüne atomik olarak (geçici dosya + `rename`) taşır.
- Hatalar: `UPLOAD_INCOMPLETE` (eksik parça; `details.missing`), `HASH_MISMATCH` (yükleme silinir), `QUOTA_EXCEEDED`.
- `blobs/check`'te var görünen ya da `exists: true` dönen blob, commit'e kadar temizlikten korunur (§8).
- Aynı blob o arada başka bir cihazdan tamamlandıysa `200 {"blob": "b_…", "size": …, "exists": true}`.

**`DELETE /v1/spaces/{space}/uploads/{upload}`** → `204`.

**`GET /v1/spaces/{space}/blobs/{blob}`**:

- `200` ya da `Range: bytes=a-b` ile `206`.
- Başlıklar: `Content-Type: application/octet-stream`, `Content-Length`, `Accept-Ranges: bytes`, `ETag: "b_…"`, `Pisi-Blob-Sha256: <hex>`.
- Tek aralık desteklenir; çoklu aralık `416`. Hata: `BLOB_NOT_FOUND`.

### 6.5 Cihazlar

**`GET /v1/spaces/{space}/devices`** (A) → `200`:

```json
{
    "devices": [
        {
            "deviceId": "dv_…",
            "role": "admin",
            "label": "<zarf: device-label>",
            "createdAt": "…",
            "lastSeenAt": "2026-11-16T09:58:00.000Z",
            "lastProtocol": 1,
            "revokedAt": null
        }
    ]
}
```

`lastSeenAt` dakika hassasiyetinde tutulur. Eşleştirilen cihazda ilk değer, telefonun sonucu aldığı (`result`) andır.

**`GET /v1/spaces/{space}/devices/me`** → aynı biçimde tek cihaz.

**`PATCH /v1/spaces/{space}/devices/me`**: `{"label": "<zarf>"}` → `200` cihaz.

**`DELETE /v1/spaces/{space}/devices/{device}`** (A; ya da `{device}` = `me`) → `204`. Zaten iptal edilmiş cihaz için de `204`.

- Cihaz `revokedAt` ile işaretlenir; satırı ve geçmişteki değişiklikleri kalır.
- İptal edilen token'la gelen her istek `403 DEVICE_REVOKED` döner.
- Son etkin `admin` kendini iptal edemez: `409 LAST_ADMIN`.

### 6.6 Eşleştirme

**Akış (QR yolu):**

```text
Masaüstü (admin)                         Sunucu                               Telefon
1 ECDH (dPriv,dPub), sır x (32 bayt),
  yeni cihaz kimliği d üret
  POST pairings {pairingId,deviceId:d,
  desktopKey:dPub}  ───────────────────▶ kod üretir, 10 dk
                    ◀─────────────────── {code, expiresAt}
2 QR: pisi-sync:1?u=…&s=…&p=…&k=dPub&x=x&c=kod
                                                                       3 QR okur; ECDH (mPriv,mPub),
                                                                         token t üretir
                                         ◀─── POST /v1/pairings/{p}/claim {method:"qr",
                                              deviceKey:mPub, proof, label, tokenHash}
4 GET pairings/{p} ──────────────────▶  {state:"claimed", deviceKey, proof, label}
  proof'u x ile doğrular, KEK türetir,
  etiketi çözer, "Pixel 7 bağlanmak
  istiyor" → kullanıcı onaylar
  POST grant {role, wrappedKey, label} ▶ cihaz d'yi tokenHash ile etkinleştirir
                                         ◀─── GET /v1/pairings/{p}/result (Bearer t)
                                         ───▶ {spaceId, deviceId, wrappedKey, desktopKey}
                                                                       5 KEK ile anahtar paketini çözer,
                                                                         K ve t'yi Keystore'a yazar
```

**QR alanları:** `u` sunucu temel adresi (`https://`, sondaki `/` olmadan, URL kodlamalı), `s` alan, `p` eşleştirme, `k` masaüstü ECDH açık anahtarı (87 karakter), `x` 32 baytlık eşleştirme sırrı (43 karakter base64url), `c` kısa kod (`XXXX-XXXX`). Alan sırası sabittir; bir alan iki kez gelirse ya da biri eksikse QR reddedilir. Etiketteki `platform` değerleri: `windows`, `macos`, `linux`, `android`, `ios`, `web`.

**Kod yolu:** telefon 3. adımdan önce `POST /v1/pairings/lookup {"code": "7K3M-Q9WX"}` ile `pairingId`, `spaceId` ve `desktopKey`'i alır ve claim'de `method: "code"`, `code` gönderir (`proof` yok). Ardından iki taraf **doğrulama numarasını** hesaplayıp gösterir. Masaüstü, kullanıcı "Aynı" demeden `grant` göndermez; "Farklı" derse `reject` gönderir.

**Türetmeler:**

```text
Z      = ECDH-P256(kendi özel anahtarı, karşı açık anahtar)          // 32 bayt x koordinatı
KEK    = HKDF(Z, salt = UTF8("pisi-sync/1|pair|" + pairingId),
              info = UTF8("kek|" + desktopKey + "|" + deviceKey), 32)   // AES-256-GCM
proof  = base64url( HMAC-SHA256(x, UTF8("pisi-sync/1|claim|" + pairingId + "|" + deviceKey)) )
sas    = uint32_be( HKDF(Z, salt = UTF8("pisi-sync/1|sas|" + pairingId),
              info = UTF8(desktopKey + "|" + deviceKey), 4) ) mod 1000000   // "482 913"
```

`pair-key` zarfı içindeki anahtar paketi:

```json
{ "v": 1, "spaceId": "sp_…", "deviceId": "dv_…", "keyEpoch": 1, "key": "<K, base64url>", "spaceName": "Pisi Projem" }
```

**`POST /v1/spaces/{space}/pairings`** (A):

```json
{ "pairingId": "pr_…", "deviceId": "dv_…", "desktopKey": "<87 karakter>" }
```

→ `201 {"pairingId": "pr_…", "code": "7K3M-Q9WX", "expiresAt": "…"}`. Bir alanda aynı anda en çok 3 açık eşleştirme bulunur (`409 PAIRING_LIMIT`).

**`POST /v1/pairings/lookup`** (—): `{"code": "7K3M-Q9WX"}` → `200 {"pairingId": "pr_…", "spaceId": "sp_…", "desktopKey": "…", "expiresAt": "…"}`.

- Yalnız `open` durumundaki eşleştirme bulunur. Yanlış ya da süresi dolmuş kod: `404 PAIRING_NOT_FOUND`. Her deneme IP sayacını artırır (§9.4).
- Bir eşleştirmede 5 yanlış kodlu claim olursa (her biri `403 PAIRING_CODE_INVALID`) eşleştirme kapanır; sonraki claim `410 PAIRING_EXPIRED` alır.

**`POST /v1/pairings/{pairing}/claim`** (—):

```json
{
    "method": "qr",
    "proof": "<base64url>",
    "code": null,
    "deviceKey": "<87 karakter>",
    "label": "<zarf: pair-label>",
    "tokenHash": "<telefonun token'ının SHA-256'sı, hex>"
}
```

- `202 {"state": "claimed", "expiresAt": "…"}`.
- Eşleştirme `open` değilse `409 PAIRING_STATE` (`details.state`); süresi dolduysa `410 PAIRING_EXPIRED`. `tokenHash` başka bir cihazınkiyle aynıysa `409 ID_TAKEN`.
- Başarılı claim'den sonra kısa kod geçersizdir.
- `method: "code"` iken `code` eşleştirmeninkine eşit olmalıdır (`403 PAIRING_CODE_INVALID`).
- Sunucu `proof`'u doğrulayamaz; yalnız saklar ve masaüstüne verir.

**`GET /v1/spaces/{space}/pairings/{pairing}`** (A) → `200`:

```json
{
    "pairingId": "pr_…",
    "state": "claimed",
    "method": "qr",
    "deviceKey": "…",
    "proof": "…",
    "label": "<zarf>",
    "expiresAt": "…"
}
```

`state` değerleri: `open`, `claimed`, `granted`, `collected`, `rejected`, `cancelled`, `expired`.

**`POST /v1/spaces/{space}/pairings/{pairing}/grant`** (A):

```json
{ "role": "member", "wrappedKey": "<zarf: pair-key>", "label": "<zarf: device-label, K_label ile>" }
```

`200 {"state": "granted", "deviceId": "dv_…"}`. Cihaz satırı `tokenHash` ile bu anda etkinleşir. Yalnız `claimed` durumda kabul edilir; telefonun sonucu alma süresi onay anından yeniden başlar (`pairingTtlSeconds`).

**`POST /v1/spaces/{space}/pairings/{pairing}/reject`** (A) → `200 {"state": "rejected"}`. Yalnız `open` ya da `claimed` durumda.

**`DELETE /v1/spaces/{space}/pairings/{pairing}`** (A) → `204` (`cancelled`). `open`/`claimed` iptal edilir; zaten `cancelled` ya da `expired` ise yine `204`; öteki durumlarda `409 PAIRING_STATE`.

**`GET /v1/pairings/{pairing}/result`**:

- `Authorization: Bearer <telefonun token'ı>`; özeti claim'deki `tokenHash`'e eşit olmalıdır.
- `granted` iken `200`:

```json
{ "state": "granted", "spaceId": "sp_…", "deviceId": "dv_…", "role": "member", "wrappedKey": "<zarf>", "desktopKey": "…" }
```

- İlk başarılı okumadan sonra `wrappedKey` sunucudan silinir ve durum `collected` olur.
- Henüz onaylanmadıysa `202 {"state": "claimed"}`; reddedildiyse `403 PAIRING_REJECTED`; süresi dolduysa `410 PAIRING_EXPIRED`; sonuç alınmışsa ya da iptal edildiyse `409 PAIRING_STATE` (`details.state`).
- Token yoksa `401 AUTH_REQUIRED`; özeti tutmuyorsa `401 TOKEN_INVALID`.
- İstemci 2 sn aralıkla yoklar.

**İstemci denetimleri (ZORUNLU):**

- Telefon QR yolunda `lookup` yapmaz; `desktopKey`'i yalnız QR'dan alır. `result`'taki `desktopKey` QR'dakinden farklıysa durur.
- Masaüstü QR yolunda `proof` doğrulanmadan onay penceresini göstermez.
- Kod yolunda iki taraf doğrulama numarasını gösterir; telefon numarayı gösterdikten sonra `result`'u bekler.
- Masaüstü her iki yolda da çözülen cihaz adını gösterir ve kullanıcı onayı olmadan `grant` göndermez.

---

## 7. Tutarlılık ve eşzamanlılık

### 7.1 Karşılaştır-ve-değiştir

Commit'teki her değişiklik için sunucu, alan satırını kilitleyerek (`SELECT … FOR UPDATE`) şunu denetler: `baseSeq` = fid'in başlığının `seq`'i (başlık yoksa `0`). Biri tutmazsa bütün commit `STALE_BASE` ile reddedilir. Tutarsa `seq`'ler `spaces.head`'den sırayla verilir, `changes`'e eklenir, `heads` güncellenir ve işlem tamamlanır.

### 7.2 Birleştirmeyi kim yapar

`STALE_BASE` alan istemci önce çeker, sonra üç yollu birleştirmeyi yerelde yapar (`docs/sync-plan.md` §3.4) ve yeni `baseSeq`'lerle yeniden gönderir. Sunucu içerik birleştirmez. Böylece bir çakışma için tek bir çakışma kopyası oluşur.

### 7.3 İdempotens

- Sunucu her başarılı commit'i `commits(spaceId, commitId)` ile en az 7 gün saklar (gövdenin SHA-256'sı ve verilen `seqs`).
- Ağ hatasından sonra istemci **aynı** `commitId` ve aynı gövdeyle yeniden dener.
- Blob yükleme de idempotenttir: aynı blob ikinci kez `exists: true` döner.

### 7.4 İstemcinin sunucuya karşı denetimleri

- **Geri sarma:** `head` ya da gelen bir `seq` cihazın imlecinden küçükse istemci senkronu durdurur, `SERVER_ROLLBACK` gösterir ve hiçbir şey yazmaz. Kullanıcı ancak bilerek "sunucuyla yeniden eşleş" diyerek devam eder.
    - İmleç yalnız çekmeyle ilerler. Bu yüzden cihaz, kendi commit'leri için sunucudan aldığı en büyük `seq`'i de saklar (`knownSeq`; cihaz durumunda, sunucuya gitmez). `head` bundan küçükse de geri sarma sayılır. Böylece cihazın gönderdiği ama sunucunun eski yedeğinde olmayan bir değişiklik sessizce kaybolmaz (S7'de senaryo matrisiyle bulundu; tel biçimi değişmedi).
    - **"Sunucuyla yeniden eşleş"** (`shared/sync-recovery.mjs`): eşleşme, token ve proje dosyaları kalır; imleç, `knownSeq`, görülen `dseq`'ler ve bekleyen commit sıfırlanır, sonraki tur bütün başlıkları (`GET heads`) alır. Cihazın eski indeksi her dosya için şöyle kullanılır:
        - sunucu aynı içeriği tutuyorsa (aynı blob) dosya eşit sayılır;
        - sunucunun sürümü cihazın daha önce gördüğü bir sürümse (kendi değişikliği ya da `dseq`'i o cihazdan görülen en büyük değeri aşmayan bir değişiklik) sunucunun sürümü cihazınkinden eskidir; cihazın sürümü yeniden gönderilir (birleştirme yok);
        - sunucunun sürümü yeni ve cihazın son eşitlediği sürümü yazan cihazdan geliyorsa (ör. önce yeniden eşleşen masaüstü) o sürüm gerçek bir temeldir ve olağan üç yollu birleştirme yapılır. Bunun için indeks girdisi sürümü yazan cihazı (`dev`) tutar;
        - geri kalan her durumda (sürümü başka bir cihaz yazdı, çekilip uygulanmamış bir değişiklik, silme, doğrulanamayan kayıt) yerel ve uzak boş temelle birleşir (`docs/sync-plan.md` §3.4): iki taraftan da metin kaybolmaz, gerekirse çakışma kopyası oluşur.
        - Silmeler tahmin edilmez: sunucunun döndüğü yedekten sonra silinen dosyalar geri gelebilir. Telefon yeniden eşleşirken de silme göndermez (SV12).
    - İmleç tek başına her geri sarmayı gösteremez: yedekten sonra eşitleyip kapalı kalan cihazın imlecini, öbür cihazların o arada gönderdikleri yeniden geçebilir; aradaki `seq`'ler başka değişikliklere yeniden verilmiştir. Bunun için iki denetim vardır (tel biçimi değişmez):
        - **İmleç işareti:** cihaz çektiği son değişikliğin `seq`, `fid` ve `commit` kimliğini saklar ve sonraki çekmeye bir satır geriden başlar (`changes?after=<imleç − 1>`). İmleçteki satır hâlâ o değişiklik olmalıdır; `seq` bir kez verildiği için geri sarmada o `seq` başka bir commit'e (rastgele kimlik) düşer ve cihaz hiçbir şey uygulamadan ve göndermeden `SERVER_ROLLBACK` ile durur. Hiçbir şey çekmeyip yalnız gönderen tur, göndermeden önce aynı satırı `limit=1` ile denetler. İmleçteki satır budanmışsa bu denetim yapılamaz.
        - **Başlıklar geri gitmez:** bütün başlıklarla yapılan her karşılaştırmada (ilk indirme hariç) cihaz, eşitlediği her dosyanın başlığını indeksiyle karşılaştırır. Başlık indeksteki `seq`'in altındaysa, aynı `seq`'te başka bir blob'u gösteriyorsa ya da hiç yoksa sunucu geri gitmiştir: `SERVER_ROLLBACK`. Cihaz en geç günde bir böyle bir karşılaştırma yapar (işareti olmayan eski durumlar ve budanmış satırlar için).
- **Yeniden oynatma:** her cihaz için görülen en büyük `dseq` saklanır. Aynı cihazdan gelen `dseq` öncekinden büyük değilse ya da `meta.dev` değişikliğin `device` alanıyla tutmuyorsa değişiklik uygulanmaz ve `SERVER_REPLAY` gösterilir.
- **Uygulanmayan değişiklikler:** doğrulanamayan bir uzak değişiklik (`DECRYPT_FAILED`, `HASH_MISMATCH_LOCAL`, `META_INVALID`, `PATH_UNSAFE`, `PROTOCOL_UNSUPPORTED`, `SERVER_REPLAY`, `BLOB_NOT_FOUND`) yazılmaz ve imleç ilerler; değişiklik cihaz durumunda dosya kimliğiyle tutulur ve Ayarlar'da listelenir. Aynı dosyanın daha yeni ve geçerli bir değişikliği gelince liste kaydı kalkar. `SERVER_REPLAY` ve `PATH_UNSAFE` dışındakiler bütün başlıklarla (`GET heads`) yeniden denenir: "Şimdi eşitle"de hemen, yoksa en çok 15 dakikada bir. Tam karşılaştırma `dseq` denetlemediği için daha önce reddedilen yeniden oynatma aynı `seq`'te yine reddedilir.
- **Bağ:** `meta` zarfı fid, op ve blob'a bağlıdır (§4.2). Sunucu bir blob'u ya da meta'yı başka bir dosyaya taşıyamaz.
- **Uygulama sırası:** bir commit'in değişiklikleri birlikte uygulanır. Önce ekler, sonra belgeler, sonra otorite dosyaları (`docs/sync-plan.md` §3.6).
- **Son masaüstü:** alandaki son etkin `admin` `DELETE devices/me` ile `LAST_ADMIN` alır. İstemci bu durumda bağı sessizce bırakmaz; kullanıcı onaylarsa alanı `DELETE /v1/spaces/{space}` ile siler. Silinen alanın cihazları `TOKEN_INVALID` alır; telefon senkronu bırakır, dosyaları kalır ve kullanıcıya alanın silinmiş olabileceğini söyler. Sahipsiz kalmış alanları hosting sahibi `app/bin/spaces.php` ile görür ve siler (`docs/sync-server-cpanel.md` §16).

---

## 8. Budama ve temizlik

`app/bin/gc.php` (cPanel Cron Jobs, önerilen saatte bir). Cron yoksa saatte en çok bir kez, bir isteğin yanıtı gönderildikten sonra en çok 2 sn süren fırsatçı temizlik yapılır.

- **Günlük budama:** başlık olmayan ve `retainDays`'ten (varsayılan 90) eski değişiklikler silinebilir. `prunedThrough`, altındaki her şeyin eksik olabileceği en büyük `seq`'tir. Başlıklar (silme başlıkları dâhil) hiç budanmaz.
- **Blob temizliği:** hiçbir başlığın ve saklanan hiçbir değişikliğin başvurmadığı, 48 saatten eski blob'lar silinir. 48 saat, yüklenip henüz commit'lenmemiş blob'ları korur.
- **Yüklemeler:** 24 saatte tamamlanmayan yüklemeler ve parçaları silinir.
- **Eşleştirmeler:** süresi dolan `open`/`claimed` kayıtlar `expired` olur; 7 gün sonra silinir. `collected` kayıtlarda `wrappedKey` zaten yoktur.
- **Commit kayıtları:** 7 günden eskiler silinir.
- **Hız sınırı sayaçları:** penceresi geçenler silinir.

---

## 9. Hatalar

### 9.1 Biçim

Başarısız her JSON yanıtı:

```json
{ "error": { "code": "STALE_BASE", "message": "İnsan okuması için kısa açıklama.", "retryable": true, "details": {} } }
```

- İstemci davranışı yalnız `code`'a göre seçer. `message` gösterim içindir ve dili sunucu ayarına göre Türkçe ya da İngilizcedir; istemci kullanıcıya kendi locale metnini gösterir.
- `details` isteğe bağlıdır.
- Hata yanıtı token, anahtar, dosya yolu, SQL ya da yığın izi İÇERMEZ.

### 9.2 Sunucu hata kodları

| HTTP | Kod                      | Ne zaman                                                           | Yeniden dene                 |
| ---- | ------------------------ | ------------------------------------------------------------------ | ---------------------------- |
| 400  | `HTTPS_REQUIRED`         | istek HTTPS değil                                                  | hayır                        |
| 400  | `BAD_REQUEST`            | yol, sorgu ya da başlık geçersiz                                   | hayır                        |
| 400  | `INVALID_JSON`           | gövde bir JSON nesnesi değil                                       | hayır                        |
| 400  | `INVALID_FIELD`          | alan eksik ya da biçimi yanlış (`details.field`)                   | hayır                        |
| 401  | `AUTH_REQUIRED`          | token yok                                                          | hayır                        |
| 401  | `TOKEN_INVALID`          | token tanınmıyor                                                   | hayır                        |
| 403  | `DEVICE_REVOKED`         | cihaz iptal edilmiş                                                | hayır; eşleşme sonlanır      |
| 403  | `FORBIDDEN_ROLE`         | işlem `admin` gerektiriyor                                         | hayır                        |
| 403  | `DELETE_NOT_ALLOWED`     | `member` cihaz `delete` gönderdi                                   | hayır                        |
| 403  | `SETUP_KEY_INVALID`      | kurulum anahtarı yanlış                                            | hayır                        |
| 403  | `PAIRING_CODE_INVALID`   | claim'deki kod tutmuyor                                            | hayır                        |
| 403  | `PAIRING_REJECTED`       | masaüstü reddetti                                                  | hayır                        |
| 404  | `NOT_FOUND`              | yol ya da kaynak yok (başka alanın kaynağı dâhil)                  | hayır                        |
| 404  | `BLOB_NOT_FOUND`         | blob yok                                                           | hayır                        |
| 404  | `UPLOAD_NOT_FOUND`       | yükleme yok                                                        | hayır; yeniden başlat        |
| 404  | `PAIRING_NOT_FOUND`      | kod ya da eşleştirme yok                                           | hayır                        |
| 405  | `METHOD_NOT_ALLOWED`     | yöntem desteklenmiyor                                              | hayır                        |
| 409  | `STALE_BASE`             | `baseSeq` başlıkla tutmuyor                                        | evet: çek, birleştir, gönder |
| 409  | `ID_TAKEN`               | istemcinin ürettiği kimlik kullanılıyor                            | evet: yeni kimlikle          |
| 409  | `COMMIT_ID_REUSED`       | aynı `commitId` farklı gövdeyle ya da başka cihazdan               | hayır                        |
| 409  | `PAIRING_STATE`          | eşleştirme bu işlem için uygun durumda değil                       | hayır                        |
| 409  | `PAIRING_LIMIT`          | açık eşleştirme sayısı sınırda                                     | hayır                        |
| 409  | `LAST_ADMIN`             | son admin kendini iptal etmek istedi                               | hayır                        |
| 410  | `CURSOR_EXPIRED`         | `after < prunedThrough`                                            | evet: `heads` ile            |
| 410  | `PAIRING_EXPIRED`        | eşleştirmenin süresi doldu                                         | hayır                        |
| 410  | `UPLOAD_EXPIRED`         | yüklemenin süresi doldu                                            | evet: yeniden başlat         |
| 413  | `PAYLOAD_TOO_LARGE`      | blob, parça ya da gövde sınırı aşıyor                              | hayır                        |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` yanlış                                              | hayır                        |
| 416  | `RANGE_NOT_SATISFIABLE`  | `Range` geçersiz                                                   | hayır                        |
| 422  | `INVALID_CHANGE`         | geçersiz geçiş (ör. silinmişi silme)                               | hayır                        |
| 422  | `DUPLICATE_FID`          | aynı fid bir commit'te iki kez                                     | hayır                        |
| 422  | `BLOB_MISSING`           | `put`'un blob'u yüklenmemiş                                        | evet: yükle, gönder          |
| 422  | `SIZE_MISMATCH`          | `size` blob boyutuyla tutmuyor                                     | hayır                        |
| 422  | `HASH_MISMATCH`          | parça ya da blob özeti tutmuyor                                    | evet: yeniden yükle          |
| 422  | `UPLOAD_INCOMPLETE`      | eksik parça var (`details.missing`)                                | evet: eksikleri yükle        |
| 422  | `BATCH_TOO_LARGE`        | commit ya da `check` sınırı aşıyor                                 | hayır; böl                   |
| 426  | `PROTOCOL_UNSUPPORTED`   | `Pisi-Sync-Protocol` desteklenmiyor (`details.min`, `details.max`) | hayır; güncelle              |
| 429  | `RATE_LIMITED`           | hız sınırı (`Retry-After` başlığı)                                 | evet: bekle                  |
| 500  | `INTERNAL`               | beklenmeyen hata                                                   | evet: geri çekilerek         |
| 503  | `MAINTENANCE`            | şema göçü bekleniyor ya da bakım                                   | evet: geri çekilerek         |
| 503  | `DB_UNAVAILABLE`         | veritabanına bağlanılamıyor                                        | evet: geri çekilerek         |
| 507  | `QUOTA_EXCEEDED`         | alan kotası ya da sunucu sınırı doldu                              | hayır                        |

İstemci tanımadığı kodu HTTP durumuna göre ele alır: 5xx ve 429 geri çekilerek yeniden denenir (1, 2, 4 … en çok 300 sn); diğerleri tur hatası olarak gösterilir. `Retry-After` istemcinin istek içinde beklediği süreyi (30 sn) aşarsa tur `RATE_LIMITED` ile biter ve istemci bir sonraki turu `Retry-After` kadar sonra (en çok 300 sn) kendisi başlatır.

### 9.3 İstemcide üretilen kodlar

Sunucudan gelmez; senkron durumunda ve çakışma günlüğünde gösterilir.

| Kod                   | Anlamı                                                              |
| --------------------- | ------------------------------------------------------------------- |
| `OFFLINE`             | ağ yok; tur ertelendi                                               |
| `SERVER_ROLLBACK`     | sunucu imleçten geri gitti (§7.4); senkron durdu                    |
| `SERVER_REPLAY`       | aynı cihazdan eski `dseq` geldi (§7.4); değişiklik uygulanmadı      |
| `DECRYPT_FAILED`      | zarf çözülemedi ya da biçimi bilinmiyor                             |
| `META_INVALID`        | metadata şeması geçersiz ya da fid tutmuyor                         |
| `PATH_UNSAFE`         | yol güvensiz ya da senkron dışı                                     |
| `HASH_MISMATCH_LOCAL` | çözülen içerik blob kimliğiyle ya da ek adındaki özetle tutmuyor    |
| `LOCAL_CORRUPT`       | yerel JSON bozuk; dosya ne gönderildi ne ezildi (plan SV10)         |
| `DEFERRED_DIRTY`      | açık belgede kaydedilmemiş değişiklik var; dosya bu turda ertelendi |
| `FILE_TOO_LARGE`      | dosya `maxBlobBytes`'ı aşıyor; senkron edilmiyor                    |
| `PATH_COLLISION`      | iki yerel dosya aynı fid'e düşüyor (§4.5)                           |
| `NOT_STOPPED`         | "sunucuyla yeniden eşleş" istendi ama senkron geri sarmayla durmadı |

### 9.4 Hız sınırları ve kotalar (varsayılan; sunucu ayarından değişir)

| Kapsam                                           | Sınır                                                   |
| ------------------------------------------------ | ------------------------------------------------------- |
| `POST /v1/spaces`, IP başına                     | 5 / saat; yanlış anahtardan sonra 1 saat kilit          |
| `POST /v1/pairings/lookup` ve `claim`, IP başına | 10 / saat                                               |
| Geçersiz token'lı istekler, IP başına            | 30 / dakika                                             |
| Kimliği doğrulanmış istekler, cihaz başına       | 600 / dakika                                            |
| Bir alandaki açık eşleştirmeler                  | 3                                                       |
| Alan kotası                                      | ayarda; varsayılan sınırsız (barındırma kotası geçerli) |

---

## 10. Sürümleme

- **Protokol ana sürümü** yolda (`/v1`) ve `Pisi-Sync-Protocol` başlığındadır. `GET /v1/info.protocol` sunucunun desteklediği aralığı verir.
- **Geriye uyumlu eklemeler** (yeni isteğe bağlı alan, yeni uç nokta, yeni hata kodu, yeni sınır) ana sürümü değiştirmez; `protocol.revision` bir artar. İstemciler bilinmeyen alanları yok sayar. Bir özelliğe ihtiyaç duyan istemci `revision`'a bakar.
- **Kıran değişiklik** (alanın anlamı, zarf ya da metadata ana sürümü, anahtar türetme, fid ya da blob kimliği hesabı, karşılaştır-ve-değiştir kuralı) yeni ana sürümdür: `/v2`. Sunucu `/v1` ve `/v2`'yi, bütün etkin cihazların `lastProtocol`'ü yeni sürüme geçene kadar yan yana sunar.
- **Zarf sürümü** (§4.2 bayt 4) ve **metadata sürümü** (`meta.v`) yalnız protokol ana sürümüyle birlikte değişir. Bilinmeyen sürüm uygulanmaz.
- **Sunucu şeması** protokolden bağımsız sıralı göçlerle (`schema_migrations`) değişir. Göç beklenirken sunucu `503 MAINTENANCE` döner.
- **İstemci durumu** (cihazdaki senkron durum dosyası) kendi `stateVersion`'ını taşır. Okunamayan durum silinmez; kullanıcıya "senkron durumu okunamadı, yeniden eşleş" denir (plan SV1).
- Bu belgenin başındaki sürüm, protokol ana sürümüdür. Taslak (S0) değişiklikleri S2 birleşene kadar sürüm artırmadan yapılabilir; S2'den sonra her değişiklik bu bölüme göre yapılır.

---

## 11. Tehdit modeli

### 11.1 Korunan varlıklar

1. Proje içeriği: notlar, görevler, günlük, haritalar, ekler.
2. İçerik hakkındaki bilgi: dosya yolları ve başlıklar, proje adı, cihaz adları.
3. Proje anahtarı `K` ve cihaz token'ları; sunucunun kurulum anahtarı.
4. Bütünlük: hiçbir cihaz, gönderilmemiş bir içeriği kabul etmez.
5. Kullanılabilirlik (ikincil): sunucu yokken her cihaz kendi kopyasıyla çalışmaya devam eder.

### 11.2 Sunucunun (ve sunucuyu ele geçirenin) gördükleri

- **Görür:**
    - IP adresleri ve istek zamanları.
    - Alan, cihaz ve eşleştirme sayıları; cihaz rolleri, son görülme zamanı (dakika) ve protokol sürümü.
    - fid'ler: opaktır ama kararlıdır. Aynı dosyanın ne sıklıkla değiştiği ve hangi dosyaların aynı commit'te birlikte değiştiği görülür.
    - `put`/`delete` türü ve hangi cihazın gönderdiği.
    - Blob kimlikleri: anahtarlıdır, ama aynı içeriğin iki yolda kullanıldığı görülür.
    - Şifreli boyutlar: Padmé ile yuvarlanmıştır. Toplam proje boyutu da görünür.
    - Eşleştirmedeki ECDH açık anahtarları ve kısa kod.
- **Görmez:** içerik, yollar, dosya adları, başlıklar, proje adı, cihaz adı ve platformu, not/görev sayısı, `K`, token'ların kendisi (yalnız özetleri).
- Sunucuya yeni bir açık alan eklemek protokol değişikliğidir ve bu listeye yazılır (plan SV8).

### 11.3 Saldırganlar ve önlemler

| Saldırgan                                          | Yapabileceği                                    | Önlem                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ağı dinleyen                                       | trafiği okumak                                  | HTTPS (AutoSSL); ayrıca içerik uçtan uca şifreli                                                                                                        |
| Ağda aktif saldırgan                               | trafiği değiştirmek, sahte sunucu               | sertifika doğrulaması kapatılmaz; sahte sunucu da şifreli içeriği çözemez ya da değiştiremez (AEAD)                                                     |
| Barındırma hesabını ele geçiren / sunucu operatörü | okumak                                          | uçtan uca şifreleme; anahtar sunucuya hiç gitmez                                                                                                        |
|                                                    | içeriği değiştirmek, başka dosyaya taşımak      | AES-GCM etiketi, AAD bağı, blob kimliği ve ek özeti doğrulaması (§4.3)                                                                                  |
|                                                    | eski sürümü yeniden sunmak, günlüğü geri sarmak | imleç ve `dseq` denetimleri (§7.4) — durumu olan cihazlar fark eder                                                                                     |
|                                                    | veri silmek, erişimi kesmek                     | önlenemez; cihazlardaki tam kopyalar kalır, kullanıcı başka sunucuya yeniden kurabilir                                                                  |
|                                                    | eşleştirmede ortadaki adam                      | QR yolu: QR'daki `desktopKey` ve `proof`. Kod yolu: doğrulama numarası. İkisinde de masaüstü onayı                                                      |
|                                                    | kısa kodu kaba kuvvetle bulmak                  | kod tek başına anahtarı açmaz; ECDH + doğrulama numarası olmadan `K` alınamaz                                                                           |
| Kurulum anahtarını bilmeyen internet kullanıcısı   | alan açmak, kota tüketmek                       | `Pisi-Setup-Key` (`password_hash` ile saklanır, sabit zamanlı karşılaştırma), IP hız sınırı                                                             |
| Kısa kodu tahmin etmeye çalışan                    | başkasının eşleştirmesine katılmak              | 40 bit kod, 10 dk ömür, eşleştirme başına 5 yanlış deneme, IP sınırı; katılsa bile masaüstü onayı ve doğrulama numarası gerekir                         |
| QR'ı omzundan gören                                | 10 dk içinde katılmak                           | masaüstü cihaz adını gösterip onay ister; beklenmeyen istek reddedilir; pencere kapanınca eşleştirme iptal edilir                                       |
| Telefonu çalınan                                   | yerel veriyi okumak, senkronu sürdürmek         | Android uygulama alanı + Keystore ile sarılı anahtar ve ekran kilidi; masaüstünden iptal sunucu erişimini keser                                         |
| Ele geçirilmiş eşli cihaz                          | her şeyi okumak, yazmak                         | önlenemez (`K` elinde). Gelen yollar doğrulanır (SV9); `member` silemez; yazdıkları sürüm geçmişi ve çakışma kurallarıyla geri alınabilir               |
| Veritabanı dökümünü ele geçiren                    | token ya da kurulum anahtarı çalmak             | token'lar SHA-256 özeti, kurulum anahtarı `password_hash`; içerik zaten şifreli                                                                         |
| Sunucuya kötü istek gönderen                       | SQL enjeksiyonu, yol aşma, büyük gövde          | yalnız hazır ifadeler (prepared statements); blob yolları yalnız doğrulanmış kimliklerden kurulur; gövde ve parça sınırları; `public_html` dışında veri |

### 11.4 Kabul edilen riskler (sürüm 1)

- **İptal anahtarı yenilemez.** İptal edilen cihaz sunucuya erişemez, ama elindeki veri ve `K` kalır. Sunucu da ele geçirilirse, iptal edilmiş cihaz yeni şifreli veriyi çözebilir. Anahtar yenileme kapsam dışıdır (`docs/sync-plan.md` §5).
- **Metadata görünür:** zaman, boyut sınıfı, değişim sıklığı, birlikte değişen dosyalar, cihaz sayısı.
- **İlk eşleşmede geri sarma fark edilemez:** önceki durumu olmayan yeni bir cihaz, sunucunun eski bir başlık seti sunduğunu anlayamaz.
- **Kullanılabilirlik sunucuya bağlıdır;** sunucu yokken cihazlar arası aktarım olmaz.
- **Kurulum anahtarı sızarsa** biri yeni alan açıp kota tüketebilir; mevcut alanlara erişemez. Önlem: ayardaki özeti değiştirmek.
- **Cihaz saati:** otorite dosyası birleştirmesinde aynı alan iki tarafta değiştiyse kaydın `updatedAt`'i kazananı belirler; saati yanlış bir cihaz kazanmayı etkileyebilir. Kaybeden değer çakışma günlüğünde kalır (plan SV3).

---

## 12. Sunucu veri modeli (MariaDB 10.11, InnoDB, `utf8mb4`)

```text
spaces        space_id PK, name_enc BLOB, key_epoch INT, head BIGINT, pruned_through BIGINT,
              usage_bytes BIGINT, quota_bytes BIGINT NULL, created_at
devices       device_id PK, space_id FK, role ENUM('admin','member'), token_hash CHAR(64) UNIQUE NULL,
              label_enc BLOB NULL, created_at, last_seen_at NULL, last_protocol INT NULL, revoked_at NULL
pairings      pairing_id PK, space_id FK, device_id UNIQUE, created_by, desktop_key VARCHAR(100),
              code_hash CHAR(64) UNIQUE NULL, state ENUM(...), method ENUM('qr','code') NULL,
              device_key VARCHAR(100) NULL, proof VARCHAR(64) NULL, label_enc BLOB NULL,
              token_hash CHAR(64) NULL, wrapped_key BLOB NULL, role ENUM NULL, failed_attempts INT,
              expires_at, created_at
heads         (space_id, fid) PK, seq BIGINT UNIQUE(space_id, seq), op ENUM('put','delete'),
              blob_id CHAR(45) NULL, size BIGINT, device_id, at, meta_enc BLOB, INDEX(space_id, blob_id)
changes       (space_id, seq) PK, fid, op, blob_id NULL, size, device_id, commit_id, at, meta_enc BLOB,
              INDEX(space_id, fid), INDEX(space_id, blob_id), INDEX(space_id, at)
blobs         (space_id, blob_id) PK, size BIGINT, sha256 CHAR(64), created_at, last_ref_at
uploads       upload_id PK, space_id, blob_id, size, sha256, part_bytes, parts_received JSON,
              created_at, expires_at
commits       (space_id, commit_id) PK, body_sha256 CHAR(64), seqs JSON, created_at
rate_limits   (bucket, window_start) PK, count INT, expires_at BIGINT
schema_migrations  version PK, applied_at
```

- Şema `server/app/schema/NNN-*.sql` dosyalarındadır; bu bölüm onun özetidir.
- Alanın alt tabloları `spaces`'e `ON DELETE CASCADE` ile bağlıdır; alan silinince satırı da silinir.
- `code_hash` = `SHA-256(normalize(kod))`. Kod düz metin olarak yalnız `POST pairings` yanıtında bir kez döner. Eşleştirme `open` durumundan çıkınca `code_hash` `NULL` olur.
- `rate_limits` kovaları IP adresini yalnız özetiyle taşır; `expires_at` (Unix saniyesi) geçen satırları temizlik siler.
- Dosya sistemi düzeni: `app/data/blobs/<space>/<blob[2..3]>/<blob[4..5]>/<blob>`, yüklemeler `app/data/tmp/<upload>/<n>`. Klasör izinleri `0700`, dosyalar `0600`.

---

## 13. Test vektörleri

S1, `tests/fixtures/sync-vectors.json` dosyasını üretir. Masaüstü (`node:test`) ve mobil (vitest) testleri aynı dosyayı doğrular:

- Sabit `K` ve `spaceId` için HKDF çıktıları (§4.1).
- Örnek yollar için `pathKey` ve fid. En az şunlar:
    - `Toplantı Notları.node`, `diary/2026-11-16.node`, `inv_Not__node_…/image/<sha>.png`.
    - `ISTANBUL.node` ve `istanbul.node`: aynı fid.
    - `İSTANBUL.node` ve `istanbul.node`: JavaScript katlaması `i̇stanbul` (i + birleşen nokta) verdiği için farklı fid. Vektör bu sonucu sabitler.
    - NFD girdili `Çiçek.node`: NFC girdiyle aynı fid.
- Örnek baytlar için blob kimliği.
- Sabit nonce ile her amaç için zarf (sıkıştırmasız ve sıkıştırmalı, dolgulu).
- Padmé tablosu.
- Sabit ECDH anahtar çiftleri için `Z`, `KEK`, `proof` ve doğrulama numarası.
- Geçersiz örnekler: değiştirilmiş etiket, yanlış bağ, bilinmeyen zarf sürümü, güvensiz yollar.
- `merges` (G9, `docs/task-plan.md`): istemcinin birleştirme kuralları için örnekler: `tasks.json` tamamlamaları (`merges.tasks`) ve günlük görev bölümü ile görev bloklu notun çakışma kopyası (`merges.notes`). Tel biçiminin parçası değildir; iki platformun aynı girdiden aynı sonucu ürettiğini sınar.

Sunucu sözleşme testleri (`npm run test:sync-server`) şifre çözmez; şifreli baytları opak kabul eder ve yalnız SHA-256'yı doğrular.
