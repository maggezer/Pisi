<?php

declare(strict_types=1);

namespace PisiSync;

/**
 * Sunucu hata kodları (docs/sync-protocol.md §9.2): HTTP durumu, yeniden denenebilirlik
 * ve iki dilde kısa açıklama. Mesajlar yalnız gösterim içindir; istemci `code`'a bakar.
 */
final class Errors
{
    /** @var array<string, array{0: int, 1: bool, 2: string, 3: string}> */
    public const TABLE = [
        'HTTPS_REQUIRED' => [400, false, 'İstek HTTPS ile yapılmalı.', 'The request must use HTTPS.'],
        'BAD_REQUEST' => [400, false, 'Yol, sorgu ya da başlık geçersiz.', 'The path, query or a header is invalid.'],
        'INVALID_JSON' => [400, false, 'Gövde geçerli bir JSON nesnesi değil.', 'The body is not a valid JSON object.'],
        'INVALID_FIELD' => [400, false, 'Bir alan eksik ya da biçimi yanlış.', 'A field is missing or malformed.'],
        'AUTH_REQUIRED' => [401, false, 'Cihaz token\'ı gerekli.', 'A device token is required.'],
        'TOKEN_INVALID' => [401, false, 'Token tanınmıyor.', 'The token is not recognised.'],
        'DEVICE_REVOKED' => [403, false, 'Bu cihazın bağlantısı kaldırıldı.', 'This device has been revoked.'],
        'FORBIDDEN_ROLE' => [403, false, 'Bu işlem yönetici cihaz gerektirir.', 'This operation requires an admin device.'],
        'DELETE_NOT_ALLOWED' => [403, false, 'Bu cihaz silme gönderemez.', 'This device may not send deletions.'],
        'SETUP_KEY_INVALID' => [403, false, 'Kurulum anahtarı yanlış.', 'The setup key is invalid.'],
        'PAIRING_CODE_INVALID' => [403, false, 'Eşleştirme kodu tutmuyor.', 'The pairing code does not match.'],
        'PAIRING_REJECTED' => [403, false, 'Eşleştirme reddedildi.', 'The pairing was rejected.'],
        'NOT_FOUND' => [404, false, 'Bulunamadı.', 'Not found.'],
        'BLOB_NOT_FOUND' => [404, false, 'Blob bulunamadı.', 'Blob not found.'],
        'UPLOAD_NOT_FOUND' => [404, false, 'Yükleme bulunamadı.', 'Upload not found.'],
        'PAIRING_NOT_FOUND' => [404, false, 'Eşleştirme bulunamadı.', 'Pairing not found.'],
        'METHOD_NOT_ALLOWED' => [405, false, 'Bu yöntem desteklenmiyor.', 'Method not allowed.'],
        'STALE_BASE' => [409, true, 'Bazı dosyaların sunucudaki sürümü değişti.', 'Some files changed on the server.'],
        'ID_TAKEN' => [409, true, 'Bu kimlik kullanılıyor.', 'This id is already in use.'],
        'COMMIT_ID_REUSED' => [409, false, 'Bu commit kimliği başka bir gövdeyle kullanıldı.', 'This commit id was used with a different body.'],
        'PAIRING_STATE' => [409, false, 'Eşleştirme bu işlem için uygun durumda değil.', 'The pairing is not in a state that allows this.'],
        'PAIRING_LIMIT' => [409, false, 'Açık eşleştirme sayısı sınırda.', 'Too many open pairings.'],
        'LAST_ADMIN' => [409, false, 'Son yönetici cihaz kendini kaldıramaz.', 'The last admin device cannot revoke itself.'],
        'CURSOR_EXPIRED' => [410, true, 'İmleç budanan günlüğün gerisinde kaldı.', 'The cursor is behind the pruned log.'],
        'PAIRING_EXPIRED' => [410, false, 'Eşleştirmenin süresi doldu.', 'The pairing has expired.'],
        'UPLOAD_EXPIRED' => [410, true, 'Yüklemenin süresi doldu.', 'The upload has expired.'],
        'PAYLOAD_TOO_LARGE' => [413, false, 'Gövde sınırı aşıyor.', 'The payload is too large.'],
        'UNSUPPORTED_MEDIA_TYPE' => [415, false, 'Content-Type yanlış.', 'Unsupported Content-Type.'],
        'RANGE_NOT_SATISFIABLE' => [416, false, 'Range geçersiz.', 'The range is not satisfiable.'],
        'INVALID_CHANGE' => [422, false, 'Geçersiz değişiklik.', 'Invalid change.'],
        'DUPLICATE_FID' => [422, false, 'Aynı dosya bir commit\'te iki kez var.', 'The same file appears twice in a commit.'],
        'BLOB_MISSING' => [422, true, 'Blob yüklenmemiş.', 'The blob has not been uploaded.'],
        'SIZE_MISMATCH' => [422, false, 'Boyut blob boyutuyla tutmuyor.', 'The size does not match the blob.'],
        'HASH_MISMATCH' => [422, true, 'Özet tutmuyor.', 'The hash does not match.'],
        'UPLOAD_INCOMPLETE' => [422, true, 'Eksik parça var.', 'Some parts are missing.'],
        'BATCH_TOO_LARGE' => [422, false, 'Toplu istek sınırı aşıyor.', 'The batch is too large.'],
        'PROTOCOL_UNSUPPORTED' => [426, false, 'Protokol sürümü desteklenmiyor.', 'Protocol version not supported.'],
        'RATE_LIMITED' => [429, true, 'Çok fazla istek.', 'Too many requests.'],
        'INTERNAL' => [500, true, 'Beklenmeyen bir sunucu hatası.', 'Unexpected server error.'],
        'MAINTENANCE' => [503, true, 'Sunucu bakımda.', 'The server is under maintenance.'],
        'DB_UNAVAILABLE' => [503, true, 'Veritabanına bağlanılamıyor.', 'The database is unavailable.'],
        'QUOTA_EXCEEDED' => [507, false, 'Kota doldu.', 'Quota exceeded.']
    ];

    /** @return array{status: int, body: array<string, mixed>} */
    public static function describe(ApiError $error, string $locale): array
    {
        $entry = self::TABLE[$error->errorCode] ?? self::TABLE['INTERNAL'];
        $code = isset(self::TABLE[$error->errorCode]) ? $error->errorCode : 'INTERNAL';
        return [
            'status' => $entry[0],
            'body' => [
                'error' => [
                    'code' => $code,
                    'message' => $locale === 'en' ? $entry[3] : $entry[2],
                    'retryable' => $entry[1],
                    'details' => $error->details === [] ? new \stdClass() : $error->details
                ]
            ]
        ];
    }
}
