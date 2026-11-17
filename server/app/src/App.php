<?php

declare(strict_types=1);

namespace PisiSync;

use PisiSync\Handlers\Blobs;
use PisiSync\Handlers\Changes;
use PisiSync\Handlers\Devices;
use PisiSync\Handlers\Info;
use PisiSync\Handlers\Pairings;
use PisiSync\Handlers\Spaces;

/** Ön denetleyici: HTTPS, CORS, yönlendirme, protokol sürümü, bakım ve hata biçimi. */
final class App
{
    private const SEGMENT = '([^/]+)';

    /**
     * Protokol §6 tablosu. [yöntem, yol, işleyici, yetki]. Yetki: 'none', 'device', 'admin'.
     *
     * @return list<array{0: string, 1: string, 2: callable, 3: string}>
     */
    public static function routes(): array
    {
        return [
            ['GET', '/v1/info', [Info::class, 'get'], 'none'],
            ['POST', '/v1/spaces', [Spaces::class, 'create'], 'none'],
            ['GET', '/v1/spaces/{space}', [Spaces::class, 'get'], 'device'],
            ['DELETE', '/v1/spaces/{space}', [Spaces::class, 'delete'], 'admin'],
            ['GET', '/v1/spaces/{space}/head', [Changes::class, 'head'], 'device'],
            ['GET', '/v1/spaces/{space}/changes', [Changes::class, 'changes'], 'device'],
            ['GET', '/v1/spaces/{space}/heads', [Changes::class, 'heads'], 'device'],
            ['POST', '/v1/spaces/{space}/commit', [Changes::class, 'commit'], 'device'],
            ['POST', '/v1/spaces/{space}/blobs/check', [Blobs::class, 'check'], 'device'],
            ['POST', '/v1/spaces/{space}/blobs/{blob}/uploads', [Blobs::class, 'startUpload'], 'device'],
            ['PUT', '/v1/spaces/{space}/uploads/{upload}/parts/{part}', [Blobs::class, 'putPart'], 'device'],
            ['POST', '/v1/spaces/{space}/uploads/{upload}/complete', [Blobs::class, 'complete'], 'device'],
            ['DELETE', '/v1/spaces/{space}/uploads/{upload}', [Blobs::class, 'abort'], 'device'],
            ['GET', '/v1/spaces/{space}/blobs/{blob}', [Blobs::class, 'download'], 'device'],
            ['GET', '/v1/spaces/{space}/devices', [Devices::class, 'list'], 'admin'],
            ['GET', '/v1/spaces/{space}/devices/me', [Devices::class, 'me'], 'device'],
            ['PATCH', '/v1/spaces/{space}/devices/me', [Devices::class, 'updateMe'], 'device'],
            ['DELETE', '/v1/spaces/{space}/devices/{device}', [Devices::class, 'revoke'], 'device'],
            ['POST', '/v1/spaces/{space}/pairings', [Pairings::class, 'start'], 'admin'],
            ['GET', '/v1/spaces/{space}/pairings/{pairing}', [Pairings::class, 'get'], 'admin'],
            ['POST', '/v1/spaces/{space}/pairings/{pairing}/grant', [Pairings::class, 'grant'], 'admin'],
            ['POST', '/v1/spaces/{space}/pairings/{pairing}/reject', [Pairings::class, 'reject'], 'admin'],
            ['DELETE', '/v1/spaces/{space}/pairings/{pairing}', [Pairings::class, 'cancel'], 'admin'],
            ['POST', '/v1/pairings/lookup', [Pairings::class, 'lookup'], 'none'],
            ['POST', '/v1/pairings/{pairing}/claim', [Pairings::class, 'claim'], 'none'],
            ['GET', '/v1/pairings/{pairing}/result', [Pairings::class, 'result'], 'none']
        ];
    }

    public static function handleHttpRequest(string $appDir): void
    {
        ini_set('display_errors', '0');
        ini_set('html_errors', '0');
        $locale = 'tr';
        $context = null;
        try {
            $config = Config::load($appDir);
            $locale = $config->locale();
            $request = Request::fromGlobals($config);
            $context = new Context($config, $request);
            $response = self::dispatch($context);
        } catch (ApiError $error) {
            $response = Response::error($error, $locale);
        } catch (\Throwable $error) {
            error_log('pisi-sync: ' . get_class($error) . ' ' . $error->getFile() . ':' . $error->getLine());
            $response = Response::error(new ApiError('INTERNAL'), $locale);
        }
        if ($context !== null) {
            self::addCommonHeaders($context, $response);
        } else {
            $response->headers += ['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff', 'Referrer-Policy' => 'no-referrer'];
        }
        $response->send();
        if ($context !== null) {
            self::afterResponse($context);
        }
    }

