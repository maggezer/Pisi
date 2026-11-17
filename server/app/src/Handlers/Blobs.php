<?php

declare(strict_types=1);

namespace PisiSync\Handlers;

use PisiSync\ApiError;
use PisiSync\BlobStore;
use PisiSync\Clock;
use PisiSync\Context;
use PisiSync\Db;
use PisiSync\Response;
use PisiSync\Validate;

/**
 * Blob'lar: eksikleri sorma, parçalı yükleme ve Range ile indirme (protokol §6.4).
 * Sunucu şifreli baytları opak kabul eder; yalnız boyut ve SHA-256 doğrular.
 */
final class Blobs
{
    private const COPY_CHUNK = 1048576;

    public static function check(Context $context): Response
    {
        $body = $context->json();
        $list = $body['blobs'] ?? null;
        if (!is_array($list) || !array_is_list($list)) {
            throw ApiError::field('blobs');
        }
        $max = $context->config->int('limits.maxCheckBlobs');
        if (count($list) > $max) {
            throw new ApiError('BATCH_TOO_LARGE', ['limit' => $max]);
        }
        foreach ($list as $blob) {
            if (!Validate::isId('blob', $blob)) {
                throw ApiError::field('blobs');
            }
        }
        $list = array_values(array_unique($list));
        if ($list === []) {
            return Response::json(200, ['missing' => []]);
        }
        $db = $context->db();
        $spaceId = $context->spaceId();
        $present = array_column($db->all('SELECT blob_id FROM blobs WHERE space_id = ? AND blob_id IN (' . Db::placeholders(count($list)) . ')', [$spaceId, ...$list]), 'blob_id');
        if ($present !== []) {
            // Var olduğu söylenen blob, commit'e kadar temizlikten korunur (protokol §8).
            $db->run('UPDATE blobs SET last_ref_at = ? WHERE space_id = ? AND blob_id IN (' . Db::placeholders(count($present)) . ')', [Clock::nowDb(), $spaceId, ...$present]);
        }
        return Response::json(200, ['missing' => array_values(array_diff($list, $present))]);
    }

    public static function startUpload(Context $context): Response
    {
        $blobId = Validate::pathId('blob', $context->request->param('blob'));
        $body = $context->json();
        $size = Validate::int($body, 'size', 1);
        $sha256 = Validate::sha256($body, 'sha256');
        $maxBlob = $context->config->int('limits.maxBlobBytes');
        if ($size > $maxBlob) {
            throw new ApiError('PAYLOAD_TOO_LARGE', ['limit' => $maxBlob]);
        }
        $db = $context->db();
        $spaceId = $context->spaceId();
        if ($db->value('SELECT 1 FROM blobs WHERE space_id = ? AND blob_id = ?', [$spaceId, $blobId]) !== null) {
            $db->run('UPDATE blobs SET last_ref_at = ? WHERE space_id = ? AND blob_id = ?', [Clock::nowDb(), $spaceId, $blobId]);
            return Response::json(200, ['exists' => true]);
        }
        $space = Spaces::load($context);
        self::assertQuota($space, $size);

        $partBytes = $context->config->effectivePartBytes();
        $parts = intdiv($size + $partBytes - 1, $partBytes);
        $uploadId = Validate::randomId('up_');
        $expires = Clock::plusSeconds($context->config->int('limits.uploadTtlSeconds'));
        BlobStore::ensureDir($context->store->uploadDir($uploadId));
        $db->run(
            'INSERT INTO uploads (upload_id, space_id, blob_id, size, sha256, part_bytes, parts_received, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, \'{}\', ?, ?)',
            [$uploadId, $spaceId, $blobId, $size, $sha256, $partBytes, Clock::nowDb(), $expires]
        );
        return Response::json(201, ['uploadId' => $uploadId, 'partBytes' => $partBytes, 'parts' => $parts, 'expiresAt' => Clock::iso($expires)]);
    }

