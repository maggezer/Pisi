<?php

declare(strict_types=1);

namespace PisiSync;

/** Bir isteğin bağımlılıkları: ayarlar, istek, veritabanı, sayaçlar ve kimliği doğrulanmış cihaz. */
final class Context
{
    private ?Db $db = null;
    private ?RateLimiter $limiter = null;

    /** @var array<string, mixed>|null */
    public ?array $device = null;

    public readonly BlobStore $store;

    public function __construct(public readonly Config $config, public readonly Request $request)
    {
        $this->store = new BlobStore($config->dataDir());
    }

    public function db(): Db
    {
        return $this->db ??= Db::connect($this->config);
    }

    public function limiter(): RateLimiter
    {
        return $this->limiter ??= new RateLimiter($this->db());
    }

    public function hasDb(): bool
    {
        return $this->db !== null;
    }

    public function spaceId(): string
    {
        return (string) $this->device['space_id'];
    }

    public function deviceId(): string
    {
        return (string) $this->device['device_id'];
    }

    public function isAdmin(): bool
    {
        return ($this->device['role'] ?? null) === 'admin';
    }

    /** @return array<string, mixed> */
    public function json(bool $allowEmpty = false): array
    {
        return $this->request->json($this->config->int('limits.maxRequestJsonBytes'), $allowEmpty);
    }
}
