// The desktop keeps its file paths, export names and registry bindings, but the
// rules behind them live in shared/. These tests check that the desktop really
// runs the shared code (same function objects) and that the parts left on the
// desktop (clock, randomness, disk) wrap it without changing what is written.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import * as sharedDateParser from '../shared/date-parser.mjs';
import * as sharedDiaryRules from '../shared/diary-rules.mjs';
import * as sharedDocumentModel from '../shared/document-model.mjs';
import * as sharedDocumentNaming from '../shared/document-naming.mjs';
import * as sharedIds from '../shared/ids.mjs';
import * as sharedTaskModel from '../shared/task-model.mjs';
import * as sharedTaskViews from '../shared/task-views.mjs';
import * as sharedWikiLinkCore from '../shared/wiki-link-core.mjs';
import * as rendererDateParser from '../renderer/productivity/pisi-date-parser.mjs';
import * as rendererTodoUtils from '../renderer/tags/pisi-todo-utils.mjs';
import * as rendererWikiLinkCore from '../renderer/editor/pisi-wiki-link-core.mjs';
import * as mainWikiLinkCore from '../main/functions/wiki-link-core.js';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
const pathSecurity = modules['main.pathSecurity'];
const filesystemCore = modules['main.filesystemCore'];
const documentStore = modules['main.documentStore'];
const taskStore = modules['main.taskStore'];
const taskCapture = modules['main.taskCapture'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeProject(t) {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-shared-wrappers-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    return project;
}

function assertSameBindings(wrapper, shared, names, label) {
    for (const name of names) {
        assert.notEqual(shared[name], undefined, `${label}: shared has no ${name}`);
        assert.equal(wrapper[name], shared[name], `${label}: ${name} is not the shared implementation`);
    }
}

test('renderer ve main sarmalayıcıları shared fonksiyonlarının kendisini dışa aktarır', () => {
    assertSameBindings(rendererDateParser, sharedDateParser, Object.keys(rendererDateParser), 'pisi-date-parser.mjs');
    assert.deepEqual(Object.keys(rendererDateParser).sort(), Object.keys(sharedDateParser).sort());

    assertSameBindings(rendererWikiLinkCore, sharedWikiLinkCore, Object.keys(rendererWikiLinkCore), 'pisi-wiki-link-core.mjs');
    assertSameBindings(mainWikiLinkCore, sharedWikiLinkCore, Object.keys(mainWikiLinkCore), 'wiki-link-core.js');
    // Main and renderer used to keep two copies of these; now there is one.
    for (const name of [
        'isPisiWikiNodeId',
        'isPisiWikiBlockId',
        'escapePisiWikiHtml',
        'normalizePisiWikiTitle',
        'parsePisiWikiTarget',
        'makePisiWikiLinkHtml'
    ]) {
        assert.equal(mainWikiLinkCore[name], rendererWikiLinkCore[name], name);
    }

    const desktopOnly = [
        'PISI_TODO_SORT_OPTIONS',
        'PISI_TODO_STATUS_FILTER_OPTIONS',
        'getPisiTodoSortOption',
        'getPisiTodoStatusFilterOption',
        'extractPisiTodoMetadataFromBlock'
    ];
    const shared = { ...sharedTaskModel, ...sharedTaskViews };
    assertSameBindings(
        rendererTodoUtils,
        shared,
        Object.keys(rendererTodoUtils).filter((name) => !desktopOnly.includes(name)),
        'pisi-todo-utils.mjs'
    );
    for (const name of desktopOnly) assert.notEqual(rendererTodoUtils[name], undefined, name);
});

test('main registry adlandırma ve kimlik kurallarını shared üzerinden sunar', () => {
    const naming = [
        'isPisiVisibleFile',
        'isPisiManagedSidecarFolder',
        'getPisiFileExt',
        'getPisiTypeFromExt',
        'getPisiSidecarPrefix',
        'sanitizePisiBaseName',
        'stripPisiIdSuffix',
        'sanitizeForSidecarName'
    ];
    assertSameBindings(pathSecurity, sharedDocumentNaming, naming, 'main.pathSecurity');
    assertSameBindings(pathSecurity, sharedIds, ['normalizePisiId'], 'main.pathSecurity');
    assertSameBindings(filesystemCore, sharedDocumentNaming, ['getPisiSidecarName'], 'main.filesystemCore');
    assertSameBindings(documentStore, sharedDiaryRules, ['normalizePisiDiaryIsoDate', 'makePisiDiaryNodeTitle'], 'main.documentStore');

    // Other main modules reach these as bare globals; the global is the same function.
    for (const name of [...naming, 'normalizePisiId', 'getPisiSidecarName', 'normalizePisiDiaryIsoDate', 'makePisiDiaryNodeTitle']) {
        assert.equal(globalThis[name], { ...sharedDocumentNaming, ...sharedIds, ...sharedDiaryRules }[name], name);
    }
});

test('generatePisiId shared biçimine rastgele bir UUID koyar', () => {
    const nodeId = pathSecurity.generatePisiId('.node');
    const mapId = pathSecurity.generatePisiId('.map');

    assert.match(nodeId, /^node_/);
    assert.match(mapId, /^map_/);
    assert.match(nodeId.slice('node_'.length), UUID);
    assert.equal(nodeId, sharedIds.formatPisiDocumentId('.node', nodeId.slice('node_'.length)));
    assert.equal(sharedIds.normalizePisiId(nodeId, '.node'), nodeId);
    assert.equal(sharedIds.normalizePisiId(mapId, '.map'), mapId);
    assert.notEqual(pathSecurity.generatePisiId('.node'), nodeId);
});

test('createPisiDocumentData shared iskeletini o anın saatiyle doldurur', () => {
    const before = Date.now();
    const created = filesystemCore.createPisiDocumentData({ ext: '.node', title: 'Not', id: 'node_abc', parentMap: 'map_1' });
    const after = Date.now();

    assert.deepEqual(
        created,
        sharedDocumentModel.makePisiDocumentData({ ext: '.node', title: 'Not', id: 'node_abc', parentMap: 'map_1', now: created.pisi.createdAt })
    );
    const writtenAt = Date.parse(created.pisi.createdAt);
    assert.ok(writtenAt >= before && writtenAt <= after);
    assert.equal(new Date(writtenAt).toISOString(), created.pisi.createdAt);
});

test('görünen başlık ve boş dosya adı araması shared adaylarını kullanır', (t) => {
    assert.equal(pathSecurity.getVisibleTitleFromFilePath(path.join('x', 'Not__node_1.node'), '.node', 'node_1'), 'Not');
    assert.equal(pathSecurity.getVisibleTitleFromFilePath(path.join('x', 'CON.map'), '.map'), '_CON');

    const project = makeProject(t);
    const candidate = (attempt) => path.join(project, sharedDocumentNaming.getPisiPhysicalFileName('Not', '.node', 'node_1', attempt));
    const next = (currentPath = null) => pathSecurity.getUniquePisiPhysicalPath(project, 'Not', '.node', 'node_1', currentPath);

    for (let attempt = 0; attempt < 4; attempt += 1) {
        assert.equal(next(), candidate(attempt));
        // A document keeps its own name when it is the one occupying it.
        if (attempt > 0) assert.equal(next(candidate(attempt - 1)), candidate(attempt - 1));
        fs.writeFileSync(candidate(attempt), '{}');
    }
    assert.equal(path.basename(next()), 'Not__node_1_3.node');
});

test('günlük notu shared kurallarıyla oluşturulur: yol, işaretçi ve belge verisi', (t) => {
    const project = makeProject(t);
    const isoDate = '2026-10-21';

    assert.equal(documentStore.getPisiDiaryNodePath(project, isoDate), path.join(project, ...sharedDiaryRules.getPisiDiaryNodeKey(isoDate).split('/')));

    const result = documentStore.getOrCreateDiaryNode(project, isoDate);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.fullPath, documentStore.getPisiDiaryNodePath(project, isoDate));

    const diaryFolder = path.join(project, sharedDiaryRules.PISI_DIARY_FOLDER);
    assert.equal(fs.readFileSync(path.join(diaryFolder, sharedDiaryRules.PISI_DIARY_MARKER_FILE), 'utf8'), sharedDiaryRules.PISI_DIARY_MARKER_TEXT);

    const written = JSON.parse(fs.readFileSync(result.fullPath, 'utf8'));
    assert.deepEqual(written, sharedDiaryRules.makePisiDiaryDocumentData({ isoDate, id: written.pisi.id, now: written.pisi.createdAt }));
    assert.equal(fs.statSync(path.join(diaryFolder, written.pisi.sidecar)).isDirectory(), true);
    assert.deepEqual(documentStore.listPisiDiaryDates(project), { ok: true, dates: [isoDate] });
});

