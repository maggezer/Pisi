'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

function replaceOnce(source, before, after, label) {
    if (!source.includes(before)) {
        throw new Error(`Target not found: ${label}`);
    }
    return source.replace(before, after);
}

{
    const file = 'renderer/tags/pisi-todo-second-release.mjs';
    let source = read(file);
    source = replaceOnce(
        source,
        '    formatPisiTodoTag,\n    getNextPisiTodoDate,',
        '    formatPisiTodoTag,\n    getNextPisiTodoDate,\n    getPisiTodayIsoDate,',
        'local date formatter import'
    );
    source = replaceOnce(
        source,
        '    const nextTag = formatPisiTodoTag(mission.priority, nextDate.toISOString().slice(0, 10));',
        '    const nextTag = formatPisiTodoTag(\n        mission.priority,\n        getPisiTodayIsoDate(nextDate)\n    );',
        'recurrence local date formatting'
    );
    write(file, source);
}

{
    const file = 'tests/todo-second-release.test.js';
    let source = read(file);
    source = replaceOnce(
        source,
        "    assert.match(source, /createNextPisiRecurringMissionSecondRelease/);",
        "    assert.match(source, /createNextPisiRecurringMissionSecondRelease/);\n    assert.match(source, /getPisiTodayIsoDate\\(nextDate\\)/);\n    assert.doesNotMatch(source, /nextDate\\.toISOString\\(\\)\\.slice/);",
        'recurrence local date regression assertions'
    );
    write(file, source);
}

console.log('Fixed recurring Todo dates to use local calendar dates.');
