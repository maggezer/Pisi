'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const root = path.resolve(__dirname, '..');
const electronSource = fs.readFileSync(
    path.join(root, 'main', 'functions', 'electron-ipc.js'),
    'utf8'
);
const runtimeSource = fs.readFileSync(
    path.join(root, 'main', 'runtime.js'),
    'utf8'
);
const projectSource = fs.readFileSync(
    path.join(root, 'renderer', 'tree', 'pisi-project.mjs'),
    'utf8'
);
const startupSource = fs.readFileSync(
    path.join(root, 'renderer', 'shell', 'pisi-startup.mjs'),
    'utf8'
);

function loadProjectLockApi(options = {}) {
    const functionNames = [
        'normalizeProjectLockPid',
        'isProjectLockOwnedByCurrentInstance',
        'isProjectLockHeldByAnotherProcess',
        'removeProjectLockFile',
        'migrateLegacyProjectLock',
        'acquireProjectLock',
        'inspectProjectFolder'
    ];
    const source = `
        const pisiInstanceId = 'current-instance';
        ${functionNames
            .map((name) => extractFunction(electronSource, name))
            .join('\n')}
        globalThis.projectLockApi = {
            acquireProjectLock,
            inspectProjectFolder
        };
    `;
    const alivePids = new Set(options.alivePids || []);
    const context = {
        console,
        fs,
        path,
        process,
        hideFileOnWindows() {},
        isProcessAlive(pid) {
            return alivePids.has(pid);
        },
        markInternalFileChange() {},
        sealInternalFileChange() {}
    };

    vm.createContext(context);
    vm.runInContext(source, context);
    return context.projectLockApi;
}

function loadProjectSelectionApi() {
    const source = `
        ${extractFunction(projectSource, 'normalizePisiProjectSelection')}
        globalThis.normalizeSelection = normalizePisiProjectSelection;
    `;
    const context = {};

    vm.createContext(context);
    vm.runInContext(source, context);
    return context.normalizeSelection;
}

test('aynı PID ile kalmış eski proje kilidi güvenle geri alınır', (t) => {
    const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-lock-'));
    const lockPath = path.join(folderPath, '.pisi.lock');

    t.after(() => {
        fs.rmSync(folderPath, { recursive: true, force: true });
    });

    fs.writeFileSync(lockPath, JSON.stringify({
        pid: String(process.pid),
        instanceId: 'crashed-instance',
        openedAt: '2026-01-01T00:00:00.000Z'
    }));

    const api = loadProjectLockApi({
        alivePids: [process.pid]
    });
    const result = api.acquireProjectLock(folderPath);
    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

    assert.equal(result.ok, true);
    assert.equal(lockData.pid, process.pid);
    assert.equal(lockData.instanceId, 'current-instance');
});

test('başka çalışan sürecin proje kilidi korunur ve açık hata döner', (t) => {
    const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-lock-'));
    const lockPath = path.join(folderPath, '.pisi.lock');
    const otherPid = process.pid + 100000;
    const existingLock = {
        pid: otherPid,
        instanceId: 'other-instance'
    };

    t.after(() => {
        fs.rmSync(folderPath, { recursive: true, force: true });
    });

    fs.writeFileSync(lockPath, JSON.stringify(existingLock));

    const api = loadProjectLockApi({
        alivePids: [otherPid]
    });
    const result = api.acquireProjectLock(folderPath);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROJECT_IN_USE');
    assert.deepEqual(
        JSON.parse(fs.readFileSync(lockPath, 'utf8')),
        existingLock
    );
});

test('erişilemeyen proje yolu yapılandırılmış hata döndürür', () => {
    const api = loadProjectLockApi();
    const missingPath = path.join(
        os.tmpdir(),
        `pisi-missing-${Date.now()}-${process.pid}`
    );
    const result = api.inspectProjectFolder(missingPath);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'ENOENT');
    assert.match(result.error, /bulunamadı/);
});

test('klasör seçimi eski ve yapılandırılmış IPC yanıtlarını destekler', () => {
    const normalizeSelection = loadProjectSelectionApi();

    assert.deepEqual(
        { ...normalizeSelection('/tmp/project') },
        {
            ok: true,
            folderPath: '/tmp/project'
        }
    );
    assert.deepEqual(
        { ...normalizeSelection({ ok: true, folderPath: '/tmp/project' }) },
        {
            ok: true,
            folderPath: '/tmp/project'
        }
    );
    assert.deepEqual(
        { ...normalizeSelection({ ok: false, cancelled: true }) },
        {
            ok: false,
            cancelled: true
        }
    );

    const failed = normalizeSelection({
        ok: false,
        code: 'EACCES',
        error: 'Erişim reddedildi.',
        reported: true
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'EACCES');
    assert.equal(failed.error, 'Erişim reddedildi.');
    assert.equal(failed.reported, true);
});

test('proje ancak dosya ağacı başarıyla yüklendikten sonra açılmış sayılır', () => {
    assert.match(runtimeSource, /const lockResult = tryLockProjectFolder\(selectedFolder\)/);
    assert.match(runtimeSource, /cancelled:\s*true/);
    assert.match(runtimeSource, /ok:\s*true,\s*folderPath: lockResult\.folderPath/);
    assert.match(projectSource, /const loaded = await loadProject\(selection\.folderPath\)/);
    assert.match(projectSource, /if \(loaded\) \{\s*hideProjectModal\(\)/);
    assert.match(projectSource, /const loaded = await loadFolderChildren/);
    assert.match(projectSource, /return loaded;/);
    assert.match(startupSource, /const loaded = await loadProject\(lastFolder\)/);
    assert.match(startupSource, /if \(loaded\) \{\s*hideProjectModal\(\)/);
});
