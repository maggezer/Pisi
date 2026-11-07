import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPisiProjectWatcher, isPisiWatchIgnoredPath, shouldUsePisiRecursiveWatch } from '../main/functions/project-watcher-core.js';

function makeProject(t, notes = 30) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-watch-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const dir of ['.git/objects', '.pisi/trash/items', '.pisi/mutations/mut_1', '.pisi-history/n1', '.pisi-sync', 'node_modules/x']) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (let index = 0; index < notes; index += 1) fs.mkdirSync(path.join(root, 'nd_Harita__map_1', `inv_Not ${index}__node_${index}`), { recursive: true });
    return root;
}

function fakeWatch() {
    const calls = [];
    const watch = (target, options, listener) => {
        const watcher = {
            target,
            options,
            listener,
            closed: false,
            close() {
                this.closed = true;
            },
            on() {}
        };
        calls.push(watcher);
        return watcher;
    };
    return { calls, watch };
}

const readdir = (directory) => fsPromises.readdir(directory, { withFileTypes: true });

test('one recursive watcher on macOS and Windows; per-directory on Linux (sync start there)', () => {
    assert.equal(shouldUsePisiRecursiveWatch('darwin'), true);
    assert.equal(shouldUsePisiRecursiveWatch('win32'), true);
    assert.equal(shouldUsePisiRecursiveWatch('linux'), false);
    assert.equal(shouldUsePisiRecursiveWatch('freebsd'), false);
});

test('internal folders and temporary files never produce events', () => {
    for (const ignored of [
        '.git/index',
        '.pisi-history/n1/a.gz',
        '.pisi/trash/items/x.json',
        '.pisi/mutations/mut_1/journal.json',
        '.pisi-sync/state.json',
        'node_modules/a/b.js',
        'nd_A/.Not.node.123.abc.tmp',
        'nd_A/Not.node.swp',
        'nd_A/~$rapor.docx',
        '.DS_Store',
        'nd_A/.pisi-delete-123/x.node'
    ]) {
        assert.equal(isPisiWatchIgnoredPath(ignored), true, ignored);
    }
    for (const watched of ['Harita.map', 'nd_A/Not.node', '.pisi/tasks.json', '.pisi/relationships.json', 'nd_A/inv_Not__node_1/image.png']) {
        assert.equal(isPisiWatchIgnoredPath(watched), false, watched);
    }
});

test('a large project gets exactly one recursive watcher', async (t) => {
    const root = makeProject(t, 200);
    const { calls, watch } = fakeWatch();
    const watchers = new Map();
    const watcher = createPisiProjectWatcher({ root, watch, readdir, recursive: true, watchers, onChange() {} });
    const result = await watcher.start();
    assert.deepEqual(result, { mode: 'recursive', watchers: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, root);
    assert.equal(calls[0].options.recursive, true);
    watcher.close();
    assert.equal(calls[0].closed, true);
    assert.equal(watchers.size, 0);
});

test('recursive events are filtered and report the changed path and its folder', async (t) => {
    const root = makeProject(t, 1);
    const { calls, watch } = fakeWatch();
    const events = [];
    const watcher = createPisiProjectWatcher({
        root,
        watch,
        readdir,
        recursive: true,
        onChange: (type, changed, dir) => events.push([type, path.relative(root, changed), path.relative(root, dir)])
    });
    await watcher.start();
    const emit = (type, name) => calls[0].listener(type, name);
    emit('change', path.join('nd_Harita__map_1', 'Not 1.node'));
    emit('rename', path.join('.pisi', 'mutations', 'mut_1', 'journal.json'));
    emit('change', path.join('.pisi-history', 'n1', 'a.gz'));
    emit('rename', path.join('nd_Harita__map_1', '.Not 1.node.1.x.tmp'));
    emit('change', path.join('.git', 'HEAD'));
    emit('change', path.join('.pisi', 'tasks.json'));
    assert.deepEqual(events, [
        ['change', path.join('nd_Harita__map_1', 'Not 1.node'), 'nd_Harita__map_1'],
        ['change', path.join('.pisi', 'tasks.json'), '.pisi']
    ]);
    assert.equal(watcher.rescanCount, 0, 'recursive mode never rescans');
    watcher.close();
});

test('per-directory setup yields to the event loop between batches', async (t) => {
    const root = makeProject(t, 450);
    const { watch } = fakeWatch();
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    const watcher = createPisiProjectWatcher({ root, watch, readdir, recursive: false, onChange() {} });
    await watcher.start();
    clearInterval(timer);
    assert.ok(ticks > 0, 'timers ran while watchers were being set up');
    assert.equal(watcher.watchers.size, 453);
    watcher.close();
});

test('per-directory: one watcher per folder, internal folders skipped, rename rescans only the affected folder', async (t) => {
    const root = makeProject(t, 5);
    const { calls, watch } = fakeWatch();
    const watchers = new Map();
    const scanned = [];
    const countingReaddir = (directory) => {
        scanned.push(path.relative(root, directory) || '.');
        return readdir(directory);
    };
    const watcher = createPisiProjectWatcher({ root, watch, readdir: countingReaddir, recursive: false, watchers, onChange() {} });
    const started = watcher.start();
    assert.ok(started instanceof Promise, 'setup is asynchronous');
    const result = await started;
    // root, .pisi, nd_Harita__map_1 and its 5 sidecar folders.
    assert.equal(result.mode, 'per-directory');
    assert.equal(result.watchers, 8);
    assert.ok(
        ![...watchers.keys()].some((key) => /\.git|\.pisi-history|trash|mutations|\.pisi-sync|node_modules/.test(key)),
        'internal folders are not watched'
    );
    assert.ok(calls.every((call) => call.options.recursive === false));

    // A new sidecar folder appears: only nd_Harita__map_1 and below are listed again.
    const mapFolder = path.join(root, 'nd_Harita__map_1');
    fs.mkdirSync(path.join(mapFolder, 'inv_Yeni__node_9'));
    scanned.length = 0;
    await watcher.rescan(path.join(mapFolder, 'inv_Yeni__node_9'));
    assert.ok(watchers.has(path.join(mapFolder, 'inv_Yeni__node_9')), 'the new folder is watched');
    assert.ok(!scanned.includes('.') && !scanned.includes('.pisi'), 'the rest of the tree is not rescanned');

    // A folder disappears: its watcher is closed.
    fs.rmSync(path.join(mapFolder, 'inv_Not 0__node_0'), { recursive: true });
    await watcher.rescan(path.join(mapFolder, 'inv_Not 0__node_0'));
    assert.equal(watchers.has(path.join(mapFolder, 'inv_Not 0__node_0')), false);
    assert.equal(watchers.size, 8);
    watcher.close();
});
