<?php

declare(strict_types=1);

namespace PisiSync\Handlers;

use PisiSync\ApiError;
use PisiSync\Clock;
use PisiSync\Context;
use PisiSync\Db;
use PisiSync\Response;
use PisiSync\Validate;

/** Değişiklik günlüğü, başlıklar ve commit (protokol §5, §6.3, §7). */
final class Changes
{
    public const META_MAX_BYTES = 16384;

    public static function head(Context $context): Response
    {
        $space = Spaces::load($context);
        return Response::json(200, ['head' => (int) $space['head'], 'prunedThrough' => (int) $space['pruned_through']]);
    }

    public static function changes(Context $context): Response
    {
        $maxPage = $context->config->int('limits.maxChangesPage');
        $after = Validate::queryInt($context->request, 'after', 0, 0, PHP_INT_MAX);
        $limit = Validate::queryInt($context->request, 'limit', $maxPage, 1, $maxPage);
        $db = $context->db();
        $spaceId = $context->spaceId();

        // Okumalar tutarlı bir anlık görüntüden yapılır: head ile sayfa aynı andan gelir.
        return $db->transaction(static function () use ($context, $db, $spaceId, $after, $limit): Response {
            $space = Spaces::load($context);
            $pruned = (int) $space['pruned_through'];
            if ($after < $pruned) {
                throw new ApiError('CURSOR_EXPIRED', ['prunedThrough' => $pruned]);
            }
            $rows = $db->all(
                'SELECT seq, fid, op, blob_id, size, device_id, commit_id, at, meta_enc FROM changes WHERE space_id = ? AND seq > ? ORDER BY seq LIMIT ?',
                [$spaceId, $after, $limit]
            );
            if ($rows !== []) {
                // Sayfa bir commit'in ortasında bitmez (protokol §6.3).
                $last = $rows[count($rows) - 1];
                $rest = $db->all(
                    'SELECT seq, fid, op, blob_id, size, device_id, commit_id, at, meta_enc FROM changes WHERE space_id = ? AND seq > ? AND commit_id = ? ORDER BY seq',
                    [$spaceId, (int) $last['seq'], $last['commit_id']]
                );
                array_push($rows, ...$rest);
            }
            $head = (int) $space['head'];
            $lastSeq = $rows === [] ? $after : (int) $rows[count($rows) - 1]['seq'];
            return Response::json(200, [
                'changes' => array_map([self::class, 'formatChange'], $rows),
                'head' => $head,
                'more' => $lastSeq < $head
            ]);
        });
    }

    public static function heads(Context $context): Response
    {
        $maxPage = $context->config->int('limits.maxHeadsPage');
        $limit = Validate::queryInt($context->request, 'limit', $maxPage, 1, $maxPage);
        $after = $context->request->queryString('after');
        if ($after !== null && $after !== '' && !Validate::isId('fid', $after)) {
            throw new ApiError('BAD_REQUEST', ['query' => 'after']);
        }
        $db = $context->db();
        $spaceId = $context->spaceId();
        return $db->transaction(static function () use ($context, $db, $spaceId, $after, $limit): Response {
            $space = Spaces::load($context);
            $rows = $db->all(
                'SELECT fid, seq, op, blob_id, size, device_id, at, meta_enc FROM heads WHERE space_id = ? AND fid > ? ORDER BY fid LIMIT ?',
                [$spaceId, $after ?? '', $limit + 1]
            );
            $next = null;
            if (count($rows) > $limit) {
                array_pop($rows);
                $next = $rows[count($rows) - 1]['fid'];
            }
            return Response::json(200, [
                'asOfSeq' => (int) $space['head'],
                'heads' => array_map(static fn (array $row): array => [
                    'fid' => $row['fid'],
                    'seq' => (int) $row['seq'],
                    'op' => $row['op'],
                    'blob' => $row['blob_id'],
                    'size' => (int) $row['size'],
                    'device' => $row['device_id'],
                    'at' => Clock::iso((string) $row['at']),
                    'meta' => Validate::toBase64Url((string) $row['meta_enc'])
                ], $rows),
                'next' => $next
            ]);
        });
    }

