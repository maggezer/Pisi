#!/usr/bin/env node
// Senkron sunucusunu (server/) testler için kurar ve kaldırır (docs/sync-plan.md S2 adım 6).
// Her sunucu kendi MariaDB veritabanını (pisi_sync_t_…), veri klasörünü ve `php -S`
// sürecini alır. S3–S7 testleri de bunu kullanır.
//
//   import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
//   const server = await startSyncTestServer({ config: { limits: { maxSpaces: 2 } } });
//   … server.baseUrl, server.setupKey, server.sql(), server.dump(), server.runBin('gc.php') …
//   await server.stop();
//
// Elle denemek için: node scripts/start-sync-test-server.mjs (Ctrl+C ile kapanır).
//
// Ortam değişkenleri: PISI_SYNC_TEST_DB_HOST (127.0.0.1), PISI_SYNC_TEST_DB_PORT (3306),
// PISI_SYNC_TEST_DB_USER (root), PISI_SYNC_TEST_DB_PASSWORD (boş), PISI_SYNC_TEST_PHP (php).
// Sunucu düz HTTP konuşur; istemci `X-Forwarded-Proto: https` gönderir ve test ayarı bu
// başlığa güvenir (https.trustForwardedProto). Gerçek kurulumda bu ayar kapalıdır.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const dbTool = path.join(serverDir, 'tests', 'db-tool.php');

export const SYNC_TEST_PHP = process.env.PISI_SYNC_TEST_PHP || 'php';

function dbEnv() {
    return {
        host: process.env.PISI_SYNC_TEST_DB_HOST || '127.0.0.1',
        port: process.env.PISI_SYNC_TEST_DB_PORT || '3306',
        user: process.env.PISI_SYNC_TEST_DB_USER || 'root',
        password: process.env.PISI_SYNC_TEST_DB_PASSWORD || ''
    };
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        result[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
    }
    return result;
}

function runPhp(args, { env = {}, input = undefined } = {}) {
    const result = spawnSync(SYNC_TEST_PHP, args, { cwd: root, env: { ...process.env, ...env }, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (result.error) throw result.error;
    return result;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
        });
    });
}

async function waitForServer(baseUrl, child, logFile) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) break;
        try {
            const response = await fetch(`${baseUrl}/v1/info`, { headers: { 'X-Forwarded-Proto': 'https' } });
            await response.arrayBuffer();
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-2000) : '';
    throw new Error(`Senkron test sunucusu açılmadı.\n${log}`);
}

/**
 * Starts a sync server. Options:
 * - `config`: overrides merged over the test defaults (see server/app/config.sample.php).
 * - `migrate` (true): run bin/migrate.php before starting; false leaves the schema empty (MAINTENANCE).
 * - `database` (true): create a database; false keeps `config.database` as given (DB_UNAVAILABLE tests).
 * - `ini`: php.ini overrides for `php -S` (defaults: post_max_size=8M, upload_max_filesize=8M).
 * - `workers` (4): PHP_CLI_SERVER_WORKERS, so concurrent requests run in parallel.
 * - `publicDir` (server/public): web root whose index.php is served (deployment tests).
 */