    public static function putPart(Context $context): Response
    {
        $request = $context->request;
        $upload = self::loadUpload($context);
        $partText = $request->param('part');
        $count = intdiv((int) $upload['size'] + (int) $upload['part_bytes'] - 1, (int) $upload['part_bytes']);
        if (preg_match('/^[1-9]\d{0,8}$/', $partText) !== 1 || (int) $partText > $count) {
            throw new ApiError('BAD_REQUEST', ['param' => 'part', 'parts' => $count]);
        }
        $part = (int) $partText;
        if ($request->mediaType() !== 'application/octet-stream') {
            throw new ApiError('UNSUPPORTED_MEDIA_TYPE', ['expected' => 'application/octet-stream']);
        }
        $expectedHash = strtolower((string) $request->header('pisi-part-sha256'));
        if (!Validate::isId('sha256', $expectedHash)) {
            throw new ApiError('BAD_REQUEST', ['header' => 'Pisi-Part-Sha256']);
        }
        $partBytes = (int) $upload['part_bytes'];
        $expected = $part < $count ? $partBytes : (int) $upload['size'] - ($count - 1) * $partBytes;
        $length = $request->contentLength();
        if ($length !== null && $length > $expected) {
            throw new ApiError('PAYLOAD_TOO_LARGE', ['expected' => $expected]);
        }

        $dir = $context->store->uploadDir((string) $upload['upload_id']);
        BlobStore::ensureDir($dir);
        $temp = $dir . '/' . $part . '.' . bin2hex(random_bytes(6)) . '.partial';
        $written = self::copyInput($temp, $expected + 1);
        $actualHash = hash_file('sha256', $temp);
        if ($written !== $expected) {
            @unlink($temp);
            throw $written > $expected ? new ApiError('PAYLOAD_TOO_LARGE', ['expected' => $expected]) : new ApiError('BAD_REQUEST', ['expected' => $expected, 'received' => $written]);
        }
        if (!hash_equals($expectedHash, (string) $actualHash)) {
            @unlink($temp);
            throw new ApiError('HASH_MISMATCH', ['part' => $part]);
        }
        if (!@rename($temp, $context->store->partPath((string) $upload['upload_id'], $part))) {
            @unlink($temp);
            throw new \RuntimeException('Parça yazılamadı.');
        }

        $db = $context->db();
        $size = (int) $upload['size'];
        // `received`: şimdiye kadar alınan parçaların toplam baytı.
        $received = $db->transaction(static function () use ($db, $upload, $part, $actualHash, $count, $partBytes, $size): int {
            $row = $db->one('SELECT parts_received FROM uploads WHERE upload_id = ? FOR UPDATE', [$upload['upload_id']]);
            if ($row === null) {
                throw new ApiError('UPLOAD_NOT_FOUND');
            }
            $parts = json_decode((string) $row['parts_received'], true) ?: [];
            $parts[(string) $part] = $actualHash;
            $db->run('UPDATE uploads SET parts_received = ? WHERE upload_id = ?', [json_encode($parts, JSON_FORCE_OBJECT), $upload['upload_id']]);
            $total = 0;
            foreach (array_keys($parts) as $n) {
                $total += (int) $n < $count ? $partBytes : $size - ($count - 1) * $partBytes;
            }
            return $total;
        });
        return Response::json(200, ['part' => $part, 'received' => $received]);
    }

