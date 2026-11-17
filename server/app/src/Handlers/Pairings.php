<?php

declare(strict_types=1);

namespace PisiSync\Handlers;

use PisiSync\ApiError;
use PisiSync\Auth;
use PisiSync\Clock;
use PisiSync\Context;
use PisiSync\Db;
use PisiSync\RateLimiter;
use PisiSync\Response;
use PisiSync\Validate;

/**
 * Eşleştirme (protokol §6.6). Sunucu proof'u doğrulayamaz, anahtar paketini açamaz;
 * yalnız durumları ve kısa kodu yönetir. Kod düz metin olarak yalnız başlatma yanıtında döner.
 */
final class Pairings
{
    private const MAX_CODE_ATTEMPTS = 5;
    private const ACTIVE = ['open', 'claimed', 'granted'];

    public static function start(Context $context): Response
    {
        $body = $context->json();
        $pairingId = Validate::id($body, 'pairingId', 'pairing');
        $deviceId = Validate::id($body, 'deviceId', 'device');
        $desktopKey = Validate::id($body, 'desktopKey', 'publicKey');
        $db = $context->db();
        $spaceId = $context->spaceId();
        $ttl = $context->config->int('limits.pairingTtlSeconds');
        $maxOpen = max(1, $context->config->int('limits.maxOpenPairings'));

        $result = $db->transaction(static function () use ($context, $db, $spaceId, $pairingId, $deviceId, $desktopKey, $ttl, $maxOpen): array {
            Spaces::load($context, true);
            self::expireStale($db, $spaceId);
            $open = (int) $db->value('SELECT COUNT(*) FROM pairings WHERE space_id = ? AND state IN (\'open\', \'claimed\')', [$spaceId]);
            if ($open >= $maxOpen) {
                throw new ApiError('PAIRING_LIMIT', ['limit' => $maxOpen]);
            }
            if ($db->value('SELECT 1 FROM pairings WHERE pairing_id = ?', [$pairingId]) !== null) {
                throw new ApiError('ID_TAKEN', ['field' => 'pairingId']);
            }
            if ($db->value('SELECT 1 FROM devices WHERE device_id = ? UNION SELECT 1 FROM pairings WHERE device_id = ?', [$deviceId, $deviceId]) !== null) {
                throw new ApiError('ID_TAKEN', ['field' => 'deviceId']);
            }
            $now = Clock::nowDb();
            $expires = Clock::plusSeconds($ttl);
            for ($attempt = 0; $attempt < 5; $attempt++) {
                $code = '';
                for ($i = 0; $i < 8; $i++) {
                    $code .= Validate::CODE_ALPHABET[random_int(0, 31)];
                }
                if ($db->value('SELECT 1 FROM pairings WHERE code_hash = ?', [self::codeHash($code)]) === null) {
                    $db->run(
                        'INSERT INTO pairings (pairing_id, space_id, device_id, created_by, desktop_key, code_hash, state, failed_attempts, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, \'open\', 0, ?, ?)',
                        [$pairingId, $spaceId, $deviceId, $context->deviceId(), $desktopKey, self::codeHash($code), $expires, $now]
                    );
                    return ['code' => substr($code, 0, 4) . '-' . substr($code, 4), 'expires' => $expires];
                }
            }
            throw new \RuntimeException('Kısa kod üretilemedi.');
        });

        return Response::json(201, ['pairingId' => $pairingId, 'code' => $result['code'], 'expiresAt' => Clock::iso($result['expires'])]);
    }

    public static function get(Context $context): Response
    {
        $pairing = self::loadInSpace($context);
        return Response::json(200, [
            'pairingId' => $pairing['pairing_id'],
            'state' => $pairing['state'],
            'method' => $pairing['method'],
            'deviceKey' => $pairing['device_key'],
            'proof' => $pairing['proof'],
            'label' => $pairing['label_enc'] === null ? null : Validate::toBase64Url((string) $pairing['label_enc']),
            'expiresAt' => Clock::iso((string) $pairing['expires_at'])
        ]);
    }

    public static function grant(Context $context): Response
    {
        $body = $context->json();
        $role = Validate::oneOf($body, 'role', ['admin', 'member']);
        $wrappedKey = Validate::envelope($body, 'wrappedKey', Spaces::LABEL_MAX_BYTES);
        $label = Validate::envelope($body, 'label', Spaces::LABEL_MAX_BYTES);
        $db = $context->db();
        $ttl = $context->config->int('limits.pairingTtlSeconds');
        $deviceId = $db->transaction(static function () use ($context, $db, $role, $wrappedKey, $label, $ttl): string {
            $pairing = self::loadInSpace($context, true);
            self::requireState($pairing, ['claimed']);
            if ($db->value('SELECT 1 FROM devices WHERE device_id = ? OR token_hash = ?', [$pairing['device_id'], $pairing['token_hash']]) !== null) {
                throw new ApiError('ID_TAKEN', ['field' => 'deviceId']);
            }
            $now = Clock::nowDb();
            $db->run(
                'INSERT INTO devices (device_id, space_id, role, token_hash, label_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$pairing['device_id'], $pairing['space_id'], $role, $pairing['token_hash'], $label, $now]
            );
            // Telefonun sonucu alması için süre onaydan itibaren yeniden başlar.
            $db->run(
                'UPDATE pairings SET state = \'granted\', role = ?, wrapped_key = ?, expires_at = ? WHERE pairing_id = ?',
                [$role, $wrappedKey, Clock::plusSeconds($ttl), $pairing['pairing_id']]
            );
            return (string) $pairing['device_id'];
        });
        return Response::json(200, ['state' => 'granted', 'deviceId' => $deviceId]);
    }

