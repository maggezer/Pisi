<?php

declare(strict_types=1);

// Budama ve temizlik (protokol §8). cPanel Cron Jobs: saatte bir
//   php /home/KULLANICI/pisi-sync/app/bin/gc.php >/dev/null 2>&1

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require __DIR__ . '/../src/bootstrap.php';

use PisiSync\BlobStore;
use PisiSync\Config;
use PisiSync\Db;
use PisiSync\Gc;
use PisiSync\Migrator;

$appDir = dirname(__DIR__);
try {
    $config = Config::load($appDir);
    $db = Db::connect($config);
    if (!(new Migrator($db, $appDir . '/schema'))->isCurrent()) {
        fwrite(STDERR, "Şema güncel değil; önce php app/bin/migrate.php çalıştırın.\n");
        exit(2);
    }
    $stats = (new Gc($db, new BlobStore($config->dataDir()), $config))->run(null);
    @touch($config->dataDir() . '/gc.stamp');
    echo json_encode($stats, JSON_UNESCAPED_SLASHES) . "\n";
} catch (\Throwable $error) {
    fwrite(STDERR, 'Temizlik başarısız: ' . get_class($error) . "\n");
    exit(1);
}
