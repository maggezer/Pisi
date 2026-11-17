<?php

declare(strict_types=1);

// Pisi senkron sunucusu: web köküne konan tek PHP dosyası (docs/sync-plan.md §3.9).
// Uygulama kodu, ayarlar ve veri public_html DIŞINDADIR. app/ başka bir yerdeyse
// yalnız aşağıdaki satırı değiştirin (docs/sync-server-cpanel.md).
const PISI_SYNC_APP_DIR = __DIR__ . '/../app';

require PISI_SYNC_APP_DIR . '/src/bootstrap.php';

\PisiSync\App::handleHttpRequest(PISI_SYNC_APP_DIR);
