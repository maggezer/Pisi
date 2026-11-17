<?php

declare(strict_types=1);

// Kurulum anahtarı (protokol §6.2, §11.3). Sunucu anahtarın yalnız password_hash
// özetini saklar.
//
//   php app/bin/setup-key.php             yeni anahtar üretir, özetini data/setup-key.hash'e
//                                         yazar ve anahtarı BİR KEZ ekrana basar
//   php app/bin/setup-key.php --key-file  anahtarı ekrana basmaz; data/setup-key.txt'e yazar
//                                         (Terminal'i olmayan hesaplarda Cron Jobs ile; dosyayı
//                                         indirip SİLİN)
//   php app/bin/setup-key.php --hash      anahtarı standart girdiden okur, yalnız özetini basar
//                                         (config.php'deki setupKeyHash için)

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require __DIR__ . '/../src/bootstrap.php';

use PisiSync\BlobStore;
use PisiSync\Config;
use PisiSync\Validate;

$config = Config::load(dirname(__DIR__));

if (in_array('--hash', $argv, true)) {
    $key = trim((string) stream_get_contents(STDIN));
    if ($key === '' || strlen($key) > 256) {
        fwrite(STDERR, "Anahtar boş ya da 256 karakterden uzun.\n");
        exit(1);
    }
    echo password_hash($key, PASSWORD_DEFAULT) . "\n";
    exit(0);
}

$key = Validate::randomId('psk_', 32);
$dataDir = $config->dataDir();
BlobStore::ensureDir($dataDir);
$old = umask(0077);
$ok = file_put_contents($dataDir . '/setup-key.hash', password_hash($key, PASSWORD_DEFAULT) . "\n") !== false;
if ($ok && in_array('--key-file', $argv, true)) {
    $ok = file_put_contents($dataDir . '/setup-key.txt', $key . "\n") !== false;
    umask($old);
    if ($ok) {
        echo "Anahtar data/setup-key.txt dosyasına yazıldı. İndirip sunucudan silin.\n";
        exit(0);
    }
}
umask($old);
if (!$ok) {
    fwrite(STDERR, "Veri klasörüne yazılamadı.\n");
    exit(1);
}
echo "Yeni kurulum anahtarı (bir daha gösterilmez; güvenli bir yere kaydedin):\n" . $key . "\n";
if (is_string($config->get('setupKeyHash')) && $config->get('setupKeyHash') !== '') {
    fwrite(STDERR, "Uyarı: config.php'de setupKeyHash dolu; o değer data/setup-key.hash'ten önce gelir.\n");
}
