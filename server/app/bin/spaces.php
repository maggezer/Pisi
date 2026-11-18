<?php

declare(strict_types=1);

// Alanların bakımı (docs/sync-server-cpanel.md §16):
//   php app/bin/spaces.php list                         alanlar: kimlik, açılış, son görülme, boyut, cihazlar
//   php app/bin/spaces.php delete sp_… --confirm=sp_…   alanı bütünüyle siler (geri alınamaz)
// Sahipsiz kalan bir alanı (bütün masaüstüleri kaybolmuş ya da yeniden kurulmuş) kaldırmak içindir.
// Alan adları şifreli olduğundan sunucu bunları gösteremez; alanı açılış ve son görülme
// tarihinden tanıyın. Silinen alanın cihazları TOKEN_INVALID alır; telefon senkronu bırakır ve
// kullanıcıya söyler, proje dosyaları cihazlarda kalır. Gizli değer basmaz.

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require __DIR__ . '/../src/bootstrap.php';

use PisiSync\BlobStore;
use PisiSync\Config;
use PisiSync\Db;
use PisiSync\Migrator;
use PisiSync\SpaceAdmin;

$usage = "Kullanım:\n  php app/bin/spaces.php list [--json]\n  php app/bin/spaces.php delete <alan> --confirm=<alan>\n";
$args = array_slice($argv, 1);
$command = $args[0] ?? '';
$options = [];
$positional = [];
foreach (array_slice($args, 1) as $arg) {
    if (str_starts_with($arg, '--')) {
        [$name, $value] = array_pad(explode('=', substr($arg, 2), 2), 2, '');
        $options[$name] = $value;
    } else {
        $positional[] = $arg;
    }
}
if (!in_array($command, ['list', 'delete'], true)) {
    fwrite(STDERR, $usage);
    exit(2);
}

$appDir = dirname(__DIR__);
try {
    $config = Config::load($appDir);
    $db = Db::connect($config);
    if (!(new Migrator($db, $appDir . '/schema'))->isCurrent()) {
        fwrite(STDERR, "Şema güncel değil; önce php app/bin/migrate.php çalıştırın.\n");
        exit(2);
    }
    $admin = new SpaceAdmin($db, new BlobStore($config->dataDir()));

    if ($command === 'list') {
        $spaces = $admin->list();
        if (array_key_exists('json', $options)) {
            echo json_encode(['spaces' => $spaces], JSON_UNESCAPED_SLASHES) . "\n";
            exit(0);
        }
        if ($spaces === []) {
            echo "Alan yok.\n";
            exit(0);
        }
        printf("%-25s  %-20s  %-20s  %10s  %8s  %s\n", 'alan', 'açılış', 'son görülme', 'MiB', 'head', 'masaüstü/telefon');
        foreach ($spaces as $space) {
            printf(
                "%-25s  %-20s  %-20s  %10.1f  %8d  %d/%d%s\n",
                $space['spaceId'],
                substr($space['createdAt'], 0, 16),
                $space['lastSeenAt'] === null ? '—' : substr($space['lastSeenAt'], 0, 16),
                $space['usageBytes'] / 1048576,
                $space['head'],
                $space['admins'],
                $space['members'],
                $space['admins'] === 0 ? '  (masaüstü yok)' : ''
            );
        }
        exit(0);
    }

    $spaceId = $positional[0] ?? '';
    if (preg_match('/^sp_[A-Za-z0-9_-]{22}$/', $spaceId) !== 1) {
        fwrite(STDERR, "Geçerli bir alan kimliği verin (sp_…).\n" . $usage);
        exit(2);
    }
    if (($options['confirm'] ?? '') !== $spaceId) {
        fwrite(STDERR, "Silmek için alan kimliğini --confirm=$spaceId ile yineleyin. Silme geri alınamaz.\n");
        exit(2);
    }
    if (!$admin->delete($spaceId)) {
        fwrite(STDERR, "Alan bulunamadı: $spaceId\n");
        exit(3);
    }
    echo "Alan silindi: $spaceId\n";
    exit(0);
} catch (\Throwable $error) {
    fwrite(STDERR, 'İşlem başarısız: ' . get_class($error) . "\n");
    exit(1);
}
