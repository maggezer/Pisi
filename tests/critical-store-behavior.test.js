'use strict';

// Behavior tests for the most critical write paths: saving a document, the single
// task authority, and Trash delete/restore. They replace source-regex tests and run
// the real main-process stores (tests/main-store-harness.cjs) against a temporary
// project folder, so they behave the same on Linux, macOS and Windows.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadPisiMainStores } = require('./main-store-harness.cjs');

const modules = loadPisiMainStores();
const documentStore = modules['main.documentStore'];
const filesystemCore = modules['main.filesystemCore'];
const taskStore = modules['main.taskStore'];
const taskService = modules['main.taskService'];
const relationshipStore = modules['main.relationshipStore'];
const trashStore = modules['main.trashStore'];

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-critical-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const map = documentStore.createUniquePisiFile(project, '.map');
    assert.equal(map.ok, true, map.error);
    const first = documentStore.createNodeUnderMap(map.fullPath);
    const second = documentStore.createNodeUnderMap(map.fullPath);
    assert.equal(first.ok && second.ok, true);
    return {
        project,
        mapPath: map.fullPath,
        first: { path: first.fullPath, id: first.metadata.id },
        second: { path: second.fullPath, id: second.metadata.id }
    };
}

function mapNodeIds(mapPath) {
    return documentStore.ensurePisiFileMetadata(mapPath).data.map.nodes.map((node) => node.id);
}

function taskTitles(project) {
    return taskStore
        .readPisiTaskStore(project)
        .tasks.map((task) => task.title)
        .sort();
}

function relationshipIds(project) {
    return relationshipStore
        .readPisiRelationshipStore(project)
        .relationships.map((item) => item.id)
        .sort();
}

// A task lives in a note (by its id) or in a day's diary (docs/task-plan.md §3.1).
function addTask(project, title, note = null, extra = {}) {
    globalThis.activeProjectFolder = project;
    const target = note ? { noteId: note.id, notePath: note.path } : { diaryDate: '2026-11-21' };
    const result = taskService.createPisiTask(project, { task: { title, ...extra }, target });
    assert.equal(result.ok, true, result.error);
    return result.task;
}

function relate(project, sourceId, targetId) {
    const result = relationshipStore.upsertPisiSemanticRelationship(project, { sourceId, targetId, type: 'co-level' });
    assert.equal(result.ok, true, result.error);
    return result.relationship;
}

// Replaces data-integrity.test.js › "node document writer connectionTypes projectionını diske yazmaz".
test('kayıt: not yazıldığında connectionTypes projeksiyonu diske girmez, bellekteki nesne değişmez', (t) => {
    const { first } = makeProject(t);
    const info = documentStore.ensurePisiFileMetadata(first.path);
    const data = { ...info.data, pisi: { ...info.data.pisi, connectionTypes: { 'up-hub': ['node_x'] } }, content: '<p>Kaydedilen metin</p>' };

    filesystemCore.writePisiDocument(first.path, data);

    const onDisk = JSON.parse(fs.readFileSync(first.path, 'utf8'));
    assert.equal(onDisk.content, '<p>Kaydedilen metin</p>');
    assert.equal(onDisk.pisi.id, first.id);
    assert.equal(Object.hasOwn(onDisk.pisi, 'connectionTypes'), false);
    assert.deepEqual(data.pisi.connectionTypes, { 'up-hub': ['node_x'] }, 'the caller keeps its in-memory projection');
    assert.deepEqual(
        fs.readdirSync(path.dirname(first.path)).filter((name) => name.endsWith('.tmp')),
        [],
        'the atomic write leaves no temporary file'
    );
});

// Replaces source-of-truth.test.js › "task store tek semantik otoritedir; projection yazımları canonical store üzerinden korunur".

