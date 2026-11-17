// Masaüstü senkronunun yerel tarafı (docs/sync-plan.md S3, SV2, SV4, SV6, SV7, SV11):
// - bir turun yazmaları gerçek atomic mutation içinde yapılır; yarıda kesilen tur projeyi
//   turun öncesine döndürür (hata enjeksiyonu);
// - kirli (kaydedilmemiş) açık belge yazılmaz, bildirilir;
// - yazılan not/harita için yönetilen yan klasör oluşur, silinen notun boş yan klasörü kalkar;
// - tarama senkron dışı yolları ve sembolik bağlantıları atlar;
// - cihaz durumu proje dışında durur; bozuk durum dosyası ezilmez.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPisiSyncProjectFiles } from '../main/functions/sync-client-files.js';
import { createPisiSyncStateStore, getPisiSyncProjectKey, makePisiSyncState } from '../main/functions/sync-client-state.js';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const electronUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-apply-userdata-'));
process.on('exit', () => fs.rmSync(electronUserData, { recursive: true, force: true }));
const quiet = () => new Proxy(function () {}, { get: (_target, name) => (name === 'then' ? undefined : quiet()), apply: () => undefined });
const electronStub = {
    app: new Proxy(
        {},
        {
            get(_target, name) {
                if (name === 'isPackaged') return false;
                if (name === 'getPath' || name === 'getAppPath') return () => electronUserData;
                if (name === 'getName') return () => 'Pisi';
                if (name === 'getVersion') return () => '0.0.0';
                if (name === 'getLocale') return () => 'tr';
                if (name === 'whenReady') return () => new Promise(() => {});
                return quiet();
            }
        }
    ),
    BrowserWindow: class BrowserWindow {
        static getAllWindows() {
            return [];
        }
    },
    ipcMain: quiet(),
    dialog: quiet(),
    shell: quiet(),
    net: { fetch: async () => ({ ok: false, status: 500 }) }
};
Module._load = function pisiTestElectronStub(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
};
// The modules main.mjs loads first, in its order, up to the ones the sync apply step uses.
for (const name of [
    'path-security',
    'logger',
    'i18n',
    'filesystem-core',
    'storage',
    'atomic-mutation',
    'atomic-recovery-hardening',
    'document-store',
    'map-store',
    'project-operations',
    'relationship-store',
    'map-semantic-core',
    'map-operational-store',
    'task-capture',
    'task-store',
    'trash-store',
    'task-reference-integrity',
    'source-of-truth',
    'structured-nodes',
    'property-schema-store',
    'property-schema-mutations',
    'sync-project-adapter',
    'project-integrity',
    'portability',
    'auto-update',
    'electron-ipc'
]) {
    require(`../main/functions/${name}.js`);
}
require('../main/runtime.js');
Module._load = originalLoad;
const { modules } = require('../main/module-registry.js');
const atomic = modules['main.atomicMutation'];
const filesystemCore = modules['main.filesystemCore'];

const NOTE_ID = 'node_11111111-2222-4333-8444-555555555555';
const note = (text, sidecar = `inv_Not__${NOTE_ID}`) =>
    Buffer.from(JSON.stringify({ pisi: { version: 1, type: 'node', id: NOTE_ID, title: 'Not', sidecar }, content: text }));

function project(t) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-apply-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

function desktopFiles(root, options = {}) {
    return createPisiSyncProjectFiles(root, {
        run: (operation) => atomic.runPisiAtomicMutation(root, 'sync.apply.v1', operation),
        writeFile: (absolute, bytes) => filesystemCore.writeFileAtomic(absolute, bytes, { backup: false }),
        ...options
    });
}

test('yarıda kesilen tur atomic mutation ile turun öncesine döner', async (t) => {
    const root = project(t);
    fs.writeFileSync(path.join(root, 'a.node'), note('eski a'));
    fs.writeFileSync(path.join(root, 'c.txt'), 'silinecek');
    const ops = [
        { op: 'write', path: 'a.node', bytes: note('yeni a') },
        { op: 'write', path: 'klasör/b.node', bytes: note('yeni b') },
        { op: 'remove', path: 'c.txt' }
    ];
    const failing = desktopFiles(root, {
        beforeWrite: (_op, index) => {
            if (index === 2) throw new Error('kesildi');
        }
    });
    await assert.rejects(failing.apply(ops), /kesildi/);
    assert.match(fs.readFileSync(path.join(root, 'a.node'), 'utf8'), /eski a/);
    assert.equal(fs.existsSync(path.join(root, 'klasör')), false);
    assert.equal(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'silinecek');
    assert.equal(fs.existsSync(path.join(root, `inv_Not__${NOTE_ID}`)), false);

    const result = await desktopFiles(root).apply(ops);
    assert.deepEqual(result.skipped, []);
    assert.match(fs.readFileSync(path.join(root, 'a.node'), 'utf8'), /yeni a/);
    assert.match(fs.readFileSync(path.join(root, 'klasör', 'b.node'), 'utf8'), /yeni b/);
    assert.equal(fs.existsSync(path.join(root, 'c.txt')), false);
    assert.ok(fs.statSync(path.join(root, `inv_Not__${NOTE_ID}`)).isDirectory(), 'yazılan notun yan klasörü oluşur (SV6)');
    assert.ok(fs.statSync(path.join(root, 'klasör', `inv_Not__${NOTE_ID}`)).isDirectory());
});

