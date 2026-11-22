// Desktop compatibility of the mobile data layer (docs/mobile-plan.md M4, rule V10).
// The mobile repos run over a copy of a project the desktop app created
// (tests/fixtures/desktop-project, built by scripts/electron-mobile-fixture-e2e.mjs),
// and then the desktop's own code judges the result: Project Integrity must find
// nothing new (its task audit checks every diary section against the day rule,
// docs/task-plan.md G8) and the desktop task store must read what mobile wrote.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createNodeFsDriver } from '../mobile/src/data/drivers/node-fs-driver.mjs';
import { splitNoteBlocks } from '../shared/note-blocks.mjs';
import { inlineToHtml, parseInlineHtml } from '../mobile/src/data/note-inline.mjs';
import { makeBlockHtml } from '../mobile/src/data/note-patch.mjs';
import { createProject } from '../mobile/src/data/project-repo.mjs';
import { getCalendarMarks } from '../mobile/src/screens/calendar/calendar-model.mjs';
import { parseTaskDraft } from '../mobile/src/screens/pisi/day-model.mjs';
import { getTaskChoicePatch, getTaskDatePatch, getTaskReminderPatch, getTaskTimePatch } from '../mobile/src/screens/tasks/task-edit.mjs';
import { buildTaskLists } from '../mobile/src/screens/tasks/view-model.mjs';
import { getCalendarTaskSummaryByDate } from '../renderer/calendar/pisi-calendar-ui.mjs';
import { collectPisiCollapsedHubNodeIds, isPisiMapEdgeHiddenByCollapsedHub } from '../shared/map-view.mjs';
import { readPisiTask } from '../shared/task-model.mjs';
import { listPisiDiaryTaskIds, makePisiDiaryTaskSectionHtml } from '../shared/task-diary.mjs';
import { filterPisiTasks } from '../shared/task-views.mjs';

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
    Menu: quiet(),
    nativeImage: quiet(),
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
    'task-store',
    'trash-store',
    'task-service',
    'structured-nodes',
    'property-schema-store',
    'property-schema-mutations',
    'project-integrity',
    // The map operations (connections, views) the M9 test builds a map with, and the IPC module they bind to.
    'electron-ipc',
    'map-semantic-operation-hooks'
]) {
    require(`../main/functions/${name}.js`);
}
// Constants the stores read as registry globals (connection keys).
require('../main/runtime.js');
Module._load = originalLoad;
const { modules } = require('../main/module-registry.js');
const desktopAudit = modules['main.projectIntegrity'].auditPisiProjectIntegrity;
const desktopTasks = modules['main.taskService'];
const desktopDocuments = modules['main.documentStore'];
const desktopMaps = modules['main.mapStore'];
const desktopMapSemantics = modules['main.mapSemanticOperationHooks'];
const desktopRelationships = modules['main.relationshipStore'];
const desktopStructuredNodes = modules['main.structuredNodes'];

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
    const [mapEntry] = await project.maps.list();
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
            ['paragraph', true],
            // The task block (docs/task-plan.md §3.2.1): a protected block that only carries the task id.
            ['task', false]
        ]
    );
    assert.equal(diary.text, 'Plan belgesini okudum.');
    assert.deepEqual([mapEntry.nodeCount, map.nodes.length, map.edges.length, map.edges[0].sourcePort], [2, 2, 1, 'bottom']);
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
    // The desktop reports nothing for its own untouched project.
    assert.deepEqual(baseline, []);
    const before = snapshot(root);
    const storeBefore = readJson(root, '.pisi/tasks.json');
    const meetingBefore = readJson(root, 'Toplantı Notları.node');
    const diaryBefore = readJson(root, `diary/${TODAY}.node`);

    const project = openMobile(root);
    await project.open();
    await project.index.build();
    const byTitle = (title) => storeBefore.tasks.find((task) => task.title === title);

    // Görev ekle (bugünün günlüğüne), not görevini tamamla, tekrar eden görevi ve geciken tekrarı tamamla (§3.2.3).
    const added = await project.tasks.create({ title: '  Mobilden   eklenen görev ', priority: 2, dueTime: '16:00' }, { diaryDate: TODAY });
    const completed = await project.tasks.complete(byTitle('Raporu gönder').id);
    const daily = await project.tasks.complete(byTitle('Egzersiz').id);
    const weekly = await project.tasks.complete(byTitle('Haftalık özet yaz').id);
    // Sheet bloğu olan notta tek bir paragrafı düzenle.
    const target = (await project.notes.read('Toplantı Notları.node')).blocks.filter((block) => block.editable)[1];
    const edited = await project.notes.updateContent('Toplantı Notları.node', [
        { op: 'replace', blockId: target.blockId, html: 'Kararlar mobilde güncellendi &amp; kaydedildi.' }
    ]);
    // Yeni not oluştur, bugünün günlüğünü yaz, ertesi günün (görevin ilerlediği gün) günlüğüne yaz.
    const created = await project.notes.create({ title: 'Mobil Not', text: 'İlk paragraf.\n\nİkinci paragraf\nikinci satır.' });
    const todayDiary = await project.diary.setText(TODAY, 'Bugün mobilden yazdım.');
    const nextDiary = await project.diary.setText('2026-11-15', 'Yeni günün ilk satırı.');
    const emptyDiary = await project.diary.setText('2026-11-16', '   ');
    await project.flush();

    assert.ok(added.ok && completed.ok && daily.ok && weekly.ok && edited.changed && created.ok && todayDiary.changed && nextDiary.changed);
    assert.deepEqual([emptyDiary.changed, fs.existsSync(path.join(root, 'diary/2026-11-16.node'))], [false, false], 'boş günlük dosyası oluşmaz');

    // (a) Masaüstü Project Integrity denetimi yeni bulgu üretmiyor; her günlüğün bölümü gün kuralına uyuyor.
    const audit = desktopAudit(root);
    assert.deepEqual(
        issueKeys(audit).filter((key) => !baseline.includes(key)),
        []
    );

    // (b) Yalnız ilgili dosyalar değişti: görevin günleri değişen günlükler (13-11: haftalık görev çıktı; 14-11: geciken tamamlandı ve
    // yeni görev girdi; 15-11: günlük görev ilerledi, günlük oluştu; 20-11: haftalık görev ilerledi), düzenlenen not ve yeni not.
    // Tekrarsız görev bitiş gününde tamamlandı: hiçbir günlük yazılmadı (§3.2.2).
    const after = snapshot(root);
    const sidecar = (key) => readJson(root, key).pisi.sidecar;
    assert.deepEqual(changedFiles(before, after), [
        '.pisi/tasks.json',
        'Mobil Not.node',
        'Toplantı Notları.node',
        'diary/2026-11-13.node',
        'diary/2026-11-14.node',
        'diary/2026-11-15.node',
        'diary/2026-11-20.node'
    ]);
    assert.deepEqual([completed.days.written, completed.days.created], [[], []]);
    assert.deepEqual(daily.days.created, ['2026-11-15']);
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
    // Görevin tamamlanması ve düzenlenmesi notu değiştirmez; not yalnız görevin kimliğini taşır (GV2).
    assert.equal(differing.length, 1);

    // Günlüklerin görev bölümü yalnız kimlik taşır, kuraldan üretilmiştir ve günün son bloğudur; metin ondan önce gelir.
    const storeAfter = readJson(root, '.pisi/tasks.json');
    const tasksAfter = storeAfter.tasks.map(readPisiTask);
    for (const day of ['2026-11-13', TODAY, '2026-11-15', '2026-11-20']) {
        const content = readJson(root, `diary/${day}.node`).content;
        const section = makePisiDiaryTaskSectionHtml(day, listPisiDiaryTaskIds(day, tasksAfter));
        assert.ok(content.endsWith(section), `${day}: bölüm kuraldan üretilir`);
    }
    const diaryAfter = readJson(root, `diary/${TODAY}.node`);
    assert.ok(diaryBefore.content.includes('data-pisi-task-ref='));
    assert.match(diaryAfter.content, /^<div class="pisi-editor-block" data-pisi-block-id="blk_[^"]+"[^>]*>Bugün mobilden yazdım\.<\/div>/);
    assert.ok(!diaryAfter.content.includes('Mobilden eklenen görev'), 'başlık günlüğe yazılmaz');
    assert.match(
        readJson(root, 'diary/2026-11-15.node').content,
        /^<div class="pisi-editor-block" data-pisi-block-id="blk_[^"]+"[^>]*>Yeni günün ilk satırı\.<\/div>/
    );

    // (d) tasks.json sürüm 2; bilinmeyen alanlar ve diğer kayıtlar korunmuş (GV12).
    const touched = new Set([completed.task.id, daily.task.id, weekly.task.id]);
    assert.equal(storeAfter.version, 2);
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
    // Tekrar eden görev yeni kayıt açmaz: tamamlama completions'a yazılır, görev ilerler (§3.2.3).
    assert.equal(storeAfter.tasks.length, storeBefore.tasks.length + 1);
    assert.deepEqual(
        [daily.task.dueDate, daily.task.status, daily.task.completions],
        ['2026-11-15', 'todo', [{ date: TODAY, dueDate: TODAY, at: NOW.toISOString() }]]
    );
    // Geciken haftalık tekrar: tamamlama bugün, 13-11 tekrarı için; görev bugünden sonraki ilk tekrara (20-11) ilerler.
    assert.deepEqual([weekly.task.dueDate, weekly.task.completions], ['2026-11-20', [{ date: TODAY, dueDate: '2026-11-13', at: NOW.toISOString() }]]);
    assert.deepEqual([completed.task.status, completed.task.completedOn, completed.task.noteId], ['done', TODAY, byTitle('Raporu gönder').noteId]);

    // (e) Masaüstü görev servisi mobilin yazdığı görevleri okuyor: kayıtlar masaüstünün okuduğu biçimde, alan alan aynı.
    const desktopList = desktopTasks.listPisiTasks(root);
    assert.equal(desktopList.tasks.length, storeAfter.tasks.length);
    for (const written of [added.task, completed.task, daily.task, weekly.task]) {
        const stored = storeAfter.tasks.find((task) => task.id === written.id);
        assert.deepEqual(readPisiTask(stored), stored, 'kayıt kanonik sürüm 2 kaydıdır');
        assert.deepEqual(
            desktopList.tasks.find((task) => task.id === written.id),
            readPisiTask(stored)
        );
    }
    assert.deepEqual(
        [added.task.title, added.task.dueDate, added.task.dueTime, added.task.diaryDate, added.task.noteId, /^task_[0-9a-f-]{36}$/.test(added.task.id)],
        ['Mobilden eklenen görev', TODAY, '16:00', TODAY, null, true]
    );

    // Denetim gerçekten çalışıyor: masaüstü kuralına uymayan bir kayıt yeni bulgu olarak görünür.
    const tampered = copyFixture(t);
    const tamperedStore = readJson(tampered, '.pisi/tasks.json');
    tamperedStore.tasks[0].priority = 9;
    fs.writeFileSync(path.join(tampered, '.pisi', 'tasks.json'), JSON.stringify(tamperedStore));
    assert.ok(issueKeys(desktopAudit(tampered)).some((key) => key.startsWith('task-field-invalid')));

    // Aynı işlemleri yinelemek dosyaları yeniden yazmaz (V4).
    const settled = snapshot(root);
    await project.tasks.complete(completed.task.id);
    await project.tasks.update(added.task.id, { title: 'Mobilden eklenen görev' });
    await project.notes.updateContent('Toplantı Notları.node', [
        { op: 'replace', blockId: target.blockId, html: 'Kararlar mobilde güncellendi &amp; kaydedildi.' }
    ]);
    await project.diary.setText(TODAY, 'Bugün mobilden yazdım.');
    await project.flush();
    assert.deepEqual(changedFiles(settled, snapshot(root)), []);
});

