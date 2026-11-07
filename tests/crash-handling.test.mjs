import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createPisiLogger } from '../main/functions/logger-core.js';

// main/electron-bridge.js loads `electron` with require(); stub it before the import.
const originalLoad = Module._load;
Module._load = function pisiCrashTestElectronStub(request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: { isPackaged: true, getPath: () => os.tmpdir(), isReady: () => true, getName: () => 'Pisi', getVersion: () => '0.0.0' },
            dialog: {},
            shell: {},
            BrowserWindow: class {},
            Menu: {},
            ipcMain: { on() {}, handle() {} }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { attachPisiCrashHandling, handlePisiFatalError } = await import('../main/functions/crash-handling.js');
Module._load = originalLoad;

function setup(t, responses = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-crash-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const logger = createPisiLogger({ directory: () => dir });
    const window = new EventEmitter();
    window.webContents = new EventEmitter();
    window.webContents.reloads = 0;
    window.webContents.reload = () => (window.webContents.reloads += 1);
    window.destroyed = false;
    window.isDestroyed = () => window.destroyed;
    window.closed = 0;
    window.close = () => (window.closed += 1);
    const shown = [];
    const deps = {
        app: {
            isReady: () => true,
            relaunches: 0,
            exits: [],
            relaunch() {
                this.relaunches += 1;
            },
            exit(code) {
                this.exits.push(code);
            },
            getPath: () => dir
        },
        dialog: {
            // Electron accepts (window, options) or (options).
            showMessageBox: async (first, second) => {
                const box = second || first;
                shown.push(box);
                if (box.signal) await new Promise((resolve) => setTimeout(resolve, 20));
                return { response: responses.length ? responses.shift() : 0 };
            }
        },
        shell: {},
        log: (level, module, message, error, context) => logger.write({ level, module, message, error, context }),
        translate: (text) => text,
        capture: false
    };
    const lines = () =>
        fs
            .readdirSync(dir)
            .filter((name) => name.endsWith('.log'))
            .flatMap((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n'))
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    const flush = () => new Promise((resolve) => setTimeout(resolve, 60));
    return { window, deps, shown, lines, flush };
}

test('render-process-gone is handled: logged, the user is asked, Reload reloads the window', async (t) => {
    const h = setup(t, [0]);
    assert.equal(attachPisiCrashHandling(h.window, h.deps), true);
    assert.equal(h.window.webContents.listenerCount('render-process-gone'), 1, 'the handler is installed');
    assert.equal(h.window.listenerCount('unresponsive'), 1);
    assert.equal(h.window.listenerCount('responsive'), 1);

    h.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });
    await h.flush();
    const crash = h.lines().find((line) => line.module === 'window' && line.level === 'fatal');
    assert.ok(crash, 'the crash is logged');
    assert.deepEqual(crash.context, { reason: 'crashed', exitCode: 133 });
    assert.equal(h.shown[0].message, 'Pencere beklenmedik şekilde kapandı.');
    assert.deepEqual(h.shown[0].buttons, ['Yeniden yükle', 'Kapat']);
    assert.equal(h.window.webContents.reloads, 1);
    assert.ok(h.lines().some((line) => line.message.includes('yeniden yüklendi')));
});

test('render-process-gone: Close closes the window; a clean exit asks nothing', async (t) => {
    const h = setup(t, [1]);
    attachPisiCrashHandling(h.window, h.deps);
    h.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 0 });
    await h.flush();
    assert.equal(h.window.closed, 1);
    assert.equal(h.window.webContents.reloads, 0);
    h.window.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    await h.flush();
    assert.equal(h.shown.length, 1, 'no dialog for a clean exit');
    assert.equal(h.lines().filter((line) => line.level === 'fatal').length, 2, 'both events are logged');
});

test('unresponsive offers Wait / Reload; becoming responsive closes the question', async (t) => {
    const h = setup(t, [1]);
    attachPisiCrashHandling(h.window, h.deps);
    h.window.emit('unresponsive');
    await h.flush();
    assert.deepEqual(h.shown[0].buttons, ['Bekle', 'Yeniden yükle']);
    assert.equal(h.window.webContents.reloads, 1, 'Reload reloads');
    assert.ok(h.lines().some((line) => line.level === 'warn' && line.message === 'Pencere yanıt vermiyor'));

    h.window.emit('unresponsive');
    h.window.emit('responsive');
    await h.flush();
    assert.equal(h.shown[1].signal.aborted, true, 'the open question is dismissed');
    assert.equal(h.window.webContents.reloads, 1, 'nothing is reloaded after recovery');
    assert.ok(h.lines().some((line) => line.message === 'Pencere yeniden yanıt veriyor'));
});

test('an uncaught exception offers a restart; the next open recovers interrupted writes', async (t) => {
    const h = setup(t, [0]);
    assert.equal(await handlePisiFatalError(new Error('boom'), h.deps), 'relaunched');
    assert.equal(h.deps.app.relaunches, 1);
    assert.deepEqual(h.deps.app.exits, [0]);
    assert.match(h.shown[0].detail, /boom/);
    const keep = setup(t, [1]);
    assert.equal(await handlePisiFatalError(new Error('again'), keep.deps), 'continued');
    assert.equal(keep.deps.app.relaunches, 0);
});
