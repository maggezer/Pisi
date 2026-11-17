<?php

declare(strict_types=1);

namespace PisiSync;

/** Cihaz kimlik doğrulaması (protokol §2, §3, §6). Yetki her istekte veritabanından okunur. */
final class Auth
{
    /**
     * Token'ın biçimini denetler ve SHA-256 özetini döner. Geçersiz token'lar IP başına
     * sayılır; sınır aşılınca geçersiz denemeler TOKEN_INVALID yerine RATE_LIMITED alır.
     * Geçerli token'lı istekler bu sayaçtan etkilenmez.
     */
    public static function tokenHash(Context $context): string
    {
        try {
            $token = $context->request->token();
        } catch (ApiError) {
            self::rejectToken($context);
        }
        if ($token === null) {
            throw new ApiError('AUTH_REQUIRED');
        }
        if (!Validate::isId('token', $token)) {
            self::rejectToken($context);
        }
        return hash('sha256', $token);
    }

    public static function rejectToken(Context $context): never
    {
        $bucket = RateLimiter::ipBucket('badtoken', $context->request->clientIp);
        $context->limiter()->hit($bucket, $context->config->int('rateLimits.invalidTokenPerMinute'), 60);
        throw new ApiError('TOKEN_INVALID');
    }

    /** Yoldaki alana ait etkin cihazı bulur ve `$context->device`'a koyar. */
    public static function device(Context $context, string $spaceId, bool $admin): void
    {
        $hash = self::tokenHash($context);
        $device = $context->db()->one(
            'SELECT d.device_id, d.space_id, d.role, d.token_hash, d.revoked_at, d.last_seen_at, d.last_protocol FROM devices d WHERE d.token_hash = ?',
            [$hash]
        );
        if ($device === null || !hash_equals((string) $device['token_hash'], $hash)) {
            self::rejectToken($context);
        }
        if ($device['revoked_at'] !== null) {
            throw new ApiError('DEVICE_REVOKED');
        }
        if (!hash_equals((string) $device['space_id'], $spaceId)) {
            throw new ApiError('NOT_FOUND');
        }
        $context->limiter()->hit('device:' . $device['device_id'], $context->config->int('rateLimits.devicePerMinute'), 60);
        if ($admin && $device['role'] !== 'admin') {
            throw new ApiError('FORBIDDEN_ROLE');
        }
        $minute = Clock::nowMinuteDb();
        $protocol = (int) $context->request->header('pisi-sync-protocol');
        $lastSeen = $device['last_seen_at'] === null ? null : Clock::iso((string) $device['last_seen_at']);
        if ($lastSeen !== Clock::iso($minute) || (int) $device['last_protocol'] !== $protocol) {
            $context->db()->run('UPDATE devices SET last_seen_at = ?, last_protocol = ? WHERE device_id = ?', [$minute, $protocol, $device['device_id']]);
        }
        $context->device = $device;
    }
}
