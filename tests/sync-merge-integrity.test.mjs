// Merged files and conflict copies of the sync core, written into a copy of
// the desktop-made project (tests/fixtures/desktop-project), must give the
// desktop's own Project Integrity audit no new finding (docs/sync-plan.md S1.8,
// rule SV6). Each file is merged from the fixture as base and two edits.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { splitNoteBlocks } from '../shared/note-blocks.mjs';
import { listPisiDiaryTaskIds, readPisiDiaryTaskSection, replacePisiDiaryTaskSection } from '../shared/task-diary.mjs';
import { listPisiNoteTaskIds } from '../shared/task-blocks.mjs';
import { completePisiTask, readPisiTask } from '../shared/task-model.mjs';
import { makePisiSyncConflictCopy } from '../shared/sync-conflict.mjs';
import { mergePisiSyncAuthority } from '../shared/sync-merge-authority.mjs';
import { mergePisiSyncMap, serializePisiSyncJson } from '../shared/sync-merge-json.mjs';
import { mergePisiSyncNode } from '../shared/sync-merge-node.mjs';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const electronUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-integrity-userdata-'));
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
// The modules main.mjs loads before Project Integrity, in the same order.
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
    // The diary sections the desktop writes after a turn (G9) go through its internal-write marking.
    'electron-ipc'
]) {
    require(`../main/functions/${name}.js`);
}
require('../main/runtime.js');
Module._load = originalLoad;
const { modules } = require('../main/module-registry.js');
const desktopAudit = modules['main.projectIntegrity'].auditPisiProjectIntegrity;

const fixture = path.join(import.meta.dirname, 'fixtures', 'desktop-project');
const NOW = new Date(2026, 10, 16, 13, 5);
const later = (minutes) => new Date(Date.UTC(2026, 10, 16, 12, minutes)).toISOString();
const issueKeys = (report) => report.issues.map((issue) => [issue.code, issue.path, issue.entityId ?? ''].join(' | ')).sort();

function copyFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-integrity-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.cpSync(fixture, root, { recursive: true });
    for (const folder of JSON.parse(fs.readFileSync(`${fixture}.directories.json`, 'utf8'))) fs.mkdirSync(path.join(root, folder), { recursive: true });
    return root;
}

const readJson = (root, key) => JSON.parse(fs.readFileSync(path.join(root, key), 'utf8'));
const writeJson = (root, key, value) => {
    fs.mkdirSync(path.dirname(path.join(root, key)), { recursive: true });
    fs.writeFileSync(path.join(root, key), serializePisiSyncJson(value));
};

/** A copy of a note whose `index`-th block with an id gets `text` as its inside. */
function withBlockText(document, index, text) {
    const copy = structuredClone(document);
    const segments = splitNoteBlocks(copy.content);
    const target = segments.filter((segment) => segment.blockId)[index];
    copy.content = segments.map((segment) => (segment === target ? `${segment.openTag}${text}${segment.closeTag}` : segment.html)).join('');
    return copy;
}

let uuidCounter = 0;

/** Writes a conflict copy as the sync apply step would: the note, its sidecar and its attachments. */
function writeConflictCopy(root, notePath, document) {
    const copy = makePisiSyncConflictCopy({
        path: notePath,
        document,
        deviceName: 'Pixel 7',
        now: NOW,
        makeUuid: () => `0b4f6a1e-7a52-4c1e-9d55-${String((uuidCounter += 1)).padStart(12, '0')}`,
        isTaken: (candidate) => fs.existsSync(path.join(root, candidate))
    });
    writeJson(root, copy.path, copy.document);
    fs.mkdirSync(path.join(root, copy.sidecar), { recursive: true });
    for (const asset of copy.assets) {
        fs.mkdirSync(path.dirname(path.join(root, asset.to)), { recursive: true });
        fs.copyFileSync(path.join(root, asset.from), path.join(root, asset.to));
    }
    return copy;
}