test('kirli açık belge yazılmaz ve bildirilir; silinen notun boş yan klasörü kalkar', async (t) => {
    const root = project(t);
    fs.writeFileSync(path.join(root, 'açık.node'), note('ekrandaki'));
    fs.writeFileSync(path.join(root, 'silinen.node'), note('x', 'inv_Silinen__node_s'));
    fs.mkdirSync(path.join(root, 'inv_Silinen__node_s', 'image'), { recursive: true });
    const result = await desktopFiles(root).apply(
        [
            { op: 'write', path: 'açık.node', bytes: note('uzak') },
            { op: 'remove', path: 'silinen.node' }
        ],
        { isDirty: (relative) => relative === 'açık.node' }
    );
    assert.deepEqual(result.skipped, ['açık.node']);
    assert.match(fs.readFileSync(path.join(root, 'açık.node'), 'utf8'), /ekrandaki/);
    assert.equal(fs.existsSync(path.join(root, 'silinen.node')), false);
    assert.equal(fs.existsSync(path.join(root, 'inv_Silinen__node_s')), false);
});

test('tarama senkron dışı yolları, geçici dosyaları ve sembolik bağlantıları atlar; proje dışı yol reddedilir', async (t) => {
    const root = project(t);
    const files = {
        'Not.node': '{}',
        '.pisi/tasks.json': '{}',
        '.pisi/mutations/notlar.txt': 'x',
        '.pisi/trash/items/x.json': '{}',
        '.pisi/backups/atomic/Not.node.pisi-backup': '{}',
        '.pisi-history/n/1.gz': 'x',
        '.pisi-sync/manifest.json': '{}',
        '.Not.node.123.tmp': 'x',
        'node_modules/a/index.js': 'x',
        'diary/.pisi-diary': ''
    };
    for (const [relative, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        fs.writeFileSync(path.join(root, relative), content);
    }
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.writeFileSync(path.join(outside, 'gizli.txt'), 'dışarıda');
    fs.symlinkSync(path.join(outside, 'gizli.txt'), path.join(root, 'bağlantı.txt'));
    const adapter = desktopFiles(root);
    assert.deepEqual(
        (await adapter.list()).map((file) => file.path),
        ['.pisi/tasks.json', 'Not.node', 'diary/.pisi-diary']
    );
    assert.equal(await adapter.read('bağlantı.txt'), null);
    await assert.rejects(adapter.apply([{ op: 'write', path: '../dışarı.txt', bytes: Buffer.from('x') }]), (error) => error.code === 'PATH_UNSAFE');
});

test('cihaz durumu proje dışında; bozuk durum ezilmez, sırlar mühürlü saklanır', async (t) => {
    const root = project(t);
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-state-'));
    t.after(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
    const sealed = [];
    const secrets = {
        seal: (text) => {
            sealed.push(text);
            return Buffer.from(`mühür:${text}`).toString('base64');
        },
        open: (text) =>
            Buffer.from(text, 'base64')
                .toString('utf8')
                .replace(/^mühür:/, '')
    };
    const store = createPisiSyncStateStore({ root: stateRoot, projectPath: root, secrets });
    assert.equal(await store.load(), null);
    await store.save(makePisiSyncState({ projectPath: root, serverUrl: 'https://ornek.com', spaceId: 'sp_x', deviceId: 'dv_x', role: 'admin' }));
    const key = new Uint8Array(32).fill(7);
    await store.writeSecrets({ token: 'pst_gizli', key });
    const opened = await store.readSecrets();
    assert.equal(opened.token, 'pst_gizli');
    assert.deepEqual([...opened.key], [...key]);
    const onDisk = fs.readFileSync(path.join(store.dir, 'secrets.json'), 'utf8');
    assert.doesNotMatch(onDisk, /pst_gizli/);
    assert.ok(store.dir.startsWith(stateRoot), 'durum kullanıcı veri klasöründe (SV2)');
    assert.equal(fs.readdirSync(root).length, 0, 'proje klasörüne hiçbir şey yazılmaz');

    await store.writeBase('f_x', Buffer.from('temel'));
    assert.equal(Buffer.from(await store.readBase('f_x')).toString(), 'temel');
    assert.equal(await store.readBase('f_X'), null, 'fid büyük-küçük harfe duyarlı');

    fs.writeFileSync(path.join(store.dir, 'state.json'), '{ bozuk');
    await assert.rejects(store.load(), (error) => error.code === 'STATE_UNREADABLE');
    assert.equal(fs.readFileSync(path.join(store.dir, 'state.json'), 'utf8'), '{ bozuk');
    assert.equal(getPisiSyncProjectKey('C:\\Proje', 'win32'), getPisiSyncProjectKey('c:\\proje', 'win32'));
    assert.notEqual(getPisiSyncProjectKey('/home/a/Proje', 'linux'), getPisiSyncProjectKey('/home/a/proje', 'linux'));
});
