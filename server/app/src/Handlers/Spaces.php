<?php

declare(strict_types=1);

namespace PisiSync\Handlers;

use PisiSync\ApiError;
use PisiSync\Clock;
use PisiSync\Context;
use PisiSync\RateLimiter;
use PisiSync\Response;
use PisiSync\Validate;

/** Alanlar (protokol §6.2). */
final class Spaces
{
    public const LABEL_MAX_BYTES = 4096;

    public static function create(Context $context): Response
    {
        $limiter = $context->limiter();
        $bucket = RateLimiter::ipBucket('spaces', $context->request->clientIp);
        $limiter->assertNotLocked($bucket);
        $limiter->hit($bucket, $context->config->int('rateLimits.spaceCreatePerHour'), 3600);

        $key = $context->request->header('pisi-setup-key');
        $hash = $context->config->setupKeyHash();
        if ($key === null || $key === '' || strlen($key) > 256 || $hash === null || !password_verify($key, $hash)) {
            $limiter->lock($bucket, $context->config->int('rateLimits.setupKeyLockSeconds'));
            throw new ApiError('SETUP_KEY_INVALID');
        }

        $body = $context->json();
        $spaceId = Validate::id($body, 'spaceId', 'space');
        $deviceId = Validate::id($body, 'deviceId', 'device');
        $tokenHash = Validate::sha256($body, 'tokenHash');
        $spaceName = Validate::envelope($body, 'spaceName', self::LABEL_MAX_BYTES);
        $deviceLabel = Validate::envelope($body, 'deviceLabel', self::LABEL_MAX_BYTES);

        $db = $context->db();
        $now = Clock::nowDb();
        $db->transaction(static function () use ($db, $context, $spaceId, $deviceId, $tokenHash, $spaceName, $deviceLabel, $now): void {
            $maxSpaces = $context->config->nullableInt('limits.maxSpaces');
            if ($maxSpaces !== null && (int) $db->value('SELECT COUNT(*) FROM spaces') >= $maxSpaces) {
                throw new ApiError('QUOTA_EXCEEDED', ['scope' => 'spaces']);
            }
            if ($db->value('SELECT 1 FROM spaces WHERE space_id = ?', [$spaceId]) !== null) {
                throw new ApiError('ID_TAKEN', ['field' => 'spaceId']);
            }
            if ($db->value('SELECT 1 FROM devices WHERE device_id = ? UNION SELECT 1 FROM pairings WHERE device_id = ?', [$deviceId, $deviceId]) !== null) {
                throw new ApiError('ID_TAKEN', ['field' => 'deviceId']);
            }
            if ($db->value('SELECT 1 FROM devices WHERE token_hash = ?', [$tokenHash]) !== null) {
                throw new ApiError('ID_TAKEN', ['field' => 'tokenHash']);
            }
            $db->run(
                'INSERT INTO spaces (space_id, name_enc, key_epoch, head, pruned_through, usage_bytes, quota_bytes, created_at) VALUES (?, ?, 1, 0, 0, 0, ?, ?)',
                [$spaceId, $spaceName, $context->config->nullableInt('limits.spaceQuotaBytes'), $now]
            );
            $db->run(
                'INSERT INTO devices (device_id, space_id, role, token_hash, label_enc, created_at, last_seen_at, last_protocol) VALUES (?, ?, \'admin\', ?, ?, ?, ?, ?)',
                [$deviceId, $spaceId, $tokenHash, $deviceLabel, $now, Clock::nowMinuteDb(), (int) $context->request->header('pisi-sync-protocol')]
            );
        });

        return Response::json(201, ['spaceId' => $spaceId, 'deviceId' => $deviceId, 'role' => 'admin', 'head' => 0, 'createdAt' => Clock::iso($now)]);
    }

    public static function get(Context $context): Response
    {
        $space = self::load($context);
        return Response::json(200, [
            'spaceId' => $space['space_id'],
            'spaceName' => Validate::toBase64Url((string) $space['name_enc']),
            'keyEpoch' => (int) $space['key_epoch'],
            'head' => (int) $space['head'],
            'prunedThrough' => (int) $space['pruned_through'],
            'usageBytes' => (int) $space['usage_bytes'],
            'quotaBytes' => $space['quota_bytes'] === null ? null : (int) $space['quota_bytes'],
            'createdAt' => Clock::iso((string) $space['created_at'])
        ]);
    }

    public static function delete(Context $context): Response
    {
        $body = $context->json();
        $spaceId = $context->spaceId();
        if (($body['confirm'] ?? null) !== $spaceId) {
            throw ApiError::field('confirm');
        }
        $db = $context->db();
        $db->transaction(static function () use ($db, $spaceId): void {
            $db->run('SELECT head FROM spaces WHERE space_id = ? FOR UPDATE', [$spaceId]);
            // Alt tablolar ON DELETE CASCADE ile silinir.
            $db->run('DELETE FROM spaces WHERE space_id = ?', [$spaceId]);
        });
        $context->store->discardSpace($spaceId);
        return Response::empty(204);
    }

    /** @return array<string, mixed> */
    public static function load(Context $context, bool $forUpdate = false): array
    {
        $space = $context->db()->one('SELECT * FROM spaces WHERE space_id = ?' . ($forUpdate ? ' FOR UPDATE' : ''), [$context->spaceId()]);
        if ($space === null) {
            throw new ApiError('NOT_FOUND');
        }
        return $space;
    }
}
