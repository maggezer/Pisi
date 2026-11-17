<?php

declare(strict_types=1);

namespace PisiSync;

/**
 * Blob ve yükleme dosyaları (protokol §12): `data/blobs/<alan>/<b[2..3]>/<b[4..5]>/<blob>`,
 * `data/tmp/<yükleme>/<n>`. Yollar yalnız doğrulanmış kimliklerden kurulur. Klasörler
 * 0700, dosyalar 0600.
 */
final class BlobStore
{
    public function __construct(private readonly string $dataDir)
    {
    }

    public function blobPath(string $spaceId, string $blobId): string
    {
        self::assertId('space', $spaceId);
        self::assertId('blob', $blobId);
        return $this->dataDir . '/blobs/' . $spaceId . '/' . substr($blobId, 2, 2) . '/' . substr($blobId, 4, 2) . '/' . $blobId;
    }

    public function uploadDir(string $uploadId): string
    {
        self::assertId('upload', $uploadId);
        return $this->dataDir . '/tmp/' . $uploadId;
    }

    public function partPath(string $uploadId, int $part): string
    {
        return $this->uploadDir($uploadId) . '/' . $part;
    }

    public function spaceDir(string $spaceId): string
    {
        self::assertId('space', $spaceId);
        return $this->dataDir . '/blobs/' . $spaceId;
    }

    public function trashDir(): string
    {
        return $this->dataDir . '/trash';
    }

    public static function ensureDir(string $dir): void
    {
        if (is_dir($dir)) {
            return;
        }
        $old = umask(0077);
        try {
            if (!@mkdir($dir, 0700, true) && !is_dir($dir)) {
                throw new \RuntimeException('Veri klasörü oluşturulamadı.');
            }
        } finally {
            umask($old);
        }
    }

    /** Bir klasörü içeriğiyle siler; `$deadline` geçerse yarıda bırakır ve false döner. */
    public static function removeTree(string $path, ?float $deadline = null): bool
    {
        if (!file_exists($path) && !is_link($path)) {
            return true;
        }
        if (is_file($path) || is_link($path)) {
            @unlink($path);
            return true;
        }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            if ($deadline !== null && microtime(true) > $deadline) {
                return false;
            }
            if (!self::removeTree($path . '/' . $entry, $deadline)) {
                return false;
            }
        }
        @rmdir($path);
        return true;
    }

    /** Alanın blob klasörünü çöp klasörüne taşır; temizlik (gc) siler. */
    public function discardSpace(string $spaceId): void
    {
        $dir = $this->spaceDir($spaceId);
        if (!is_dir($dir)) {
            return;
        }
        self::ensureDir($this->trashDir());
        $target = $this->trashDir() . '/' . $spaceId . '-' . bin2hex(random_bytes(4));
        if (!@rename($dir, $target)) {
            self::removeTree($dir);
        }
    }

    private static function assertId(string $kind, string $value): void
    {
        if (!Validate::isId($kind, $value)) {
            throw new \InvalidArgumentException('Geçersiz kimlik.');
        }
    }
}
