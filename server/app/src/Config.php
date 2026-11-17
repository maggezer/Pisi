<?php

declare(strict_types=1);

namespace PisiSync;

/**
 * Sunucu ayarları: app/config.php (config.sample.php'den kopyalanır) varsayılanların
 * üzerine yazılır. PISI_SYNC_CONFIG ortam değişkeni başka bir dosyayı gösterebilir
 * (testler bunu kullanır).
 */
final class Config
{
    public const SERVER_VERSION = '1.0.0';
    public const PROTOCOL_MIN = 1;
    public const PROTOCOL_MAX = 1;
    public const PROTOCOL_REVISION = 1;

    /** @var array<string, mixed> */
    private array $values;

    /** @param array<string, mixed> $values */
    private function __construct(array $values, public readonly string $appDir)
    {
        $this->values = $values;
    }

    public static function load(string $appDir): self
    {
        $file = getenv('PISI_SYNC_CONFIG');
        if (!is_string($file) || $file === '') {
            $file = $appDir . '/config.php';
        }
        $user = [];
        if (is_file($file)) {
            $loaded = require $file;
            if (!is_array($loaded)) {
                throw new \RuntimeException('config.php bir dizi döndürmeli.');
            }
            $user = $loaded;
        }
        return self::fromArray($user, $appDir);
    }

    /** @param array<string, mixed> $user */
    public static function fromArray(array $user, string $appDir): self
    {
        $values = self::merge(self::defaults($appDir), $user);
        $limits = &$values['limits'];
        foreach (['maxBlobBytes', 'partBytes', 'maxCommitChanges', 'maxChangesPage', 'maxHeadsPage', 'maxRequestJsonBytes', 'maxCheckBlobs', 'pairingTtlSeconds'] as $name) {
            $limits[$name] = max(1, (int) $limits[$name]);
        }
        unset($limits);
        return new self($values, $appDir);
    }

    /** @return array<string, mixed> */
    private static function defaults(string $appDir): array
    {
        return [
            'database' => ['dsn' => '', 'user' => '', 'password' => ''],
            'dataDir' => $appDir . '/data',
            'setupKeyHash' => null,
            'locale' => 'tr',
            'https' => ['require' => true, 'trustForwardedProto' => false, 'hsts' => false],
            'cors' => ['origins' => ['https://localhost']],
            'clientIpHeader' => null,
            'limits' => [
                'maxBlobBytes' => 64 * 1024 * 1024,
                'partBytes' => 4 * 1024 * 1024,
                'maxCommitChanges' => 200,
                'maxChangesPage' => 1000,
                'maxHeadsPage' => 1000,
                'maxRequestJsonBytes' => 1024 * 1024,
                'maxCheckBlobs' => 500,
                'pairingTtlSeconds' => 600,
                'spaceQuotaBytes' => null,
                'maxSpaces' => null,
                'maxOpenPairings' => 3,
                'uploadTtlSeconds' => 86400
            ],
            'rateLimits' => [
                'spaceCreatePerHour' => 5,
                'setupKeyLockSeconds' => 3600,
                'pairingPerHour' => 10,
                'invalidTokenPerMinute' => 30,
                'devicePerMinute' => 600
            ],
            'retention' => ['changesDays' => 90, 'blobGraceHours' => 48, 'commitDays' => 7, 'pairingDays' => 7],
            'gc' => ['opportunistic' => true, 'intervalSeconds' => 3600, 'budgetSeconds' => 2],
            'maintenance' => false,
            'testing' => ['faultInjection' => false]
        ];
    }

    /**
     * @param array<string, mixed> $base
     * @param array<string, mixed> $override
     * @return array<string, mixed>
     */
    private static function merge(array $base, array $override): array
    {
        foreach ($override as $key => $value) {
            if (is_array($value) && isset($base[$key]) && is_array($base[$key]) && !array_is_list($base[$key])) {
                $base[$key] = self::merge($base[$key], $value);
            } else {
                $base[$key] = $value;
            }
        }
        return $base;
    }

    public function get(string $path): mixed
    {
        $value = $this->values;
        foreach (explode('.', $path) as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) {
                return null;
            }
            $value = $value[$part];
        }
        return $value;
    }

    public function int(string $path): int
    {
        return (int) $this->get($path);
    }

    public function nullableInt(string $path): ?int
    {
        $value = $this->get($path);
        return $value === null ? null : (int) $value;
    }

    public function dataDir(): string
    {
        return rtrim((string) $this->get('dataDir'), '/');
    }

    public function locale(): string
    {
        return $this->get('locale') === 'en' ? 'en' : 'tr';
    }

    /**
     * Parça boyutu sunucunun post_max_size değerinin altında seçilir (protokol §6.1).
     * Ayardaki değer bu sınıra sığmıyorsa 64 KiB'nin katı olarak küçültülür.
     */
    public function effectivePartBytes(): int
    {
        $configured = $this->int('limits.partBytes');
        $postMax = self::iniBytes((string) ini_get('post_max_size'));
        if ($postMax > 0 && $configured > $postMax - 65536) {
            $configured = max(65536, intdiv($postMax - 65536, 65536) * 65536);
        }
        return $configured;
    }

    public static function iniBytes(string $value): int
    {
        $value = trim($value);
        if ($value === '') {
            return 0;
        }
        $unit = strtolower(substr($value, -1));
        $number = (int) $value;
        return match ($unit) {
            'g' => $number * 1024 * 1024 * 1024,
            'm' => $number * 1024 * 1024,
            'k' => $number * 1024,
            default => $number
        };
    }

    public function setupKeyHash(): ?string
    {
        $hash = $this->get('setupKeyHash');
        if (is_string($hash) && $hash !== '') {
            return $hash;
        }
        $file = $this->dataDir() . '/setup-key.hash';
        if (is_file($file)) {
            $text = trim((string) file_get_contents($file));
            return $text === '' ? null : $text;
        }
        return null;
    }

    /** Sunucunun /v1/info'da bildirdiği sınırlar (protokol §6.1). */
    public function publicLimits(): array
    {
        return [
            'maxBlobBytes' => $this->int('limits.maxBlobBytes'),
            'partBytes' => $this->effectivePartBytes(),
            'maxCommitChanges' => $this->int('limits.maxCommitChanges'),
            'maxChangesPage' => $this->int('limits.maxChangesPage'),
            'maxHeadsPage' => $this->int('limits.maxHeadsPage'),
            'maxRequestJsonBytes' => $this->int('limits.maxRequestJsonBytes'),
            'maxCheckBlobs' => $this->int('limits.maxCheckBlobs'),
            'pairingTtlSeconds' => $this->int('limits.pairingTtlSeconds'),
            'spaceQuotaBytes' => $this->nullableInt('limits.spaceQuotaBytes')
        ];
    }
}