    public static function complete(Context $context): Response
    {
        $context->json(true);
        $upload = self::loadUpload($context);
        $uploadId = (string) $upload['upload_id'];
        $partBytes = (int) $upload['part_bytes'];
        $size = (int) $upload['size'];
        $count = intdiv($size + $partBytes - 1, $partBytes);
        $received = json_decode((string) $upload['parts_received'], true) ?: [];
        $missing = [];
        for ($n = 1; $n <= $count; $n++) {
            if (!isset($received[(string) $n]) || !is_file($context->store->partPath($uploadId, $n))) {
                $missing[] = $n;
            }
        }
        if ($missing !== []) {
            throw new ApiError('UPLOAD_INCOMPLETE', ['missing' => $missing]);
        }

        @set_time_limit(300);
        $dir = $context->store->uploadDir($uploadId);
        $assembled = $dir . '/assembled.' . bin2hex(random_bytes(6));
        $hash = hash_init('sha256');
        $out = fopen($assembled, 'xb');
        if ($out === false) {
            throw new \RuntimeException('Birleştirme dosyası açılamadı.');
        }
        $total = 0;
        for ($n = 1; $n <= $count; $n++) {
            $in = fopen($context->store->partPath($uploadId, $n), 'rb');
            if ($in === false) {
                fclose($out);
                throw new \RuntimeException('Parça okunamadı.');
            }
            while (!feof($in)) {
                $chunk = fread($in, self::COPY_CHUNK);
                if ($chunk === false || $chunk === '') {
                    break;
                }
                hash_update($hash, $chunk);
                fwrite($out, $chunk);
                $total += strlen($chunk);
            }
            fclose($in);
        }
        fflush($out);
        fclose($out);
        @chmod($assembled, 0600);
        $digest = hash_final($hash);
        $db = $context->db();
        if ($total !== $size || !hash_equals((string) $upload['sha256'], $digest)) {
            $db->run('DELETE FROM uploads WHERE upload_id = ?', [$uploadId]);
            BlobStore::removeTree($dir);
            throw new ApiError('HASH_MISMATCH', ['upload' => $uploadId]);
        }

        $spaceId = $context->spaceId();
        $blobId = (string) $upload['blob_id'];
        $target = $context->store->blobPath($spaceId, $blobId);
        $existed = $db->transaction(static function () use ($context, $db, $spaceId, $blobId, $uploadId, $size, $digest, $assembled, $target): bool {
            $space = Spaces::load($context, true);
            $exists = $db->value('SELECT 1 FROM blobs WHERE space_id = ? AND blob_id = ?', [$spaceId, $blobId]) !== null;
            if (!$exists) {
                self::assertQuota($space, $size);
                BlobStore::ensureDir(dirname($target));
                if (!@rename($assembled, $target)) {
                    throw new \RuntimeException('Blob yerine taşınamadı.');
                }
                $now = Clock::nowDb();
                $db->run('INSERT INTO blobs (space_id, blob_id, size, sha256, created_at, last_ref_at) VALUES (?, ?, ?, ?, ?, ?)', [$spaceId, $blobId, $size, $digest, $now, $now]);
                $db->run('UPDATE spaces SET usage_bytes = usage_bytes + ? WHERE space_id = ?', [$size, $spaceId]);
            }
            $db->run('DELETE FROM uploads WHERE upload_id = ?', [$uploadId]);
            return $exists;
        });
        BlobStore::removeTree($dir);
        if ($existed) {
            return Response::json(200, ['blob' => $blobId, 'size' => $size, 'exists' => true]);
        }
        return Response::json(201, ['blob' => $blobId, 'size' => $size]);
    }

    public static function abort(Context $context): Response
    {
        $uploadId = Validate::pathId('upload', $context->request->param('upload'));
        $db = $context->db();
        $row = $db->one('SELECT upload_id FROM uploads WHERE upload_id = ? AND space_id = ?', [$uploadId, $context->spaceId()]);
        if ($row === null) {
            throw new ApiError('UPLOAD_NOT_FOUND');
        }
        $db->run('DELETE FROM uploads WHERE upload_id = ?', [$uploadId]);
        BlobStore::removeTree($context->store->uploadDir($uploadId));
        return Response::empty(204);
    }

