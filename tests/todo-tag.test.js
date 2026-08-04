'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const readJson = (filePath) => JSON.parse(read(filePath));
const utilsPromise = import(
    pathToFileURL(path.join(root, 'renderer/tags/pisi-todo-utils.mjs')).href
);

test('todo önem dereceleri 1-5 ve mevcut sözdizimi korunur', async () => {
    const {
        PISI_TODO_PRIORITY_OPTIONS,
        formatPisiTodoTag
    } = await utilsPromise;

    assert.deepEqual(
        PISI_TODO_PRIORITY_OPTIONS.map(({ value, label }) => ({ value, label })),
        [
            { value: 1, label: 'very low' },
            { value: 2, label: 'low' },
            { value: 3, label: 'medium' },
            { value: 4, label: 'high' },
            { value: 5, label: 'very high' }
        ]
    );
    assert.equal(formatPisiTodoTag(3, '2026-07-30'), 'todo.3.30-07-2026');
    assert.equal(formatPisiTodoTag(5, '2026-12-01'), 'todo.5.01-12-2026');
    assert.equal(formatPisiTodoTag(6, '2026-07-30'), null);
    assert.equal(formatPisiTodoTag(0, '2026-07-30'), null);
    assert.equal(formatPisiTodoTag(3, '2026-02-30'), null);
});

test('tarihsiz görev mevcut todo sözdiziminin geriye uyumlu uzantısıdır', async () => {
    const {
        formatPisiTodoTag,
        parsePisiTodoTagValue
    } = await utilsPromise;

    assert.equal(formatPisiTodoTag(2, 'none'), 'todo.2.none');
    assert.equal(formatPisiTodoTag(2, ''), 'todo.2.none');

    const task = parsePisiTodoTagValue('..todo.2.none', new Date(2026, 7, 4));
    assert.equal(task.tag, 'todo.2.none');
    assert.equal(task.priority, 2);
    assert.equal(task.finishDate, null);
    assert.equal(task.daysLeft, null);
    assert.equal(task.dateBucket, 'undated');
    assert.equal(task.workorder, Number.POSITIVE_INFINITY);
});

test('eski 6-9 todo etiketleri very high olarak geriye dönük okunur', async () => {
    const { parsePisiTodoTagValue } = await utilsPromise;
    const now = new Date(2026, 6, 30);
    const current = parsePisiTodoTagValue('todo.4.31-07-2026', now);
    const legacy = parsePisiTodoTagValue('..todo.9.31-07-2026', now);

    assert.equal(current.priority, 4);
    assert.equal(current.priorityLabel, 'high');
    assert.equal(current.daysLeft, 1);
    assert.equal(legacy.rawPriority, 9);
    assert.equal(legacy.priority, 5);
    assert.equal(legacy.priorityLabel, 'very high');
    assert.equal(legacy.legacyPriority, true);
});

test('bugün, yaklaşan, geciken ve tarihsiz filtreleri doğru sınıflandırır', async () => {
    const {
        getPisiTodoDateBucket,
        matchesPisiTodoFilter,
        parsePisiTodoTagValue
    } = await utilsPromise;
    const now = new Date(2026, 7, 4);
    const today = parsePisiTodoTagValue('todo.3.04-08-2026', now);
    const upcoming = parsePisiTodoTagValue('todo.3.10-08-2026', now);
    const later = parsePisiTodoTagValue('todo.3.20-08-2026', now);
    const overdue = parsePisiTodoTagValue('todo.3.03-08-2026', now);
    const undated = parsePisiTodoTagValue('todo.3.none', now);

    assert.equal(getPisiTodoDateBucket(today.finishDate, now), 'today');
    assert.equal(getPisiTodoDateBucket(upcoming.finishDate, now), 'upcoming');
    assert.equal(getPisiTodoDateBucket(later.finishDate, now), 'later');
    assert.equal(getPisiTodoDateBucket(overdue.finishDate, now), 'overdue');
    assert.equal(getPisiTodoDateBucket(undated.finishDate, now), 'undated');
    assert.equal(matchesPisiTodoFilter(today, 'today', now), true);
    assert.equal(matchesPisiTodoFilter(upcoming, 'upcoming', now), true);
    assert.equal(matchesPisiTodoFilter(later, 'upcoming', now), false);
    assert.equal(matchesPisiTodoFilter(overdue, 'overdue', now), true);
    assert.equal(matchesPisiTodoFilter(undated, 'undated', now), true);
    assert.equal(matchesPisiTodoFilter(later, 'all', now), true);
});

