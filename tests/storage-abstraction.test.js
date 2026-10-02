'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readSource = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const storageLayer = require('../main/functions/storage');

function makeProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-storage-'));
}

test('filesystem storage keeps project-relative writes inside the project root', () => {
    const project = makeProject();
    try {
        const storage = storageLayer.getPisiProjectStorage(project);
        const written = storage.writeJson(
            '.pisi/value.json',
            { value: 'ok' },
            {
                backup: false
            }
        );
        assert.equal(written.ok, true);
        assert.equal(fs.existsSync(path.join(project, '.pisi', 'value.json')), true);
        assert.deepEqual(storage.readJson('.pisi/value.json').data, { value: 'ok' });
        assert.throws(() => storage.resolvePath('../outside.json'));
    } finally {
        storageLayer.clearPisiProjectStorageCache(project);
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('filesystem storage rejects symlink escape instead of following it', (t) => {
    const project = makeProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-storage-outside-'));
    try {
        fs.writeFileSync(path.join(outside, 'secret.json'), '{"secret":true}', 'utf8');
        const linkPath = path.join(project, 'linked');
        try {
            fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            t.skip(`symlink oluşturulamıyor: ${error.message}`);
            return;
        }
        const storage = storageLayer.getPisiProjectStorage(project);
        const read = storage.readJson('linked/secret.json');
        assert.equal(read.ok, false);
        assert.match(read.error, /symlink|junction/i);
    } finally {
        try {
            storageLayer.clearPisiProjectStorageCache(project);
        } catch {}
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('canonical metadata stores use the shared storage port instead of direct fs access', () => {
    for (const file of ['main/functions/task-store.js', 'main/functions/relationship-store.js', 'main/functions/property-schema-store.js']) {
        const source = readSource(file);
        assert.match(source, /require\('\.\/storage'\)/, file);
        assert.match(source, /getPisiProjectStorage/, file);
        assert.doesNotMatch(source, /require\(['"]fs['"]\)/, file);
    }

    const sourceOfTruth = readSource('main/functions/source-of-truth.js');
    assert.doesNotMatch(sourceOfTruth, /require\(['"]fs['"]\)/);
    assert.doesNotMatch(sourceOfTruth, /writeFile|readFile|writeJson|readJson/);
});

test('storage remains an IO boundary and delegates production writes to the atomic file primitive', () => {
    const storage = readSource('main/functions/storage.js');
    const core = readSource('main/functions/storage-core.js');
    const main = readSource('main.js');

    assert.match(storage, /globalThis\.writeFileAtomic/);
    assert.match(storage, /assertPisiStoragePathSafe/);
    assert.match(core, /PISI_STORAGE_CONTRACT_VERSION/);
    assert.match(core, /createPisiProjectStorage/);
    assert.doesNotMatch(storage, /task_|relationship|propertyDefinitions|todoTag/);
    assert.doesNotMatch(core, /task_|relationship|propertyDefinitions|todoTag/);

    const storageIndex = main.indexOf('main/functions/storage');
    const atomicIndex = main.indexOf('main/functions/atomic-mutation');
    const taskIndex = main.indexOf('main/functions/task-store');
    const relationshipIndex = main.indexOf('main/functions/relationship-store');
    assert.ok(storageIndex >= 0);
    assert.ok(storageIndex < atomicIndex);
    assert.ok(atomicIndex < taskIndex);
    assert.ok(atomicIndex < relationshipIndex);
});
