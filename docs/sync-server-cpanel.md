# Pisi senkron sunucusu: cPanel kurulum rehberi

Sürüm: 1 · 17-11-2026 · Plan: [`docs/sync-plan.md`](sync-plan.md) S2 · Protokol: [`docs/sync-protocol.md`](sync-protocol.md)

Bu rehber, Pisi'nin senkron sunucusunu (`server/`) paylaşımlı bir cPanel hesabına kurar. Sunucu PHP 8.4 ve MariaDB 10.11 ile çalışır; framework, Composer ya da sürekli çalışan bir süreç gerekmez.
Sunucu dosya içeriğini, dosya yollarını ve adları hiç görmez; yalnız şifreli blob'ları ve sıra numaralı bir değişiklik günlüğünü saklar (protokol §11).

Rehberdeki `KULLANICI` cPanel kullanıcı adınızdır, `sync.ornek.com` sunucuya vereceğiniz alt alan adıdır. **Gerçek adresinizi, veritabanı parolanızı ve kurulum anahtarınızı repoya, bir issue'ya ya da PR'a yazmayın.**

---

## 1. Kurulacak düzen

```text
/home/KULLANICI/
  pisi-sync/
    app/                  web kökünün DIŞINDA: kod, ayar, veri
      src/  schema/  bin/
      config.php          sizin ayarlarınız (repoda yok)
      data/               blob'lar, yarım yüklemeler, kurulum anahtarı özeti (repoda yok)
    public/               alt alan adının belge kökü: yalnız index.php ve .htaccess
  .pisi-sync-deploy       Git ile dağıtımda hedef klasörler (§4.1)
```

- Web köküne (`public/`) **yalnız** `index.php` ve `.htaccess` konur. `app/` klasörü `public_html` ya da belge kökünün içinde olmamalıdır.
- `public/index.php`, `app/` klasörünü tek bir satırdan bulur: `const PISI_SYNC_APP_DIR = __DIR__ . '/../app';`. Yukarıdaki düzende bu satır olduğu gibi çalışır.

## 2. Alt alan adı ve belge kökü

1. cPanel → **Domains** (eski arayüzde **Subdomains**) → **Create A New Domain**.
2. Alan adı: `sync.ornek.com`. **Share document root** seçeneğini kapatın.
3. **Document Root**: `pisi-sync/public`. (cPanel varsayılan olarak `public_html/sync` önerir; değiştirin.)
4. Kaydedin. cPanel klasörü oluşturur.

Alt alan adı yerine `https://ornek.com/pisi` gibi bir alt klasör kullanacaksanız `public/` içeriğini `public_html/pisi/` altına koyun ve `index.php`'deki satırı `app/`'in tam yoluna çevirin, ör. `const PISI_SYNC_APP_DIR = '/home/KULLANICI/pisi-sync/app';`.

## 3. PHP 8.4

1. cPanel → **MultiPHP Manager** → `sync.ornek.com`'u seçin → **PHP Version**: `ea-php84` (ya da `PHP 8.4`) → **Apply**.
2. cPanel → **MultiPHP INI Editor** → **Basic Mode** → `sync.ornek.com`:
    - `post_max_size`: en az `8M` (sunucu parça boyutunu bunun altında seçer; varsayılan parça 4 MiB).
    - `upload_max_filesize`: `8M`.
    - `max_execution_time`: `60` ya da üstü.
    - `memory_limit`: `128M` ya da üstü.
3. Eklentiler: `pdo_mysql`, `json`, `hash`, `mbstring`, `openssl` açık olmalıdır. EA4'te genelde açıktır; değilse **Select PHP Version → Extensions** (CloudLinux) ya da barındırma desteğinden isteyin.

Komut satırında PHP 8.4'ün yolu genelde `/opt/cpanel/ea-php84/root/usr/bin/php`'dir. Bu rehberdeki komutlarda `php` yerine bunu kullanın; `php -v` farklı bir sürüm gösterebilir.

## 4. Dosyaların yüklenmesi

İki yol vardır. Git yolu güncellemeyi kolaylaştırır.

### 4.1 cPanel Git Version Control (önerilen)

1. cPanel → **Git Version Control** → **Create**.
    - **Clone URL**: Pisi reposunun adresi (`https://github.com/maggezer/Pisi.git`).
    - **Repository Path**: `repositories/Pisi`.
    - **Repository Name**: `Pisi`.
