'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

function replaceOnce(source, before, after, label) {
    if (!source.includes(before)) throw new Error(`Target not found: ${label}`);
    return source.replace(before, after);
}

{
    const file = 'renderer/tags/pisi-tag-index.mjs';
    let source = read(file);
    source = replaceOnce(
        source,
        "        showCompletedMissions: false,\n        missionFilter: 'all',\n        missionFilterOpen: false,\n        missionStatusFilter: 'all',\n        missionSort: 'smart'",
        "        showCompletedMissions: false, missionFilter: 'all',\n        missionFilterOpen: false,\n        missionStatusFilter: 'all', missionSort: 'smart'",
        'compact Todo state defaults'
    );
    source = replaceOnce(
        source,
        '        const {\n            todoStates,\n            todoSources,\n            todoParents,\n            todoRepeats,\n            todoOrders\n        } = extractPisiTodoMetadataFromBlock(\n            block,\n            normalizePisiUserTag\n        );',
        '        const { todoStates, todoSources, todoParents, todoRepeats, todoOrders } =\n            extractPisiTodoMetadataFromBlock(block, normalizePisiUserTag);',
        'compact Todo metadata destructuring'
    );
    source = replaceOnce(
        source,
        '            todoStates,\n            todoSources,\n            todoParents,\n            todoRepeats,\n            todoOrders,',
        '            todoStates, todoSources, todoParents,\n            todoRepeats, todoOrders,',
        'compact Todo index fields'
    );
    write(file, source);
}

{
    const file = 'styles/50-tags-and-missions.css';
    let source = read(file);
    source = replaceOnce(
        source,
        '\n.pisi-missions-toolbar-row {\n    flex-wrap: wrap;',
        '\n.pisi-missions-toolbar > .pisi-missions-toolbar-row {\n    flex-wrap: wrap;',
        'specific Todo toolbar row selector'
    );
    source = replaceOnce(
        source,
        '\n.pisi-mission-card {\n    margin-left: calc(var(--pisi-mission-depth, 0) * 15px);',
        '\n.pisi-missions-list > .pisi-mission-card {\n    margin-left: calc(var(--pisi-mission-depth, 0) * 15px);',
        'specific Todo mission card selector'
    );
    write(file, source);
}

console.log('Refined Todo second release architecture integration.');
