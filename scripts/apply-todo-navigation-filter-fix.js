'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

function write(file, content) {
    fs.writeFileSync(path.join(root, file), content);
}

function replaceOnce(source, pattern, replacement, label) {
    const matches = source.match(pattern);
    if (!matches) {
        throw new Error(`Target not found: ${label}`);
    }
    return source.replace(pattern, replacement);
}

const editorPath = 'renderer/tags/pisi-tag-editor.mjs';
let editor = read(editorPath);

const navigationBlock = `let pisiMissionHighlightAnimation = null;
let pisiMissionHighlightRequest = 0;

function clearPisiMissionHighlightArtifacts(root = document) {
    root.querySelectorAll?.(
        '.pisi-block-highlight, .pisi-todo-source-highlight'
    ).forEach((element) => {
        element.classList.remove(
            'pisi-block-highlight',
            'pisi-todo-source-highlight'
        );
    });
}

function clearPisiMissionHighlight() {
    pisiMissionHighlightRequest += 1;
    pisiMissionHighlightAnimation?.cancel?.();
    pisiMissionHighlightAnimation = null;
    clearPisiMissionHighlightArtifacts(document);
}

function bindPisiMissionHighlightSanitizer(editor) {
    if (!editor || editor.dataset.pisiMissionHighlightSanitizer === '1') {
        return;
    }

    editor.dataset.pisiMissionHighlightSanitizer = '1';
    clearPisiMissionHighlightArtifacts(editor);

    const observer = new MutationObserver(() => {
        clearPisiMissionHighlightArtifacts(editor);
    });

    observer.observe(editor, {
        childList: true,
        subtree: true
    });
}

function getPisiMissionEditorCandidates(mission) {
    const candidates = [];
    const modalEditor = document.getElementById('node-modal-content');
    const centerEditor = document.getElementById('center-node-editor-content');

    if (
        modalEditor &&
        samePisiPathForTags(activeModalNode?.path, mission?.nodePath)
    ) {
        candidates.push(modalEditor);
    }

    if (
        centerEditor &&
        samePisiPathForTags(activeCenterNode?.path, mission?.nodePath)
    ) {
        candidates.push(centerEditor);
    }

    return candidates;
}

function pisiMissionBlockContainsTodo(block, todoTag) {
    const normalizedTodoTag = normalizePisiUserTag(todoTag).toLowerCase();
    if (!normalizedTodoTag) return true;

    return Array.from(
        block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')
    ).some((tagElement) => {
        return normalizePisiUserTag(
            tagElement.dataset.pisiTag || tagElement.textContent || ''
        ).toLowerCase() === normalizedTodoTag;
    });
}

function getPisiMissionSourceInBlock(block, mission) {
    const normalizedTodoTag = normalizePisiUserTag(
        mission?.todoTag
    ).toLowerCase();

    return Array.from(
        block.querySelectorAll('.pisi-todo-source[data-pisi-todo-for]')
    ).find((element) => {
        return normalizePisiUserTag(
            element.dataset.pisiTodoFor || ''
        ).toLowerCase() === normalizedTodoTag;
    }) || null;
}

function findPisiMissionTarget(editor, mission) {
    if (!editor || !mission) return null;

    ensurePisiEditorBlocks(editor, { preserveSelection: false });

    const blocks = Array.from(
        editor.querySelectorAll('.pisi-editor-block[data-pisi-block-id]')
    );
    const escapedBlockId = mission.blockId
        ? CSS.escape(String(mission.blockId))
        : '';
    const idMatches = escapedBlockId
        ? Array.from(editor.querySelectorAll(
            `.pisi-editor-block[data-pisi-block-id="${escapedBlockId}"]`
        ))
        : [];

    const exactBlock = idMatches.find((block) => {
        return pisiMissionBlockContainsTodo(block, mission.todoTag);
    });

    if (exactBlock) {
        return getPisiMissionSourceInBlock(exactBlock, mission) || exactBlock;
    }

    const sourceText = String(mission.sourceText || '')
        .replace(/\\s+/g, ' ')
        .trim();
    const todoBlocks = blocks.filter((block) => {
        return pisiMissionBlockContainsTodo(block, mission.todoTag);
    });

    if (sourceText) {
        for (const block of todoBlocks) {
            const source = getPisiMissionSourceInBlock(block, mission);
            const currentText = String(source?.textContent || '')
                .replace(/\\s+/g, ' ')
                .trim();

            if (source && currentText === sourceText) {
                return source;
            }
        }
    }

    return todoBlocks.length === 1 ? todoBlocks[0] : null;
}

function animatePisiMissionTarget(target) {
    if (!target?.isConnected) return false;

    pisiMissionHighlightAnimation?.cancel?.();
    target.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
    });

    pisiMissionHighlightAnimation = target.animate([
        {
            backgroundColor: 'rgba(93, 173, 226, 0.34)',
            boxShadow: '0 0 0 2px rgba(93, 173, 226, 0.88)',
            offset: 0
        },
        {
            backgroundColor: 'rgba(93, 173, 226, 0.24)',
            boxShadow: '0 0 0 2px rgba(93, 173, 226, 0.72)',
            offset: 0.72
        },
        {
            backgroundColor: 'rgba(93, 173, 226, 0)',
            boxShadow: '0 0 0 2px rgba(93, 173, 226, 0)',
            offset: 1
        }
    ], {
        duration: 2200,
        easing: 'ease-out'
    });

    const animation = pisiMissionHighlightAnimation;
    animation.finished
        .catch(() => {})
        .finally(() => {
            if (pisiMissionHighlightAnimation === animation) {
                pisiMissionHighlightAnimation = null;
            }
        });

    return true;
}

async function highlightPisiEditorBlock(mission) {
    if (!mission?.nodePath) return false;

    clearPisiMissionHighlight();
    const requestId = pisiMissionHighlightRequest;

    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (requestId !== pisiMissionHighlightRequest) return false;

        for (const editor of getPisiMissionEditorCandidates(mission)) {
            const target = findPisiMissionTarget(editor, mission);
            if (target) return animatePisiMissionTarget(target);
        }

        await new Promise((resolve) => setTimeout(resolve, 60));
    }

    return false;
}

async function openPisiTagBlockResult(block) {
    if (!block?.nodePath) return;

    clearPisiMissionHighlight();

    const escapedPath = CSS.escape(block.nodePath);
    const box = document.querySelector(
        `.map-node-box[data-node-path="${escapedPath}"]`
    );

    if (box) {
        await openNodeModalFromBox(box);
    } else if (typeof openPisiFileTab === 'function') {
        await openPisiFileTab({
            name: block.fileName || \
                \`${'${block.nodeTitle || \'Node\'}'}.node\`,
            fileName: block.fileName || \
                \`${'${block.nodeTitle || \'Node\'}'}.node\`,
            fullPath: block.nodePath,
            type: 'file',
            isDirectory: false,
            isFile: true,
            metadata: {
                type: 'node',
                title: block.nodeTitle || 'Node'
            }
        });
    }

    const highlighted = await highlightPisiEditorBlock(block);
    if (!highlighted) {
        console.warn(
            '[PISI] Görevin kaynak bloğu açık editörde bulunamadı:',
            block.blockId,
            block.nodePath
        );
    }
}

const PISI_SYSTEM_TAGS`;