    public static function reject(Context $context): Response
    {
        $context->json(true);
        $db = $context->db();
        $db->transaction(static function () use ($context, $db): void {
            $pairing = self::loadInSpace($context, true);
            self::requireState($pairing, ['open', 'claimed']);
            $db->run('UPDATE pairings SET state = \'rejected\', code_hash = NULL WHERE pairing_id = ?', [$pairing['pairing_id']]);
        });
        return Response::json(200, ['state' => 'rejected']);
    }

    public static function cancel(Context $context): Response
    {
        $db = $context->db();
        $db->transaction(static function () use ($context, $db): void {
            $pairing = self::loadInSpace($context, true);
            if (in_array($pairing['state'], ['cancelled', 'expired'], true)) {
                return;
            }
            self::requireState($pairing, ['open', 'claimed']);
            $db->run('UPDATE pairings SET state = \'cancelled\', code_hash = NULL WHERE pairing_id = ?', [$pairing['pairing_id']]);
        });
        return Response::empty(204);
    }

    public static function lookup(Context $context): Response
    {
        self::limitIp($context);
        $body = $context->json();
        if (!is_string($body['code'] ?? null)) {
            throw ApiError::field('code');
        }
        $code = Validate::normalizeCode($body['code']);
        $db = $context->db();
        $pairing = $code === null ? null : $db->one('SELECT * FROM pairings WHERE code_hash = ?', [self::codeHash($code)]);
        if ($pairing !== null) {
            $pairing = self::refresh($db, $pairing);
        }
        if ($pairing === null || $pairing['state'] !== 'open') {
            throw new ApiError('PAIRING_NOT_FOUND');
        }
        return Response::json(200, [
            'pairingId' => $pairing['pairing_id'],
            'spaceId' => $pairing['space_id'],
            'desktopKey' => $pairing['desktop_key'],
            'expiresAt' => Clock::iso((string) $pairing['expires_at'])
        ]);
    }

    public static function claim(Context $context): Response
    {
        self::limitIp($context);
        $pairingId = Validate::pathId('pairing', $context->request->param('pairing'));
        $body = $context->json();
        $method = Validate::oneOf($body, 'method', ['qr', 'code']);
        $deviceKey = Validate::id($body, 'deviceKey', 'publicKey');
        $label = Validate::envelope($body, 'label', Spaces::LABEL_MAX_BYTES);
        $tokenHash = Validate::sha256($body, 'tokenHash');
        $proof = null;
        $code = null;
        if ($method === 'qr') {
            $proof = Validate::id($body, 'proof', 'proof');
        } else {
            if (!is_string($body['code'] ?? null)) {
                throw ApiError::field('code');
            }
            $code = Validate::normalizeCode($body['code']) ?? '';
        }

        $db = $context->db();
        $outcome = $db->transaction(static function () use ($db, $pairingId, $method, $deviceKey, $label, $tokenHash, $proof, $code): array {
            $pairing = $db->one('SELECT * FROM pairings WHERE pairing_id = ? FOR UPDATE', [$pairingId]);
            if ($pairing === null) {
                throw new ApiError('PAIRING_NOT_FOUND');
            }
            $pairing = self::refresh($db, $pairing);
            self::requireState($pairing, ['open']);
            if ($method === 'code' && ($pairing['code_hash'] === null || !hash_equals((string) $pairing['code_hash'], self::codeHash((string) $code)))) {
                $attempts = (int) $pairing['failed_attempts'] + 1;
                $closed = $attempts >= self::MAX_CODE_ATTEMPTS;
                $db->run(
                    'UPDATE pairings SET failed_attempts = ?, state = ?, code_hash = ? WHERE pairing_id = ?',
                    [$attempts, $closed ? 'expired' : 'open', $closed ? null : $pairing['code_hash'], $pairingId]
                );
                // Yanlış deneme sayılır ve kaydedilir; hata işlemden sonra döner.
                return ['error' => 'PAIRING_CODE_INVALID'];
            }
            if ($db->value('SELECT 1 FROM devices WHERE token_hash = ?', [$tokenHash]) !== null) {
                throw new ApiError('ID_TAKEN', ['field' => 'tokenHash']);
            }
            $db->run(
                'UPDATE pairings SET state = \'claimed\', method = ?, device_key = ?, proof = ?, label_enc = ?, token_hash = ?, code_hash = NULL WHERE pairing_id = ?',
                [$method, $deviceKey, $proof, $label, $tokenHash, $pairingId]
            );
            return ['expires' => (string) $pairing['expires_at']];
        });
        if (isset($outcome['error'])) {
            throw new ApiError($outcome['error']);
        }
        return Response::json(202, ['state' => 'claimed', 'expiresAt' => Clock::iso($outcome['expires'])]);
    }

