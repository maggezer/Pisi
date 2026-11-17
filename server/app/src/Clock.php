<?php

declare(strict_types=1);

namespace PisiSync;

/** UTC zamanı: veritabanında DATETIME(3), telde ISO 8601 (`…T10:00:00.000Z`). */
final class Clock
{
    public static function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    public static function db(\DateTimeImmutable $time): string
    {
        return $time->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
    }

    public static function nowDb(): string
    {
        return self::db(self::now());
    }

    public static function plusSeconds(int $seconds): string
    {
        return self::db(self::now()->modify(($seconds >= 0 ? '+' : '') . $seconds . ' seconds'));
    }

    /** Dakikaya yuvarlanmış şimdiki zaman (cihazların son görülme zamanı, protokol §6.5). */
    public static function nowMinuteDb(): string
    {
        return self::now()->format('Y-m-d H:i:00.000');
    }

    public static function iso(?string $dbTime): ?string
    {
        if ($dbTime === null) {
            return null;
        }
        $time = new \DateTimeImmutable($dbTime, new \DateTimeZone('UTC'));
        return $time->format('Y-m-d\TH:i:s.v\Z');
    }

    public static function isPast(string $dbTime): bool
    {
        return new \DateTimeImmutable($dbTime, new \DateTimeZone('UTC')) <= self::now();
    }

    public static function secondsUntil(string $dbTime): int
    {
        return max(0, (new \DateTimeImmutable($dbTime, new \DateTimeZone('UTC')))->getTimestamp() - time());
    }
}
