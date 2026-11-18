<?php

declare(strict_types=1);

namespace PisiSync;

// Alanların bakımı: hosting sahibinin bin/spaces.php ile alanları görmesi ve
// silmesi, `DELETE /v1/spaces/{space}` ile aynı silme yolu. Sunucu alanın adını
// bilmez (şifreli); liste yalnız kimlik, tarih, boyut ve cihaz sayılarını verir.
final class SpaceAdmin
{
    public function __construct(private readonly Db $db, private readonly BlobStore $store)
    {
    }

    /**
     * Her alan: kimlik, açılış, son görülme (cihazların en yenisi), head, kaplanan bayt,
     * etkin masaüstü (admin) ve telefon (member) sayısı.
     *
     * @return list<array{spaceId: string, createdAt: string, lastSeenAt: ?string, head: int, usageBytes: int, admins: int, members: int}>
     */
    public function list(): array
    {
        $rows = $this->db->all(
            'SELECT s.space_id, s.created_at, s.head, s.usage_bytes,
                    MAX(d.last_seen_at) AS last_seen_at,
                    SUM(d.role = \'admin\' AND d.revoked_at IS NULL) AS admins,
                    SUM(d.role = \'member\' AND d.revoked_at IS NULL) AS members
             FROM spaces s LEFT JOIN devices d ON d.space_id = s.space_id
             GROUP BY s.space_id, s.created_at, s.head, s.usage_bytes
             ORDER BY s.created_at, s.space_id'
        );
        return array_map(static fn(array $row): array => [
            'spaceId' => (string) $row['space_id'],
            'createdAt' => Clock::iso((string) $row['created_at']),
            'lastSeenAt' => $row['last_seen_at'] === null ? null : Clock::iso((string) $row['last_seen_at']),
            'head' => (int) $row['head'],
            'usageBytes' => (int) $row['usage_bytes'],
            'admins' => (int) ($row['admins'] ?? 0),
            'members' => (int) ($row['members'] ?? 0)
        ], $rows);
    }

    /** Alanı bütünüyle siler: kayıtlar, cihazlar (token'ları TOKEN_INVALID alır) ve blob'lar. Alan yoksa false. */
    public function delete(string $spaceId): bool
    {
        $db = $this->db;
        $deleted = $db->transaction(static function () use ($db, $spaceId): bool {
            if ($db->one('SELECT head FROM spaces WHERE space_id = ? FOR UPDATE', [$spaceId]) === null) {
                return false;
            }
            // Alt tablolar ON DELETE CASCADE ile silinir.
            $db->run('DELETE FROM spaces WHERE space_id = ?', [$spaceId]);
            return true;
        });
        if ($deleted) {
            $this->store->discardSpace($spaceId);
        }
        return (bool) $deleted;
    }
}