2. cPanel → **File Manager** → sağ üstte **Settings** → **Show Hidden Files** işaretli olsun. Ev klasörünüzde (`/home/KULLANICI`) `.pisi-sync-deploy` adlı bir dosya oluşturun:

    ```text
    APP_DIR=/home/KULLANICI/pisi-sync/app
    PUBLIC_DIR=/home/KULLANICI/pisi-sync/public
    PHP_BIN=/opt/cpanel/ea-php84/root/usr/bin/php
    RUN_MIGRATE=1
    ```

3. **Git Version Control** → `Pisi` → **Manage** → **Pull or Deploy** → **Deploy HEAD Commit**.
    - Repodaki `.cpanel.yml`, `server/deploy/cpanel-deploy.sh`'i çalıştırır: `app/` (kod, şema, `bin/`) ve `public/` (`index.php`, `.htaccess`) hedeflere kopyalanır, `index.php`'deki yol `APP_DIR`'e ayarlanır.
    - `config.php` ve `data/` **hiç değiştirilmez**. `config.php` varsa göç (§8) da kendiliğinden çalışır.
    - Betik, `APP_DIR` web kökünün ya da `public_html`'in içindeyse durur.

### 4.2 File Manager ile

1. GitHub'dan reponun ZIP'ini indirip bilgisayarınızda açın; yalnız `server/` klasörü gerekir.
2. File Manager → **Settings** → **Show Hidden Files**.
3. `/home/KULLANICI/pisi-sync/app` klasörünü oluşturun; `server/app/` içindekileri (`src/`, `schema/`, `bin/`, `config.sample.php`, `.htaccess`) buraya yükleyin. (Klasörü ZIP olarak yükleyip **Extract** ile açmak en kolayıdır.)
4. `server/public/index.php` ve `server/public/.htaccess` dosyalarını `/home/KULLANICI/pisi-sync/public/` içine yükleyin.
5. `pisi-sync/app` klasörünün izinlerini **0700** yapın (File Manager → **Permissions**).

## 5. Veritabanı

1. cPanel → **MySQL Database Wizard**.
2. Veritabanı adı: ör. `pisisync` (cPanel `KULLANICI_pisisync` yapar).
3. Kullanıcı: ör. `pisisync`, güçlü bir parola (**Password Generator**). Parolayı güvenli bir yere kaydedin.
4. Yetkiler: **ALL PRIVILEGES**.

## 6. `config.php`

1. File Manager → `pisi-sync/app/config.sample.php` → **Copy** → `pisi-sync/app/config.php`.
2. `config.php`'yi **Edit** ile açın ve doldurun:

    ```php
    'database' => [
        'dsn' => 'mysql:host=localhost;dbname=KULLANICI_pisisync;charset=utf8mb4',
        'user' => 'KULLANICI_pisisync',
        'password' => '...'
    ],
    ```

3. Geri kalan ayarlar varsayılanla çalışır. Önemli olanlar:
    - `https.require`: `true` kalmalı. Sunucu düz HTTP'yi `HTTPS_REQUIRED` ile reddeder.
    - `https.trustForwardedProto`: yalnız sitenin önünde TLS'i sonlandıran bir vekil (ör. Cloudflare "Flexible") varsa ve §11'deki deneme `HTTPS_REQUIRED` dönüyorsa `true` yapın.
    - `clientIpHeader`: Cloudflare arkasındaysanız `'HTTP_CF_CONNECTING_IP'`; hız sınırları gerçek IP'ye göre sayılır.
    - `limits.spaceQuotaBytes`, `limits.maxSpaces`: barındırma kotanızı korumak için sınır koyabilirsiniz.
    - `locale`: hata mesajlarının dili (`tr` ya da `en`).
4. `config.php`'nin izinlerini **0600** yapın.

## 7. Kurulum anahtarı

Kurulum anahtarı, masaüstünün sunucuda yeni bir proje alanı açabilmesi için gerekir (protokol §6.2). Sunucu anahtarın kendisini değil, yalnız `password_hash` özetini saklar.

**Terminal varsa** (cPanel → **Terminal**):

```bash
/opt/cpanel/ea-php84/root/usr/bin/php ~/pisi-sync/app/bin/setup-key.php
```

Komut `psk_…` ile başlayan anahtarı **bir kez** ekrana basar ve özetini `app/data/setup-key.hash` dosyasına yazar. Anahtarı parola yöneticinize kaydedin; Pisi masaüstünde alan açarken sorulur.

**Terminal yoksa** (Cron Jobs ile tek seferlik):

1. cPanel → **Cron Jobs** → **Add New Cron Job** → **Once Per Minute** → komut:

    ```text
    /opt/cpanel/ea-php84/root/usr/bin/php /home/KULLANICI/pisi-sync/app/bin/setup-key.php --key-file >/dev/null 2>&1
    ```

