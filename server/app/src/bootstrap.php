<?php

declare(strict_types=1);

// Framework ve Composer yok: PisiSync\Ad sınıfı src/Ad.php, PisiSync\Handlers\Ad
// sınıfı src/Handlers/Ad.php dosyasındadır.
spl_autoload_register(static function (string $class): void {
    $prefix = 'PisiSync\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    if (preg_match('/^[A-Za-z]+(?:\\\\[A-Za-z]+)?$/', $relative) !== 1) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
