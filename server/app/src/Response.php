<?php

declare(strict_types=1);

namespace PisiSync;

/** JSON yanıtı, boş yanıt ya da akış (blob indirme). */
final class Response
{
    /** @var (callable(): void)|null */
    private $stream = null;

    /** @param array<string, string> $headers */
    private function __construct(public readonly int $status, private readonly ?string $body, public array $headers = [])
    {
    }

    public static function json(int $status, array|\stdClass $data, array $headers = []): self
    {
        $body = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        return new self($status, $body, ['Content-Type' => 'application/json; charset=utf-8'] + $headers);
    }

    public static function empty(int $status = 204, array $headers = []): self
    {
        return new self($status, null, $headers);
    }

    /** @param callable(): void $writer */
    public static function stream(int $status, array $headers, callable $writer): self
    {
        $response = new self($status, null, $headers);
        $response->stream = $writer;
        return $response;
    }

    public static function error(ApiError $error, string $locale): self
    {
        $described = Errors::describe($error, $locale);
        return self::json($described['status'], $described['body'], $error->headers);
    }

    public function send(): void
    {
        if (!headers_sent()) {
            http_response_code($this->status);
            header_remove('X-Powered-By');
            foreach ($this->headers as $name => $value) {
                header($name . ': ' . $value);
            }
            if ($this->body !== null) {
                header('Content-Length: ' . strlen($this->body));
            }
        }
        if ($this->stream !== null) {
            ($this->stream)();
        } elseif ($this->body !== null) {
            echo $this->body;
        }
    }
}
