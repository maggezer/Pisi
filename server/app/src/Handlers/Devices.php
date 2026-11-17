<?php

declare(strict_types=1);

namespace PisiSync\Handlers;

use PisiSync\ApiError;
use PisiSync\Clock;
use PisiSync\Context;
use PisiSync\Response;
use PisiSync\Validate;

/** Cihazlar (protokol §6.5). */
final class Devices
{
    private const COLUMNS = 'device_id, role, label_enc, created_at, last_seen_at, last_protocol, revoked_at';

    public static function list(Context $context): Response
    {
        $rows = $context->db()->all('SELECT ' . self::COLUMNS . ' FROM devices WHERE space_id = ? ORDER BY created_at, device_id', [$context->spaceId()]);
        return Response::json(200, ['devices' => array_map([self::class, 'format'], $rows)]);
    }

    public static function me(Context $context): Response
    {
        return Response::json(200, self::format(self::loadSelf($context)));
    }

    public static function updateMe(Context $context): Response
    {
        $body = $context->json();
        $label = Validate::envelope($body, 'label', Spaces::LABEL_MAX_BYTES);
        $context->db()->run('UPDATE devices SET label_enc = ? WHERE device_id = ?', [$label, $context->deviceId()]);
        return Response::json(200, self::format(self::loadSelf($context)));
    }

    public static function revoke(Context $context): Response
    {
        $param = $context->request->param('device');
        $self = $param === 'me' || $param === $context->deviceId();
        if (!$self) {
            Validate::pathId('device', $param);
            if (!$context->isAdmin()) {
                throw new ApiError('FORBIDDEN_ROLE');
            }
        }
        $targetId = $self ? $context->deviceId() : $param;
        $db = $context->db();
        $spaceId = $context->spaceId();
        $db->transaction(static function () use ($context, $db, $spaceId, $targetId): void {
            Spaces::load($context, true);
            $target = $db->one('SELECT device_id, role, revoked_at FROM devices WHERE device_id = ? AND space_id = ?', [$targetId, $spaceId]);
            if ($target === null) {
                throw new ApiError('NOT_FOUND');
            }
            if ($target['revoked_at'] !== null) {
                return;
            }
            if ($target['role'] === 'admin') {
                $admins = (int) $db->value('SELECT COUNT(*) FROM devices WHERE space_id = ? AND role = \'admin\' AND revoked_at IS NULL', [$spaceId]);
                if ($admins <= 1) {
                    throw new ApiError('LAST_ADMIN');
                }
            }
            $db->run('UPDATE devices SET revoked_at = ? WHERE device_id = ?', [Clock::nowDb(), $targetId]);
        });
        return Response::empty(204);
    }

    /** @return array<string, mixed> */
    private static function loadSelf(Context $context): array
    {
        $row = $context->db()->one('SELECT ' . self::COLUMNS . ' FROM devices WHERE device_id = ?', [$context->deviceId()]);
        if ($row === null) {
            throw new ApiError('NOT_FOUND');
        }
        return $row;
    }

    /** @param array<string, mixed> $row */
    public static function format(array $row): array
    {
        return [
            'deviceId' => $row['device_id'],
            'role' => $row['role'],
            'label' => $row['label_enc'] === null ? null : Validate::toBase64Url((string) $row['label_enc']),
            'createdAt' => Clock::iso((string) $row['created_at']),
            'lastSeenAt' => $row['last_seen_at'] === null ? null : Clock::iso((string) $row['last_seen_at']),
            'lastProtocol' => $row['last_protocol'] === null ? null : (int) $row['last_protocol'],
            'revokedAt' => $row['revoked_at'] === null ? null : Clock::iso((string) $row['revoked_at'])
        ];
    }
}
