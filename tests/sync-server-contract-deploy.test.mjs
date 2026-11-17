// Senkron sunucusunun barındırmaya dağıtımı (server/deploy/cpanel-deploy.sh, .cpanel.yml;
// docs/sync-server-cpanel.md §4): kurulum düzeni, app/'in web kökü dışında kalması, yeniden
// dağıtımda config.php ve data/'nın korunması ve dağıtılan kopyanın gerçekten çalışması.
// `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SYNC_TEST_PHP, startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { SYNC_SERVER_SKIP, call, createSpace } from './sync-server-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'server', 'deploy', 'cpanel-deploy.sh');
const skip = SYNC_SERVER_SKIP || (process.platform === 'win32' ? 'bash gerekir' : false);

function deploy(home, conf) {
    const confFile = path.join(home, '.pisi-sync-deploy');
    fs.writeFileSync(
        confFile,
        Object.entries(conf)
            .map(([key, value]) => `${key}=${value}\n`)
            .join('')
    );
    return spawnSync('bash', [script], { cwd: root, env: { ...process.env, HOME: home }, encoding: 'utf8' });
}

describe('senkron sunucusu: cPanel dağıtımı', { skip }, () => {
    const cleanup = [];
    after(async () => {
        for (const item of cleanup.reverse()) await item();
    });

    test('.cpanel.yml dağıtım betiğini çalıştırır', () => {
        const text = fs.readFileSync(path.join(root, '.cpanel.yml'), 'utf8');
        assert.match(text, /^deployment:\n\s+tasks:\n\s+- \/bin\/bash server\/deploy\/cpanel-deploy\.sh$/m);
    });

    test('ayar yoksa ya da app/ web kökünün içindeyse dağıtmaz', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-deploy-home-'));
        cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
        const missing = spawnSync('bash', [script], { cwd: root, env: { ...process.env, HOME: home }, encoding: 'utf8' });
        assert.notEqual(missing.status, 0);
        const inside = deploy(home, { APP_DIR: `${home}/site/app`, PUBLIC_DIR: `${home}/site` });
        assert.notEqual(inside.status, 0);
        assert.match(inside.stderr, /web kökünün/);
        const publicHtml = deploy(home, { APP_DIR: `${home}/public_html/app`, PUBLIC_DIR: `${home}/sync` });
        assert.notEqual(publicHtml.status, 0);
        const quoted = deploy(home, { APP_DIR: `"${home}/a b"`, PUBLIC_DIR: `${home}/sync` });
        assert.notEqual(quoted.status, 0);
        assert.equal(fs.existsSync(path.join(home, 'sync', 'index.php')), false);
    });

    test('dağıtılan kopya çalışır; yeniden dağıtım config.php ve data/ klasörünü korur', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-deploy-home-'));
        cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
        const appDir = path.join(home, 'pisi-sync', 'app');
        const publicDir = path.join(home, 'sync.ornek.test');
        const first = deploy(home, { APP_DIR: appDir, PUBLIC_DIR: publicDir, PHP_BIN: SYNC_TEST_PHP, RUN_MIGRATE: 1 });
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stdout, /config\.php henüz yok/);

        assert.deepEqual(fs.readdirSync(publicDir).sort(), ['.htaccess', 'index.php']);
        assert.match(
            fs.readFileSync(path.join(publicDir, 'index.php'), 'utf8'),
            new RegExp(`^const PISI_SYNC_APP_DIR = '${appDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';$`, 'm')
        );
        assert.deepEqual(fs.readdirSync(appDir).sort(), ['.htaccess', 'bin', 'config.sample.php', 'schema', 'src']);
        assert.equal(fs.statSync(appDir).mode & 0o777, 0o700);

        // Kullanıcının dosyaları: config.php ve data/ (blob'lar) dağıtımda değişmez.
        fs.writeFileSync(path.join(appDir, 'config.php'), "<?php return ['locale' => 'en'];\n");
        fs.mkdirSync(path.join(appDir, 'data', 'blobs'), { recursive: true });
        fs.writeFileSync(path.join(appDir, 'data', 'blobs', 'keep'), 'veri');
        fs.writeFileSync(path.join(appDir, 'src', 'Eski.php'), '<?php // eski sürümden kalan');
        const again = deploy(home, { APP_DIR: appDir, PUBLIC_DIR: publicDir, PHP_BIN: SYNC_TEST_PHP, RUN_MIGRATE: 0 });
        assert.equal(again.status, 0, again.stderr);
        assert.equal(fs.readFileSync(path.join(appDir, 'config.php'), 'utf8'), "<?php return ['locale' => 'en'];\n");
        assert.equal(fs.readFileSync(path.join(appDir, 'data', 'blobs', 'keep'), 'utf8'), 'veri');
        assert.equal(fs.existsSync(path.join(appDir, 'src', 'Eski.php')), false, 'kod klasörü bütünüyle yenilenir');
        assert.deepEqual(
            fs.readdirSync(appDir).filter((name) => /\.(new|old)$/.test(name)),
            []
        );

        // Dağıtılmış web kökü test ayarlarıyla gerçekten yanıt verir.
        const server = await startSyncTestServer({ publicDir });
        cleanup.push(() => server.stop());
        assert.equal((await call(server, 'GET', '/v1/info', { protocol: null })).json.service, 'pisi-sync');
        const space = await createSpace(server);
        assert.equal((await call(server, 'GET', `/v1/spaces/${space.spaceId}/head`, { token: space.token })).status, 200);
    });

    test('ayar dosyası $HOME kullanabilir; göç app/ klasöründe çalışır, depo klasöründe değil', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-deploy-home-'));
        cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
        // Barındırmanın PHP'si gibi çalışma klasörüne günlük bırakan sahte bir PHP.
        const fakePhp = path.join(home, 'fake-php');
        fs.writeFileSync(fakePhp, '#!/bin/bash\npwd > "$HOME/php-cwd"\necho "$@" > "$HOME/php-args"\necho "PHP Deprecated: test" >> error_log\n', {
            mode: 0o755
        });
        const appDir = path.join(home, 'pisi-sync', 'app');
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, 'config.php'), '<?php return [];\n');

        const result = deploy(home, { APP_DIR: '$HOME/pisi-sync/app', PUBLIC_DIR: '$HOME/pisi-sync/public', PHP_BIN: fakePhp, RUN_MIGRATE: 1 });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(fs.existsSync(path.join(home, 'pisi-sync', 'public', 'index.php')), '$HOME genişletildi');
        assert.equal(fs.readFileSync(path.join(home, 'php-cwd'), 'utf8').trim(), fs.realpathSync(appDir));
        assert.equal(fs.readFileSync(path.join(home, 'php-args'), 'utf8').trim(), 'bin/migrate.php');
        assert.ok(fs.existsSync(path.join(appDir, 'error_log')), 'PHP günlüğü app/ klasörüne düştü');
        assert.equal(fs.existsSync(path.join(root, 'error_log')), false, 'depo klasörü kirlenmedi');
        // Depoda yine de bir error_log oluşursa git onu görmez; cPanel dağıtımı kilitlenmez.
        for (const file of ['error_log', 'server/error_log']) assert.equal(spawnSync('git', ['check-ignore', '-q', file], { cwd: root }).status, 0, file);
    });

    test('göç gerekiyor ama PHP bulunamıyorsa hiçbir dosyaya dokunmadan anlaşılır hata verir', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-deploy-home-'));
        cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
        const appDir = path.join(home, 'pisi-sync', 'app');
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, 'config.php'), '<?php return [];\n');
        const result = deploy(home, { APP_DIR: appDir, PUBLIC_DIR: path.join(home, 'pisi-sync', 'public'), PHP_BIN: '/opt/yok/php84/bin/php', RUN_MIGRATE: 1 });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /PHP bulunamadı: '\/opt\/yok\/php84\/bin\/php'.*PHP_BIN.*RUN_MIGRATE=0/);
        assert.deepEqual(fs.readdirSync(appDir), ['config.php'], 'hiçbir dosya kopyalanmadı');
        assert.equal(fs.existsSync(path.join(home, 'pisi-sync', 'public', 'index.php')), false);

        const skipped = deploy(home, {
            APP_DIR: appDir,
            PUBLIC_DIR: path.join(home, 'pisi-sync', 'public'),
            PHP_BIN: '/opt/yok/php84/bin/php',
            RUN_MIGRATE: 0
        });
        assert.equal(skipped.status, 0, 'RUN_MIGRATE=0 iken PHP aranmaz');
    });
});