test('Görevler sekmesi (M6, G8): hızlı eklenen ve detayda düzenlenen görevler masaüstüyle uyumludur, listeler masaüstüyle aynıdır', async (t) => {
    const root = copyFixture(t);
    addUnknownTaskFields(root);
    const baseline = issueKeys(desktopAudit(root));
    const before = snapshot(root);
    const storeBefore = readJson(root, '.pisi/tasks.json');
    const project = openMobile(root);
    await project.open();
    const stored = async (id) => (await project.tasks.list()).tasks.find((task) => task.id === id);
    const edit = async (id, patchOf) => {
        const patch = patchOf(await stored(id));
        return patch ? project.tasks.update(id, patch) : { ok: true, changed: false };
    };

    // Hızlı ekle: masaüstüyle aynı ayrıştırıcı; öncelik çipten gelir; görev bugünün günlüğünde durur.
    const quick = async (text, priority) => project.tasks.create({ ...parseTaskDraft(text, { now: NOW }).payload, priority }, { diaryDate: TODAY });
    const weekly = await quick('her pazartesi 14:00 haftalık rapor', 4);
    const tomorrow = await quick('yarın 9.30 diş hekimi', 3);
    const undated = await quick('Kitap listesi', 5);
    const far = await quick('25.12 yıl sonu raporu', 2);
    // Detay: tarih, saat, öncelik, tekrar ve hatırlatma alanları tek tek değişir.
    await edit(tomorrow.task.id, (task) => getTaskDatePatch(task, '2026-11-18'));
    await edit(tomorrow.task.id, (task) => getTaskTimePatch(task, '16:45'));
    await edit(tomorrow.task.id, (task) => getTaskChoicePatch(task, 'priority', '1'));
    await edit(tomorrow.task.id, (task) => getTaskChoicePatch(task, 'repeat', 'monthly'));
    await edit(tomorrow.task.id, (task) => getTaskChoicePatch(task, 'reminderMode', 'day-before'));
    await edit(tomorrow.task.id, (task) => getTaskReminderPatch(task, '2026-11-17T09:00'));
    await edit(far.task.id, (task) => getTaskDatePatch(task, null));
    await edit(undated.task.id, (task) => getTaskDatePatch(task, TODAY));
    // Nottaki görev telefonda bütün alanlarıyla düzenlenir (G8, pisi-error.md §5d); yeri (noteId) korunur, not yazılmaz.
    const noteTask = storeBefore.tasks.find((task) => task.title === 'Sunucu faturasını öde');
    const noteEdit = await edit(noteTask.id, () => ({ title: 'Telefonda düzenlendi', priority: 1, dueDate: '2026-12-01' }));
    await edit(noteTask.id, () => ({ status: 'waiting' }));
    await project.flush();

    assert.equal(noteEdit.changed, true);
    // Yalnız tasks.json ve görevlerin günlerinin günlükleri yazıldı; hiçbir not dosyası değişmedi (GV5).
    assert.deepEqual(changedFiles(before, snapshot(root)), [
        '.pisi/tasks.json',
        'diary/2026-11-14.node',
        'diary/2026-11-15.node',
        'diary/2026-11-16.node',
        'diary/2026-11-18.node',
        'diary/2026-11-20.node',
        'diary/2026-12-01.node',
        'diary/2026-12-25.node'
    ]);
    assert.deepEqual(
        issueKeys(desktopAudit(root)).filter((key) => !baseline.includes(key)),
        []
    );

    const storeAfter = readJson(root, '.pisi/tasks.json');
    const find = (id) => storeAfter.tasks.find((task) => task.id === id);
    assert.deepEqual(
        [weekly, tomorrow, undated, far].map(({ task }) => {
            const { title, priority, dueDate, dueTime, repeat, reminderMode, reminderAt, diaryDate } = find(task.id);
            return [title, priority, dueDate, dueTime, repeat, reminderMode, reminderAt, diaryDate];
        }),
        [
            ['her pazartesi 14:00 haftalık rapor', 4, '2026-11-16', '14:00', 'weekly', 'none', null, TODAY],
            ['yarın 9.30 diş hekimi', 1, '2026-11-18', '16:45', 'monthly', 'day-before', '2026-11-17T09:00', TODAY],
            ['Kitap listesi', 5, TODAY, null, 'none', 'none', null, TODAY],
            ['25.12 yıl sonu raporu', 2, null, null, 'none', 'none', null, TODAY]
        ]
    );
    // Nottaki görev: alanlar değişti, yeri ve kimliği aynı.
    assert.deepEqual(
        [find(noteTask.id).title, find(noteTask.id).priority, find(noteTask.id).dueDate, find(noteTask.id).status, find(noteTask.id).noteId],
        ['Telefonda düzenlendi', 1, '2026-12-01', 'waiting', noteTask.noteId]
    );
    for (const task of storeBefore.tasks) if (task.id !== noteTask.id) assert.deepEqual(find(task.id), task);
    assert.deepEqual(storeAfter.futureSetting, { keep: ['me', 1] });

    // Masaüstü görev servisi aynı kayıtları okur; telefonun yazdığı kayıt kanonik sürüm 2 kaydıdır.
    const desktopList = desktopTasks.listPisiTasks(root);
    assert.equal(desktopList.tasks.length, storeAfter.tasks.length);
    for (const { task } of [weekly, tomorrow, undated, far]) {
        const record = find(task.id);
        assert.deepEqual(readPisiTask(record), record);
        assert.deepEqual(
            desktopList.tasks.find((item) => item.id === task.id),
            record
        );
    }

    // Mobilin görünümleri, masaüstü görev panelinin tarih süzgeçleriyle aynı görevleri listeler:
    // panel bitmiş görevleri gizler ve kalanları görevin gününe (dueDate) göre süzer (shared/task-views.mjs).
    const lists = buildTaskLists(storeAfter.tasks.map(readPisiTask), { today: TODAY });
    const desktopView = (filter) =>
        filterPisiTasks(storeAfter.tasks.map(readPisiTask), { dateFilter: filter, today: TODAY })
            .map((task) => task.title)
            .sort();
    const mobileView = (...names) =>
        names
            .flatMap((name) => lists[name])
            .map((entry) => entry.task.title)
            .sort();
    assert.deepEqual(mobileView('today'), desktopView('today'));
    assert.deepEqual(mobileView('week'), desktopView('upcoming'));
    assert.deepEqual(mobileView('overdue'), desktopView('overdue'));
    assert.deepEqual(mobileView('undated'), desktopView('undated'));
    assert.deepEqual(mobileView('today', 'week', 'later', 'overdue', 'undated'), desktopView('all'));
    assert.deepEqual(mobileView('today'), ['Egzersiz', 'Kitap listesi', 'Raporu gönder']);
    // The note task moved to 2026-12-01 above, so it is later, not this week.
    assert.deepEqual(mobileView('week'), ['her pazartesi 14:00 haftalık rapor', 'yarın 9.30 diş hekimi']);
    assert.deepEqual(mobileView('undated'), ['25.12 yıl sonu raporu', 'Okuma listesini düzenle']);
});

