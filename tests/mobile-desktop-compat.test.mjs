// Desktop compatibility of the mobile data layer (docs/mobile-plan.md M4, rule V10).
// The mobile repos run over a copy of a project the desktop app created
// (tests/fixtures/desktop-project, built by scripts/electron-mobile-fixture-e2e.mjs),
// and then the desktop's own code judges the result: Project Integrity must find
// nothing new and the desktop task store must read what mobile wrote.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createNodeFsDriver } from '../mobile/src/data/drivers/node-fs-driver.mjs';
import { splitNoteBlocks } from '../mobile/src/data/note-blocks.mjs';
import { createProject } from '../mobile/src/data/project-repo.mjs';
import { normalizePisiTaskRecord } from '../shared/task-model.mjs';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
// The desktop main modules are loaded for real; only Electron itself is stubbed.
const electronUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-compat-userdata-'));
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
// The same modules, in the same order, that main.mjs loads before Project Integrity.
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
    'project-integrity'
]) {
    require(`../main/functions/${name}.js`);
}
// Constants the stores read as registry globals (connection keys).
require('../main/runtime.js');
Module._load = originalLoad;
const { modules } = require('../main/module-registry.js');
const desktopAudit = modules['main.projectIntegrity'].auditPisiProjectIntegrity;
const desktopTasks = modules['main.taskStore'];

const fixture = path.join(import.meta.dirname, 'fixtures', 'desktop-project');
// Saturday 14 November 2026, 09:30 local time: the fixture's tasks are dated around it.
const NOW = new Date(2026, 10, 14, 9, 30);
const TODAY = '2026-11-14';

function copyFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-compat-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.cpSync(fixture, root, { recursive: true });
    // Folders the desktop created empty; git cannot store them (see tests/fixtures/README.md).
    for (const folder of JSON.parse(fs.readFileSync(`${fixture}.directories.json`, 'utf8'))) fs.mkdirSync(path.join(root, folder), { recursive: true });
    return root;
}

function snapshot(root) {
    const files = new Map();
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(full);
            else files.set(path.relative(root, full).split(path.sep).join('/'), fs.readFileSync(full));
        }
    };
    walk(root);
    return files;
}

function changedFiles(before, after) {
    const changed = [];
    for (const [key, bytes] of after) if (!before.has(key) || !before.get(key).equals(bytes)) changed.push(key);
    for (const key of before.keys()) if (!after.has(key)) changed.push(`- ${key}`);
    return changed.sort();
}

const issueKeys = (report) => report.issues.map((issue) => [issue.code, issue.path, issue.entityId ?? ''].join(' | ')).sort();
const readJson = (root, key) => JSON.parse(fs.readFileSync(path.join(root, key), 'utf8'));
const openMobile = (root) => createProject({ driver: createNodeFsDriver(root), now: () => new Date(NOW), makeUuid: () => crypto.randomUUID() });

