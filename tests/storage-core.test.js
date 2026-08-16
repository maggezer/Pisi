'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    PISI_STORAGE_CONTRACT_VERSION,
    normalizePisiStorageKey,
    resolvePisiStoragePath,
    getPisiStorageKeyForPath,
    createPisiProjectStorage
} = require('../main/functions/storage-core');

function makeMemoryDriver(root) {
    const files = new Map();
    const directories = new Set([path.resolve(root)]);
    const calls = [];
    const normalize = (value) => path.resolve(value);
    const parentDirectories = (target) => {
        let current = path.dirname(target);
        const pending = [];
        while (current && current !== path.dirname(current)) {
            pending.push(current);
            if (current === normalize(root)) break;
            current = path.dirname(current);
        }
        pending.reverse().forEach((item) => directories.add(item));
    };

    return {
        calls,
        files,
        directories,
        exists(target) {
            target = normalize(target);
            return files.has(target) || directories.has(target);
        },
        mkdir(target) {
            target = normalize(target);
            parentDirectories(target);
            directories.add(target);
            calls.push(['mkdir', target]);
        },
        readText(target) {
            target = normalize(target);
            calls.push(['readText', target]);
            if (!files.has(target)) throw new Error('missing');
            return files.get(target);
        },
        writeText(target, content, options) {
            target = normalize(target);
            parentDirectories(target);
            files.set(target, content);
            calls.push(['writeText', target, options?.backup]);
        },
        list(target) {
            target = normalize(target);
            const entries = new Map();
            for (const directory of directories) {
                if (directory === target) continue;
                if (path.dirname(directory) === target) {
                    entries.set(path.basename(directory), {
                        name: path.basename(directory),
                        isFile: false,
                        isDirectory: true,
                        isSymbolicLink: false
                    });
                }
            }
            for (const file of files.keys()) {
                if (path.dirname(file) === target) {
                    entries.set(path.basename(file), {
                        name: path.basename(file),
                        isFile: true,
                        isDirectory: false,
                        isSymbolicLink: false
                    });
                }
            }
            calls.push(['list', target]);
            return [...entries.values()];
        },
        stat(target) {
            target = normalize(target);
            if (files.has(target)) return { isFile: () => true, isDirectory: () => false };
            if (directories.has(target)) return { isFile: () => false, isDirectory: () => true };
            throw new Error('missing');
        },
        rename(source, destination) {
            source = normalize(source);
            destination = normalize(destination);
            if (!files.has(source)) throw new Error('missing');
            parentDirectories(destination);
            files.set(destination, files.get(source));
            files.delete(source);
            calls.push(['rename', source, destination]);
        },
        remove(target) {
            target = normalize(target);
            files.delete(target);
            directories.delete(target);
            calls.push(['remove', target]);
        }
    };
}

test('storage keys are project-relative and reject traversal or absolute paths', () => {
    const root = path.resolve('/tmp/pisi-storage-contract');
    assert.equal(normalizePisiStorageKey('a\\b/../c.json'), 'a/c.json');
    assert.equal(resolvePisiStoragePath(root, 'a/c.json'), path.join(root, 'a', 'c.json'));
    assert.equal(getPisiStorageKeyForPath(root, path.join(root, 'a', 'c.json')), 'a/c.json');
    for (const invalid of ['../outside', '../../x', '/tmp/x', 'C:\\outside\\x']) {
        assert.throws(() => normalizePisiStorageKey(invalid));
    }
    assert.throws(() => getPisiStorageKeyForPath(root, path.resolve(root, '..', 'outside')));
});

test('project storage contract works through a replaceable driver', () => {
    const root = path.resolve('/virtual/pisi-project');
    const driver = makeMemoryDriver(root);
    const storage = createPisiProjectStorage(root, driver);

    assert.equal(storage.contractVersion, PISI_STORAGE_CONTRACT_VERSION);
    const written = storage.writeJson('.pisi/example.json', { value: 42 }, {
        backup: false
    });
    assert.equal(written.ok, true);
    assert.equal(driver.calls.some((call) => call[0] === 'writeText'), true);

    const read = storage.readJson('.pisi/example.json');
    assert.equal(read.ok, true);
    assert.deepEqual(read.data, { value: 42 });

    const renamed = storage.rename('.pisi/example.json', '.pisi/renamed.json');
    assert.equal(renamed.ok, true);
    assert.equal(storage.exists('.pisi/example.json'), false);
    assert.equal(storage.exists('.pisi/renamed.json'), true);

    const removed = storage.remove('.pisi/renamed.json');
    assert.equal(removed.ok, true);
    assert.equal(storage.exists('.pisi/renamed.json'), false);
    assert.equal(storage.remove('.').code, 'STORAGE_ROOT_DELETE_FORBIDDEN');
});

test('walk is bounded, ignores requested directories and filters extensions', () => {
    const root = path.resolve('/virtual/pisi-walk');
    const driver = makeMemoryDriver(root);
    const storage = createPisiProjectStorage(root, driver);
    storage.writeText('one.node', '{}', { backup: false });
    storage.writeText('two.map', '{}', { backup: false });
    storage.writeText('.pisi/hidden.node', '{}', { backup: false });
    storage.writeText('folder/three.node', '{}', { backup: false });

    const result = storage.walk('.', {
        ignore: ['.pisi'],
        extensions: ['.node'],
        maxFiles: 10
    });
    assert.equal(result.ok, true);
    assert.deepEqual(
        result.entries.map((entry) => entry.key).sort(),
        ['folder/three.node', 'one.node']
    );
});