    /** @param array<string, mixed> $row */
    public static function formatChange(array $row): array
    {
        return [
            'seq' => (int) $row['seq'],
            'fid' => $row['fid'],
            'op' => $row['op'],
            'blob' => $row['blob_id'],
            'size' => (int) $row['size'],
            'device' => $row['device_id'],
            'commit' => $row['commit_id'],
            'at' => Clock::iso((string) $row['at']),
            'meta' => Validate::toBase64Url((string) $row['meta_enc'])
        ];
    }

    public static function commit(Context $context): Response
    {
        $body = $context->json();
        $commitId = Validate::id($body, 'commitId', 'commit');
        $list = $body['changes'] ?? null;
        if (!is_array($list) || !array_is_list($list) || $list === []) {
            throw ApiError::field('changes');
        }
        $max = $context->config->int('limits.maxCommitChanges');
        if (count($list) > $max) {
            throw new ApiError('BATCH_TOO_LARGE', ['limit' => $max]);
        }

        $changes = [];
        $seen = [];
        foreach ($list as $index => $item) {
            if (!is_array($item) || array_is_list($item)) {
                throw ApiError::field("changes[$index]");
            }
            $change = self::parseChange($item, $index);
            if (isset($seen[$change['fid']])) {
                throw new ApiError('DUPLICATE_FID', ['fid' => $change['fid']]);
            }
            $seen[$change['fid']] = true;
            $changes[] = $change;
        }
        if (!$context->isAdmin()) {
            foreach ($changes as $change) {
                if ($change['op'] === 'delete') {
                    throw new ApiError('DELETE_NOT_ALLOWED', ['fid' => $change['fid']]);
                }
            }
        }

        $deviceId = $context->deviceId();
        $bodyHash = hash('sha256', json_encode([
            'device' => $deviceId,
            'changes' => array_map(static fn (array $change): array => [
                $change['fid'],
                $change['op'],
                $change['blob'],
                $change['size'],
                $change['baseSeq'],
                hash('sha256', $change['meta'])
            ], $changes)
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

        $db = $context->db();
        $spaceId = $context->spaceId();
        $result = $db->transaction(static function () use ($context, $db, $spaceId, $commitId, $changes, $bodyHash, $deviceId): array {
            $space = Spaces::load($context, true);
            $previous = $db->one('SELECT body_sha256, seqs FROM commits WHERE space_id = ? AND commit_id = ?', [$spaceId, $commitId]);
            if ($previous !== null) {
                if (!hash_equals((string) $previous['body_sha256'], $bodyHash)) {
                    throw new ApiError('COMMIT_ID_REUSED');
                }
                $seqs = array_map('intval', json_decode((string) $previous['seqs'], true, 4, JSON_THROW_ON_ERROR));
                return ['seqs' => $seqs, 'head' => max($seqs)];
            }

            $fids = array_column($changes, 'fid');
            $heads = [];
            foreach ($db->all('SELECT fid, seq, op FROM heads WHERE space_id = ? AND fid IN (' . Db::placeholders(count($fids)) . ')', [$spaceId, ...$fids]) as $row) {
                $heads[$row['fid']] = $row;
            }
            $stale = [];
            foreach ($changes as $change) {
                $headSeq = isset($heads[$change['fid']]) ? (int) $heads[$change['fid']]['seq'] : 0;
                if ($change['baseSeq'] !== $headSeq) {
                    $stale[] = ['fid' => $change['fid'], 'baseSeq' => $change['baseSeq'], 'headSeq' => $headSeq];
                }
            }
            if ($stale !== []) {
                throw new ApiError('STALE_BASE', ['head' => (int) $space['head'], 'stale' => $stale]);
            }
            foreach ($changes as $change) {
                $current = $heads[$change['fid']]['op'] ?? null;
                if ($change['op'] === 'delete' && $current !== 'put') {
                    throw new ApiError('INVALID_CHANGE', ['fid' => $change['fid']]);
                }
            }

            $blobIds = array_values(array_unique(array_filter(array_column($changes, 'blob'))));
            if ($blobIds !== []) {
                $sizes = [];
                foreach ($db->all('SELECT blob_id, size FROM blobs WHERE space_id = ? AND blob_id IN (' . Db::placeholders(count($blobIds)) . ')', [$spaceId, ...$blobIds]) as $row) {
                    $sizes[$row['blob_id']] = (int) $row['size'];
                }
                $missing = array_values(array_diff($blobIds, array_keys($sizes)));
                if ($missing !== []) {
                    throw new ApiError('BLOB_MISSING', ['blobs' => $missing]);
                }
                foreach ($changes as $change) {
                    if ($change['op'] === 'put' && $sizes[$change['blob']] !== $change['size']) {
                        throw new ApiError('SIZE_MISMATCH', ['fid' => $change['fid'], 'size' => $sizes[$change['blob']]]);
                    }
                }
            }

            $now = Clock::nowDb();
            $seq = (int) $space['head'];
            $seqs = [];
            foreach ($changes as $change) {
                $seq++;
                $seqs[] = $seq;
                $db->run(
                    'INSERT INTO changes (space_id, seq, fid, op, blob_id, size, device_id, commit_id, at, meta_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$spaceId, $seq, $change['fid'], $change['op'], $change['blob'], $change['size'], $deviceId, $commitId, $now, $change['meta']]
                );
                $db->run(
                    'INSERT INTO heads (space_id, fid, seq, op, blob_id, size, device_id, at, meta_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE seq = VALUES(seq), op = VALUES(op), blob_id = VALUES(blob_id), size = VALUES(size), device_id = VALUES(device_id), at = VALUES(at), meta_enc = VALUES(meta_enc)',
                    [$spaceId, $change['fid'], $seq, $change['op'], $change['blob'], $change['size'], $deviceId, $now, $change['meta']]
                );
            }
            if ($blobIds !== []) {
                $db->run('UPDATE blobs SET last_ref_at = ? WHERE space_id = ? AND blob_id IN (' . Db::placeholders(count($blobIds)) . ')', [$now, $spaceId, ...$blobIds]);
            }
            $db->run('UPDATE spaces SET head = ? WHERE space_id = ?', [$seq, $spaceId]);
            $db->run('INSERT INTO commits (space_id, commit_id, body_sha256, seqs, created_at) VALUES (?, ?, ?, ?, ?)', [$spaceId, $commitId, $bodyHash, json_encode($seqs), $now]);
            return ['seqs' => $seqs, 'head' => $seq];
        });

        return Response::json(200, ['commitId' => $commitId, 'seqs' => $result['seqs'], 'head' => $result['head']]);
    }

    /**
     * @param array<string, mixed> $item
     * @return array{fid: string, op: string, blob: ?string, size: int, baseSeq: int, meta: string}
     */
    private static function parseChange(array $item, int $index): array
    {
        $prefix = "changes[$index].";
        $fid = $item['fid'] ?? null;
        if (!Validate::isId('fid', $fid)) {
            throw ApiError::field($prefix . 'fid');
        }
        $op = $item['op'] ?? null;
        if ($op !== 'put' && $op !== 'delete') {
            throw ApiError::field($prefix . 'op');
        }
        $baseSeq = $item['baseSeq'] ?? null;
        if (!is_int($baseSeq) || $baseSeq < 0) {
            throw ApiError::field($prefix . 'baseSeq');
        }
        $meta = is_string($item['meta'] ?? null) ? Validate::fromBase64Url($item['meta']) : null;
        if ($meta === null || strlen($meta) < 38 || strlen($meta) > self::META_MAX_BYTES) {
            throw ApiError::field($prefix . 'meta');
        }
        $blob = null;
        $size = 0;
        if ($op === 'put') {
            $blob = $item['blob'] ?? null;
            if (!Validate::isId('blob', $blob)) {
                throw ApiError::field($prefix . 'blob');
            }
            $size = $item['size'] ?? null;
            if (!is_int($size) || $size < 1) {
                throw ApiError::field($prefix . 'size');
            }
        } elseif (($item['blob'] ?? null) !== null || !in_array($item['size'] ?? 0, [0, null], true)) {
            throw ApiError::field($prefix . (($item['blob'] ?? null) !== null ? 'blob' : 'size'));
        }
        return ['fid' => $fid, 'op' => $op, 'blob' => $blob, 'size' => $size, 'baseSeq' => $baseSeq, 'meta' => $meta];
    }
}