export async function startSyncTestServer(options = {}) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-server-'));
    const dataDir = path.join(workDir, 'data');
    const configPath = path.join(workDir, 'config.php');
    const db = dbEnv();
    const dbName = `pisi_sync_t_${crypto.randomBytes(6).toString('hex')}`;
    const useDatabase = options.database !== false;
    const setupKey = `psk_${crypto.randomBytes(32).toString('base64url')}`;
    const env = {
        PISI_SYNC_CONFIG: configPath,
        PISI_SYNC_TEST_DB_HOST: db.host,
        PISI_SYNC_TEST_DB_PORT: db.port,
        PISI_SYNC_TEST_DB_USER: db.user,
        PISI_SYNC_TEST_DB_PASSWORD: db.password
    };

    const hashed = runPhp([path.join(serverDir, 'app', 'bin', 'setup-key.php'), '--hash'], { input: setupKey });
    if (hashed.status !== 0) throw new Error(`Kurulum anahtarı özeti alınamadı: ${hashed.stderr}`);

    const defaults = {
        database: { dsn: `mysql:host=${db.host};port=${db.port};dbname=${dbName};charset=utf8mb4`, user: db.user, password: db.password },
        dataDir,
        setupKeyHash: hashed.stdout.trim(),
        https: { require: true, trustForwardedProto: true },
        gc: { opportunistic: false },
        rateLimits: { spaceCreatePerHour: 100000, setupKeyLockSeconds: 0, pairingPerHour: 100000, invalidTokenPerMinute: 100000, devicePerMinute: 100000 },
        testing: { faultInjection: false }
    };
    const config = merge(defaults, options.config);
    fs.writeFileSync(path.join(workDir, 'config.json'), JSON.stringify(config));
    fs.writeFileSync(
        configPath,
        "<?php\n\ndeclare(strict_types=1);\n\nreturn json_decode((string) file_get_contents(__DIR__ . '/config.json'), true, 32, JSON_THROW_ON_ERROR);\n"
    );

    let created = false;
    const cleanup = () => {
        if (created) runPhp([dbTool, 'drop', dbName], { env });
        fs.rmSync(workDir, { recursive: true, force: true });
    };
    try {
        if (useDatabase) {
            const result = runPhp([dbTool, 'create', dbName], { env });
            if (result.status !== 0) throw new Error(`Test veritabanı açılamadı (PISI_SYNC_TEST_DB_* ayarlarını denetleyin): ${result.stderr}`);
            created = true;
        }
        if (useDatabase && options.migrate !== false) {
            const result = runPhp([path.join(serverDir, 'app', 'bin', 'migrate.php')], { env });
            if (result.status !== 0) throw new Error(`Göç başarısız: ${result.stderr}`);
        }
    } catch (error) {
        cleanup();
        throw error;
    }

    const port = await freePort();
    const ini = {
        post_max_size: '8M',
        upload_max_filesize: '8M',
        memory_limit: '256M',
        display_errors: '0',
        log_errors: '1',
        error_log: path.join(workDir, 'php-error.log'),
        ...options.ini
    };
    const args = [
        ...Object.entries(ini).flatMap(([key, value]) => ['-d', `${key}=${value}`]),
        '-S',
        `127.0.0.1:${port}`,
        path.join(options.publicDir || path.join(serverDir, 'public'), 'index.php')
    ];
    const logFile = path.join(workDir, 'php-server.log');
    const log = fs.openSync(logFile, 'a');
    const child = spawn(SYNC_TEST_PHP, args, {
        cwd: workDir,
        env: { ...process.env, ...env, PHP_CLI_SERVER_WORKERS: String(options.workers ?? 4) },
        stdio: ['ignore', log, log]
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await waitForServer(baseUrl, child, logFile);
    } catch (error) {
        child.kill('SIGKILL');
        cleanup();
        throw error;
    }

    let stopped = false;
    return {
        baseUrl,
        port,
        workDir,
        dataDir,
        dbName,
        setupKey,
        config,
        /** Runs a server/app/bin script with this server's config. */
        runBin(name, args = [], input = undefined) {
            return runPhp([path.join(serverDir, 'app', 'bin', name), ...args], { env, input });
        },
        /** Runs one SQL statement on this server's database: `{ rows, affected }`. */
        sql(statement, params = []) {
            const result = runPhp([dbTool, 'exec'], { env, input: JSON.stringify({ sql: statement, params }) });
            if (result.status !== 0) throw new Error(`SQL çalışmadı: ${result.stderr || result.stdout}`);
            return JSON.parse(result.stdout);
        },
        /** Every table of this server's database; binary columns as `{ hex }`. */
        dump() {
            const result = runPhp([dbTool, 'dump'], { env });
            if (result.status !== 0) throw new Error(`Döküm alınamadı: ${result.stderr || result.stdout}`);
            return JSON.parse(result.stdout);
        },
        phpErrorLog() {
            const file = path.join(workDir, 'php-error.log');
            return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        },
        async stop() {
            if (stopped) return;
            stopped = true;
            await new Promise((resolve) => {
                if (child.exitCode !== null) return resolve();
                child.once('exit', resolve);
                child.kill('SIGTERM');
                setTimeout(() => child.kill('SIGKILL'), 3000).unref();
            });
            fs.closeSync(log);
            cleanup();
        }
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = await startSyncTestServer();
    console.log(`Pisi senkron test sunucusu: ${server.baseUrl} (istemci X-Forwarded-Proto: https göndermeli)`);
    console.log(`Test kurulum anahtarı (yalnız bu geçici sunucu için): ${server.setupKey}`);
    console.log('Kapatmak için Ctrl+C.');
    const stop = async () => {
        await server.stop();
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
