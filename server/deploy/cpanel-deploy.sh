#!/bin/bash
# Pisi senkron sunucusunu repodan barındırmaya kopyalar (docs/sync-server-cpanel.md §4).
# cPanel Git Version Control kökteki .cpanel.yml ile bunu çalıştırır; elle de çalışır:
#   bash server/deploy/cpanel-deploy.sh
#
# Hedefler ~/.pisi-sync-deploy dosyasından okunur (repoya girmez; bash olarak okunur,
# bu yüzden $HOME kullanılabilir):
#   APP_DIR=$HOME/pisi-sync/app        public_html DIŞINDA
#   PUBLIC_DIR=$HOME/pisi-sync/public  alt alan adının belge kökü
#   PHP_BIN=/opt/alt/php84/usr/bin/php (isteğe bağlı; boşsa ea-php84, alt-php84, sonra `php` aranır)
#   RUN_MIGRATE=1                      (isteğe bağlı; 0 ise göç elle yapılır)
#
# app/config.php ve app/data/ hiç değiştirilmez. PHP, depo klasöründe değil APP_DIR'de
# çalıştırılır: barındırma PHP günlüğünü (error_log) çalışma klasörüne yazıyorsa depo
# kirlenmez ve cPanel sonraki dağıtımı reddetmez.

set -euo pipefail

CONF="${PISI_SYNC_DEPLOY_CONF:-$HOME/.pisi-sync-deploy}"
if [ ! -f "$CONF" ]; then
    echo "Dağıtım ayarı yok: $CONF (docs/sync-server-cpanel.md §4)." >&2
    exit 1
fi
APP_DIR=""
PUBLIC_DIR=""
PHP_BIN=""
RUN_MIGRATE="1"
# shellcheck source=/dev/null
. "$CONF"

valid_path() {
    [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "$1" != *..* ]]
}
if ! valid_path "$APP_DIR" || ! valid_path "$PUBLIC_DIR"; then
    echo "APP_DIR ve PUBLIC_DIR mutlak ve yalnız harf, rakam, . _ - / içeren yollar olmalı." >&2
    exit 1
fi
APP_DIR="${APP_DIR%/}"
PUBLIC_DIR="${PUBLIC_DIR%/}"
case "$APP_DIR/" in
    "$PUBLIC_DIR"/*)
        echo "APP_DIR web kökünün (PUBLIC_DIR) içinde olamaz." >&2
        exit 1
        ;;
esac
if [ -n "${HOME:-}" ]; then
    case "$APP_DIR/" in
        "$HOME/public_html/"*)
            echo "APP_DIR public_html içinde olamaz." >&2
            exit 1
            ;;
    esac
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
mkdir -p "$APP_DIR" "$PUBLIC_DIR"
chmod 700 "$APP_DIR"

# Göç gerekecekse PHP'yi kopyalamadan önce bul: bulunamazsa hiçbir şey değişmeden durulur.
MIGRATE_NOW=0
if [ "$RUN_MIGRATE" = "1" ] && [ -f "$APP_DIR/config.php" ]; then
    MIGRATE_NOW=1
    if [ -z "$PHP_BIN" ]; then
        for candidate in /opt/cpanel/ea-php84/root/usr/bin/php /opt/alt/php84/usr/bin/php; do
            if [ -x "$candidate" ]; then
                PHP_BIN="$candidate"
                break
            fi
        done
    fi
    if [ -z "$PHP_BIN" ]; then
        PHP_BIN="$(command -v php || true)"
    fi
    if [ -z "$PHP_BIN" ] || [ ! -x "$PHP_BIN" ]; then
        echo "PHP bulunamadı: '${PHP_BIN:-php}'. ~/.pisi-sync-deploy içindeki PHP_BIN'i düzeltin ya da RUN_MIGRATE=0 yapın (docs/sync-server-cpanel.md §3). Hiçbir dosya değiştirilmedi." >&2
        exit 1
    fi
fi

# Önce şema, sonra kod: yeni kod eski şemayı görürse 503 MAINTENANCE döner, bozulmaz.
for dir in schema bin src; do
    rm -rf "$APP_DIR/$dir.new" "$APP_DIR/$dir.old"
    cp -R "$SRC/app/$dir" "$APP_DIR/$dir.new"
    if [ -d "$APP_DIR/$dir" ]; then
        mv "$APP_DIR/$dir" "$APP_DIR/$dir.old"
    fi
    mv "$APP_DIR/$dir.new" "$APP_DIR/$dir"
    rm -rf "$APP_DIR/$dir.old"
done
cp "$SRC/app/config.sample.php" "$APP_DIR/config.sample.php"
cp "$SRC/app/.htaccess" "$APP_DIR/.htaccess"

umask 022
sed "s#^const PISI_SYNC_APP_DIR = .*;#const PISI_SYNC_APP_DIR = '$APP_DIR';#" "$SRC/public/index.php" > "$PUBLIC_DIR/index.php.new"
mv "$PUBLIC_DIR/index.php.new" "$PUBLIC_DIR/index.php"
cp "$SRC/public/.htaccess" "$PUBLIC_DIR/.htaccess"

if [ "$MIGRATE_NOW" = "1" ]; then
    (cd "$APP_DIR" && "$PHP_BIN" bin/migrate.php)
elif [ "$RUN_MIGRATE" = "1" ]; then
    echo "config.php henüz yok; göç atlandı (docs/sync-server-cpanel.md §5)."
fi
echo "Pisi senkron sunucusu dağıtıldı."