test('görev deposu shared kaydını yazar; saat, UUID ve yol çözümü masaüstünden gelir', (t) => {
    const project = makeProject(t);
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 13, 6, 30, 15, 123) });
    const payload = {
        id: 'task_wrapper1',
        title: '  Raporu   yaz ',
        priority: 4,
        dueDate: '2026-11-20',
        repeat: 'Weekly',
        source: { nodePath: path.join(project, 'notlar', 'a.node'), blockId: ' blk_1 ' }
    };

    const result = taskStore.upsertPisiFirstClassTask(project, structuredClone(payload));
    assert.equal(result.ok, true);

    const expected = sharedTaskModel.normalizePisiTaskRecord(payload, null, {
        now: new Date(),
        makeUuid: () => assert.fail('a valid id must not be replaced'),
        normalizeStoredPath: (value) => (value ? path.relative(project, value).split(path.sep).join('/') : null)
    });
    assert.equal(expected.source.nodePath, 'notlar/a.node');
    const stored = JSON.parse(fs.readFileSync(path.join(project, '.pisi', 'tasks.json'), 'utf8'));
    assert.deepEqual(stored.tasks, [expected]);
    assert.equal(JSON.stringify(stored.tasks[0]), JSON.stringify(expected));
    // The API hands back absolute paths; the file keeps project-relative ones.
    assert.equal(result.task.source.nodePath, path.join(project, 'notlar', 'a.node'));

    const generated = taskStore.upsertPisiFirstClassTask(project, { title: 'Kimliksiz', id: 'geçersiz' });
    assert.match(generated.task.id, /^task_/);
    assert.match(generated.task.id.slice('task_'.length), UUID);
    assert.throws(
        () => taskStore.upsertPisiFirstClassTask(project, { title: 'Dışarıda', source: { nodePath: path.join(project, '..', 'x.node') } }),
        /proje klasörünün dışında/
    );
});