/** Adds fields a future desktop version might write: one at the top of tasks.json and one on a task. */
function addUnknownTaskFields(root) {
    const file = path.join(root, '.pisi', 'tasks.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    store.futureSetting = { keep: ['me', 1] };
    store.tasks[0].futureField = { nested: true };
    fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
}

test('mobil, masaüstünün oluşturduğu projeyi yalnız okuyunca hiçbir dosya değişmez', async (t) => {
    const root = copyFixture(t);
    const before = snapshot(root);
    const project = openMobile(root);

    const opened = await project.open();
    await project.index.build();
    const listed = await project.tasks.list();
    const meeting = await project.notes.read('Toplantı Notları.node');
    const diary = await project.diary.read('2026-11-12');
    const [mapEntry] = project.maps.list();
    const map = await project.maps.read(mapEntry.key);
    await project.flush();

    assert.equal(opened.created, false);
    assert.deepEqual(opened.integrity, { healthy: true, readOnlyFiles: [] });
    assert.equal(listed.tasks.length, 6);
    assert.deepEqual(
        meeting.blocks.filter((block) => block.kind === 'element').map((block) => [block.blockType, block.editable]),
        [
            ['paragraph', true],
            ['paragraph', true],
            ['sheet', false],
            ['canvas', false],
            ['image', false],
            ['file', false],
            ['paragraph', true]
        ]
    );
    assert.equal(diary.text, 'Plan belgesini okudum.');
    assert.deepEqual([map.nodes.length, map.relationships.length, map.relationships[0].view.sourcePort], [2, 1, 'bottom']);
    assert.deepEqual(project.search.query('zebra kararlar').length, 0);
    assert.deepEqual(
        project.search.query('KARARLAR').map((note) => note.title),
        ['Toplantı Notları']
    );
    assert.deepEqual(changedFiles(before, snapshot(root)), [], 'okuma hiçbir dosyaya yazmamalı');
});

test('mobilin yazdığı proje masaüstü denetiminden yeni bulgu almaz ve yalnız ilgili yerler değişir', async (t) => {
    const root = copyFixture(t);
    addUnknownTaskFields(root);
    const baseline = issueKeys(desktopAudit(root));
    // What the desktop reports for its own untouched project (see pisi-error.md: Inbox property without a schema).
    assert.deepEqual(baseline, ['property-schema-authority-missing | .pisi/properties.json | ']);
    const before = snapshot(root);
    const storeBefore = readJson(root, '.pisi/tasks.json');
    const meetingBefore = readJson(root, 'Toplantı Notları.node');
    const diaryBefore = readJson(root, `diary/${TODAY}.node`);

    const project = openMobile(root);
    await project.open();
    await project.index.build();
    const byTitle = (title) => storeBefore.tasks.find((task) => task.title === title);

    // Görev ekle, görev tamamla, tekrar eden görevi tamamla.
    const added = await project.tasks.upsert({ title: '  Mobilden   eklenen görev ', priority: 2, dueDate: TODAY, scheduledAt: `${TODAY}T16:00` });
    const completed = await project.tasks.complete(byTitle('Raporu gönder').id);
    const daily = await project.tasks.complete(byTitle('Egzersiz').id);
    const weekly = await project.tasks.complete(byTitle('Haftalık özet yaz').id);
    // Sheet bloğu olan notta tek bir paragrafı düzenle.
    const target = (await project.notes.read('Toplantı Notları.node')).blocks.filter((block) => block.editable)[1];
    const edited = await project.notes.updateContent('Toplantı Notları.node', [
        { op: 'replace', blockId: target.blockId, html: 'Kararlar mobilde güncellendi &amp; kaydedildi.' }
    ]);
    // Yeni not oluştur, bugünün günlüğünü yaz, yeni bir günün günlüğünü yaz.
    const created = await project.notes.create({ title: 'Mobil Not', text: 'İlk paragraf.\n\nİkinci paragraf\nikinci satır.' });
    const todayDiary = await project.diary.setText(TODAY, 'Bugün mobilden yazdım.');
    const newDiary = await project.diary.setText('2026-11-15', 'Yeni günün ilk satırı.');
    const emptyDiary = await project.diary.setText('2026-11-16', '   ');
    await project.flush();

    assert.ok(added.ok && completed.ok && daily.ok && weekly.ok && edited.changed && created.ok && todayDiary.changed && newDiary.created);
    assert.deepEqual([emptyDiary.changed, fs.existsSync(path.join(root, 'diary/2026-11-16.node'))], [false, false], 'boş günlük dosyası oluşmaz');

    // (a) Masaüstü Project Integrity denetimi yeni bulgu üretmiyor.
    const audit = desktopAudit(root);
    assert.deepEqual(
        issueKeys(audit).filter((key) => !baseline.includes(key)),
        []
    );

    // (b) Dokunulmayan dosyalar bayt bayt aynı; geçici dosya kalmadı.
    const after = snapshot(root);
    const sidecar = (key) => readJson(root, key).pisi.sidecar;
    assert.deepEqual(changedFiles(before, after), [
        '.pisi/tasks.json',
        'Mobil Not.node',
        'Toplantı Notları.node',
        'diary/2026-11-14.node',
        'diary/2026-11-15.node'
    ]);
    assert.equal(fs.statSync(path.join(root, sidecar('Mobil Not.node'))).isDirectory(), true);
    assert.equal(fs.statSync(path.join(root, 'diary', sidecar('diary/2026-11-15.node'))).isDirectory(), true);

    // (c) Düzenlenen notta yalnız ilgili blok değişmiş.
    const meetingAfter = readJson(root, 'Toplantı Notları.node');
    assert.deepEqual(
        { ...meetingAfter, content: '', pisi: { ...meetingAfter.pisi, updatedAt: '' } },
        { ...meetingBefore, content: '', pisi: { ...meetingBefore.pisi, updatedAt: '' } }
    );
    assert.equal(meetingAfter.pisi.updatedAt, NOW.toISOString());
    const blocksBefore = splitNoteBlocks(meetingBefore.content).map((block) => block.html);
    const blocksAfter = splitNoteBlocks(meetingAfter.content).map((block) => block.html);
    const differing = blocksAfter.map((html, position) => (html === blocksBefore[position] ? null : position)).filter((position) => position !== null);
    assert.deepEqual([blocksAfter.length, differing], [blocksBefore.length, [1]]);
    assert.equal(blocksAfter[1], blocksBefore[1].replace('Kararlar bu paragrafta toplanır.', 'Kararlar mobilde güncellendi &amp; kaydedildi.'));
    for (const marker of ['data-pisi-sheet-asset', 'data-pisi-asset="paint/', 'data-pisi-image-asset', 'data-pisi-file-asset']) {
        assert.ok(blocksAfter.some((html) => html.includes(marker)));
    }
    // Günlükte masaüstünün yönettiği görev bölümü aynen duruyor.
    const diaryAfter = readJson(root, `diary/${TODAY}.node`);
    const managed = (content) => content.slice(content.indexOf('<!--PISI_DIARY_MANAGED_START-->'));
    assert.equal(managed(diaryAfter.content), managed(diaryBefore.content));
    assert.match(diaryAfter.content, /^<div class="pisi-editor-block" data-pisi-block-id="blk_[^"]+">Bugün mobilden yazdım\.<\/div>\n/);

    // (d) tasks.json içindeki bilinmeyen alanlar ve diğer kayıtlar korunmuş.
    const storeAfter = readJson(root, '.pisi/tasks.json');
    const touched = new Set([completed.task.id, daily.task.id, weekly.task.id]);
    assert.deepEqual(storeAfter.futureSetting, { keep: ['me', 1] });
    assert.deepEqual(Object.keys(storeAfter), Object.keys(storeBefore));
    assert.deepEqual(storeAfter.tasks[0].futureField, { nested: true });
    assert.equal(storeAfter.tasks[0].status, 'done', 'bilinmeyen alanı taşıyan kayıt tamamlanan görevdir');
    for (const task of storeBefore.tasks) {
        if (!touched.has(task.id))
            assert.deepEqual(
                storeAfter.tasks.find((item) => item.id === task.id),
                task
            );
    }
    assert.deepEqual(
        storeAfter.tasks.slice(0, storeBefore.tasks.length).map((task) => task.id),
        storeBefore.tasks.map((task) => task.id)
    );
    // Tekrar eden görevler: eskisi tamamlandı, sonraki tarihle kaynaksız yeni kayıt eklendi.
    assert.deepEqual([daily.next.dueDate, daily.next.todoTag, daily.next.repeat, daily.next.status], ['2026-11-15', 'todo.3.15-11-2026', 'daily', 'todo']);
    assert.deepEqual([weekly.next.dueDate, weekly.next.todoTag, weekly.next.source.nodePath], ['2026-11-20', 'todo.3.20-11-2026', null]);
    assert.equal(completed.next, null);

    // (e) Masaüstü task-store mobilin yazdığı görevleri aynı biçimde okuyor.
    const desktopList = desktopTasks.listPisiFirstClassTasks(root);
    assert.equal(desktopList.tasks.length, storeAfter.tasks.length);
    const mobileWritten = [added.task, completed.task, daily.task, daily.next, weekly.task, weekly.next];
    for (const written of mobileWritten) {
        const stored = storeAfter.tasks.find((task) => task.id === written.id);
        const read = desktopList.tasks.find((task) => task.id === written.id);
        const canonical = normalizePisiTaskRecord(stored, stored, { now: NOW, makeUuid: () => 'unused', normalizeStoredPath: (value) => value || null });
        // The record is already canonical for the desktop normalizer: same fields, same order, same values.
        const known = Object.fromEntries(Object.keys(canonical).map((key) => [key, stored[key]]));
        assert.deepEqual(JSON.stringify(known), JSON.stringify({ ...canonical, updatedAt: stored.updatedAt }));
        assert.deepEqual({ ...read, source: null }, { ...stored, source: null });
        assert.equal(read.source.nodePath, stored.source.nodePath ? path.join(root, stored.source.nodePath) : null);
    }
    assert.deepEqual(
        [added.task.title, added.task.todoTag, added.task.status, added.task.source.nodePath, /^task_[0-9a-f-]{36}$/.test(added.task.id)],
        ['Mobilden eklenen görev', 'todo.2.14-11-2026', 'todo', null, true]
    );

    // Denetim gerçekten çalışıyor: masaüstü kuralına uymayan bir kayıt yeni bulgu olarak görünür.
    const tampered = copyFixture(t);
    const tamperedStore = readJson(tampered, '.pisi/tasks.json');
    tamperedStore.tasks[0].priority = 9;
    fs.writeFileSync(path.join(tampered, '.pisi', 'tasks.json'), JSON.stringify(tamperedStore));
    assert.ok(issueKeys(desktopAudit(tampered)).some((key) => key.startsWith('task-priority-invalid')));

    // Aynı işlemleri yinelemek dosyaları yeniden yazmaz (V4).
    const settled = snapshot(root);
    await project.tasks.setStatus(completed.task.id, 'done');
    await project.notes.updateContent('Toplantı Notları.node', [
        { op: 'replace', blockId: target.blockId, html: 'Kararlar mobilde güncellendi &amp; kaydedildi.' }
    ]);
    await project.diary.setText(TODAY, 'Bugün mobilden yazdım.');
    await project.flush();
    assert.deepEqual(changedFiles(settled, snapshot(root)), []);
});

test('(f) bozuk tasks.json ezilmez: mobil dosyayı salt okunur sayar ve yazmayı reddeder', async (t) => {
    const root = copyFixture(t);
    const file = path.join(root, '.pisi', 'tasks.json');
    const broken = '{ "version": 1, "tasks": [ { "id": "task_yarım"';
    fs.writeFileSync(file, broken);
    const before = snapshot(root);
    const project = openMobile(root);

    const opened = await project.open();
    const listed = await project.tasks.list();
    await assert.rejects(project.tasks.upsert({ title: 'Yazılmamalı' }), { code: 'READ_ONLY' });
    await assert.rejects(project.tasks.complete('task_yarım'), { code: 'READ_ONLY' });
    // Başka dosyalar yazılabilir kalır.
    const note = await project.notes.create({ title: 'Bozuk depoya rağmen' });
    await project.flush();

    assert.deepEqual(opened.integrity, { healthy: false, readOnlyFiles: ['.pisi/tasks.json'] });
    assert.deepEqual([listed.ok, listed.corrupt, listed.readOnly, listed.tasks.length], [false, true, true, 0]);
    assert.equal(fs.readFileSync(file, 'utf8'), broken);
    assert.deepEqual(changedFiles(before, snapshot(root)), [note.key]);
});

test('boş klasörde mobilin kurduğu yeni proje masaüstü denetiminden temiz çıkar', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-new-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = openMobile(root);

    const opened = await project.open();
    await project.tasks.upsert({ title: 'İlk görev', dueDate: TODAY, repeat: 'weekly' });
    await project.notes.create({ title: 'İlk not', text: 'Merhaba.' });
    await project.diary.setText(TODAY, 'İlk gün.');
    await project.flush();

    assert.equal(opened.created, true);
    assert.deepEqual(fs.readdirSync(root).sort(), ['.pisi', 'diary', 'inv_İlk not__' + readJson(root, 'İlk not.node').pisi.id, 'İlk not.node'].sort());
    assert.equal(fs.readFileSync(path.join(root, 'diary', '.pisi-diary'), 'utf8'), 'Bu klasör PISI diary özelliği tarafından yönetilir.\n');
    assert.deepEqual(issueKeys(desktopAudit(root)), []);
    assert.equal(desktopTasks.listPisiFirstClassTasks(root).tasks[0].title, 'İlk görev');
    // İkinci açılış var olan projeye dokunmaz.
    const settled = snapshot(root);
    assert.equal((await openMobile(root).open()).created, false);
    assert.deepEqual(changedFiles(settled, snapshot(root)), []);
});