2. Bir dakika bekleyin, sonra cron işini **silin** (yoksa her dakika yeni anahtar üretir).
3. File Manager → `pisi-sync/app/data/setup-key.txt` dosyasını indirin, anahtarı kaydedin ve dosyayı sunucudan **silin**.

Anahtarı değiştirmek için komutu yeniden çalıştırın; eski anahtar artık geçmez. Var olan alanlar ve cihazlar etkilenmez.

## 8. Göç (veritabanı şeması)

Sunucu, şema güncel değilken `/v1/info` dışındaki her isteğe `503 MAINTENANCE` döner. Şemayı yalnız şu komut kurar ve günceller:

```bash
/opt/cpanel/ea-php84/root/usr/bin/php ~/pisi-sync/app/bin/migrate.php
```

Terminal yoksa §7'deki gibi tek seferlik bir cron işi kullanın (komut: `… /home/KULLANICI/pisi-sync/app/bin/migrate.php`), bir dakika sonra silin. Git ile dağıtımda (`RUN_MIGRATE=1`) her dağıtımda kendiliğinden çalışır.

Ardından kurulumu denetleyin:

```bash
/opt/cpanel/ea-php84/root/usr/bin/php ~/pisi-sync/app/bin/check.php
```

`check.php` PHP sürümünü ve eklentileri, ayar dosyasını, veri klasörünü, veritabanı bağlantısını, şema sürümünü, kurulum anahtarını ve parça boyutunu denetler; gizli değer basmaz. `[HATA]` satırı kalmamalıdır.

## 9. HTTPS (AutoSSL)

1. cPanel → **SSL/TLS Status** → `sync.ornek.com` ve `www.sync.ornek.com` için sertifika durumu **AutoSSL Domain Validated** olmalı. Değilse **Run AutoSSL**.
2. Sertifika olmadan senkron çalışmaz; istemciler sertifika doğrulamasını hiçbir koşulda kapatmaz.
3. İsterseniz `config.php`'de `'https' => ['hsts' => true]` ile `Strict-Transport-Security` başlığını açın (yalnız sertifika düzgün çalıştıktan sonra).

## 10. Temizlik (Cron Jobs)

Eski günlük kayıtları, kullanılmayan blob'lar, süresi dolan eşleştirmeler ve yarım yüklemeler `bin/gc.php` ile temizlenir (protokol §8).

cPanel → **Cron Jobs** → **Once Per Hour** (`0 * * * *`) → komut:

```text
/opt/cpanel/ea-php84/root/usr/bin/php /home/KULLANICI/pisi-sync/app/bin/gc.php >/dev/null 2>&1
```

Cron kurulmazsa sunucu, saatte en çok bir kez, bir isteğin yanıtından sonra en çok 2 saniye süren kısa bir temizlik yapar. Büyük projelerde cron önerilir.

## 11. Deneme

Kendi bilgisayarınızda:

```bash
curl -s https://sync.ornek.com/v1/info
```

Beklenen yanıt `{"service":"pisi-sync","protocol":{"min":1,"max":1,"revision":1},…}` ile başlar.

Veritabanı ve şemayı da denemek için (token olmadan):

```bash
curl -s -H 'Pisi-Sync-Protocol: 1' https://sync.ornek.com/v1/spaces/sp_AAAAAAAAAAAAAAAAAAAAAA/head
```

| Yanıt                            | Anlamı                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| `AUTH_REQUIRED`                  | her şey yerinde                                                          |
| `MAINTENANCE`                    | göç yapılmadı (§8) ya da `maintenance` ayarı açık                        |
| `DB_UNAVAILABLE`                 | `config.php`'deki veritabanı ayarları yanlış (§5, §6)                    |
| `HTTPS_REQUIRED`                 | PHP isteği HTTPS olarak görmüyor; §6'daki `trustForwardedProto`'ya bakın |
| HTML hata sayfası, 404 ya da 500 | belge kökü, `.htaccess` ya da `index.php`'deki `app/` yolu yanlış        |

### 11.1 `Authorization` başlığı PHP'ye geçiyor mu?

Bazı barındırmalar `Authorization` başlığını PHP'ye geçirmez. Biçimi doğru ama geçersiz bir token'la deneyin:

```bash
curl -s -H 'Pisi-Sync-Protocol: 1' -H 'Authorization: Bearer pst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' https://sync.ornek.com/v1/spaces/sp_AAAAAAAAAAAAAAAAAAAAAA/head
```

