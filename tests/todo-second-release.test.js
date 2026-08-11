'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));
const utilsPromise = import(
    pathToFileURL(path.join(root, 'renderer/tags/pisi-todo-utils.mjs')).href
);

test('tekrarlayan görev tarihleri tüm desteklenen tekrar türlerinde ilerler', async () => {
    const {
        PISI_TODO_REPEAT_OPTIONS,
        getNextPisiTodoDate,
        getPisiTodayIsoDate
    } = await utilsPromise;

    assert.deepEqual(
        PISI_TODO_REPEAT_OPTIONS.map((option) => option.value),
        [
            'none',
            'daily',
            'weekdays',
            'weekly',
            'biweekly',
            'after-completion',
            'monthly'
        ]
    );
    assert.equal(
        getPisiTodayIsoDate(
            getNextPisiTodoDate(new Date(2026, 7, 5), 'daily')
        ),
        '2026-08-06'
    );
    assert.equal(
        getPisiTodayIsoDate(
            getNextPisiTodoDate(new Date(2026, 7, 7), 'weekdays')
        ),
        '2026-08-10'
    );
    assert.equal(
        getPisiTodayIsoDate(
            getNextPisiTodoDate(new Date(2026, 7, 5), 'weekly')
        ),
        '2026-08-12'
    );
    assert.equal(
        getPisiTodayIsoDate(
            getNextPisiTodoDate(new Date(2026, 7, 5), 'biweekly')
        ),
        '2026-08-19'
    );
    assert.equal(
        getPisiTodayIsoDate(
            getNextPisiTodoDate(
                new Date(2026, 7, 5),
                'after-completion',
                new Date(2026, 7, 20),
                3
            )
        ),
        '2026-08-23'
    );
    assert.equal(
        getPisiTodayIsoDate(
            getNextPisiTodoDate(new Date(2026, 0, 31), 'monthly')
        ),
        '2026-02-28'
    );
});

test('tekrar ve manuel sıra metadata alanları indeks ve sanitizer zincirinde korunur', () => {
    const utils = read('renderer/tags/pisi-todo-utils.mjs');
    const index = read('renderer/tags/pisi-tag-index.mjs');
    const editor = read('renderer/editor/pisi-node-editor.mjs');

    for (const token of [
        'data-pisi-todo-repeat',
        'data-pisi-todo-order'
    ]) {
        assert.match(editor, new RegExp(token));
    }
    assert.match(utils, /todoRepeats/);
    assert.match(utils, /todoOrders/);
    assert.match(index, /todoRepeats/);
    assert.match(index, /todoOrders/);
});

test('ikinci sürüm paneli alt görev arayüzü olmadan tekrar, filtre ve sürükle bırak sağlar', () => {
    const source = read('renderer/tags/pisi-todo-second-release.mjs');
    const firstRelease = read('renderer/tags/pisi-todo-first-release.mjs');
    const css = read('styles/50-tags-and-missions.css');

    assert.doesNotMatch(source, /pisi-mission-add-child/);
    assert.doesNotMatch(source, /pisi-mission-child-progress/);
    assert.doesNotMatch(source, /childCount|completedChildren|mission\.depth/);
    assert.doesNotMatch(source, /block\.todoParents/);
    assert.match(source, /Alt görev sistemi kaldırıldı/);
    assert.match(source, /createNextPisiRecurringMissionSecondRelease/);
    assert.match(source, /getPisiTodayIsoDate\(nextDate\)/);
    assert.doesNotMatch(source, /nextDate\.toISOString\(\)\.slice/);
    assert.match(source, /togglePisiMissionCompletionSecondRelease/);
    assert.match(source, /pisi-mission-drag-handle/);
    assert.match(source, /missionStatusFilter/);
    assert.match(firstRelease, /enhancePisiMissionSecondRelease/);
    assert.match(firstRelease, /matchesPisiMissionStatusFilterSecondRelease/);
    assert.match(firstRelease, /togglePisiMissionCompletionSecondRelease/);
    assert.match(css, /TODO SECOND RELEASE/);
    assert.match(css, /pisi-mission-card\.drag-over/);
});

test('manuel sıralama artık görevleri parent hiyerarşisine göre kısıtlamaz', () => {
    const source = read('renderer/tags/pisi-todo-second-release.mjs');

    assert.doesNotMatch(source, /dragged\.parentId/);
    assert.doesNotMatch(source, /dataset\.parentId/);
    assert.match(source, /list\.querySelectorAll\('\.pisi-mission-card'\)/);
    assert.match(source, /persistPisiMissionManualOrderSecondRelease\(ordered\)/);
});

test('günlük node eşitlemesi durum ve tekrar bilgisini taşır', () => {
    const runtime = read('renderer/runtime.mjs');
    const store = read('main/functions/document-store.js');

    assert.match(runtime, /status: String\(block\.todoStates/);
    assert.match(runtime, /repeat: String\(block\.todoRepeats/);
    assert.match(store, /data-pisi-diary-status/);
});

test('ikinci sürüm modülü bootstrap, manifest ve dil kataloglarına bağlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const manifest = readJson('renderer/module-manifest.json');
    const eng = readJson('locales/lang-eng.json');

    assert.match(bootstrap, /pisi-todo-second-release\.mjs/);
    assert.ok(manifest.some((entry) => entry.module === 'tags.todoSecondRelease'));
    assert.equal(eng.strings['Manuel sıra'], 'Manual order');
    assert.equal(eng.strings['Tekrarlama'], 'Repeat');
});
