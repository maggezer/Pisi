<?php

declare(strict_types=1);

namespace PisiSync;

/** Gelen HTTP isteği: yöntem, ön denetleyiciye göre yol, başlıklar ve gövde. */
final class Request
{
    /** @var array<string, string> */
    public array $params = [];

    /** @param array<string, string> $headers küçük harfli adlar */
    private function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        private readonly array $headers,
        public readonly bool $https,
        public readonly string $clientIp
    ) {
    }

    public static function fromGlobals(Config $config): self
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (!is_string($value)) {
                continue;
            }
            if (str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
            }
        }
        foreach (['CONTENT_TYPE' => 'content-type', 'CONTENT_LENGTH' => 'content-length'] as $key => $name) {
            if (isset($_SERVER[$key]) && is_string($_SERVER[$key]) && $_SERVER[$key] !== '') {
                $headers[$name] = $_SERVER[$key];
            }
        }
        if (!isset($headers['authorization']) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) && is_string($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $headers['authorization'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
        if (!isset($headers['authorization']) && function_exists('apache_request_headers')) {
            foreach ((array) apache_request_headers() as $name => $value) {
                if (is_string($name) && strtolower($name) === 'authorization' && is_string($value)) {
                    $headers['authorization'] = $value;
                }
            }
        }

        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $rawPath = explode('?', $uri, 2)[0];
        // Yol çözülmeden (percent-decode yapılmadan) eşlenir: kimlikler base64url'dir.
        $path = self::stripBase($rawPath, (string) ($_SERVER['SCRIPT_NAME'] ?? ''));
        parse_str((string) ($_SERVER['QUERY_STRING'] ?? ''), $query);

        $https = false;
        $flag = $_SERVER['HTTPS'] ?? '';
        if (is_string($flag) && $flag !== '' && strtolower($flag) !== 'off') {
            $https = true;
        }
        if (($_SERVER['REQUEST_SCHEME'] ?? '') === 'https') {
            $https = true;
        }
        if ($config->get('https.trustForwardedProto') === true && strtolower($headers['x-forwarded-proto'] ?? '') === 'https') {
            $https = true;
        }

        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        $ipHeader = $config->get('clientIpHeader');
        if (is_string($ipHeader) && $ipHeader !== '' && isset($_SERVER[$ipHeader]) && is_string($_SERVER[$ipHeader])) {
            $candidate = trim(explode(',', $_SERVER[$ipHeader])[0]);
            if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
                $ip = $candidate;
            }
        }

        return new self($method, $path, $query, $headers, $https, $ip);
    }

    /** /pisi/index.php altında kuruluysa /pisi/v1/info → /v1/info. */
    private static function stripBase(string $path, string $scriptName): string
    {
        // Yalnız ön denetleyici index.php olarak çalışıyorsa (Apache) kök öneki atılır;
        // php -S yönlendiricisinde SCRIPT_NAME istek yoludur.
        $base = str_ends_with($scriptName, '/index.php') ? rtrim(str_replace('\\', '/', dirname($scriptName)), '/.') : '';
        if ($base !== '' && str_starts_with($path, $base . '/')) {
            $path = substr($path, strlen($base));
        }
        if (str_starts_with($path, '/index.php/')) {
            $path = substr($path, strlen('/index.php'));
        }
        return $path === '' ? '/' : $path;
    }

    public function header(string $name): ?string
    {
        $value = $this->headers[strtolower($name)] ?? null;
        return $value === null ? null : trim($value);
    }

    public function contentLength(): ?int
    {
        $value = $this->header('content-length');
        if ($value === null || preg_match('/^\d{1,15}$/', $value) !== 1) {
            return null;
        }
        return (int) $value;
    }

    public function mediaType(): string
    {
        return strtolower(trim(explode(';', $this->header('content-type') ?? '', 2)[0]));
    }

    /** Cihaz token'ı: Authorization: Bearer ya da X-Pisi-Token (protokol §2). */
    public function token(): ?string
    {
        $bearer = null;
        $authorization = $this->header('authorization');
        if ($authorization !== null && $authorization !== '') {
            if (preg_match('/^Bearer\s+(\S+)$/i', $authorization, $match) !== 1) {
                throw new ApiError('TOKEN_INVALID');
            }
            $bearer = $match[1];
        }
        $alternate = $this->header('x-pisi-token');
        if ($alternate === '') {
            $alternate = null;
        }
        if ($bearer !== null && $alternate !== null && !hash_equals($bearer, $alternate)) {
            throw new ApiError('TOKEN_INVALID');
        }
        return $bearer ?? $alternate;
    }

    /**
     * JSON gövdesini nesne olarak okur. Boş gövde `$allowEmpty` ise [] döner.
     *
     * @return array<string, mixed>
     */
    public function json(int $maxBytes, bool $allowEmpty = false): array
    {
        $length = $this->contentLength();
        if ($length !== null && $length > $maxBytes) {
            throw new ApiError('PAYLOAD_TOO_LARGE', ['limit' => $maxBytes]);
        }
        $raw = (string) file_get_contents('php://input', false, null, 0, $maxBytes + 1);
        if (strlen($raw) > $maxBytes) {
            throw new ApiError('PAYLOAD_TOO_LARGE', ['limit' => $maxBytes]);
        }
        if ($raw === '' && $allowEmpty) {
            return [];
        }
        if ($this->mediaType() !== 'application/json') {
            throw new ApiError('UNSUPPORTED_MEDIA_TYPE', ['expected' => 'application/json']);
        }
        try {
            $value = json_decode($raw, true, 32, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        } catch (\JsonException) {
            throw new ApiError('INVALID_JSON');
        }
        if (!is_array($value) || (array_is_list($value) && $value !== [])) {
            throw new ApiError('INVALID_JSON');
        }
        return $value;
    }

    public function param(string $name): string
    {
        return $this->params[$name] ?? '';
    }

    public function queryString(string $name): ?string
    {
        $value = $this->query[$name] ?? null;
        if ($value === null) {
            return null;
        }
        if (!is_string($value)) {
            throw new ApiError('BAD_REQUEST', ['query' => $name]);
        }
        return $value;
    }
}
