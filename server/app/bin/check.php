<?php

declare(strict_types=1);

// Kurulum denetimi: php app/bin/check.php
// PHP sürümü ve eklentiler, ayarlar, veri klasörü, veritabanı, şema ve kurulum anahtarı.
// Gizli değer basmaz.

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require __DIR__ . '/../src/bootstrap.php';

use PisiSync\BlobStore;
use PisiSync\Config;
use PisiSync\Db;
use PisiSync\Migrator;

$appDir = dirname(__DIR__);
$failed = false;
$report = static function (bool $ok, string $label, string $hint = '', bool $warning = false) use (&$failed): void {
    if (!$ok && !$warning) {
        $failed = true;
    }
    echo ($ok ? '[ OK ]  ' : ($warning ? '[UYARI] ' : '[HATA]  ')) . $label . ($ok || $hint === '' ? '' : ' — ' . $hint) . "\n";
};

$report(PHP_VERSION_ID >= 80400, 'PHP ' . PHP_VERSION, 'PHP 8.4 gerekir (MultiPHP Manager)');
foreach (['pdo_mysql', 'json', 'hash'] as $extension) {
    $report(extension_loaded($extension), 'eklenti: ' . $extension, 'cPanel → Select PHP Version → Extensions');
}

try {
    $config = Config::load($appDir);
} catch (\Throwable $error) {
    $report(false, 'config.php okunamadı', $error->getMessage());
    exit(1);
}
$configFile = getenv('PISI_SYNC_CONFIG') ?: $appDir . '/config.php';
$report(is_file($configFile), 'config.php', 'config.sample.php dosyasını config.php olarak kopyalayın');

$dataDir = $config->dataDir();
try {
    BlobStore::ensureDir($dataDir);
    $probe = $dataDir . '/.write-test-' . bin2hex(random_bytes(4));
    $writable = @file_put_contents($probe, 'x') === 1;
    @unlink($probe);
    $report($writable, 'veri klasörü yazılabilir', 'klasör izinleri (0700) ve sahibini denetleyin');
} catch (\Throwable) {
    $report(false, 'veri klasörü oluşturulamadı', 'dataDir ayarını denetleyin');
}
$docRoot = realpath($appDir . '/../public') ?: '';
$report(realpath($dataDir) === false || $docRoot === '' || !str_starts_with((string) realpath($dataDir), $docRoot . DIRECTORY_SEPARATOR), 'veri klasörü web kökünün dışında');

$postMax = Config::iniBytes((string) ini_get('post_max_size'));
$part = $config->effectivePartBytes();
$report($postMax <= 0 || $part < $postMax, sprintf('parça boyutu %d bayt, post_max_size %s', $part, (string) ini_get('post_max_size')));

$report($config->setupKeyHash() !== null, 'kurulum anahtarı özeti', 'php app/bin/setup-key.php çalıştırın');
$report($config->get('https.require') !== false, 'HTTPS zorunlu', 'https.require yalnız testte kapatılır');
$report($config->get('testing.faultInjection') !== true, 'test hata enjeksiyonu kapalı', 'testing.faultInjection false olmalı');

try {
    $db = Db::connect($config);
    $report(true, 'veritabanı bağlantısı');
    $version = (string) $db->value('SELECT VERSION()');
    $report(stripos($version, 'mariadb') !== false, 'veritabanı sürümü: ' . $version, 'MariaDB 10.11 önerilir');
    $migrator = new Migrator($db, $appDir . '/schema');
    $report($migrator->isCurrent(), sprintf('şema sürümü %d / %d', $migrator->currentVersion(), $migrator->requiredVersion()), 'php app/bin/migrate.php çalıştırın');
} catch (\Throwable) {
    $report(false, 'veritabanı bağlantısı', 'config.php içindeki database ayarlarını denetleyin');
}

$stamp = $dataDir . '/gc.stamp';
$report(is_file($stamp) && filemtime($stamp) > time() - 86400, 'son temizlik 24 saat içinde', 'Cron Jobs ile bin/gc.php kurun (kurulmazsa istekler arasında kısa temizlik yapılır)', true);

exit($failed ? 1 : 0);