/** Every diary's content, by file name. */
function diaryContents(root) {
    const folder = path.join(root, 'diary');
    return Object.fromEntries(
        fs
            .readdirSync(folder)
            .filter((name) => name.endsWith('.node'))
            .sort()
            .map((name) => [name, JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')).content])
    );
}

test('GV15: aynı görev işlemlerinden masaüstü servisi ve mobil depo aynı tasks.json kayıtlarını ve bayt bayt aynı günlük bölümlerini üretir', async (t) => {
    const desktopRoot = copyFixture(t);
    const mobileRoot = copyFixture(t);
    const store = readJson(desktopRoot, '.pisi/tasks.json');
    const idOf = (title) => store.tasks.find((task) => task.title === title).id;
    const clock = { now: new Date(NOW) };
    desktopTasks.setPisiTaskServiceClock(() => new Date(clock.now));
    t.after(() => desktopTasks.setPisiTaskServiceClock(null));
    const phone = createProject({ driver: createNodeFsDriver(mobileRoot), now: () => new Date(clock.now), makeUuid: () => crypto.randomUUID() });
    await phone.open();
    const A = 'task_parity-0001';
    const B = 'task_parity-0002';

    // Each step runs on both copies: the desktop's task commands, the phone's TaskRepo.
    const steps = [
        [
            'günlükte saatli görev',
            () => desktopTasks.createPisiTask(desktopRoot, { task: { id: A, title: 'A', dueTime: '08:15' }, target: { diaryDate: TODAY } }),
            () => phone.tasks.create({ id: A, title: 'A', dueTime: '08:15' }, { diaryDate: TODAY })
        ],
        [
            'başka güne tarihli günlük görevi',
            () => desktopTasks.createPisiTask(desktopRoot, { task: { id: B, title: 'B', dueDate: '2026-11-25' }, target: { diaryDate: '2026-11-18' } }),
            () => phone.tasks.create({ id: B, title: 'B', dueDate: '2026-11-25' }, { diaryDate: '2026-11-18' })
        ],
        [
            'günlük tekrar tamamlanır',
            () => desktopTasks.completePisiTaskCommand(desktopRoot, { taskId: idOf('Egzersiz') }),
            () => phone.tasks.complete(idOf('Egzersiz'))
        ],
        [
            'geciken haftalık tekrar tamamlanır',
            () => desktopTasks.completePisiTaskCommand(desktopRoot, { taskId: idOf('Haftalık özet yaz') }),
            () => phone.tasks.complete(idOf('Haftalık özet yaz'))
        ],
        [
            'not görevinin günü değişir',
            () => desktopTasks.updatePisiTask(desktopRoot, { taskId: idOf('Sunucu faturasını öde'), patch: { dueDate: '2026-12-01' } }),
            () => phone.tasks.update(idOf('Sunucu faturasını öde'), { dueDate: '2026-12-01' })
        ],
        [
            'en son tamamlama geri alınır',
            () => desktopTasks.reopenPisiTaskCommand(desktopRoot, { taskId: idOf('Egzersiz') }),
            () => phone.tasks.reopen(idOf('Egzersiz'))
        ],
        [
            'başlık değişir (hiçbir günlük yazılmaz)',
            () => desktopTasks.updatePisiTask(desktopRoot, { taskId: A, patch: { title: 'A (yeni)' } }),
            () => phone.tasks.update(A, { title: 'A (yeni)' })
        ],
        [
            'iki gün sonra: tarihli görev erken tamamlanır',
            () => desktopTasks.completePisiTaskCommand(desktopRoot, { taskId: B }),
            () => phone.tasks.complete(B),
            new Date(2026, 10, 16, 18, 0)
        ]
    ];
    for (const [name, desktop, mobile, at] of steps) {
        if (at) clock.now = at;
        const desktopResult = desktop();
        const mobileResult = await mobile();
        assert.equal(desktopResult.ok, true, `${name}: masaüstü ${desktopResult.error || ''}`);
        assert.equal(mobileResult.ok, true, `${name}: mobil`);
        await phone.flush();
        assert.deepEqual(diaryContents(mobileRoot), diaryContents(desktopRoot), `${name}: günlükler`);
        assert.deepEqual(readJson(mobileRoot, '.pisi/tasks.json').tasks, readJson(desktopRoot, '.pisi/tasks.json').tasks, `${name}: görev kayıtları`);
    }
    // The diaries a task joined were created on both sides with the same content: the desktop's empty diary and the section.
    assert.deepEqual(Object.keys(diaryContents(mobileRoot)), [
        '2026-11-12.node',
        '2026-11-13.node',
        '2026-11-14.node',
        '2026-11-15.node',
        '2026-11-16.node',
        '2026-11-18.node',
        '2026-11-20.node',
        '2026-11-25.node',
        '2026-12-01.node'
    ]);
    assert.deepEqual(issueKeys(desktopAudit(mobileRoot)), []);
});

test('Notlar (M7): editörün yamaları yalnız dokunulan blokları değiştirir; bilinmeyen bloklar ve değişmeyen notlar bayt bayt kalır', async (t) => {
    const root = copyFixture(t);
    // Masaüstünün ileride yazabileceği, mobilin tanımadığı bir blok ve bir link (bilinmeyeni koru, V3/V8).
    const planKey = 'Proje Planı.node';
    const planFile = path.join(root, planKey);
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const future =
        '<div class="pisi-editor-block pisi-callout" data-pisi-block-id="blk_future" data-pisi-block-type="callout" data-pisi-callout="warn">Gelecek</div>';
    const link = '<a class="pisi-wiki-link" data-pisi-node-id="node_x" data-pisi-node-title="Toplantı Notları" contenteditable="false">Toplantı Notları</a>';
    const planBlocks = splitNoteBlocks(plan.content);
    plan.content =
        planBlocks[0].html +
        future +
        planBlocks[1].html.replace(/>([^<]*)<\/div>$/, `>$1 ${link}</div>`) +
        planBlocks
            .slice(2)
            .map((block) => block.html)
            .join('');
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
    const baseline = issueKeys(desktopAudit(root));
    const before = snapshot(root);
    const meetingBefore = readJson(root, 'Toplantı Notları.node');
    const planBefore = readJson(root, planKey);

    const project = openMobile(root);
    await project.open();
    await project.index.build();
    // Değişmeyen bir notu açıp kapatmak hiçbir şey yazmaz.
    const diaryKey = 'diary/2026-11-20.node';
    const diaryNote = await project.notes.read(diaryKey);
    assert.ok(
        diaryNote.blocks.some((block) => block.blockType === 'diary-tasks' && !block.editable),
        'günlüğün görev bölümü salt okunurdur'
    );
    const noop = await project.notes.updateContent(diaryKey, [], { expectedContent: diaryNote.data.content });
    assert.equal(noop.changed, false);

    // Toplantı Notları: ilk paragraf başlık 2 olur ve kalın yazı alır; Sheet'ten hemen sonra (kimliği yok) bir madde,
    // görselden sonra numaralı bir madde eklenir. Bunlar editörün takePatch() ile ürettiği işlemlerdir.
    const meeting = await project.notes.read('Toplantı Notları.node');
    const sheetAt = meeting.blocks.findIndex((block) => block.blockType === 'sheet');
    const imageAt = meeting.blocks.findIndex((block) => block.blockType === 'image');
    const bullet = makeBlockHtml('bullet', 'blk_11111111-1111-4111-8111-111111111111', 'Tablodan sonraki madde');
    const number = makeBlockHtml('number', 'blk_22222222-2222-4222-8222-222222222222', 'Görselden sonra');
    const edited = await project.notes.updateContent(
        'Toplantı Notları.node',
        [
            {
                op: 'replace',
                index: 0,
                blockId: meeting.blocks[0].blockId,
                type: 'heading2',
                html: inlineToHtml(parseInlineHtml('Gündem: <b>mobil</b> veri katmanı'))
            },
            { op: 'insert', afterIndex: sheetAt, html: bullet },
            { op: 'insert', afterIndex: imageAt, html: number }
        ],
        { expectedContent: meeting.data.content }
    );
    // Proje Planı: linkli paragrafta yalnız metin değişir, link karakter karakter kalır.
    const planNote = await project.notes.read(planKey);
    const linked = planNote.blocks.find((block) => block.inner?.includes('pisi-wiki-link'));
    assert.equal(linked.editable, true);
    const futureBlock = planNote.blocks.find((block) => block.blockId === 'blk_future');
    assert.deepEqual([futureBlock.blockType, futureBlock.editable], ['unknown', false]);
    const nodes = parseInlineHtml(linked.inner);
    nodes[0] = { type: 'text', text: `Mobilde: ${nodes[0].text}` };
    await project.notes.updateContent(
        planKey,
        [{ op: 'replace', index: planNote.blocks.indexOf(linked), blockId: linked.blockId, html: inlineToHtml(nodes) }],
        {
            expectedContent: planNote.data.content
        }
    );
    // Başlığı ve biçimli blokları olan yeni not.
    const created = await project.notes.create({
        title: 'Mobil Liste',
        blocks: [
            { type: 'heading1', text: 'Alışveriş' },
            { type: 'bullet', text: 'Süt' },
            { type: 'number', text: 'Ekmek' },
            { type: 'paragraph', text: 'Not: <ucuz> olanı al' }
        ]
    });
    await project.flush();
    assert.ok(edited.changed && created.ok);

    // Masaüstü denetimi yeni bulgu bulmuyor; yalnız düzenlenen ve oluşturulan notlar değişti.
    assert.deepEqual(
        issueKeys(desktopAudit(root)).filter((key) => !baseline.includes(key)),
        []
    );
    assert.deepEqual(changedFiles(before, snapshot(root)), ['Mobil Liste.node', planKey, 'Toplantı Notları.node']);

    // Toplantı Notları: yalnız ilk blok değişti, iki blok eklendi; Sheet, Paint, görsel ve dosya aynı.
    const meetingAfter = readJson(root, 'Toplantı Notları.node');
    assert.deepEqual(
        { ...meetingAfter, content: '', pisi: { ...meetingAfter.pisi, updatedAt: '' } },
        { ...meetingBefore, content: '', pisi: { ...meetingBefore.pisi, updatedAt: '' } }
    );
    const beforeHtml = splitNoteBlocks(meetingBefore.content).map((block) => block.html);
    const expected = [...beforeHtml];
    expected[0] = beforeHtml[0]
        .replace('<div class="pisi-editor-block"', '<h2 class="pisi-editor-block"')
        .replace('data-pisi-block-type="paragraph"', 'data-pisi-block-type="heading2"')
        .replace('Gündem: mobil veri katmanı</div>', 'Gündem: <b>mobil</b> veri katmanı</h2>');
    expected.splice(imageAt + 1, 0, number);
    expected.splice(sheetAt + 1, 0, bullet);
    assert.deepEqual(
        splitNoteBlocks(meetingAfter.content).map((block) => block.html),
        expected
    );
    // Yeni bloklar masaüstü editörünün makePisiBlockHtml biçimindedir ve mobil tarafından düzenlenebilir okunur.
    assert.deepEqual(
        splitNoteBlocks(meetingAfter.content)
            .filter((block) => block.editable)
            .map((block) => block.blockType),
        ['heading2', 'paragraph', 'bullet', 'number', 'paragraph']
    );

    // Proje Planı: bilinmeyen blok ve link aynen; yalnız linkli paragrafın metni değişti.
    const planAfter = readJson(root, planKey);
    assert.ok(planAfter.content.includes(future));
    assert.ok(planAfter.content.includes(` ${link}</div>`));
    assert.equal(
        planAfter.content,
        planBefore.content.replace(linked.html, linked.html.replace(`>${nodes[0].text.slice('Mobilde: '.length)}`, `>${nodes[0].text}`))
    );

    // Yeni not: başlık, liste ve kaçışlı metin masaüstü biçiminde.
    const list = readJson(root, 'Mobil Liste.node');
    assert.deepEqual(
        splitNoteBlocks(list.content).map((block) => [block.tag, block.blockType, block.editable, block.inner]),
        [
            ['h1', 'heading1', true, 'Alışveriş'],
            ['div', 'bullet', true, 'Süt'],
            ['div', 'number', true, 'Ekmek'],
            ['div', 'paragraph', true, 'Not: &lt;ucuz&gt; olanı al']
        ]
    );
    assert.doesNotMatch(list.content + meetingAfter.content + planAfter.content, /data-block-id|pisi-note-|blob:|data-type=/);

    // Dosya editör açıkken başka yerden değiştiyse yama uygulanmaz.
    const stale = meeting.data.content;
    await assert.rejects(project.notes.updateContent('Toplantı Notları.node', [{ op: 'remove', index: 1 }], { expectedContent: stale }), {
        code: 'NOTE_CHANGED'
    });
    await project.flush();
    assert.equal(readJson(root, 'Toplantı Notları.node').content, meetingAfter.content);
});

/**
 * The marks of the desktop calendar for a project folder: its own task summary
 * (renderer/calendar/pisi-calendar-ui.mjs, over the tasks the desktop task
 * store reads) and its own diary day list, in the shape of the mobile marks.
 */
function desktopCalendarMarks(root) {
    const previousWindow = globalThis.window;
    const tasks = desktopTasks.listPisiTasks(root).tasks;
    globalThis.window = { getPisiTasks: () => tasks };
    try {
        const summary = getCalendarTaskSummaryByDate();
        const days = (keep) =>
            [...summary]
                .filter(([, entry]) => keep(entry))
                .map(([day]) => day)
                .sort();
        return {
            tasks: days((entry) => entry.open > 0),
            tasksDone: days((entry) => entry.total > 0 && entry.open === 0),
            diary: [...desktopDocuments.listPisiDiaryDates(root).dates].sort()
        };
    } finally {
        globalThis.window = previousWindow;
    }
}

const sortedMarks = (marks) => ({ tasks: [...marks.tasks].sort(), tasksDone: [...marks.tasksDone].sort(), diary: [...marks.diary].sort() });

test('Takvim (M8): mobil takvimin noktaları masaüstü takviminin gün özetiyle birebir aynıdır, mobil yazdıktan sonra da', async (t) => {
    const root = copyFixture(t);
    const before = snapshot(root);
    const project = openMobile(root);
    await project.open();
    const mobileMarks = async () => sortedMarks(getCalendarMarks((await project.tasks.list()).tasks, await project.diary.listDates()));

    // Masaüstünün oluşturduğu proje: açık görevli günler, hepsi biten gün ve günlük günleri.
    assert.deepEqual(await mobileMarks(), desktopCalendarMarks(root));
    assert.deepEqual(await mobileMarks(), {
        tasks: ['2026-11-13', '2026-11-14', '2026-11-20'],
        tasksDone: ['2026-11-12'],
        diary: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-20']
    });
    // Takvimi çizmek için okumak hiçbir dosyayı değiştirmez.
    assert.deepEqual(changedFiles(before, snapshot(root)), []);

    // Pisi sekmesinde yapılanlar: 20 Kasım'ın tek görevi tamamlanır, 21 Kasım'a günlük ve saatli görev yazılır.
    const store = readJson(root, '.pisi/tasks.json');
    await project.tasks.complete(store.tasks.find((task) => task.title === 'Sunucu faturasını öde').id);
    await project.diary.setText('2026-11-21', 'Takvimden açılan gün.');
    await project.tasks.create({ title: 'Cumartesi işi', dueTime: '09:00' }, { diaryDate: '2026-11-21' });
    await project.flush();

    const after = await mobileMarks();
    assert.deepEqual(after, desktopCalendarMarks(root));
    assert.deepEqual(after.tasksDone, ['2026-11-12', '2026-11-20']);
    assert.ok(after.tasks.includes('2026-11-21') && after.diary.includes('2026-11-21'));
});

/**
 * Builds a richer map on the fixture's "Yol Haritası" with the desktop's own map operations:
 * more notes in its sidecar folder, a standalone reference, every connection kind (one with a
 * colour, a second hierarchy parent the desktop stores as a stream), a relationship without a
 * view on the map, a view whose other end is not on the map, a collapsed hub, and two notes
 * added last that have no stored layout yet.
 */
function buildDesktopMap(root) {
    globalThis.activeProjectFolder = root;
    const mapPath = path.join(root, 'Yol Haritası.map');
    const mapData = () => readJson(root, 'Yol Haritası.map');
    const sidecar = path.join(root, mapData().pisi.sidecar);
    const mapId = mapData().pisi.id;
    const [hub, child] = mapData().map.nodes.map((node) => node.id);
    const newNote = () => desktopDocuments.createUniquePisiFile(sidecar, '.node', { parentMap: mapId }).metadata.id;
    const third = newNote();
    const fourth = newNote();
    const planId = readJson(root, 'Proje Planı.node').pisi.id;
    const outsideId = readJson(root, 'Toplantı Notları.node').pisi.id;
    assert.equal(
        desktopStructuredNodes.attachPisiMapReference(mapPath, { id: planId, path: 'Proje Planı.node' }, { x: 900, y: 420, width: 220, height: 92 }).ok,
        true
    );
    const connect = (edge) => assert.equal(desktopMapSemantics.upsertPisiMapSemanticConnection(mapPath, edge).ok, true, JSON.stringify(edge));
    connect({ sourceId: child, targetId: third, type: 'down-hub', sourcePort: 'bottom', targetPort: 'top' });
    connect({ sourceId: hub, targetId: fourth, type: 'stream', sourcePort: 'right', targetPort: 'left', customization: { color: '#FF0000' } });
    connect({ sourceId: fourth, targetId: planId, type: 'co-level', sourcePort: 'bottom', targetPort: 'top' });
    connect({ sourceId: planId, targetId: third, type: 'down-hub', sourcePort: 'left', targetPort: 'right', confirmSecondParentAsStream: true });
    assert.equal(desktopRelationships.upsertPisiSemanticRelationship(root, { sourceId: hub, targetId: planId, type: 'co-level' }).ok, true);
    const outside = desktopRelationships.upsertPisiSemanticRelationship(root, { sourceId: hub, targetId: outsideId, type: 'stream' });
    assert.equal(desktopMapSemantics.persistPisiRelationshipView(mapPath, outside.relationship, { sourcePort: 'top', targetPort: 'bottom' }).ok, true);
    assert.equal(desktopMaps.saveMapCamera(mapPath, { x: 12, y: 34, zoom: 0.8, collapsedHubs: [`${child}::bottom`] }).ok, true);
    newNote();
    newNote();
    return { mapPath, ids: { hub, child, third, fourth, planId } };
}

test('Haritalar (M9): mobil harita masaüstünün çizdiği notları, yerleşimleri ve bağlantıları birebir okur; hiçbir dosyayı değiştirmez', async (t) => {
    const root = copyFixture(t);
    const { ids } = buildDesktopMap(root);
    // The desktop writes default layouts the first time it opens the map, so it reads a twin of the project.
    const twin = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-compat-map-'));
    t.after(() => fs.rmSync(twin, { recursive: true, force: true }));
    fs.cpSync(root, twin, { recursive: true });
    t.after(() => (globalThis.activeProjectFolder = null));

    const before = snapshot(root);
    const project = openMobile(root);
    await project.open();
    await project.index.build();
    const [entry] = await project.maps.list();
    const mobile = await project.maps.read(entry.key);
    await project.flush();
    assert.deepEqual(changedFiles(before, snapshot(root)), []);

    globalThis.activeProjectFolder = twin;
    const desktop = desktopMapSemantics.getPisiMapSemanticProjection(path.join(twin, 'Yol Haritası.map'));
    assert.equal(desktop.ok, true, desktop.error);
    const rel = (fullPath) => path.relative(twin, fullPath).split(path.sep).join('/');

    // Notes: the same members in the same order, with the same layout (default slots included) and reference flag.
    assert.deepEqual(
        mobile.nodes.map((node) => [node.id, node.key, node.layout, node.isReference]),
        desktop.nodes.map((node) => [node.id, rel(node.fullPath), node.layout, node.isReference])
    );
    assert.equal(entry.nodeCount, desktop.nodes.length);
    assert.equal(mobile.nodes.length, 7);
    // Connections: the desktop's projection of relationships.json through the map's views.
    const shape = (edge) => [edge.id, edge.sourceId, edge.targetId, edge.type, edge.sourcePort, edge.targetPort, edge.customization?.color ?? null];
    assert.deepEqual(mobile.edges.map(shape), desktop.edges.map(shape));
    assert.deepEqual(
        mobile.edges.map((edge) => [edge.sourceId, edge.targetId, edge.type]),
        [
            [ids.hub, ids.child, 'down-hub'],
            [ids.child, ids.third, 'down-hub'],
            [ids.hub, ids.fourth, 'stream'],
            [ids.fourth, ids.planId, 'co-level'],
            [ids.planId, ids.third, 'stream']
        ]
    );
    // Collapsed hub: what the desktop map hides (its shared rule over its own edges) is what mobile hides.
    const collapsed = desktop.map.data.map.collapsedHubs;
    const hidden = collectPisiCollapsedHubNodeIds(desktop.edges, collapsed);
    assert.deepEqual(
        mobile.nodes.filter((node) => node.hidden).map((node) => node.id),
        desktop.nodes.filter((node) => hidden.has(node.id)).map((node) => node.id)
    );
    assert.deepEqual(
        mobile.edges.filter((edge) => edge.hidden).map((edge) => edge.id),
        desktop.edges.filter((edge) => isPisiMapEdgeHiddenByCollapsedHub(edge, hidden, collapsed)).map((edge) => edge.id)
    );
    assert.deepEqual([...hidden], [ids.third]);
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
    await assert.rejects(project.tasks.create({ title: 'Yazılmamalı' }, { diaryDate: TODAY }), { code: 'READ_ONLY' });
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
    await project.tasks.create({ title: 'İlk görev', repeat: 'weekly' }, { diaryDate: TODAY });
    await project.notes.create({ title: 'İlk not', text: 'Merhaba.' });
    await project.diary.setText(TODAY, 'İlk gün.');
    await project.flush();

    assert.equal(opened.created, true);
    assert.deepEqual(fs.readdirSync(root).sort(), ['.pisi', 'diary', 'inv_İlk not__' + readJson(root, 'İlk not.node').pisi.id, 'İlk not.node'].sort());
    assert.equal(fs.readFileSync(path.join(root, 'diary', '.pisi-diary'), 'utf8'), 'Bu klasör PISI diary özelliği tarafından yönetilir.\n');
    assert.deepEqual(issueKeys(desktopAudit(root)), []);
    assert.equal(desktopTasks.listPisiTasks(root).tasks[0].title, 'İlk görev');
    // İkinci açılış var olan projeye dokunmaz.
    const settled = snapshot(root);
    assert.equal((await openMobile(root).open()).created, false);
    assert.deepEqual(changedFiles(settled, snapshot(root)), []);
});
