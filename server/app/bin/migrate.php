<?php

declare(strict_types=1);

// Şema göçleri: php app/bin/migrate.php [--status]
// Uygulama göç beklerken 503 MAINTENANCE döner (protokol §10).

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require __DIR__ . '/../src/bootstrap.php';

use PisiSync\Config;
use PisiSync\Db;
use PisiSync\Migrator;

$appDir = dirname(__DIR__);
try {
    $config = Config::load($appDir);
    $migrator = new Migrator(Db::connect($config), $appDir . '/schema');
    if (in_array('--status', $argv, true)) {
        printf("Şema sürümü: %d / gereken: %d\n", $migrator->currentVersion(), $migrator->requiredVersion());
        exit($migrator->isCurrent() ? 0 : 2);
    }
    $applied = $migrator->migrate();
    if ($applied === []) {
        printf("Şema güncel (sürüm %d).\n", $migrator->currentVersion());
    } else {
        printf("Uygulanan göçler: %s. Şema sürümü: %d.\n", implode(', ', $applied), $migrator->currentVersion());
    }
} catch (\PisiSync\ApiError $error) {
    fwrite(STDERR, "Veritabanına bağlanılamadı ({$error->errorCode}). config.php içindeki database ayarlarını denetleyin.\n");
    exit(1);
} catch (\Throwable $error) {
    fwrite(STDERR, 'Göç başarısız: ' . $error->getMessage() . "\n");
    exit(1);
}