test('görev durumları mevcut tamamlanma etiketinden bağımsız tutulur', async () => {
    const {
        PISI_TODO_STATUS_OPTIONS,
        getPisiTodoStatusOption
    } = await utilsPromise;

    assert.deepEqual(
        PISI_TODO_STATUS_OPTIONS.map(({ value }) => value),
        ['todo', 'doing', 'waiting', 'blocked']
    );
    assert.equal(getPisiTodoStatusOption('doing').label, 'Devam ediyor');
    assert.equal(getPisiTodoStatusOption('unknown').value, 'todo');

    const firstRelease = read('renderer/tags/pisi-todo-first-release.mjs');
    const editor = read('renderer/tags/pisi-tag-editor.mjs');
    const panels = read('renderer/tags/pisi-tag-panels.mjs');
    assert.match(firstRelease, /dataset\.pisiTodoStatus/);
    assert.match(firstRelease, /setPisiMissionStatusFirstRelease/);
    assert.match(editor, /markPisiMissionDone/);
    assert.match(editor, /reopenPisiMission/);
    assert.match(panels, /dataset\.pisiDoneFor/);
});

test('..todo ve seçili metin aynı öncelik/tarih akışını kullanır', () => {
    const editor = read('renderer/tags/pisi-tag-editor.mjs');
    const firstRelease = read('renderer/tags/pisi-todo-first-release.mjs');
    const css = read('styles/20-map-interactions.css');

    assert.match(editor, /isPisiTodoCommand\(command\)/);
    assert.match(editor, /openPisiTodoPriorityMenu\(editor, command\)/);
    assert.match(editor, /type="date"/);
    assert.match(editor, /formatPisiTodoTag\(priority\.value, dateValue\)/);
    assert.match(editor, /commitTodo\('none'\)/);
    assert.match(editor, /capturePisiTodoSelection\(editor\)/);
    assert.match(editor, /applyPisiTodoSelectionToEditor\(editor, todoTag, command\)/);
    assert.match(firstRelease, /className = 'pisi-todo-source'/);
    assert.match(firstRelease, /dataset\.pisiTodoFor = todoTag/);
    assert.match(firstRelease, /sourceSelection: true/);
    assert.match(css, /pisi-todo-undated/);
});

test('görev indeksi node ve map kaynağı ile durum/kaynak metnini taşır', () => {
    const index = read('renderer/tags/pisi-tag-index.mjs');
    const utils = read('renderer/tags/pisi-todo-utils.mjs');

    assert.match(index, /extractPisiTodoMetadataFromBlock/);
    assert.match(index, /mapPath: node\.mapPath \|\| null/);
    assert.match(index, /mapTitle: node\.mapTitle \|\| ''/);
    assert.match(index, /todoStates/);
    assert.match(index, /todoSources/);
    assert.match(utils, /pisi-todo-source\[data-pisi-todo-for\]/);
    assert.match(utils, /dataset\.pisiTodoStatus/);
});

test('görev kartına tıklama kaynağı açar ve node badge sayıları gösterilir', () => {
    const firstRelease = read('renderer/tags/pisi-todo-first-release.mjs');
    const editor = read('renderer/tags/pisi-tag-editor.mjs');
    const css = read('styles/50-tags-and-missions.css');

    assert.match(firstRelease, /openPisiTagBlockResult\(mission\)/);
    assert.match(firstRelease, /mapTitle.*nodeTitle/s);
    assert.match(firstRelease, /map-node-box\[data-node-path\]/);
    assert.match(firstRelease, /tree-node\[data-path\]/);
    assert.match(firstRelease, /pisi-mission-node-badge/);
    assert.match(firstRelease, /syncPisiMissionBadgesFirstRelease\(allMissions\)/);
    assert.match(editor, /highlightPisiEditorBlock\(block\.blockId, block\.todoTag\)/);
    assert.match(css, /pisi-mission-node-badge/);
});

test('Todo ilk sürüm modülü bootstrap, manifest, sanitizer ve dil kataloglarına bağlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const manifest = readJson('renderer/module-manifest.json');
    const sanitizer = read('renderer/editor/pisi-node-editor.mjs');
    const tr = readJson('locales/lang-tr.json');
    const eng = readJson('locales/lang-eng.json');

    assert.match(bootstrap, /\.\/tags\/pisi-todo-first-release\.mjs/);
    assert.ok(manifest.some((item) => item.module === 'tags.todoFirstRelease'));
    assert.match(sanitizer, /data-pisi-todo-status/);
    assert.match(sanitizer, /data-pisi-todo-for/);
    assert.equal(tr.strings['Bugün'], 'Bugün');
    assert.equal(eng.strings['Bugün'], 'Today');
    assert.equal(eng.strings['Tarihsiz'], 'No date');
    assert.equal(eng.strings['Devam ediyor'], 'In progress');
});