editor = replaceOnce(
    editor,
    /async function openPisiTagBlockResult\(block\) \{[\s\S]*?\n\}\n\nconst PISI_SYSTEM_TAGS/,
    navigationBlock,
    'Todo source navigation block'
);

editor = replaceOnce(
    editor,
    /(function bindPisiTagControlsForEditor\(editor\) \{\n    if \(!editor\) return;\n    if \(editor\.dataset\.pisiTagsBound === '1'\) return;\n\n    editor\.dataset\.pisiTagsBound = '1';)/,
    `$1\n    bindPisiMissionHighlightSanitizer(editor);`,
    'Todo highlight sanitizer binding'
);

write(editorPath, editor);

const todoPath = 'renderer/tags/pisi-todo-first-release.mjs';
let todo = read(todoPath);

const filterHelpers = `function closePisiMissionFilterMenuFirstRelease() {
    pisiTagsPanelState.missionFilterOpen = false;

    const trigger = document.querySelector(
        '.pisi-missions-filter-trigger'
    );
    const popover = document.querySelector(
        '.pisi-missions-filter-popover'
    );

    trigger?.setAttribute('aria-expanded', 'false');
    if (popover) popover.hidden = true;
}

function bindPisiMissionFilterOutsideCloseFirstRelease() {
    if (window.__pisiMissionFilterOutsideBound === true) return;
    window.__pisiMissionFilterOutsideBound = true;

    document.addEventListener('mousedown', (event) => {
        if (!pisiTagsPanelState?.missionFilterOpen) return;
        if (event.target.closest('.pisi-missions-filter-menu')) return;
        closePisiMissionFilterMenuFirstRelease();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!pisiTagsPanelState?.missionFilterOpen) return;
        closePisiMissionFilterMenuFirstRelease();
    });
}

function renderPisiMissionsPanelFirstRelease() {`;

todo = replaceOnce(
    todo,
    /function renderPisiMissionsPanelFirstRelease\(\) \{/,
    filterHelpers,
    'Todo filter menu helpers'
);

todo = replaceOnce(
    todo,
    /(if \(!window\.currentProjectFolder\) \{\n        toolbar\.innerHTML = '';)/,
    `$1\n        pisiTagsPanelState.missionFilterOpen = false;`,
    'Reset Todo filter menu without a project'
);

const filterMarkup = `    toolbar.innerHTML = '';
    bindPisiMissionFilterOutsideCloseFirstRelease();

    const toolbarRow = document.createElement('div');
    toolbarRow.className = 'pisi-missions-toolbar-row';

    const activeFilterOption = PISI_TODO_FILTER_OPTIONS.find((option) => {
        return option.value === filter;
    }) || PISI_TODO_FILTER_OPTIONS[0];
    const filterMenu = document.createElement('div');
    filterMenu.className = 'pisi-missions-filter-menu';

    const filterTrigger = document.createElement('button');
    filterTrigger.type = 'button';
    filterTrigger.className = 'pisi-missions-filter-trigger';
    filterTrigger.setAttribute('aria-haspopup', 'menu');
    filterTrigger.setAttribute(
        'aria-expanded',
        pisiTagsPanelState.missionFilterOpen === true ? 'true' : 'false'
    );
    filterTrigger.innerHTML = \
        \`<span>\${pisiTodoTranslateFirstRelease(activeFilterOption.label)}</span>\` +
        \`<span class="pisi-missions-filter-trigger-count">\${counts.get(filter) || 0}</span>\`;

    const filterPopover = document.createElement('div');
    filterPopover.className = 'pisi-missions-filter-popover';
    filterPopover.setAttribute('role', 'menu');
    filterPopover.hidden = pisiTagsPanelState.missionFilterOpen !== true;

    for (const option of PISI_TODO_FILTER_OPTIONS) {
        const optionButton = document.createElement('button');
        const isActive = option.value === filter;
        optionButton.type = 'button';
        optionButton.className = 'pisi-missions-filter-option';
        optionButton.classList.toggle('active', isActive);
        optionButton.setAttribute('role', 'menuitemradio');
        optionButton.setAttribute('aria-checked', isActive ? 'true' : 'false');
        optionButton.innerHTML = \
            \`<span class="pisi-missions-filter-check">\${isActive ? '✓' : ''}</span>\` +
            \`<span class="pisi-missions-filter-label">\${pisiTodoTranslateFirstRelease(option.label)}</span>\` +
            \`<span class="pisi-missions-filter-count">\${counts.get(option.value) || 0}</span>\`;
        optionButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            pisiTagsPanelState.missionFilter = option.value;
            pisiTagsPanelState.missionFilterOpen = false;
            renderPisiMissionsPanelFirstRelease();
        });
        filterPopover.appendChild(optionButton);
    }

    filterTrigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = pisiTagsPanelState.missionFilterOpen !== true;
        pisiTagsPanelState.missionFilterOpen = open;
        filterTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        filterPopover.hidden = !open;
    });

    filterMenu.append(filterTrigger, filterPopover);
    toolbarRow.appendChild(filterMenu);

    const completedToggle = document.createElement('button');
    completedToggle.type = 'button';
    completedToggle.className = 'pisi-missions-completed-toggle';
    completedToggle.setAttribute('aria-pressed', showCompleted ? 'true' : 'false');
    completedToggle.textContent = pisiTodoTranslateFirstRelease(showCompleted
        ? \`Tamamlananları gizle (\${completedCount})\`
        : \`Tamamlananları göster (\${completedCount})\`);
    completedToggle.disabled = completedCount === 0;
    completedToggle.addEventListener('click', () => {
        pisiTagsPanelState.showCompletedMissions = !showCompleted;
        pisiTagsPanelState.missionFilterOpen = false;
        renderPisiMissionsPanelFirstRelease();
    });
    toolbarRow.appendChild(completedToggle);
    toolbar.appendChild(toolbarRow);
`;

todo = replaceOnce(
    todo,
    /    toolbar\.innerHTML = '';\n    const filterBar[\s\S]*?    toolbar\.appendChild\(completedToggle\);\n/,
    filterMarkup,
    'Todo date filter button group'
);

write(todoPath, todo);

const cssPath = 'styles/50-tags-and-missions.css';
let css = read(cssPath);
const filterCss = `/* TODO FIRST RELEASE */
.pisi-missions-toolbar-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
}

.pisi-missions-filter-menu {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 180px;
}

.pisi-missions-filter-trigger {
    width: 100%;
    min-height: 30px;
    border: 1px solid #444;
    border-radius: 8px;
    background: #2d2d30;
    color: #d4d4d4;
    padding: 4px 9px;
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    font-weight: 750;
    cursor: pointer;
}

.pisi-missions-filter-trigger::after {
    content: "⌄";
    margin-left: auto;
    color: #8d8d91;
    transition: transform 0.14s ease;
}

.pisi-missions-filter-trigger[aria-expanded="true"] {
    border-color: #f39c12;
    color: #f5c16c;
    background: #303034;
}

.pisi-missions-filter-trigger[aria-expanded="true"]::after {
    transform: rotate(180deg);
}

.pisi-missions-filter-trigger-count,
.pisi-missions-filter-count {
    min-width: 20px;
    height: 18px;
    border-radius: 999px;
    background: #1f1f21;
    color: #aeb0b5;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    font-size: 10px;
    font-weight: 850;
}

.pisi-missions-filter-popover {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    z-index: 140;
    width: max(190px, 100%);
    padding: 5px;
    border: 1px solid #45454a;
    border-radius: 9px;
    background: #252526;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.48);
}

.pisi-missions-filter-popover[hidden] {
    display: none;
}

.pisi-missions-filter-option {
    width: 100%;
    min-height: 30px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #c7c7ca;
    padding: 4px 7px;
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    text-align: left;
    font-size: 11px;
    cursor: pointer;
}

.pisi-missions-filter-option:hover,
.pisi-missions-filter-option.active {
    background: #333337;
    color: #f5c16c;
}

.pisi-missions-filter-check {
    color: #f39c12;
    font-weight: 900;
    text-align: center;
}

.pisi-missions-filter-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.pisi-mission-content {`;

css = replaceOnce(
    css,
    /\/\* TODO FIRST RELEASE \*\/[\s\S]*?\.pisi-mission-content \{/,
    filterCss,
    'Todo filter CSS'
);
write(cssPath, css);

const testPath = 'tests/todo-navigation-filter-regression.test.js';
write(testPath, `'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Todo source navigation targets the active node and never persists highlight classes', () => {
    const source = read('renderer/tags/pisi-tag-editor.mjs');

    assert.match(source, /samePisiPathForTags\(activeModalNode\?\.path, mission\?\.nodePath\)/);
    assert.match(source, /samePisiPathForTags\(activeCenterNode\?\.path, mission\?\.nodePath\)/);
    assert.match(source, /idMatches\.find[\s\S]*pisiMissionBlockContainsTodo/);
    assert.match(source, /todoBlocks\.length === 1 \? todoBlocks\[0\] : null/);
    assert.match(source, /target\.animate\(/);
    assert.doesNotMatch(source, /block\.classList\.add\('pisi-block-highlight'\)/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*highlightPisiEditorBlock/);
});

test('Todo date filters render inside one dropdown trigger', () => {
    const source = read('renderer/tags/pisi-todo-first-release.mjs');
    const css = read('styles/50-tags-and-missions.css');

    assert.match(source, /pisi-missions-filter-trigger/);
    assert.match(source, /pisi-missions-filter-popover/);
    assert.match(source, /role', 'menuitemradio'/);
    assert.match(source, /for \(const option of PISI_TODO_FILTER_OPTIONS\)/);
    assert.doesNotMatch(source, /className = 'pisi-missions-filter';/);
    assert.match(css, /\.pisi-missions-filter-popover \{/);
    assert.match(css, /\.pisi-missions-filter-option \{/);
    assert.doesNotMatch(css, /\.pisi-missions-filter-bar \{/);
});
`);

console.log('Applied Todo source-navigation and filter-menu fix.');
