<?php

declare(strict_types=1);

namespace PisiSync;

/**
 * Sabit pencereli sayaçlar ve kilitler (protokol §9.4). IP adresleri yalnız özetleriyle
 * kova adı olur.
 */
final class RateLimiter
{
    public function __construct(private readonly Db $db)
    {
    }

    public static function ipBucket(string $scope, string $ip): string
    {
        return $scope . ':ip:' . substr(hash('sha256', 'pisi-sync/1|ip|' . $ip), 0, 32);
    }

    /** Sayacı bir artırır; sınır aşıldıysa RATE_LIMITED fırlatır. */
    public function hit(string $bucket, int $limit, int $windowSeconds): void
    {
        $count = $this->increment($bucket, $windowSeconds);
        if ($count > $limit) {
            throw self::limited($this->retryAfter($windowSeconds));
        }
    }

    /** Sayacı artırmadan sınırda olup olmadığına bakar. */
    public function check(string $bucket, int $limit, int $windowSeconds): void
    {
        $start = intdiv(time(), $windowSeconds) * $windowSeconds;
        $count = (int) ($this->db->value('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?', [$bucket, $start]) ?? 0);
        if ($count >= $limit) {
            throw self::limited($this->retryAfter($windowSeconds));
        }
    }

    public function increment(string $bucket, int $windowSeconds): int
    {
        $start = intdiv(time(), $windowSeconds) * $windowSeconds;
        $this->db->run(
            'INSERT INTO rate_limits (bucket, window_start, count, expires_at) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE count = count + 1',
            [$bucket, $start, $start + $windowSeconds]
        );
        return (int) $this->db->value('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?', [$bucket, $start]);
    }

    /** Kovayı `$seconds` boyunca kilitler (yanlış kurulum anahtarı). */
    public function lock(string $bucket, int $seconds): void
    {
        $until = time() + $seconds;
        $this->db->run(
            'INSERT INTO rate_limits (bucket, window_start, count, expires_at) VALUES (?, 0, 1, ?) ON DUPLICATE KEY UPDATE count = count + 1, expires_at = GREATEST(expires_at, VALUES(expires_at))',
            ['lock:' . $bucket, $until]
        );
    }

    public function assertNotLocked(string $bucket): void
    {
        $until = (int) ($this->db->value('SELECT expires_at FROM rate_limits WHERE bucket = ? AND window_start = 0', ['lock:' . $bucket]) ?? 0);
        if ($until > time()) {
            throw self::limited($until - time());
        }
    }

    private function retryAfter(int $windowSeconds): int
    {
        $start = intdiv(time(), $windowSeconds) * $windowSeconds;
        return max(1, $start + $windowSeconds - time());
    }

    public static function limited(int $seconds): ApiError
    {
        return new ApiError('RATE_LIMITED', ['retryAfter' => $seconds], ['Retry-After' => (string) $seconds]);
    }
}