// Replaces trash-reversible.test.js › "deletion archives canonical tasks semantic relationships and external map references".
test('silme/geri yükleme: Trash notun görevlerini, ilişkilerini ve map üyeliğini arşivler, geri yükleme hepsini döndürür', (t) => {
    const { project, mapPath, first, second } = makeProject(t);
    addTask(project, 'Nota bağlı görev', first);
    addTask(project, 'Bağımsız görev');
    const relationship = relate(project, first.id, second.id);

    const moved = trashStore.movePisiPathToTrash(project, first.path);
    assert.equal(moved.ok, true, moved.error);
    assert.equal(moved.reversible, true);
    assert.equal(fs.existsSync(first.path), false);
    assert.deepEqual(taskTitles(project), ['Bağımsız görev']);
    assert.deepEqual(relationshipIds(project), []);
    assert.deepEqual(mapNodeIds(mapPath), [second.id]);
    assert.equal(moved.summary.taskCount, 1);
    assert.equal(moved.summary.relationshipCount, 1);
    assert.equal(moved.summary.mapReferenceCount, 1);
    assert.ok(fs.existsSync(trashStore.getPisiTrashManifestPath(project, moved.trashId)), 'the manifest lives under .pisi/trash');

    const restored = trashStore.restorePisiTrashItem(project, moved.trashId);
    assert.equal(restored.ok, true, restored.error);
    assert.equal(fs.existsSync(first.path), true);
    assert.equal(documentStore.ensurePisiFileMetadata(first.path).metadata.id, first.id);
    assert.deepEqual(taskTitles(project), ['Bağımsız görev', 'Nota bağlı görev']);
    assert.deepEqual(relationshipIds(project), [relationship.id]);
    assert.deepEqual(mapNodeIds(mapPath).sort(), [first.id, second.id].sort());
    assert.deepEqual(trashStore.listPisiTrashItems(project).items, []);
});

// Replaces trash-reversible.test.js › "restore is a delta merge rather than a whole-project snapshot overwrite".
test('silme/geri yükleme: geri yükleme silmeden sonra yapılan değişiklikleri ezmez', (t) => {
    const { project, mapPath, first, second } = makeProject(t);
    addTask(project, 'Nota bağlı görev', first);
    const third = documentStore.createNodeUnderMap(mapPath);
    const moved = trashStore.movePisiPathToTrash(project, first.path);
    assert.equal(moved.ok, true, moved.error);

    // Work done while the note sits in Trash.
    addTask(project, 'Sonradan eklenen görev', second);
    const later = relate(project, second.id, third.metadata.id);
    const secondData = documentStore.ensurePisiFileMetadata(second.path).data;
    filesystemCore.writePisiDocument(second.path, { ...secondData, content: '<p>Sonradan düzenlendi</p>' });

    const restored = trashStore.restorePisiTrashItem(project, moved.trashId);
    assert.equal(restored.ok, true, restored.error);
    assert.deepEqual(taskTitles(project), ['Nota bağlı görev', 'Sonradan eklenen görev']);
    assert.deepEqual(relationshipIds(project), [later.id]);
    assert.deepEqual(mapNodeIds(mapPath).sort(), [first.id, second.id, third.metadata.id].sort());
    assert.equal(JSON.parse(fs.readFileSync(second.path, 'utf8')).content, '<p>Sonradan düzenlendi</p>');
});

// Replaces trash-reversible.test.js › "restore fails closed on path task and semantic conflicts".
test('silme/geri yükleme: çakışmada geri yükleme hiçbir şeyi değiştirmeden reddedilir', (t) => {
    const { project, mapPath, first } = makeProject(t);
    const task = addTask(project, 'Nota bağlı görev', first);
    const moved = trashStore.movePisiPathToTrash(project, first.path);
    assert.equal(moved.ok, true, moved.error);

    // Another file now sits at the original path, and the archived task id is live again.
    fs.writeFileSync(first.path, 'başka bir dosya', 'utf8');
    addTask(project, 'Aynı kimlikli görev', null, { id: task.id });
    const tasksBefore = fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8');
    const mapBefore = fs.readFileSync(mapPath, 'utf8');

    const refused = trashStore.restorePisiTrashItem(project, moved.trashId);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'TRASH_RESTORE_CONFLICT');
    assert.deepEqual(refused.conflicts.map((conflict) => conflict.type).sort(), ['path-exists', 'task-id']);
    assert.equal(fs.readFileSync(first.path, 'utf8'), 'başka bir dosya');
    assert.equal(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8'), tasksBefore);
    assert.equal(fs.readFileSync(mapPath, 'utf8'), mapBefore);
    assert.equal(trashStore.listPisiTrashItems(project).items.length, 1, 'the Trash item is kept for a later retry');

    // Without the parent map a node cannot come back either.
    fs.rmSync(first.path);
    const state = taskStore.readPisiTaskStore(project);
    taskStore.writePisiTaskStore(project, state, state.tasks.filter((item) => item.id !== task.id));
    fs.rmSync(mapPath);
    const orphan = trashStore.restorePisiTrashItem(project, moved.trashId);
    assert.equal(orphan.code, 'TRASH_RESTORE_CONFLICT');
    assert.deepEqual(
        orphan.conflicts.map((conflict) => conflict.type),
        ['parent-missing']
    );
});
