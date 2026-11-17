<?php

declare(strict_types=1);

// Pisi senkron sunucusu ayarları. Bu dosyayı config.php adıyla kopyalayın ve doldurun.
// config.php repoya girmez; gerçek adres, parola ya da anahtar repoya yazılmaz.
// Belirtilmeyen her değer varsayılanını alır (src/Config.php).

return [
    // cPanel → MySQL Database Wizard ile açılan veritabanı ve kullanıcı.
    'database' => [
        'dsn' => 'mysql:host=localhost;dbname=KULLANICI_pisisync;charset=utf8mb4',
        'user' => 'KULLANICI_pisisync',
        'password' => 'VERITABANI_PAROLASI'
    ],

    // Blob'lar, yüklemeler ve temizlik damgası. public_html DIŞINDA olmalı.
    'dataDir' => __DIR__ . '/data',

    // Kurulum anahtarının password_hash özeti. Boş bırakılırsa data/setup-key.hash okunur
    // (php bin/setup-key.php yazar). Anahtarın kendisi buraya yazılmaz.
    'setupKeyHash' => null,

    // Hata mesajlarının dili: 'tr' ya da 'en'. İstemciler kendi metinlerini gösterir.
    'locale' => 'tr',

    'https' => [
        // Düz HTTP istekleri 400 HTTPS_REQUIRED ile reddedilir.
        'require' => true,
        // Yalnız önünde TLS sonlandıran bir vekil (ör. Cloudflare) varsa ve PHP HTTPS'i
        // göremiyorsa true yapın: X-Forwarded-Proto: https başlığına güvenilir.
        'trustForwardedProto' => false,
        // Strict-Transport-Security başlığı.
        'hsts' => false
    ],

    // Mobil uygulama WebView'den https://localhost kaynağıyla istek yapar.
    'cors' => ['origins' => ['https://localhost']],

    // Vekil arkasında gerçek istemci IP'sini taşıyan $_SERVER anahtarı, ör. 'HTTP_CF_CONNECTING_IP'.
    // Hız sınırları bu IP'ye göre sayılır. Emin değilseniz null bırakın.
    'clientIpHeader' => null,

    'limits' => [
        'maxBlobBytes' => 64 * 1024 * 1024,
        // post_max_size'tan küçük olmalı; büyükse sunucu kendiliğinden küçültür.
        'partBytes' => 4 * 1024 * 1024,
        'maxCommitChanges' => 200,
        'maxChangesPage' => 1000,
        'maxHeadsPage' => 1000,
        'maxRequestJsonBytes' => 1024 * 1024,
        'maxCheckBlobs' => 500,
        'pairingTtlSeconds' => 600,
        // Alan başına bayt kotası; null = sınırsız (barındırma kotası geçerli).
        'spaceQuotaBytes' => null,
        // Sunucudaki en çok alan sayısı; null = sınırsız.
        'maxSpaces' => null
    ],

    // Protokol §9.4 varsayılanları.
    'rateLimits' => [
        'spaceCreatePerHour' => 5,
        'setupKeyLockSeconds' => 3600,
        'pairingPerHour' => 10,
        'invalidTokenPerMinute' => 30,
        'devicePerMinute' => 600
    ],

    // Protokol §8.
    'retention' => ['changesDays' => 90, 'blobGraceHours' => 48, 'commitDays' => 7, 'pairingDays' => 7],

    // Cron kurulmamışsa istekler arasında en çok budgetSeconds süren temizlik yapılır.
    'gc' => ['opportunistic' => true, 'intervalSeconds' => 3600, 'budgetSeconds' => 2],

    // true: bütün uç noktalar (/v1/info dışında) 503 MAINTENANCE döner.
    'maintenance' => false
];
