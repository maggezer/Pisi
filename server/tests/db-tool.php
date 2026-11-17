<?php

declare(strict_types=1);

// Yalnız testler için veritabanı aracı (scripts/start-sync-test-server.mjs kullanır).
//   php server/tests/db-tool.php create <ad>   PISI_SYNC_TEST_DB_* ile veritabanı açar
//   php server/tests/db-tool.php drop <ad>
//   php server/tests/db-tool.php dump          PISI_SYNC_CONFIG veritabanının bütün tabloları (JSON, ikili değerler hex)
//   php server/tests/db-tool.php exec          stdin: {"sql": "...", "params": [...]} → {"rows": [...], "affected": n}
// Node tarafında MySQL istemcisi bağımlılığı olmasın diye PDO ile çalışır.

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require __DIR__ . '/../app/src/bootstrap.php';

use PisiSync\Config;
use PisiSync\Db;

$command = $argv[1] ?? '';

function adminPdo(): PDO
{
    $host = getenv('PISI_SYNC_TEST_DB_HOST') ?: '127.0.0.1';
    $port = getenv('PISI_SYNC_TEST_DB_PORT') ?: '3306';
    return new PDO("mysql:host=$host;port=$port;charset=utf8mb4", getenv('PISI_SYNC_TEST_DB_USER') ?: 'root', getenv('PISI_SYNC_TEST_DB_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
}

function databaseName(string $name): string
{
    if (preg_match('/^pisi_sync_t_[a-z0-9_]{1,40}$/', $name) !== 1) {
        fwrite(STDERR, "Geçersiz test veritabanı adı.\n");
        exit(1);
    }
    return $name;
}

function encode(mixed $value): mixed
{
    if (is_string($value) && preg_match('//u', $value) !== 1) {
        return ['hex' => bin2hex($value)];
    }
    return $value;
}

switch ($command) {
    case 'create':
        adminPdo()->exec('CREATE DATABASE `' . databaseName($argv[2] ?? '') . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
        break;
    case 'drop':
        adminPdo()->exec('DROP DATABASE IF EXISTS `' . databaseName($argv[2] ?? '') . '`');
        break;
    case 'dump':
        $db = Db::connect(Config::load(dirname(__DIR__) . '/app'));
        $tables = [];
        foreach ($db->pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
            $rows = $db->pdo->query('SELECT * FROM `' . str_replace('`', '', (string) $table) . '`')->fetchAll(PDO::FETCH_ASSOC);
            $tables[$table] = array_map(static fn (array $row): array => array_map('encode', $row), $rows);
        }
        echo json_encode($tables, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        break;
    case 'exec':
        $input = json_decode((string) stream_get_contents(STDIN), true, 16, JSON_THROW_ON_ERROR);
        $db = Db::connect(Config::load(dirname(__DIR__) . '/app'));
        $statement = $db->run((string) $input['sql'], $input['params'] ?? []);
        $rows = $statement->columnCount() > 0 ? $statement->fetchAll() : [];
        echo json_encode(['rows' => array_map(static fn (array $row): array => array_map('encode', $row), $rows), 'affected' => $statement->rowCount()], JSON_THROW_ON_ERROR);
        break;
    default:
        fwrite(STDERR, "Kullanım: db-tool.php create|drop <ad> | dump | exec\n");
        exit(1);
}
