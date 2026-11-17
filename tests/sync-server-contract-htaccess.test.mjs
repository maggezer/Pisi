// server/public/.htaccess gerçek bir Apache 2.4 altında (docs/sync-server-cpanel.md §9):
// sertifika doğrulama dosyaları (Let's Encrypt acme-challenge, cPanel pki-validation) olduğu
// gibi sunulur; geri kalan her yol ön denetleyiciye (index.php) gider; .htaccess okunamaz;
// dosya Apache'de hata vermez. Alt klasör kurulumunda da aynı. PHP gerekmez: PHP işleyicisi
// olmadığı için yönlendirilen istek index.php'nin kaynağını döner, test bunu işaret sayar.
// `npm run test:sync-server` çalıştırır; CI'da Apache zorunludur.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SYNC_SERVER_SKIP } from './sync-server-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apache = process.env.PISI_SYNC_TEST_APACHE || '/usr/sbin/apache2';
const modules = process.env.PISI_SYNC_TEST_APACHE_MODULES || '/usr/lib/apache2/modules';
const apacheMissing = !fs.existsSync(apache) && !process.env.CI ? `Apache yok (${apache}); PISI_SYNC_TEST_APACHE ile yolu verin` : false;
const FRONT_CONTROLLER = 'PISI_SYNC_APP_DIR';

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
        });
    });
}

function writeTree(base, files) {
    for (const [relative, content] of Object.entries(files)) {
        const file = path.join(base, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
        fs.writeFileSync(file, content, { mode: 0o644 });
    }
}

describe('senkron sunucusu: .htaccess (Apache)', { skip: SYNC_SERVER_SKIP || apacheMissing }, () => {
    let work;
    let child;
    let baseUrl;

    before(async () => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-htaccess-'));
        fs.chmodSync(work, 0o755);
        const docRoot = path.join(work, 'public');
        const site = {
            'index.php': fs.readFileSync(path.join(root, 'server', 'public', 'index.php'), 'utf8'),
            '.htaccess': fs.readFileSync(path.join(root, 'server', 'public', '.htaccess'), 'utf8'),
            '.well-known/acme-challenge/token-abc': 'acme-yanit',
            '.well-known/pki-validation/ABC123.txt': 'cpanel-dcv',
            '.well-known/baska/gizli.txt': 'sunulmamali'
        };
        writeTree(docRoot, site);
        // Alt klasör kurulumu: ornek.com/pisi (rehber §2).
        writeTree(path.join(docRoot, 'pisi'), site);

        const port = await freePort();
        baseUrl = `http://127.0.0.1:${port}`;
        const runAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
        const conf = [
            `Listen 127.0.0.1:${port}`,
            'ServerName 127.0.0.1',
            `PidFile ${work}/httpd.pid`,
            `DefaultRuntimeDir ${work}`,
            `ErrorLog ${work}/error.log`,
            'LogLevel warn',
            ...['mpm_event', 'authz_core', 'rewrite', 'dir', 'mime'].map((name) => `LoadModule ${name}_module ${modules}/mod_${name}.so`),
            'TypesConfig /etc/mime.types',
            ...(runAsRoot ? ['User nobody', 'Group nogroup'] : []),
            `DocumentRoot "${docRoot}"`,
            `<Directory "${docRoot}">`,
            '    AllowOverride All',
            '    Require all granted',
            '</Directory>'
        ];
        fs.writeFileSync(path.join(work, 'httpd.conf'), conf.join('\n') + '\n');
        child = spawn(apache, ['-f', path.join(work, 'httpd.conf'), '-DFOREGROUND'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => (output += chunk));
        child.stderr.on('data', (chunk) => (output += chunk));
        const deadline = Date.now() + 10000;
        for (;;) {
            try {
                await (await fetch(`${baseUrl}/index.php`)).arrayBuffer();
                return;
            } catch {
                if (child.exitCode !== null || Date.now() > deadline) {
                    const log = fs.existsSync(path.join(work, 'error.log')) ? fs.readFileSync(path.join(work, 'error.log'), 'utf8') : '';
                    throw new Error(`Apache açılmadı:\n${output}\n${log}`);
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    });

    after(async () => {
        if (child && child.exitCode === null) {
            await new Promise((resolve) => {
                child.once('exit', resolve);
                child.kill('SIGTERM');
                setTimeout(() => child.kill('SIGKILL'), 5000).unref();
            });
        }
        if (work) fs.rmSync(work, { recursive: true, force: true });
    });

    async function get(pathname) {
        const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' });
        return { status: response.status, text: await response.text() };
    }

    for (const prefix of ['', '/pisi']) {
        const where = prefix ? 'alt klasörde' : 'belge kökünde';

        test(`${where}: sertifika doğrulama dosyaları olduğu gibi sunulur`, async () => {
            assert.deepEqual(await get(`${prefix}/.well-known/acme-challenge/token-abc`), { status: 200, text: 'acme-yanit' });
            assert.deepEqual(await get(`${prefix}/.well-known/pki-validation/ABC123.txt`), { status: 200, text: 'cpanel-dcv' });
        });

        test(`${where}: geri kalan her yol ön denetleyiciye gider`, async () => {
            for (const pathname of ['/v1/info', '/v1/spaces/sp_x/head', '/config.php', '/app/config.php', '/.well-known/baska/gizli.txt', '/index.php']) {
                const response = await get(`${prefix}${pathname}`);
                assert.equal(response.status, 200, pathname);
                assert.ok(response.text.includes(FRONT_CONTROLLER), `${pathname} index.php'ye gitmedi`);
                assert.ok(!response.text.includes('sunulmamali'), pathname);
            }
        });

        test(`${where}: .htaccess okunamaz`, async () => {
            const response = await get(`${prefix}/.htaccess`);
            assert.equal(response.status, 403);
            assert.ok(!response.text.includes('RewriteEngine'), '.htaccess içeriği sunuldu');
        });
    }

    test('Apache .htaccess için yapılandırma hatası yazmadı', () => {
        const log = fs.existsSync(path.join(work, 'error.log')) ? fs.readFileSync(path.join(work, 'error.log'), 'utf8') : '';
        // "client denied … .htaccess" beklenir (FilesMatch); yapılandırma hatası beklenmez.
        assert.doesNotMatch(log, /Invalid command|not allowed here|RewriteRule:|RewriteCond:|\[core:alert\]/);
    });
});
