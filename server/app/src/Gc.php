<?php

declare(strict_types=1);

namespace PisiSync;

use PisiSync\Handlers\Pairings;

/**
 * Budama ve temizlik (protokol §8). Her adım küçük gruplarla çalışır; `$budget` saniye
 * dolunca durur ve bir sonraki çalıştırmada kaldığı yerden sürer.
 */
final class Gc
{
    private const BATCH = 500;

    private float $deadline = INF;

    /** @var array<string, int> */
    public array $stats = [];

    public function __construct(private readonly Db $db, private readonly BlobStore $store, private readonly Config $config)
    {
    }

    /** @return array<string, int> */
    public function run(?float $budget = null): array
    {
        $this->deadline = $budget === null ? INF : microtime(true) + $budget;
        $this->stats = ['pairingsExpired' => 0, 'pairingsDeleted' => 0, 'uploads' => 0, 'commits' => 0, 'rateLimits' => 0, 'changes' => 0, 'blobs' => 0, 'trash' => 0];
        $steps = ['pairings', 'uploads', 'commits', 'rateLimits', 'changes', 'blobs', 'trash'];
        foreach ($steps as $step) {
            if ($this->outOfTime()) {
                break;
            }
            $this->{$step}();
        }
        return $this->stats;
    }

    private function outOfTime(): bool
    {
        return microtime(true) > $this->deadline;
    }

    private function pairings(): void
    {
        $before = (int) $this->db->value('SELECT COUNT(*) FROM pairings WHERE state = \'expired\'');
        Pairings::expireStale($this->db);
        $this->stats['pairingsExpired'] = (int) $this->db->value('SELECT COUNT(*) FROM pairings WHERE state = \'expired\'') - $before;
        $cutoff = Clock::plusSeconds(-86400 * $this->config->int('retention.pairingDays'));
        $this->stats['pairingsDeleted'] = $this->db->run(
            'DELETE FROM pairings WHERE state IN (\'expired\', \'rejected\', \'cancelled\', \'collected\') AND created_at < ?',
            [$cutoff]
        )->rowCount();
    }

    private function uploads(): void
    {
        do {
            $rows = $this->db->all('SELECT upload_id FROM uploads WHERE expires_at <= ? LIMIT ' . self::BATCH, [Clock::nowDb()]);
            foreach ($rows as $row) {
                $this->db->run('DELETE FROM uploads WHERE upload_id = ?', [$row['upload_id']]);
                BlobStore::removeTree($this->store->uploadDir((string) $row['upload_id']));
                $this->stats['uploads']++;
                if ($this->outOfTime()) {
                    return;
                }
            }
        } while (count($rows) === self::BATCH);

        // Satırı olmayan yükleme klasörleri (yarıda kalmış istekler).
        $tmp = $this->config->dataDir() . '/tmp';
        foreach (is_dir($tmp) ? (scandir($tmp) ?: []) : [] as $entry) {
            if (!Validate::isId('upload', $entry) || filemtime($tmp . '/' . $entry) > time() - 3600) {
                continue;
            }
            if ($this->db->value('SELECT 1 FROM uploads WHERE upload_id = ?', [$entry]) === null) {
                BlobStore::removeTree($tmp . '/' . $entry, $this->deadline);
            }
        }
    }

    private function commits(): void
    {
        $cutoff = Clock::plusSeconds(-86400 * $this->config->int('retention.commitDays'));
        $this->stats['commits'] = $this->db->run('DELETE FROM commits WHERE created_at < ?', [$cutoff])->rowCount();
    }

    private function rateLimits(): void
    {
        $this->stats['rateLimits'] = $this->db->run('DELETE FROM rate_limits WHERE expires_at < ?', [time()])->rowCount();
    }

    /** Başlık olmayan ve `retention.changesDays`'ten eski kayıtlar; prunedThrough ilerler. */
    private function changes(): void
    {
        $cutoff = Clock::plusSeconds(-86400 * $this->config->int('retention.changesDays'));
        foreach ($this->db->all('SELECT space_id FROM spaces ORDER BY space_id') as $space) {
            $spaceId = (string) $space['space_id'];
            while (!$this->outOfTime()) {
                $deleted = $this->db->transaction(function () use ($spaceId, $cutoff): int {
                    $this->db->run('SELECT head FROM spaces WHERE space_id = ? FOR UPDATE', [$spaceId]);
                    $seqs = array_map('intval', array_column($this->db->all(
                        'SELECT c.seq FROM changes c LEFT JOIN heads h ON h.space_id = c.space_id AND h.seq = c.seq
                         WHERE c.space_id = ? AND c.at < ? AND h.seq IS NULL ORDER BY c.seq LIMIT ' . self::BATCH,
                        [$spaceId, $cutoff]
                    ), 'seq'));
                    if ($seqs === []) {
                        return 0;
                    }
                    $this->db->run('DELETE FROM changes WHERE space_id = ? AND seq IN (' . Db::placeholders(count($seqs)) . ')', [$spaceId, ...$seqs]);
                    $this->db->run('UPDATE spaces SET pruned_through = GREATEST(pruned_through, ?) WHERE space_id = ?', [max($seqs), $spaceId]);
                    return count($seqs);
                });
                $this->stats['changes'] += $deleted;
                if ($deleted < self::BATCH) {
                    break;
                }
            }
        }
    }

    /** Hiçbir başlığın ve saklanan değişikliğin başvurmadığı, `blobGraceHours`'tan eski blob'lar. */
    private function blobs(): void
    {
        $cutoff = Clock::plusSeconds(-3600 * $this->config->int('retention.blobGraceHours'));
        foreach ($this->db->all('SELECT space_id FROM spaces ORDER BY space_id') as $space) {
            $spaceId = (string) $space['space_id'];
            while (!$this->outOfTime()) {
                $removed = $this->db->transaction(function () use ($spaceId, $cutoff): array {
                    $this->db->run('SELECT head FROM spaces WHERE space_id = ? FOR UPDATE', [$spaceId]);
                    $rows = $this->db->all(
                        'SELECT b.blob_id, b.size FROM blobs b WHERE b.space_id = ? AND b.last_ref_at < ?
                         AND NOT EXISTS (SELECT 1 FROM heads h WHERE h.space_id = b.space_id AND h.blob_id = b.blob_id)
                         AND NOT EXISTS (SELECT 1 FROM changes c WHERE c.space_id = b.space_id AND c.blob_id = b.blob_id)
                         LIMIT ' . self::BATCH,
                        [$spaceId, $cutoff]
                    );
                    if ($rows === []) {
                        return [];
                    }
                    $ids = array_column($rows, 'blob_id');
                    $this->db->run('DELETE FROM blobs WHERE space_id = ? AND blob_id IN (' . Db::placeholders(count($ids)) . ')', [$spaceId, ...$ids]);
                    $this->db->run('UPDATE spaces SET usage_bytes = GREATEST(0, usage_bytes - ?) WHERE space_id = ?', [array_sum(array_map('intval', array_column($rows, 'size'))), $spaceId]);
                    return $ids;
                });
                foreach ($removed as $blobId) {
                    @unlink($this->store->blobPath($spaceId, (string) $blobId));
                }
                $this->stats['blobs'] += count($removed);
                if (count($removed) < self::BATCH) {
                    break;
                }
            }
        }
    }

    private function trash(): void
    {
        $dir = $this->store->trashDir();
        foreach (is_dir($dir) ? (scandir($dir) ?: []) : [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            if (BlobStore::removeTree($dir . '/' . $entry, $this->deadline)) {
                $this->stats['trash']++;
            }
            if ($this->outOfTime()) {
                return;
            }
        }
    }
}
