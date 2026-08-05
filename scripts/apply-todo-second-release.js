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

function replaceRegexOnce(source, pattern, after, label) {
    if (!pattern.test(source)) {
        throw new Error(`Pattern not found: ${label}`);
    }
    pattern.lastIndex = 0;
    return source.replace(pattern, after);
}

// Bootstrap
{
    const file = 'renderer/bootstrap.mjs';
    let source = read(file);
    source = replaceOnce(
        source,
        'import "./tags/pisi-tag-editor.mjs";\nimport "./tags/pisi-todo-first-release.mjs";',
        'import "./tags/pisi-tag-editor.mjs";\nimport "./tags/pisi-todo-second-release.mjs";\nimport "./tags/pisi-todo-first-release.mjs";',
        'Todo second release bootstrap import'
    );
    write(file, source);
}

// Module manifest
{
    const file = 'renderer/module-manifest.json';
    const manifest = JSON.parse(read(file));
    const existing = manifest.findIndex((entry) => entry.module === 'tags.todoSecondRelease');
    if (existing >= 0) manifest.splice(existing, 1);
    const target = manifest.findIndex((entry) => entry.module === 'tags.todoFirstRelease');
    if (target < 0) throw new Error('Todo first release manifest entry not found.');
    manifest.splice(target, 0, {
        module: 'tags.todoSecondRelease',
        path: 'renderer/tags/pisi-todo-second-release.mjs',
        bindings: [
            'pisiTodoSecondReleaseState',
            'makePisiMissionIdSecondRelease',
            'enhancePisiMissionSecondRelease',
            'sortPisiMissionsSecondRelease',
            'matchesPisiMissionStatusFilterSecondRelease',
            'appendPisiMissionSecondReleaseToolbar',
            'enhancePisiMissionCardSecondRelease',
            'setPisiMissionRepeatSecondRelease',
            'setPisiMissionOrderSecondRelease',
            'addPisiSubtaskSecondRelease',
            'createNextPisiRecurringMissionSecondRelease',
            'togglePisiMissionCompletionSecondRelease',
            'persistPisiMissionManualOrderSecondRelease'
        ]
    });
    write(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

// Persist new metadata through the editor sanitizer.
{
    const file = 'renderer/editor/pisi-node-editor.mjs';
    let source = read(file);
    source = replaceOnce(
        source,
        "        'data-pisi-todo-status',\n        'data-pisi-todo-for'",
        "        'data-pisi-todo-status',\n        'data-pisi-todo-for',\n        'data-pisi-todo-parent',\n        'data-pisi-todo-repeat',\n        'data-pisi-todo-order'",
        'Todo second release sanitizer attributes'
    );
    write(file, source);
}

// Extend mission index metadata and state defaults.
{
    const file = 'renderer/tags/pisi-tag-index.mjs';
    let source = read(file);
    source = replaceOnce(
        source,
        "        showCompletedMissions: false,\n        missionFilter: 'all'",
        "        showCompletedMissions: false,\n        missionFilter: 'all',\n        missionFilterOpen: false,\n        missionStatusFilter: 'all',\n        missionSort: 'smart'",
        'Todo second release state defaults'
    );
    source = replaceOnce(
        source,
        '        const { todoStates, todoSources } = extractPisiTodoMetadataFromBlock(\n            block,\n            normalizePisiUserTag\n        );',
        '        const {\n            todoStates,\n            todoSources,\n            todoParents,\n            todoRepeats,\n            todoOrders\n        } = extractPisiTodoMetadataFromBlock(\n            block,\n            normalizePisiUserTag\n        );',
        'Todo second release metadata destructuring'
    );
    source = replaceOnce(
        source,
        '            todoStates,\n            todoSources,\n            doneFor:',
        '            todoStates,\n            todoSources,\n            todoParents,\n            todoRepeats,\n            todoOrders,\n            doneFor:',
        'Todo second release index fields'
    );
    write(file, source);
}

// Wire second release behavior into the existing mission renderer.
{
    const file = 'renderer/tags/pisi-todo-first-release.mjs';
    let source = read(file);

    const missionPattern = /            missions\.push\(\{\n([\s\S]*?)                completed\n            \}\);/;
    const missionMatch = source.match(missionPattern);
    if (!missionMatch) throw new Error('Mission construction block not found.');
    const missionBody = missionMatch[1];
    const missionReplacement = [
        '            const mission = {',
        missionBody.replace(/^/gm, ''),
        '                completed',
        '            };',
        '            missions.push(',
        "                typeof window.enhancePisiMissionSecondRelease === 'function'",
        '                    ? window.enhancePisiMissionSecondRelease(mission, block)',
        '                    : mission',
        '            );'
    ].join('\n');
    source = source.replace(missionPattern, missionReplacement);

    source = replaceOnce(
        source,
        '    });\n    return missions;\n}\n\nfunction escapePisiTodoRegExp',
        "    });\n    return typeof window.sortPisiMissionsSecondRelease === 'function'\n        ? window.sortPisiMissionsSecondRelease(missions)\n        : missions;\n}\n\nfunction escapePisiTodoRegExp",
        'Todo second release hierarchy sort'
    );

    source = replaceOnce(
        source,
        "    const missions = completionFiltered.filter((mission) => {\n        return matchesPisiTodoFilter(mission, filter);\n    });",
        "    const missions = completionFiltered.filter((mission) => {\n        return matchesPisiTodoFilter(mission, filter) &&\n            (typeof window.matchesPisiMissionStatusFilterSecondRelease !== 'function' ||\n                window.matchesPisiMissionStatusFilterSecondRelease(mission));\n    });",
        'Todo second release status filter'
    );

    source = replaceOnce(
        source,
        '    toolbarRow.appendChild(filterMenu);\n\n    const completedToggle',
        "    toolbarRow.appendChild(filterMenu);\n    if (typeof window.appendPisiMissionSecondReleaseToolbar === 'function') {\n        window.appendPisiMissionSecondReleaseToolbar({\n            toolbarRow,\n            allMissions: completionFiltered,\n            render: renderPisiMissionsPanelFirstRelease\n        });\n    }\n\n    const completedToggle",
        'Todo second release toolbar controls'
    );

    source = replaceOnce(
        source,
        "        card.dataset.dateBucket = mission.dateBucket;\n        card.classList.toggle('completed', mission.completed === true);",
        "        card.dataset.dateBucket = mission.dateBucket;\n        card.dataset.missionId = mission.missionId || '';\n        card.dataset.parentId = mission.parentId || '';\n        card.classList.toggle('completed', mission.completed === true);",
        'Todo second release card datasets'
    );

    source = replaceOnce(
        source,
        "        const checkbox = card.querySelector('.pisi-mission-check');",
        "        if (typeof window.enhancePisiMissionCardSecondRelease === 'function') {\n            window.enhancePisiMissionCardSecondRelease({\n                card,\n                mission,\n                missions,\n                list,\n                render: renderPisiMissionsPanelFirstRelease\n            });\n        }\n\n        const checkbox = card.querySelector('.pisi-mission-check');",
        'Todo second release card enhancement'
    );

    source = replaceOnce(
        source,
        "            const result = checkbox.checked\n                ? await markPisiMissionDone(mission)\n                : await reopenPisiMission(mission);",
        "            const result = typeof window.togglePisiMissionCompletionSecondRelease === 'function'\n                ? await window.togglePisiMissionCompletionSecondRelease(\n                    mission,\n                    checkbox.checked\n                )\n                : (checkbox.checked\n                    ? await markPisiMissionDone(mission)\n                    : await reopenPisiMission(mission));",
        'Todo second release completion behavior'
    );

    source = replaceOnce(
        source,
        "        element.dataset.pisiTodoStatus = String(options.status || 'todo').toLowerCase();",
        "        element.dataset.pisiTodoStatus = String(options.status || 'todo').toLowerCase();\n        element.dataset.pisiTodoRepeat = String(options.repeat || 'none').toLowerCase();",
        'Todo repeat default metadata'
    );

    write(file, source);
}

// Add second release fields to diary sync payload.
{
    const file = 'renderer/runtime.mjs';
    let source = read(file);
    source = replaceOnce(
        source,
        '                    priority: todo.priority,\n                    nodePath: block.nodePath,',
        "                    priority: todo.priority,\n                    status: String(block.todoStates?.[todo.tag] || 'todo'),\n                    repeat: String(block.todoRepeats?.[todo.tag] || 'none'),\n                    parentId: String(block.todoParents?.[todo.tag] || ''),\n                    manualOrder: Number(block.todoOrders?.[todo.tag]),\n                    nodePath: block.nodePath,",
        'Todo second release diary payload'
    );
    source = replaceOnce(
        source,
        '            text: entry.text\n        })));',
        '            text: entry.text,\n            status: entry.status,\n            repeat: entry.repeat,\n            parentId: entry.parentId,\n            manualOrder: entry.manualOrder\n        })));',
        'Todo second release diary signature'
    );
    write(file, source);
}

// Normalize and render second release metadata in diary nodes.
{
    const file = 'main/functions/document-store.js';
    let source = read(file);

    const normalizeFunction = [
        'function normalizePisiDiarySyncEntry(entry) {',
        "    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;",
        '',
        '    const date = normalizePisiDiaryIsoDate(entry?.date);',
        '    if (!date) return null;',
        '',
        "    const nodePath = String(entry.nodePath || '').trim().slice(0, 32768);",
        "    const blockId = String(entry.blockId || '').trim().slice(0, 500);",
        "    const tag = String(entry.tag || '').trim().slice(0, 200);",
        "    const text = String(entry.text || '').trim().slice(0, 250000);",
        '    if (!nodePath || !tag) return null;',
        '',
        '    const sourceIdentity = blockId || crypto',
        "        .createHash('sha256')",
        '        .update(text)',
        "        .digest('hex');",
        "    const sourceKey = [nodePath, sourceIdentity, tag].join('::');",
        '    const rawPriority = Number(entry.priority);',
        '    const priority = Number.isFinite(rawPriority)',
        '        ? Math.max(-1000000, Math.min(1000000, rawPriority))',
        '        : 0;',
        "    const allowedStatuses = new Set(['todo', 'doing', 'waiting', 'blocked']);",
        "    const allowedRepeats = new Set(['none', 'daily', 'weekdays', 'weekly', 'monthly']);",
        "    const status = String(entry.status || 'todo').toLowerCase();",
        "    const repeat = String(entry.repeat || 'none').toLowerCase();",
        '    const rawOrder = Number(entry.manualOrder);',
        '',
        '    return {',
        '        date,',
        '        sourceKey,',
        '        nodePath,',
        "        nodeTitle: String(entry.nodeTitle || 'Node').slice(0, 500),",
        '        blockId,',
        '        tag,',
        '        priority,',
        "        status: allowedStatuses.has(status) ? status : 'todo',",
        "        repeat: allowedRepeats.has(repeat) ? repeat : 'none',",
        "        parentId: String(entry.parentId || '').slice(0, 2000),",
        '        manualOrder: Number.isFinite(rawOrder)',
        '            ? Math.max(0, Math.min(1000000, rawOrder))',
        '            : null,',
        '        text,',
        '        html: sanitizePisiDiaryBlockHtml(',
        "            String(entry.html || '').slice(0, 2000000)",
        '        )',
        '    };',
        '}',
        ''
    ].join('\n');

    source = replaceRegexOnce(
        source,
        /function normalizePisiDiarySyncEntry\(entry\) \{[\s\S]*?\n\}\n\n(?=function buildPisiDiaryManagedSection)/,
        normalizeFunction,
        'Todo second release diary normalization function'
    );

    const buildFunction = [
        'function buildPisiDiaryManagedSection(isoDate, entries = []) {',
        "    if (!entries.length) return '';",
        '',
        '    const safeDate = escapeHtmlForPisiDiary(isoDate);',
        '    const statusLabels = {',
        "        todo: 'Yapılacak',",
        "        doing: 'Devam ediyor',",
        "        waiting: 'Beklemede',",
        "        blocked: 'Engellendi'",
        '    };',
        '    const repeatLabels = {',
        "        none: '',",
        "        daily: 'Her gün',",
        "        weekdays: 'Hafta içi',",
        "        weekly: 'Her hafta',",
        "        monthly: 'Her ay'",
        '    };',
        '    const blocks = entries',
        '        .slice()',
        '        .sort((a, b) => {',
        '            const aOrder = Number.isFinite(a.manualOrder) ? a.manualOrder : Number.POSITIVE_INFINITY;',
        '            const bOrder = Number.isFinite(b.manualOrder) ? b.manualOrder : Number.POSITIVE_INFINITY;',
        '            if (aOrder !== bOrder) return aOrder - bOrder;',
        '            return b.priority - a.priority;',
        '        })',
        '        .map((entry) => {',
        '        const safeSourceKey = escapeHtmlForPisiDiary(entry.sourceKey);',
        "        const safeNodeTitle = escapeHtmlForPisiDiary(entry.nodeTitle || 'Node');",
        "        const safeTag = escapeHtmlForPisiDiary(entry.tag || '');",
        "        const safeText = escapeHtmlForPisiDiary(entry.text || '');",
        "        const safeStatus = escapeHtmlForPisiDiary(statusLabels[entry.status] || statusLabels.todo);",
        "        const safeRepeat = escapeHtmlForPisiDiary(repeatLabels[entry.repeat] || '');",
        "        const safeParent = escapeHtmlForPisiDiary(entry.parentId || '');",
        "        const parentClass = entry.parentId ? ' has-parent' : '';",
        "        const repeatMeta = safeRepeat ? ` · ${safeRepeat}` : '';",
        "        const blockHtml = entry.html || `<div>${safeText || '(boş blok)'}</div>`;",
        '',
        '        return `',
        '<div class="pisi-diary-managed-block${parentClass}" data-pisi-diary-source="${safeSourceKey}" data-pisi-diary-status="${entry.status}" data-pisi-diary-parent="${safeParent}">',
        '    <div class="pisi-diary-managed-meta">${safeNodeTitle} · ..${safeTag} · ${safeStatus}${repeatMeta}</div>',
        '    ${blockHtml}',
        '</div>`;',
        "    }).join('\\n');",
        '',
        '    return `${PISI_DIARY_MANAGED_START}',
        '<h3>Görevler · ${safeDate}</h3>',
        '${blocks}',
        '${PISI_DIARY_MANAGED_END}`;',
        '}',
        ''
    ].join('\n');

    source = replaceRegexOnce(
        source,
        /function buildPisiDiaryManagedSection\(isoDate, entries = \[\]\) \{[\s\S]*?\n\}\n\n(?=function listPisiDiaryNodePaths)/,
        buildFunction,
        'Todo second release diary rendering function'
    );
    write(file, source);
}

// Styles
{
    const file = 'styles/50-tags-and-missions.css';
    let source = read(file);
    if (!source.includes('/* TODO SECOND RELEASE */')) {
        source += [
            '',
            '/* TODO SECOND RELEASE */',
            '.pisi-missions-toolbar-row {',
            '    flex-wrap: wrap;',
            '}',
            '',
            '.pisi-missions-second-controls {',
            '    display: flex;',
            '    align-items: center;',
            '    gap: 6px;',
            '    min-width: 0;',
            '}',
            '',
            '.pisi-missions-status-filter,',
            '.pisi-missions-sort,',
            '.pisi-mission-repeat {',
            '    height: 30px;',
            '    min-width: 0;',
            '    border: 1px solid #444;',
            '    border-radius: 8px;',
            '    background: #252526;',
            '    color: #d4d4d4;',
            '    padding: 0 24px 0 8px;',
            '    font-size: 10px;',
            '    font-weight: 750;',
            '    color-scheme: dark;',
            '}',
            '',
            '.pisi-missions-status-filter:focus,',
            '.pisi-missions-sort:focus,',
            '.pisi-mission-repeat:focus {',
            '    outline: none;',
            '    border-color: #f39c12;',
            '    box-shadow: 0 0 0 2px rgba(243, 156, 18, 0.14);',
            '}',
            '',
            '.pisi-mission-card {',
            '    margin-left: calc(var(--pisi-mission-depth, 0) * 15px);',
            '    transition: border-color 0.14s ease, background 0.14s ease, opacity 0.14s ease;',
            '}',
            '',
            '.pisi-mission-card[data-depth]:not([data-depth="0"])::before {',
            '    content: "";',
            '    position: absolute;',
            '    left: -9px;',
            '    top: -9px;',
            '    bottom: 50%;',
            '    width: 7px;',
            '    border-left: 1px solid #555;',
            '    border-bottom: 1px solid #555;',
            '    border-radius: 0 0 0 6px;',
            '}',
            '',
            '.pisi-mission-card[data-depth] {',
            '    position: relative;',
            '}',
            '',
            '.pisi-mission-second-actions {',
            '    margin-left: auto;',
            '    display: flex;',
            '    align-items: center;',
            '    gap: 5px;',
            '    min-width: 0;',
            '}',
            '',
            '.pisi-mission-repeat {',
            '    width: 104px;',
            '    height: 25px;',
            '}',
            '',
            '.pisi-mission-add-child,',
            '.pisi-mission-drag-handle {',
            '    width: 25px;',
            '    height: 25px;',
            '    border: 1px solid #444;',
            '    border-radius: 7px;',
            '    background: #252526;',
            '    color: #bdbdc1;',
            '    display: inline-flex;',
            '    align-items: center;',
            '    justify-content: center;',
            '    padding: 0;',
            '    font-weight: 900;',
            '    cursor: pointer;',
            '}',
            '',
            '.pisi-mission-add-child:hover:not(:disabled),',
            '.pisi-mission-drag-handle:hover {',
            '    border-color: #f39c12;',
            '    color: #f39c12;',
            '    background: #303034;',
            '}',
            '',
            '.pisi-mission-add-child:disabled {',
            '    opacity: 0.4;',
            '    cursor: default;',
            '}',
            '',
            '.pisi-mission-drag-handle {',
            '    cursor: grab;',
            '    letter-spacing: -3px;',
            '}',
            '',
            '.pisi-mission-drag-handle:active {',
            '    cursor: grabbing;',
            '}',
            '',
            '.pisi-mission-child-progress {',
            '    min-width: 28px;',
            '    height: 20px;',
            '    border-radius: 999px;',
            '    background: rgba(93, 173, 226, 0.16);',
            '    color: #9fd3f5;',
            '    display: inline-flex;',
            '    align-items: center;',
            '    justify-content: center;',
            '    padding: 0 6px;',
            '    font-size: 10px;',
            '    font-weight: 850;',
            '}',
            '',
            '.pisi-mission-card.dragging {',
            '    opacity: 0.45;',
            '}',
            '',
            '.pisi-mission-card.drag-over {',
            '    border-color: #f39c12;',
            '    box-shadow: 0 -2px 0 #f39c12;',
            '}',
            '',
            '.pisi-diary-managed-block.has-parent {',
            '    margin-left: 18px;',
            '    border-left-color: #5dade2;',
            '}',
            '',
            '.pisi-diary-managed-block[data-pisi-diary-status="waiting"] {',
            '    border-left-color: #f1c40f;',
            '}',
            '',
            '.pisi-diary-managed-block[data-pisi-diary-status="blocked"] {',
            '    border-left-color: #e74c3c;',
            '}',
            ''
        ].join('\n');
    }
    write(file, source);
}

// Language catalogs
{
    const translations = {
        'Durum filtresi': ['Durum filtresi', 'Status filter'],
        'Görev sıralama': ['Görev sıralama', 'Task sorting'],
        'Tekrarlama': ['Tekrarlama', 'Repeat'],
        'Alt görev ekle': ['Alt görev ekle', 'Add subtask'],
        'Alt görev ilerlemesi': ['Alt görev ilerlemesi', 'Subtask progress'],
        'Sürükleyerek sırala': ['Sürükleyerek sırala', 'Drag to reorder'],
        'Yeni alt görev': ['Yeni alt görev', 'New subtask'],
        'Tekrarlama yok': ['Tekrarlama yok', 'No repeat'],
        'Her gün': ['Her gün', 'Daily'],
        'Hafta içi': ['Hafta içi', 'Weekdays'],
        'Her hafta': ['Her hafta', 'Weekly'],
        'Her ay': ['Her ay', 'Monthly'],
        'Akıllı sıra': ['Akıllı sıra', 'Smart order'],
        'Tarihe göre': ['Tarihe göre', 'By date'],
        'Önceliğe göre': ['Önceliğe göre', 'By priority'],
        'Duruma göre': ['Duruma göre', 'By status'],
        'Manuel sıra': ['Manuel sıra', 'Manual order'],
        'Tüm durumlar': ['Tüm durumlar', 'All statuses'],
        'Tekrar ayarı kaydedilemedi.': ['Tekrar ayarı kaydedilemedi.', 'Repeat setting could not be saved.'],
        'Alt görev eklenemedi.': ['Alt görev eklenemedi.', 'Subtask could not be added.'],
        'Sonraki tekrar tarihi hesaplanamadı.': ['Sonraki tekrar tarihi hesaplanamadı.', 'The next recurrence date could not be calculated.'],
        'Sonraki görev etiketi oluşturulamadı.': ['Sonraki görev etiketi oluşturulamadı.', 'The next task tag could not be created.'],
        'Görev sırası kaydedilemedi.': ['Görev sırası kaydedilemedi.', 'Task order could not be saved.'],
        'Görev editörü bulunamadı.': ['Görev editörü bulunamadı.', 'Task editor could not be found.']
    };

    for (const [file, languageIndex] of [
        ['locales/lang-tr.json', 0],
        ['locales/lang-eng.json', 1]
    ]) {
        const catalog = JSON.parse(read(file));
        for (const [key, values] of Object.entries(translations)) {
            catalog.strings[key] = values[languageIndex];
        }
        write(file, `${JSON.stringify(catalog, null, 2)}\n`);
    }
}

console.log('Applied Todo second release integration.');
