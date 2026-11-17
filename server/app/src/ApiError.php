<?php

declare(strict_types=1);

namespace PisiSync;

/** Protokol hata yanıtı (docs/sync-protocol.md §9). Davranışı yalnız `code` belirler. */
final class ApiError extends \Exception
{
    /**
     * @param array<string, mixed> $details
     * @param array<string, string> $headers
     */
    public function __construct(public readonly string $errorCode, public readonly array $details = [], public readonly array $headers = [])
    {
        parent::__construct($errorCode);
    }

    public static function field(string $field): self
    {
        return new self('INVALID_FIELD', ['field' => $field]);
    }
}