test('kaynak görev kimliği ve hızlı ekleme shared biçimlerini kullanır', (t) => {
    assert.equal(taskStore.getPisiTaskIdForSource('notes\\a.node', 'blk_1', 'todo.3.none'), 'task_source_640e449a1418dc29');
    assert.equal(
        taskStore.getPisiTaskIdForSource('notes/a.node', 'blk_1', 'todo.3.none'),
        sharedIds.formatPisiSourceTaskId('notes/a.node', 'blk_1', 'todo.3.none')
    );

    const project = makeProject(t);
    const captured = taskCapture.quickAddPisiTask(project, { text: 'Hızlı görev', repeat: 'BIWEEKLY', priority: 2 });
    assert.equal(captured.ok, true, captured.error);
    assert.match(captured.task.blockId, /^blk_/);
    assert.match(captured.task.blockId.slice('blk_'.length), UUID);
    assert.equal(captured.task.blockId, sharedIds.formatPisiBlockId(captured.task.blockId.slice('blk_'.length)));

    const note = JSON.parse(fs.readFileSync(captured.task.nodePath, 'utf8'));
    assert.ok(note.content.includes(`data-pisi-block-id="${captured.task.blockId}"`));
    assert.ok(note.content.includes('data-pisi-todo-repeat="biweekly"'));
    assert.equal(
        captured.task.taskId,
        sharedIds.formatPisiSourceTaskId(
            sharedIds.normalizePisiTaskIdentityPath(captured.task.nodePath, process.platform === 'win32'),
            captured.task.blockId,
            captured.task.todoTag
        )
    );

    const unknownRepeat = taskCapture.quickAddPisiTask(project, { text: 'Bilinmeyen tekrar', repeat: 'yearly' });
    const refreshed = JSON.parse(fs.readFileSync(unknownRepeat.task.nodePath, 'utf8'));
    assert.equal(refreshed.content.split('data-pisi-todo-repeat="none"').length - 1, 1);
});
