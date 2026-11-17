<?php

declare(strict_types=1);

namespace PisiSync;

/** Kimlik biçimleri (protokol §3) ve JSON alan denetimleri. Biçim shared/sync-meta.mjs ile aynıdır. */
final class Validate
{
    public const PATTERNS = [
        'space' => '/^sp_[A-Za-z0-9_-]{22}$/',
        'device' => '/^dv_[A-Za-z0-9_-]{22}$/',
        'pairing' => '/^pr_[A-Za-z0-9_-]{22}$/',
        'commit' => '/^cm_[A-Za-z0-9_-]{22}$/',
        'upload' => '/^up_[A-Za-z0-9_-]{22}$/',
        'token' => '/^pst_[A-Za-z0-9_-]{43}$/',
        'fid' => '/^f_[A-Za-z0-9_-]{43}$/',
        'blob' => '/^b_[A-Za-z0-9_-]{43}$/',
        'publicKey' => '/^[A-Za-z0-9_-]{87}$/',
        'proof' => '/^[A-Za-z0-9_-]{43}$/',
        'sha256' => '/^[0-9a-f]{64}$/'
    ];

    /** Crockford base32, I L O U yok (protokol §3). */
    public const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    /** Zarfın en küçük boyutu: 22 baytlık başlık + 16 baytlık etiket (protokol §4.2). */
    private const ENVELOPE_MIN_BYTES = 38;

    public static function isId(string $kind, mixed $value): bool
    {
        return is_string($value) && preg_match(self::PATTERNS[$kind], $value) === 1;
    }

    /** Yol parametresi: biçimi yanlışsa BAD_REQUEST. */
    public static function pathId(string $kind, string $value): string
    {
        if (!self::isId($kind, $value)) {
            throw new ApiError('BAD_REQUEST', ['param' => $kind]);
        }
        return $value;
    }

    /** @param array<string, mixed> $body */
    public static function id(array $body, string $field, string $kind): string
    {
        $value = $body[$field] ?? null;
        if (!self::isId($kind, $value)) {
            throw ApiError::field($field);
        }
        return $value;
    }

    /**
     * Opak, şifreli zarf (base64url, dolgusuz). Sunucu içeriğe bakmaz; yalnız biçimi
     * ve boyut sınırını denetler. Çözülmüş baytları döner.
     *
     * @param array<string, mixed> $body
     */
    public static function envelope(array $body, string $field, int $maxBytes): string
    {
        $value = $body[$field] ?? null;
        $bytes = is_string($value) ? self::fromBase64Url($value) : null;
        if ($bytes === null || strlen($bytes) < self::ENVELOPE_MIN_BYTES || strlen($bytes) > $maxBytes) {
            throw ApiError::field($field);
        }
        return $bytes;
    }

    /** @param array<string, mixed> $body */
    public static function int(array $body, string $field, int $min, ?int $max = null): int
    {
        $value = $body[$field] ?? null;
        if (!is_int($value) || $value < $min || ($max !== null && $value > $max)) {
            throw ApiError::field($field);
        }
        return $value;
    }

    /** @param array<string, mixed> $body */
    public static function sha256(array $body, string $field): string
    {
        $value = $body[$field] ?? null;
        if (!self::isId('sha256', $value)) {
            throw ApiError::field($field);
        }
        return $value;
    }

    /** @param array<string, mixed> $body */
    public static function oneOf(array $body, string $field, array $allowed): string
    {
        $value = $body[$field] ?? null;
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            throw ApiError::field($field);
        }
        return $value;
    }

    public static function queryInt(Request $request, string $name, int $default, int $min, int $max): int
    {
        $value = $request->queryString($name);
        if ($value === null) {
            return $default;
        }
        if (preg_match('/^\d{1,18}$/', $value) !== 1 || (int) $value < $min || (int) $value > $max) {
            throw new ApiError('BAD_REQUEST', ['query' => $name]);
        }
        return (int) $value;
    }

    public static function toBase64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function fromBase64Url(string $value): ?string
    {
        if ($value === '' || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1 || strlen($value) % 4 === 1) {
            return null;
        }
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if ($decoded === false || self::toBase64Url($decoded) !== $value) {
            return null;
        }
        return $decoded;
    }

    /** Kısa kodu sunucunun karşılaştırdığı biçime getirir; geçersizse null. */
    public static function normalizeCode(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $code = strtoupper(str_replace(['-', ' '], '', $value));
        if (strlen($code) !== 8 || strspn($code, self::CODE_ALPHABET) !== 8) {
            return null;
        }
        return $code;
    }

    public static function randomId(string $prefix, int $bytes = 16): string
    {
        return $prefix . self::toBase64Url(random_bytes($bytes));
    }
}
