#!/usr/bin/env node
// npm run test:sync-server (docs/sync-plan.md S2, §3.10):
//   1. server/ altındaki her PHP dosyası `php -l` ile denetlenir.
//   2. tests/sync-server-contract*.test.mjs, PHP 8.4 + MariaDB 10.11 üzerinde çalışır
//      (her dosya scripts/start-sync-test-server.mjs ile kendi sunucusunu kurar).
//   3. Protokoldeki her uç nokta (§6) ve her sunucu hata kodu (§9.2) en az bir testte
//      görülmüş olmalıdır; eksik kalan varsa komut başarısız olur.
//   4. PISI_SYNC_ELECTRON_E2E=1 ise masaüstü senaryoları gerçek Electron ile çalışır
//      (scripts/electron-sync-client-e2e.mjs, S3; Electron ikilisi ve Linux'ta xvfb-run gerekir).
//   5. PISI_SYNC_MATRIX_E2E=1 ise iki cihazlı senaryo matrisi çalışır (scripts/sync-e2e-matrix.mjs, S7;
//      ayrıca mobil paket ve Playwright Chromium gerekir: npm --prefix mobile ci).
// Kök `npm test` bu dosyaları atlar (PISI_SYNC_SERVER_TESTS yok).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProtocolEndpoints, readProtocolErrorCodes } from '../tests/sync-server-client.mjs';
import { SYNC_TEST_PHP } from './start-sync-test-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function phpFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'data' ? [] : phpFiles(full);
        return entry.name.endsWith('.php') ? [full] : [];
    });
}

const version = spawnSync(SYNC_TEST_PHP, ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' });
if (version.status !== 0) {
    console.error(`PHP çalıştırılamadı (${SYNC_TEST_PHP}). PISI_SYNC_TEST_PHP ile yolu verin.`);
    process.exit(1);
}
console.log(`PHP ${version.stdout.trim()}`);

let lintFailed = false;
const files = phpFiles(path.join(root, 'server')).sort();
for (const file of files) {
    const result = spawnSync(SYNC_TEST_PHP, ['-l', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        lintFailed = true;
        process.stderr.write(result.stdout + result.stderr);
    }
}
if (lintFailed) process.exit(1);
console.log(`${files.length} PHP dosyası php -l denetiminden geçti.`);

const coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-coverage-'));
const tests = fs
    .readdirSync(path.join(root, 'tests'))
    .filter((name) => /^sync-server-contract.*\.test\.mjs$/.test(name))
    .sort()
    .map((name) => path.join('tests', name));
const extra = process.argv.slice(2);
const run = spawnSync(process.execPath, ['--test', ...extra, ...tests], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PISI_SYNC_SERVER_TESTS: '1', PISI_SYNC_COVERAGE_DIR: coverageDir }
});
if (run.status !== 0) {
    fs.rmSync(coverageDir, { recursive: true, force: true });
    process.exit(run.status || 1);
}

const seenEndpoints = new Set();
const seenCodes = new Set();
for (const name of fs.readdirSync(coverageDir)) {
    const data = JSON.parse(fs.readFileSync(path.join(coverageDir, name), 'utf8'));
    data.endpoints.forEach((key) => seenEndpoints.add(key));
    data.codes.forEach((code) => seenCodes.add(code));
}
fs.rmSync(coverageDir, { recursive: true, force: true });

// Bir test dosyası süzgeçle (--test-name-pattern) çalıştırıldıysa kapsam denetimi anlamsızdır.
if (extra.some((arg) => arg.startsWith('--test-name-pattern') || arg.startsWith('--test-skip-pattern'))) {
    console.log('Süzgeçli çalıştırma: kapsam denetimi atlandı.');
    process.exit(0);
}

const missingEndpoints = readProtocolEndpoints()
    .map((entry) => `${entry.method} ${entry.template}`)
    .filter((key) => !seenEndpoints.has(key));
const missingCodes = readProtocolErrorCodes()
    .map((entry) => entry.code)
    .filter((code) => !seenCodes.has(code));
if (missingEndpoints.length || missingCodes.length) {
    if (missingEndpoints.length) console.error(`Testi olmayan uç noktalar (protokol §6):\n  ${missingEndpoints.join('\n  ')}`);
    if (missingCodes.length) console.error(`Testi olmayan hata kodları (protokol §9.2):\n  ${missingCodes.join('\n  ')}`);
    process.exit(1);
}
console.log(`Kapsam: protokoldeki ${readProtocolEndpoints().length} uç noktanın ve ${readProtocolErrorCodes().length} hata kodunun hepsi sınandı.`);

if (process.env.PISI_SYNC_ELECTRON_E2E === '1') {
    const e2e = spawnSync(process.execPath, [path.join('scripts', 'electron-sync-client-e2e.mjs')], { cwd: root, stdio: 'inherit', env: process.env });
    if (e2e.status !== 0) process.exit(e2e.status || 1);
}

if (process.env.PISI_SYNC_MATRIX_E2E === '1') {
    const matrix = spawnSync(process.execPath, [path.join('scripts', 'sync-e2e-matrix.mjs')], { cwd: root, stdio: 'inherit', env: process.env });
    if (matrix.status !== 0) process.exit(matrix.status || 1);
}