    public static function result(Context $context): Response
    {
        $hash = Auth::tokenHash($context);
        $pairingId = Validate::pathId('pairing', $context->request->param('pairing'));
        $db = $context->db();
        return $db->transaction(static function () use ($context, $db, $pairingId, $hash): Response {
            $pairing = $db->one('SELECT * FROM pairings WHERE pairing_id = ? FOR UPDATE', [$pairingId]);
            if ($pairing === null) {
                throw new ApiError('PAIRING_NOT_FOUND');
            }
            $pairing = self::refresh($db, $pairing);
            if ($pairing['token_hash'] === null || !hash_equals((string) $pairing['token_hash'], $hash)) {
                Auth::rejectToken($context);
            }
            switch ($pairing['state']) {
                case 'claimed':
                    return Response::json(202, ['state' => 'claimed']);
                case 'granted':
                    $db->run('UPDATE pairings SET state = \'collected\', wrapped_key = NULL WHERE pairing_id = ?', [$pairingId]);
                    // Sonucu almak cihazın sunucuya ilk görünmesidir.
                    $db->run(
                        'UPDATE devices SET last_seen_at = ?, last_protocol = ? WHERE device_id = ?',
                        [Clock::nowMinuteDb(), (int) $context->request->header('pisi-sync-protocol'), $pairing['device_id']]
                    );
                    return Response::json(200, [
                        'state' => 'granted',
                        'spaceId' => $pairing['space_id'],
                        'deviceId' => $pairing['device_id'],
                        'role' => $pairing['role'],
                        'wrappedKey' => Validate::toBase64Url((string) $pairing['wrapped_key']),
                        'desktopKey' => $pairing['desktop_key']
                    ]);
                case 'rejected':
                    throw new ApiError('PAIRING_REJECTED');
                case 'expired':
                    throw new ApiError('PAIRING_EXPIRED');
                default:
                    throw new ApiError('PAIRING_STATE', ['state' => $pairing['state']]);
            }
        });
    }

    /** Süresi dolan open/claimed/granted kayıtları `expired` yapar (gc de çağırır). */
    public static function expireStale(Db $db, ?string $spaceId = null): void
    {
        $sql = 'UPDATE pairings SET state = \'expired\', wrapped_key = NULL, code_hash = NULL WHERE state IN (\'open\', \'claimed\', \'granted\') AND expires_at <= ?';
        $params = [Clock::nowDb()];
        if ($spaceId !== null) {
            $sql .= ' AND space_id = ?';
            $params[] = $spaceId;
        }
        $db->run($sql, $params);
    }

    /**
     * @param array<string, mixed> $pairing
     * @return array<string, mixed>
     */
    private static function refresh(Db $db, array $pairing): array
    {
        if (in_array($pairing['state'], self::ACTIVE, true) && Clock::isPast((string) $pairing['expires_at'])) {
            $db->run('UPDATE pairings SET state = \'expired\', wrapped_key = NULL, code_hash = NULL WHERE pairing_id = ?', [$pairing['pairing_id']]);
            $pairing['state'] = 'expired';
            $pairing['wrapped_key'] = null;
            $pairing['code_hash'] = null;
        }
        return $pairing;
    }

    /** @return array<string, mixed> */
    private static function loadInSpace(Context $context, bool $forUpdate = false): array
    {
        $pairingId = Validate::pathId('pairing', $context->request->param('pairing'));
        $db = $context->db();
        $pairing = $db->one('SELECT * FROM pairings WHERE pairing_id = ? AND space_id = ?' . ($forUpdate ? ' FOR UPDATE' : ''), [$pairingId, $context->spaceId()]);
        if ($pairing === null) {
            throw new ApiError('PAIRING_NOT_FOUND');
        }
        return self::refresh($db, $pairing);
    }

    /**
     * @param array<string, mixed> $pairing
     * @param list<string> $states
     */
    private static function requireState(array $pairing, array $states): void
    {
        if (in_array($pairing['state'], $states, true)) {
            return;
        }
        if ($pairing['state'] === 'expired') {
            throw new ApiError('PAIRING_EXPIRED');
        }
        throw new ApiError('PAIRING_STATE', ['state' => $pairing['state']]);
    }

    private static function limitIp(Context $context): void
    {
        $context->limiter()->hit(RateLimiter::ipBucket('pairing', $context->request->clientIp), $context->config->int('rateLimits.pairingPerHour'), 3600);
    }

    public static function codeHash(string $code): string
    {
        return hash('sha256', $code);
    }
}