- `TOKEN_INVALID`: başlık geçiyor.
- `AUTH_REQUIRED`: başlık PHP'ye ulaşmıyor. `.htaccess`'teki `CGIPassAuth On` ve `RewriteRule … E=HTTP_AUTHORIZATION` satırları yerinde mi bakın. Yine olmuyorsa sorun değil: Pisi istemcileri token'ı ayrıca `X-Pisi-Token` başlığıyla da gönderebilir. Aynı denemeyi `-H 'X-Pisi-Token: pst_AAAA…'` ile yapın; `TOKEN_INVALID` dönmelidir.

## 12. Yedekleme

Yedek iki parçadır ve **birlikte** alınmalıdır:

1. Veritabanı: cPanel → **Backup** → **Download a MySQL Database Backup** → `KULLANICI_pisisync` (ya da phpMyAdmin → **Export**).
2. Veri klasörü: File Manager → `pisi-sync/app/data` → **Compress** → indirin. `config.php`'yi de ayrıca saklayın.

İçerik zaten uçtan uca şifrelidir; yedek de şifreli kalır. Proje anahtarı yalnız cihazlardadır.

Eski bir yedeğe dönmek cihazlara göre **geri sarma**dır: cihazlar `SERVER_ROLLBACK` gösterir ve hiçbir şey yazmaz (protokol §7.4). Kullanıcı bilerek "sunucuyla yeniden eşleş" der. Bu yüzden yedeğe yalnız sunucu kaybolduysa dönün.

## 13. Güncelleme ve geri alma

**Güncelleme:**

1. Önce §12'deki yedeği alın.
2. Git yolu: **Git Version Control** → **Manage** → **Pull or Deploy** → **Update from Remote**, sonra **Deploy HEAD Commit**. Göç kendiliğinden çalışır (`RUN_MIGRATE=1`).
3. File Manager yolu: `app/src`, `app/schema`, `app/bin` klasörlerini yenileriyle **değiştirin** (eskileri silin, yenileri yükleyin), `public/index.php` ve `.htaccess`'i yenileyin; sonra §8'deki göç komutunu çalıştırın. `config.php` ve `data/`'ya dokunmayın.
4. `check.php` ve §11'deki denemeler.

Göç sürerken ya da yeni kod eski şemayla karşılaşırsa sunucu kısa süre `503 MAINTENANCE` döner; istemciler geri çekilerek yeniden dener.

**Geri alma:**

- Şemayı değiştirmeyen bir sürümde: önceki sürümü dağıtın. Terminal varsa `cd ~/repositories/Pisi && git checkout <önceki-commit-ya-da-etiket> && bash server/deploy/cpanel-deploy.sh`; yoksa önceki sürümün `server/` klasörünü §4.2'deki gibi yükleyin.
- Şemayı değiştiren bir sürümde: eski kod yeni şemayla çalışmayabilir. Güncelleme öncesi aldığınız veritabanı yedeğini ve `data/` klasörünü birlikte geri yükleyin ve eski kodu dağıtın. Bu bir geri sarmadır (§12); cihazlar yeniden eşleşmeyi isteyebilir.

## 14. Sorun giderme

| Belirti                                       | Bakılacak yer                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Her istek 500, HTML sayfa                     | `index.php`'deki `PISI_SYNC_APP_DIR` yolu; PHP sürümü (§3); cPanel → **Errors**                      |
| `.htaccess` yüzünden 500                      | barındırma `CGIPassAuth`'a izin vermiyorsa `<IfModule mod_version.c>` bloğunu silin                  |
| `INTERNAL`                                    | cPanel → **Errors** ya da `pisi-sync/public/error_log`; sunucu yanıtta ayrıntı vermez                |
| Büyük ekler yüklenmiyor (`PAYLOAD_TOO_LARGE`) | `post_max_size` (§3) ve `limits.maxBlobBytes`                                                        |
| `RATE_LIMITED` alan açarken                   | yanlış kurulum anahtarı IP'yi bir saat kilitler; bekleyin ve doğru anahtarı girin                    |
| Dosya izni hataları                           | `app/` ve `data/` sizin kullanıcınıza ait olmalı; PHP sizin kullanıcınızla çalışmalı (PHP-FPM/LSAPI) |

## 15. Güvenlik notları

- Kurulum anahtarı yalnız yeni alan açar; var olan alanlara erişim vermez. Sızdığını düşünürseniz §7'deki komutla yenileyin.
- Sunucu token'ları yalnız SHA-256 özetleriyle, kurulum anahtarını `password_hash` özetiyle saklar; veritabanında dosya yolu, ad ya da içerik yoktur (protokol §11.2).
- `app/` ve `data/` web kökünün dışındadır; `app/.htaccess` yanlışlıkla web köküne konulursa bile hiçbir dosyayı sunmaz.
- `config.php`'deki `testing` ayarlarını değiştirmeyin; yalnız otomatik testler içindir.