    private static function dispatch(Context $context): Response
    {
        $request = $context->request;
        $config = $context->config;
        if ($config->get('https.require') !== false && !$request->https) {
            throw new ApiError('HTTPS_REQUIRED');
        }
        if ($request->method === 'OPTIONS') {
            return Response::empty(204);
        }

        [$route, $allowed] = self::match($request->method, $request->path);
        if ($route === null) {
            if ($allowed !== []) {
                throw new ApiError('METHOD_NOT_ALLOWED', [], ['Allow' => implode(', ', $allowed)]);
            }
            throw new ApiError('NOT_FOUND');
        }
        [$route, $params] = $route;
        $request->params = $params;
        [, $template, $handler, $auth] = $route;

        if ($template !== '/v1/info') {
            $version = $request->header('pisi-sync-protocol');
            if ($version === null || preg_match('/^\d{1,4}$/', $version) !== 1 || (int) $version < Config::PROTOCOL_MIN || (int) $version > Config::PROTOCOL_MAX) {
                throw new ApiError('PROTOCOL_UNSUPPORTED', ['min' => Config::PROTOCOL_MIN, 'max' => Config::PROTOCOL_MAX]);
            }
            if ($config->get('testing.faultInjection') === true && $request->header('pisi-test-fault') === 'internal') {
                throw new \RuntimeException('fault injection');
            }
            if ($config->get('maintenance') === true) {
                throw new ApiError('MAINTENANCE');
            }
            $migrator = new Migrator($context->db(), $config->appDir . '/schema');
            if (!$migrator->isCurrent()) {
                throw new ApiError('MAINTENANCE');
            }
        }

        if ($auth !== 'none') {
            $spaceId = Validate::pathId('space', $request->param('space'));
            Auth::device($context, $spaceId, $auth === 'admin');
        }
        return $handler($context);
    }

    /**
     * @return array{0: array{0: array, 1: array<string, string>}|null, 1: list<string>}
     */
    private static function match(string $method, string $path): array
    {
        $allowed = [];
        $found = null;
        foreach (self::routes() as $route) {
            $names = [];
            $regex = preg_replace_callback('/\{([a-z]+)\}/', static function (array $match) use (&$names): string {
                $names[] = $match[1];
                return self::SEGMENT;
            }, $route[1]);
            if (preg_match('#^' . $regex . '$#', $path, $values) !== 1) {
                continue;
            }
            $params = [];
            foreach ($names as $index => $name) {
                $params[$name] = $values[$index + 1];
            }
            // devices/me (GET, PATCH) ve devices/{device} (DELETE) aynı yolu paylaşır.
            if (($params['device'] ?? null) === 'me' && $route[0] !== 'DELETE') {
                continue;
            }
            $allowed[] = $route[0];
            if ($found === null && $route[0] === $method) {
                $found = [$route, $params];
            }
        }
        return [$found, array_values(array_unique($allowed))];
    }

    private static function addCommonHeaders(Context $context, Response $response): void
    {
        $response->headers += ['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff', 'Referrer-Policy' => 'no-referrer'];
        if ($context->config->get('https.hsts') === true) {
            $response->headers['Strict-Transport-Security'] = 'max-age=31536000';
        }
        $origin = $context->request->header('origin');
        $origins = $context->config->get('cors.origins');
        if ($origin !== null && is_array($origins) && in_array($origin, $origins, true)) {
            $response->headers['Access-Control-Allow-Origin'] = $origin;
            $response->headers['Vary'] = 'Origin';
            if ($context->request->method === 'OPTIONS') {
                $response->headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
                $response->headers['Access-Control-Allow-Headers'] = 'Authorization, X-Pisi-Token, Pisi-Sync-Protocol, Pisi-Setup-Key, Pisi-Part-Sha256, Content-Type, Range';
                $response->headers['Access-Control-Max-Age'] = '600';
            } else {
                $response->headers['Access-Control-Expose-Headers'] = 'Retry-After, ETag, Content-Range, Content-Length, Accept-Ranges, Pisi-Blob-Sha256';
            }
        }
    }

    /** Cron kurulmamışsa yanıt gönderildikten sonra kısa, süre sınırlı temizlik (protokol §8). */
    private static function afterResponse(Context $context): void
    {
        $config = $context->config;
        if ($config->get('gc.opportunistic') !== true || !$context->hasDb()) {
            return;
        }
        $stamp = $config->dataDir() . '/gc.stamp';
        $interval = max(60, $config->int('gc.intervalSeconds'));
        if (is_file($stamp) && filemtime($stamp) > time() - $interval) {
            return;
        }
        try {
            BlobStore::ensureDir($config->dataDir());
            $handle = @fopen($stamp, 'c');
            if ($handle === false || !flock($handle, LOCK_EX | LOCK_NB)) {
                return;
            }
            touch($stamp);
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();
            } elseif (function_exists('litespeed_finish_request')) {
                litespeed_finish_request();
            }
            (new Gc($context->db(), $context->store, $config))->run((float) max(1, $config->int('gc.budgetSeconds')));
            flock($handle, LOCK_UN);
            fclose($handle);
        } catch (\Throwable $error) {
            error_log('pisi-sync gc: ' . get_class($error));
        }
    }
}