test('birleşik dosyalar ve çakışma kopyaları masaüstü denetiminde yeni bulgu üretmez', (t) => {
    const root = copyFixture(t);
    const baseline = issueKeys(desktopAudit(root));
    assert.deepEqual(baseline, []);

    // 1. Proje Planı: two different blocks change → clean merge.
    const plan = readJson(root, 'Proje Planı.node');
    const planMerge = mergePisiSyncNode({
        base: plan,
        local: withBlockText(plan, 0, 'Telefonda düzenlendi'),
        remote: withBlockText(plan, 2, 'Masaüstünde düzenlendi')
    });
    assert.equal(planMerge.status, 'merged');
    writeJson(root, 'Proje Planı.node', planMerge.value);

    // 2. Toplantı Notları (Sheet, Paint, görsel, dosya): the same block changes on both sides → conflict copy with its attachments.
    const meeting = readJson(root, 'Toplantı Notları.node');
    const meetingLocal = withBlockText(meeting, 1, 'Kararlar telefonda');
    const meetingMerge = mergePisiSyncNode({ base: meeting, local: meetingLocal, remote: withBlockText(meeting, 1, 'Kararlar masaüstünde') });
    assert.equal(meetingMerge.status, 'conflict');
    writeJson(root, 'Toplantı Notları.node', meetingMerge.value);
    const meetingCopy = writeConflictCopy(root, 'Toplantı Notları.node', meetingLocal);
    assert.equal(meetingCopy.assets.length, 4);
    assert.match(meetingCopy.path, /^Toplantı Notları \(çakışma 16-11-2026 13\.05 Pixel 7\)\.node$/);

    // 3. A note with task blocks: its conflict copy keeps the text, not the tasks.
    const planCopy = writeConflictCopy(root, 'Proje Planı.node', withBlockText(readJson(root, 'Proje Planı.node'), 0, 'Plan (telefon)'));
    assert.doesNotMatch(planCopy.document.content, /pisi-todo-source|data-pisi-todo-status|pisi-user-tag/);
    assert.ok(listPisiNoteTaskIds(readJson(root, 'Proje Planı.node').content).length > 0, 'asıl notta görev blokları var');
    assert.deepEqual(listPisiNoteTaskIds(planCopy.document.content), [], 'kopyada görev bloğu yok (G9)');

    // 4. A diary day with the desktop's task section: its copy is a normal note at the root.
    const diaryKey = 'diary/2026-11-14.node';
    const diaryCopy = writeConflictCopy(root, diaryKey, withBlockText(readJson(root, diaryKey), 0, 'Telefonda yazılan gün'));
    assert.equal(diaryCopy.path, 'Günlük çakışması 14-11-2026 (Pixel 7).node');
    assert.equal(readPisiDiaryTaskSection(diaryCopy.document.content).count, 0, 'kopyada görev bölümü yok (G9)');

    // 5. A diary day both devices created: one file, both texts.
    const template = readJson(root, 'diary/2026-11-12.node');
    const day = (id, text, minute) => {
        const document = withBlockText(structuredClone(template), 0, text);
        document.pisi = {
            ...document.pisi,
            id,
            title: '15-11-2026',
            sidecar: `inv_15-11-2026__${id}`,
            diaryDate: '2026-11-15',
            createdAt: later(minute),
            updatedAt: later(minute)
        };
        document.content = document.content.replace(/data-pisi-block-id="[^"]+"/, `data-pisi-block-id="blk_${id.slice(5)}"`);
        // A day without tasks has no task section (the template's is 12 November's, §3.2.2).
        document.content = replacePisiDiaryTaskSection(document.content, '2026-11-15', []);
        return document;
    };
    const dayMerge = mergePisiSyncNode({
        local: day('node_7d0c2a54-1111-4c3b-9e2f-000000000001', 'Telefon', 1),
        remote: day('node_7d0c2a54-2222-4c3b-9e2f-000000000002', 'Masaüstü', 2),
        diary: true
    });
    assert.equal(dayMerge.status, 'merged');
    writeJson(root, 'diary/2026-11-15.node', dayMerge.value);
    fs.mkdirSync(path.join(root, 'diary', dayMerge.value.pisi.sidecar), { recursive: true });

    // 6. tasks.json: the phone completes a task, the desktop renames it and reprioritises another.
    const tasks = readJson(root, '.pisi/tasks.json');
    const tasksLocal = structuredClone(tasks);
    Object.assign(tasksLocal.tasks[0], { status: 'done', completedAt: later(5), updatedAt: later(5) });
    tasksLocal.updatedAt = later(5);
    const tasksRemote = structuredClone(tasks);
    Object.assign(tasksRemote.tasks[0], { title: 'Raporu gönder (güncel)', updatedAt: later(6) });
    Object.assign(tasksRemote.tasks[1], { priority: 5, updatedAt: later(6) });
    tasksRemote.updatedAt = later(6);
    const tasksMerge = mergePisiSyncAuthority('.pisi/tasks.json', tasks, tasksLocal, tasksRemote);
    assert.deepEqual(tasksMerge.conflicts, []);
    assert.deepEqual([tasksMerge.value.tasks[0].status, tasksMerge.value.tasks[0].title], ['done', 'Raporu gönder (güncel)']);
    writeJson(root, '.pisi/tasks.json', tasksMerge.value);

    // 6b. (G9) Both devices complete the same occurrence of the daily "Egzersiz" and a day's section
    // differs on both sides: one completion, one move on; the desktop writes the sections from the rule.
    const service = modules['main.taskService'];
    const merged = readJson(root, '.pisi/tasks.json');
    const index = merged.tasks.findIndex((record) => record.title === 'Egzersiz');
    const completeAt = (minute) => {
        const copy = structuredClone(merged);
        copy.tasks[index] = completePisiTask(copy.tasks[index], { now: new Date(2026, 10, 16, 13, minute) }).task;
        copy.updatedAt = copy.tasks[index].updatedAt;
        return copy;
    };
    const twice = mergePisiSyncAuthority('.pisi/tasks.json', merged, completeAt(10), completeAt(20));
    const exercise = twice.value.tasks[index];
    assert.equal(exercise.completions.length, 1, 'tek tamamlama');
    assert.equal(exercise.dueDate, '2026-11-17', 'tek ilerleme');
    assert.deepEqual(
        twice.conflicts.map((conflict) => [conflict.field, conflict.kind]),
        [['completions', 'completion']]
    );
    writeJson(root, '.pisi/tasks.json', twice.value);
    const dayKey = 'diary/2026-11-14.node';
    const before14 = readJson(root, dayKey);
    const stand = (ids) => ({ ...before14, content: replacePisiDiaryTaskSection(before14.content, '2026-11-14', ids) });
    const sectionMerge = mergePisiSyncNode({ base: before14, local: stand([merged.tasks[3].id]), remote: stand([merged.tasks[4].id]), diary: true });
    assert.equal(sectionMerge.status, 'merged', 'bölüm farkı çakışma değildir');
    writeJson(root, dayKey, sectionMerge.value);
    const rewritten = service.rewritePisiDiarySectionsForTaskChange(root, merged.tasks, twice.value.tasks, { days: ['2026-11-14'] });
    assert.deepEqual(rewritten.days, ['2026-11-14', '2026-11-16', '2026-11-17']);
    const rule = (day) => listPisiDiaryTaskIds(day, twice.value.tasks.map(readPisiTask).filter(Boolean));
    for (const day of rewritten.days) assert.deepEqual(readPisiDiaryTaskSection(readJson(root, `diary/${day}.node`).content).taskIds, rule(day), day);
    // A day given only as a diary the turn wrote is never created, and a correct section is not written again.
    const stamp = fs.statSync(path.join(root, dayKey)).mtimeMs;
    const again = service.rewritePisiDiarySectionsForTaskChange(root, twice.value.tasks, twice.value.tasks, { days: ['2026-11-14', '2026-11-25'] });
    assert.deepEqual([again.context.writtenDiaries, again.context.createdDiaries], [[], []]);
    assert.equal(fs.existsSync(path.join(root, 'diary/2026-11-25.node')), false);
    assert.equal(fs.statSync(path.join(root, dayKey)).mtimeMs, stamp);

    // 7. relationships.json: a second parent from the local side is dropped; a stream link and a label stay.
    const relationships = readJson(root, '.pisi/relationships.json');
    const [edge] = relationships.relationships;
    const inboxId = readJson(root, 'Toplantı Notları.node').pisi.id;
    const relationshipsLocal = structuredClone(relationships);
    relationshipsLocal.relationships.push(
        { ...edge, id: 'edge_0f1e2d3c-0000-4000-8000-000000000001', sourceId: inboxId, createdAt: later(3), updatedAt: later(3) },
        {
            ...edge,
            id: 'edge_0f1e2d3c-0000-4000-8000-000000000002',
            sourceId: edge.targetId,
            targetId: inboxId,
            type: 'stream',
            sourceRole: 'downstream',
            targetRole: 'upstream',
            createdAt: later(3),
            updatedAt: later(3)
        }
    );
    const relationshipsRemote = structuredClone(relationships);
    Object.assign(relationshipsRemote.relationships[0], { label: 'alt konu', updatedAt: later(4) });
    const relationshipsMerge = mergePisiSyncAuthority('.pisi/relationships.json', relationships, relationshipsLocal, relationshipsRemote);
    assert.deepEqual(
        relationshipsMerge.conflicts.map((conflict) => conflict.reason),
        ['second-parent']
    );
    assert.equal(relationshipsMerge.value.relationships.length, 2);
    writeJson(root, '.pisi/relationships.json', relationshipsMerge.value);

    // 8. properties.json and the map.
    // The fixture has no property schema since G2 (no Inbox `systemRole`); start from an empty one.
    const properties = fs.existsSync(path.join(root, '.pisi/properties.json'))
        ? readJson(root, '.pisi/properties.json')
        : { version: 1, definitions: [], conflicts: [], updatedAt: '2026-11-14T09:30:00.000Z' };
    const propertiesLocal = structuredClone(properties);
    propertiesLocal.definitions.push({ id: 'durum', name: 'Durum', type: 'text' });
    writeJson(root, '.pisi/properties.json', mergePisiSyncAuthority('.pisi/properties.json', properties, propertiesLocal, properties).value);
    const mapKey = 'Yol Haritası.map';
    const map = readJson(root, mapKey);
    const mapLocal = structuredClone(map);
    mapLocal.map.nodes[1].x = 400;
    const mapRemote = structuredClone(map);
    mapRemote.map.camera = { x: 30, y: 10, zoom: 1.5 };
    mapRemote.map.collapsedHubs = [map.map.nodes[0].id];
    const mapMerge = mergePisiSyncMap(map, mapLocal, mapRemote);
    assert.deepEqual(mapMerge.conflicts, []);
    writeJson(root, mapKey, mapMerge.value);

    const audit = desktopAudit(root);
    assert.deepEqual(
        issueKeys(audit).filter((key) => !baseline.includes(key)),
        [],
        JSON.stringify(audit.issues, null, 2)
    );
    // Every id is used once: the copies have new ids.
    const ids = [];
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.pisi')) walk(full);
            } else if (/\.(?:node|map)$/.test(entry.name)) ids.push(JSON.parse(fs.readFileSync(full, 'utf8')).pisi.id);
        }
    };
    walk(root);
    assert.equal(new Set(ids).size, ids.length);
});
