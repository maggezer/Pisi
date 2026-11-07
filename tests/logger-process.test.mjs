import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';

// Loads main/functions/logger.js with a stubbed `electron` and a temporary userData.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-logger-process-'));
const originalLoad = Module._load;
Module._load = function pisiLoggerTestElectronStub(request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: { isPackaged: true, getPath: () => userData, getVersion: () => '9.9.9' },
            ipcMain: { on() {} },
            BrowserWindow: class {},
            Menu: {},
            dialog: {},
            shell: {}
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const nativeError = console.error;
const nativeWarn = console.warn;
const before = { rejection: new Set(process.listeners('unhandledRejection')), exception: new Set(process.listeners('uncaughtException')) };
await import('../main/functions/logger.js');
// The test runner has its own process listeners; call only the ones logger.js added.
const onRejection = process.listeners('unhandledRejection').find((listener) => !before.rejection.has(listener));
const onException = process.listeners('uncaughtException').find((listener) => !before.exception.has(listener));
Module._load = originalLoad;

test.after(() => {
    console.error = nativeError;
    console.warn = nativeWarn;
    fs.rmSync(userData, { recursive: true, force: true });
});

function lines() {
    const dir = path.join(userData, 'logs');
    return fs
        .readdirSync(dir)
        .flatMap((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n'))
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

test('startup, uncaught exceptions and unhandled rejections are logged', () => {
    assert.ok(lines().some((line) => line.module === 'app' && line.message === 'Pisi 9.9.9 başladı'));
    assert.equal(typeof onRejection, 'function', 'an unhandledRejection handler is installed');
    assert.equal(typeof onException, 'function', 'an uncaughtException handler is installed');
    onRejection(new Error('red edildi'), Promise.resolve());
    onException(new Error('yakalanmadı'));
    const rejection = lines().find((line) => line.module === 'process' && line.message.includes('unhandledRejection'));
    assert.equal(rejection.level, 'error');
    assert.match(rejection.message, /red edildi/);
    assert.match(rejection.stack, /red edildi/);
    const fatal = lines().find((line) => line.module === 'process' && line.level === 'fatal');
    assert.match(fatal.message, /uncaughtException Error: yakalanmadı/);
});

test('console.warn / console.error go to the log, without object content', () => {
    assert.notEqual(console.error, nativeError, 'console.error is wrapped');
    console.error('[PISI] Kayıt başarısız:', { content: '<p>gizli not</p>', code: 'EACCES' }, new Error('izin yok'));
    console.warn('[Sync] uyarı', 42);
    const error = lines().find((line) => line.module === 'pisi' && line.message.startsWith('Kayıt başarısız'));
    assert.equal(error.level, 'error');
    assert.equal(error.message, 'Kayıt başarısız: code=EACCES Error: izin yok');
    assert.doesNotMatch(JSON.stringify(lines()), /gizli not/);
    assert.ok(lines().some((line) => line.level === 'warn' && line.module === 'sync' && line.message === 'uyarı 42'));
});
