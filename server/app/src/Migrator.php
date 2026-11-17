<?php

declare(strict_types=1);

namespace PisiSync;

/**
 * Sıralı şema göçleri (schema/NNN-ad.sql, schema_migrations). Uygulama her istekte
 * yalnız sürümü denetler; göçü yalnız bin/migrate.php çalıştırır (plan S2 adım 2).
 */
final class Migrator
{
    public function __construct(private readonly Db $db, private readonly string $schemaDir)
    {
    }

    /** @return array<int, string> sürüm → dosya */
    public function available(): array
    {
        $files = [];
        foreach (glob($this->schemaDir . '/*.sql') ?: [] as $file) {
            if (preg_match('/^(\d{3})-[a-z0-9-]+\.sql$/', basename($file), $match) === 1) {
                $files[(int) $match[1]] = $file;
            }
        }
        ksort($files);
        return $files;
    }

    public function requiredVersion(): int
    {
        $versions = array_keys($this->available());
        return $versions === [] ? 0 : max($versions);
    }

    /** Uygulanmış en büyük sürüm; tablo yoksa 0. */
    public function currentVersion(): int
    {
        try {
            return (int) ($this->db->value('SELECT COALESCE(MAX(version), 0) FROM schema_migrations') ?? 0);
        } catch (\PDOException $error) {
            if (($error->errorInfo[1] ?? null) === 1146) {
                return 0;
            }
            throw $error;
        }
    }

    public function isCurrent(): bool
    {
        return $this->currentVersion() >= $this->requiredVersion();
    }

    /** @return list<int> uygulanan sürümler */
    public function migrate(): array
    {
        $this->db->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INT NOT NULL, applied_at DATETIME(3) NOT NULL, PRIMARY KEY (version)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin');
        $current = $this->currentVersion();
        $applied = [];
        foreach ($this->available() as $version => $file) {
            if ($version <= $current) {
                continue;
            }
            foreach (self::statements((string) file_get_contents($file)) as $statement) {
                $this->db->pdo->exec($statement);
            }
            $this->db->run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [$version, Clock::nowDb()]);
            $applied[] = $version;
        }
        return $applied;
    }

    /** @return list<string> */
    public static function statements(string $sql): array
    {
        $lines = array_filter(explode("\n", $sql), static fn (string $line): bool => !str_starts_with(ltrim($line), '--'));
        $parts = preg_split('/;\s*(?:\n|$)/', implode("\n", $lines)) ?: [];
        return array_values(array_filter(array_map('trim', $parts), static fn (string $part): bool => $part !== ''));
    }
}