    public static function download(Context $context): Response
    {
        $blobId = Validate::pathId('blob', $context->request->param('blob'));
        $spaceId = $context->spaceId();
        $row = $context->db()->one('SELECT size, sha256 FROM blobs WHERE space_id = ? AND blob_id = ?', [$spaceId, $blobId]);
        $path = $context->store->blobPath($spaceId, $blobId);
        if ($row === null || !is_file($path)) {
            throw new ApiError('BLOB_NOT_FOUND');
        }
        $size = (int) $row['size'];
        $start = 0;
        $end = $size - 1;
        $status = 200;
        $range = $context->request->header('range');
        if ($range !== null && $range !== '') {
            [$start, $end] = self::parseRange($range, $size);
            $status = 206;
        }
        $headers = [
            'Content-Type' => 'application/octet-stream',
            'Content-Length' => (string) ($end - $start + 1),
            'Accept-Ranges' => 'bytes',
            'ETag' => '"' . $blobId . '"',
            'Pisi-Blob-Sha256' => (string) $row['sha256']
        ];
        if ($status === 206) {
            $headers['Content-Range'] = "bytes $start-$end/$size";
        }
        return Response::stream($status, $headers, static function () use ($path, $start, $end): void {
            @set_time_limit(300);
            $handle = fopen($path, 'rb');
            if ($handle === false) {
                return;
            }
            fseek($handle, $start);
            $left = $end - $start + 1;
            while ($left > 0 && !feof($handle)) {
                $chunk = fread($handle, min(self::COPY_CHUNK, $left));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                $left -= strlen($chunk);
                flush();
            }
            fclose($handle);
        });
    }

    /** @return array{0: int, 1: int} */
    private static function parseRange(string $header, int $size): array
    {
        $unsatisfiable = new ApiError('RANGE_NOT_SATISFIABLE', ['size' => $size], ['Content-Range' => "bytes */$size"]);
        if (preg_match('/^bytes=(\d*)-(\d*)$/', trim($header), $match) !== 1 || ($match[1] === '' && $match[2] === '')) {
            throw $unsatisfiable;
        }
        if ($match[1] === '') {
            $suffix = (int) $match[2];
            if ($suffix === 0) {
                throw $unsatisfiable;
            }
            return [max(0, $size - $suffix), $size - 1];
        }
        $start = (int) $match[1];
        $end = $match[2] === '' ? $size - 1 : min((int) $match[2], $size - 1);
        if ($start >= $size || $end < $start) {
            throw $unsatisfiable;
        }
        return [$start, $end];
    }

    /** @return array<string, mixed> */
    private static function loadUpload(Context $context): array
    {
        $uploadId = Validate::pathId('upload', $context->request->param('upload'));
        $upload = $context->db()->one('SELECT * FROM uploads WHERE upload_id = ? AND space_id = ?', [$uploadId, $context->spaceId()]);
        if ($upload === null) {
            throw new ApiError('UPLOAD_NOT_FOUND');
        }
        if (Clock::isPast((string) $upload['expires_at'])) {
            throw new ApiError('UPLOAD_EXPIRED');
        }
        return $upload;
    }

    /** @param array<string, mixed> $space */
    private static function assertQuota(array $space, int $size): void
    {
        if ($space['quota_bytes'] !== null && (int) $space['usage_bytes'] + $size > (int) $space['quota_bytes']) {
            throw new ApiError('QUOTA_EXCEEDED', ['scope' => 'space', 'quotaBytes' => (int) $space['quota_bytes']]);
        }
    }

    /** Gövdeyi en çok `$limit` bayt olarak dosyaya akıtır; yazılan bayt sayısını döner. */
    private static function copyInput(string $target, int $limit): int
    {
        $in = fopen('php://input', 'rb');
        $out = fopen($target, 'xb');
        if ($in === false || $out === false) {
            throw new \RuntimeException('Parça akışı açılamadı.');
        }
        $written = 0;
        while (!feof($in) && $written < $limit) {
            $chunk = fread($in, min(self::COPY_CHUNK, $limit - $written));
            if ($chunk === false || $chunk === '') {
                break;
            }
            fwrite($out, $chunk);
            $written += strlen($chunk);
        }
        fclose($in);
        fclose($out);
        @chmod($target, 0600);
        return $written;
    }
}
