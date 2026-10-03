'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('document store facade delegates to acyclic focused storage modules', () => {
    const facade = read('main/functions/document-store.js');
    const io = read('main/functions/document-store-io.js');
    const metadata = read('main/functions/document-store-metadata.js');
    const diary = read('main/functions/document-store-diary.js');
    const mutations = read('main/functions/document-store-mutations.js');

    assert.match(facade, /document-store-io\.js/);
    assert.match(facade, /document-store-metadata\.js/);
    assert.match(facade, /document-store-diary\.js/);
    assert.match(facade, /document-store-mutations\.js/);
    assert.match(facade, /registerMainModule\('main\.documentStore'/);
    assert.doesNotMatch(io, /document-store-(?:metadata|diary|mutations)\.js/);
    assert.doesNotMatch(metadata, /document-store-(?:diary|mutations)\.js/);
    assert.doesNotMatch(diary, /document-store-mutations\.js/);
    assert.doesNotMatch(mutations, /document-store-diary\.js/);
});

test('renderer runtime is a thin orchestrator with acyclic calendar services', () => {
    const facade = read('renderer/runtime.mjs');
    const state = read('renderer/calendar/pisi-calendar-state.mjs');
    const ui = read('renderer/calendar/pisi-calendar-ui.mjs');
    const diary = read('renderer/calendar/pisi-calendar-diary.mjs');
    const runtime = read('renderer/calendar/pisi-calendar-runtime.mjs');

    assert.match(facade, /runtime-lifecycle\.mjs/);
    assert.match(facade, /pisi-calendar-runtime\.mjs/);
    assert.match(facade, /runtime-events\.mjs/);
    assert.doesNotMatch(state, /pisi-calendar-(?:ui|diary|runtime)\.mjs/);
    assert.doesNotMatch(ui, /pisi-calendar-(?:diary|runtime)\.mjs/);
    assert.doesNotMatch(diary, /pisi-calendar-(?:ui|runtime)\.mjs/);
    assert.match(runtime, /configurePisiCalendarDiary/);
    assert.match(runtime, /setPisiCalendarDateOpenHandler/);
});

test('split core files remain below focused architecture ceilings', () => {
    const files = [
        'main/functions/document-store.js',
        'main/functions/document-store-io.js',
        'main/functions/document-store-metadata.js',
        'main/functions/document-store-diary.js',
        'main/functions/document-store-mutations.js',
        'renderer/runtime.mjs',
        'renderer/runtime-lifecycle.mjs',
        'renderer/runtime-events.mjs',
        'renderer/calendar/pisi-calendar-state.mjs',
        'renderer/calendar/pisi-calendar-ui.mjs',
        'renderer/calendar/pisi-calendar-diary.mjs',
        'renderer/calendar/pisi-calendar-runtime.mjs'
    ];
    for (const file of files) {
        const lines = read(file).split(/\r?\n/).length;
        const limit = file.startsWith('renderer/runtime') ? 300 : 650;
        assert.ok(lines <= limit, `${file} exceeds ${limit} lines: ${lines}`);
    }
});
