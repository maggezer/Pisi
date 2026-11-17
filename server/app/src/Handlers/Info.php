<?php

declare(strict_types=1);

namespace PisiSync\Handlers;

use PisiSync\Clock;
use PisiSync\Config;
use PisiSync\Context;
use PisiSync\Response;

/** GET /v1/info (protokol §6.1). Veritabanına dokunmaz. */
final class Info
{
    public static function get(Context $context): Response
    {
        return Response::json(200, [
            'service' => 'pisi-sync',
            'protocol' => ['min' => Config::PROTOCOL_MIN, 'max' => Config::PROTOCOL_MAX, 'revision' => Config::PROTOCOL_REVISION],
            'server' => ['version' => Config::SERVER_VERSION],
            'limits' => $context->config->publicLimits(),
            'time' => Clock::iso(Clock::nowDb())
        ]);
    }
}
