import { registerModule } from "../core/module-registry.mjs";
import {
    PISI_TODO_PRIORITY_OPTIONS,
    formatPisiTodoTag,
    getPisiTodoPriorityOption,
    getPisiTodayIsoDate,
    parsePisiTodoTagValue
} from "./pisi-todo-utils.mjs";
async function markPisiMissionDone(mission) {
    return setPisiMissionCompletion(mission, true);
}
async function reopenPisiMission(mission) {
    return setPisiMissionCompletion(mission, false);
}
const PISI_SYSTEM_TAGS = [
    { id: 'h2', label: 'h2', description: 'Heading 2', headingLevel: 2 },
    { id: 'h3', label: 'h3', description: 'Heading 3', headingLevel: 3 },
    { id: 'h4', label: 'h4', description: 'Heading 4', headingLevel: 4 },
    { id: 'h5', label: 'h5', description: 'Heading 5', headingLevel: 5 }
];

function isPisiTodoCommand(command) {
    return String(command?.body || '').trim().toLowerCase() === 'todo';
}

function isPisiDoneCommand(command) {
    return String(command?.body || '').trim().toLowerCase() === 'done';
}

function buildPisiTodoPriorityItems() {
    return PISI_TODO_PRIORITY_OPTIONS.map((option) => ({
        kind: 'todo-priority',
        id: `todo-priority-${option.value}`,
        label: String(option.value),
        typedToken: String(option.value),
        description: option.label,
        priority: option.value
    }));
}

function openPisiTodoPriorityMenu(editor, commandOverride = null) {
    const command =
        commandOverride ||
        pisiTagMenuState.command ||
        getPisiEditorCommandAtCaret(editor);

    if (!command) return;

    openPisiTagMenuForEditor(editor, {
        ...command,
        mode: 'todo-priority',
        items: buildPisiTodoPriorityItems()
    });
}

function openPisiTodoDateMenu(editor, priorityValue, commandOverride = null) {
    const menu = document.getElementById('pisi-tag-menu');
    const priority = getPisiTodoPriorityOption(priorityValue);
    const command = commandOverride || pisiTagMenuState.command;

    if (!menu || !priority || !command) return;

    pisiTagMenuState = {
        active: true,
        mode: 'todo-date',
        editor,
        command,
        selectedIndex: 0,
        items: [],
        todoPriority: priority.value
    };

    menu.innerHTML = `
        <div class="pisi-todo-picker">
            <div class="pisi-todo-picker-title">Finish date</div>
            <div class="pisi-todo-priority-summary">
                ${priority.value} — ${pisiEscapeHtml(priority.label)}
            </div>
            <input
                class="pisi-todo-date-input"
                type="date"
                value="${getPisiTodayIsoDate()}"
                aria-label="Todo finish date"
            >
            <div class="pisi-todo-picker-actions">
                <button class="pisi-todo-back" type="button">Back</button>
                <button class="pisi-todo-undated" type="button">Tarihsiz</button>
                <button class="pisi-todo-apply" type="button">Add</button>
            </div>
        </div>
    `;

    const dateInput = menu.querySelector('.pisi-todo-date-input');
    const backButton = menu.querySelector('.pisi-todo-back');
    const undatedButton = menu.querySelector('.pisi-todo-undated');
    const applyButton = menu.querySelector('.pisi-todo-apply');

    const commitTodo = (dateValue = dateInput?.value) => {
        const todoTag = formatPisiTodoTag(priority.value, dateValue);

        if (!todoTag) {
            dateInput?.setCustomValidity('Choose a valid date.');
            dateInput?.reportValidity();
            return;
        }

        dateInput?.setCustomValidity('');

        const applied = window.applyPisiTodoTagToEditor?.(
            editor,
            todoTag,
            command
        );
        if (!applied && command.sourceSelection === true) {
            applyPisiTodoSelectionToEditor(editor, todoTag, command);
        } else if (!applied) {
            applyPisiUserTagToEditor(editor, todoTag, command);
        }
    };

    dateInput?.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });
    dateInput?.addEventListener('change', commitTodo);
    dateInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitTodo();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePisiTagMenu();
            editor.focus();
        }
    });

    backButton?.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPisiTodoPriorityMenu(editor, command);
    });

    undatedButton?.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitTodo('none');
    });

    applyButton?.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitTodo();
    });

    menu.hidden = false;
    positionPisiTagMenuAtSelection();

    dateInput?.focus({ preventScroll: true });
    try {
        dateInput?.showPicker?.();
    } catch {
        // Native picker may require a direct user gesture; the input remains usable.
    }
}


function bindPisiTagControls() {
    const menu = document.getElementById('pisi-tag-menu');

    if (!menu) return;

    const editors = [
        document.getElementById('node-modal-content'),
        document.getElementById('center-node-editor-content')
    ].filter(Boolean);

    for (const editor of editors) {
        bindPisiTagControlsForEditor(editor);
    }

    if (document.body.dataset.pisiTagOutsideBound === '1') return;

    document.body.dataset.pisiTagOutsideBound = '1';

    document.addEventListener('mousedown', (event) => {
        if (!pisiTagMenuState.active) return;

        const activeEditor = pisiTagMenuState.editor;

        if (
            event.target.closest('#pisi-tag-menu') ||
            event.target === activeEditor ||
            activeEditor?.contains(event.target)
        ) {
            return;
        }

        closePisiTagMenu();
    });
}

function bindPisiTagControlsForEditor(editor) {
    if (!editor) return;
    if (editor.dataset.pisiTagsBound === '1') return;

    editor.dataset.pisiTagsBound = '1';
    bindPisiMissionHighlightSanitizer(editor);

    editor.addEventListener('input', () => {
        ensurePisiEditorBlocks(editor);
        collectPisiUserTagsFromEditor(editor);
        updatePisiTagMenuForEditor(editor, true);
        refreshPisiTagsPanelSoon();
    });

    editor.addEventListener('keyup', (event) => {
        if (
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            event.key === 'Enter' ||
            event.key === 'Tab' ||
            event.key === 'Escape' ||
            event.key === ' '
        ) {
            return;
        }

        updatePisiTagMenuForEditor(editor, false);
    });

    editor.addEventListener('keydown', (event) => {
        // Kullanıcı tagı boşlukla biter.
        // Örnek: ..hayvan[space] => mavi tag chip.
        if (event.key === ' ') {
            const command = getPisiEditorCommandAtCaret(editor);
            const parsedTodo = parsePisiTodoTagValue(command?.body);

            if (parsedTodo) {
                event.preventDefault();
                window.applyPisiTodoTagToEditor?.(editor, parsedTodo.tag, command);
                return;
            }

            if (isPisiTodoCommand(command)) {
                event.preventDefault();
                openPisiTodoPriorityMenu(editor, command);
                return;
            }

            if (isPisiDoneCommand(command)) {
                event.preventDefault();
                window.applyPisiDoneCommandToEditor?.(editor, command);
                return;
            }

            if (command && command.body && !getExactPisiSystemTag(command.body)) {
                event.preventDefault();
                applyPisiUserTagToEditor(editor, command.body, command);
                return;
            }
        }

        if (!pisiTagMenuState.active) return;
        if (pisiTagMenuState.editor !== editor) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            movePisiTagSelection(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            movePisiTagSelection(-1);
            return;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();

            const selectedItem = pisiTagMenuState.items[pisiTagMenuState.selectedIndex];

            if (selectedItem) {
                applyPisiTagMenuItem(editor, selectedItem);
            }

            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closePisiTagMenu();
        }
    });

    editor.addEventListener('click', () => {
        updatePisiTagMenuForEditor(editor, false);
    });

    editor.addEventListener('contextmenu', (event) => {
        const command = capturePisiTodoSelection(editor);
        if (!command) return;

        event.preventDefault();
        event.stopPropagation();
        openPisiTodoPriorityMenu(editor, command);
    });
}

function updatePisiTagMenuForEditor(editor, allowExactTransform) {
    const command = getPisiEditorCommandAtCaret(editor);

    if (!command) {
        closePisiTagMenu();
        return;
    }

    if (isPisiTodoCommand(command)) {
        openPisiTodoPriorityMenu(editor, command);
        return;
    }

    if (isPisiDoneCommand(command)) {
        openPisiTagMenuForEditor(editor, {
            ...command,
            items: [{
                kind: 'todo-done',
                id: 'done',
                label: 'done',
                typedToken: `${command.trigger}done`,
                description: 'Görevi tamamla'
            }]
        });
        return;
    }

    const exactSystem = getExactPisiSystemTag(command.body);

    if (allowExactTransform && exactSystem) {
        applyPisiSystemTagToEditor(editor, exactSystem, command);
        return;
    }

    const items = buildPisiTagMenuItems(command);

    if (!items.length) {
        closePisiTagMenu();
        return;
    }

    openPisiTagMenuForEditor(editor, {
        ...command,
        items
    });
}

function getPisiEditorCommandAtCaret(editor) {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return null;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.startContainer)) {
        return null;
    }

    const block = getPisiCurrentEditorBlock(editor, range.startContainer);

    if (!block) return null;

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(block);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const beforeText = beforeRange.toString();

    const tagChars = 'A-Za-z0-9ğüşöçıİĞÜŞÖÇ_-';
    const commandRegex = new RegExp(
        `(^|\\s)((?:\\.\\.|/)[${tagChars}]*(?:\\.[${tagChars}]*)*)$`
    );

    const match = beforeText.match(commandRegex);

    if (!match) return null;

    const token = match[2];
    const trigger = token.startsWith('..') ? '..' : '/';
    const body = trigger === '..' ? token.slice(2) : token.slice(1);

    return {
        editor,
        block,
        range,
        token,
        trigger,
        body,
        tokenStartInText: beforeText.length - token.length,
        tokenEndInText: beforeText.length
    };
}

function buildPisiTagMenuItems(command) {
    const body = normalizePisiUserTag(command.body);
    const lowerBody = body.toLowerCase();
    const items = [];

    if (!body.includes('.') && 'todo'.startsWith(lowerBody)) {
        items.push({
            kind: 'todo-start',
            id: 'todo',
            label: 'todo',
            typedToken: `${command.trigger}todo`,
            description: 'Task'
        });
    }

    if (!body.includes('.') && 'done'.startsWith(lowerBody)) {
        items.push({
            kind: 'todo-done',
            id: 'done',
            label: 'done',
            typedToken: `${command.trigger}done`,
            description: 'Görevi tamamla'
        });
    }

    const systemItems = PISI_SYSTEM_TAGS
        .filter((item) => {
            if (body.includes('.')) return false;
            return item.label.toLowerCase().startsWith(lowerBody);
        })
        .map((item) => ({
            kind: 'system',
            id: item.id,
            label: item.label,
            typedToken: `${command.trigger}${item.label}`,
            description: item.description,
            headingLevel: item.headingLevel
        }));

    items.push(...systemItems);

    const userItems = collectPisiUserTagSuggestions(command.editor)
        .filter((tag) => !/^(?:todo(?:\.|$)|done$)/i.test(tag))
        .filter((tag) => {
            if (!body) return true;
            return tag.toLowerCase().startsWith(lowerBody);
        })
        .map((tag) => ({
            kind: 'user',
            id: tag,
            label: tag,
            typedToken: `${command.trigger}${tag}`,
            description: 'Kullanıcı etiketi'
        }));

    items.push(...userItems);

    const existsAsUser = userItems.some((item) => {
        return item.label.toLowerCase() === lowerBody;
    });

    const existsAsSystem = systemItems.some((item) => {
        return item.label.toLowerCase() === lowerBody;
    });

    if (body && !existsAsUser && !existsAsSystem && isValidPisiUserTag(body)) {
        items.unshift({
            kind: 'new-user',
            id: body,
            label: body,
            typedToken: `${command.trigger}${body}`,
            description: 'Yeni kullanıcı etiketi'
        });
    }

    return items;
}

function getExactPisiSystemTag(body) {
    const normalized = String(body || '').toLowerCase();

    if (normalized.includes('.')) return null;

    return PISI_SYSTEM_TAGS.find((item) => {
        return item.label.toLowerCase() === normalized;
    }) || null;
}

function collectPisiUserTagsFromEditor(editor) {
    if (!editor) return;

    editor.querySelectorAll('.pisi-user-tag[data-pisi-tag]').forEach((tagEl) => {
        const tag = normalizePisiUserTag(
            tagEl.dataset.pisiTag || tagEl.textContent || ''
        );

        if (tag) {
            PISI_USER_TAG_CACHE.add(tag);
        }
    });
}

function collectPisiUserTagSuggestions(editor) {
    collectPisiUserTagsFromEditor(editor);

    return Array.from(PISI_USER_TAG_CACHE).sort((a, b) => {
        return a.localeCompare(b, 'tr');
    });
}

function openPisiTagMenuForEditor(editor, command) {
    const menu = document.getElementById('pisi-tag-menu');
    if (!menu) return;

    pisiTagMenuState = {
        active: true,
        mode: command.mode || 'tags',
        editor,
        command,
        selectedIndex: 0,
        items: command.items,
        todoPriority: null
    };

    menu.innerHTML = '';

    if (command.sourceSelection === true) {
        const heading = document.createElement('div');
        heading.className = 'pisi-todo-selection-heading';
        heading.textContent = 'Seçili metni göreve dönüştür';
        menu.appendChild(heading);
    }

    command.items.forEach((item, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `pisi-tag-option ${item.kind}`;

        if (index === 0) {
            option.classList.add('active');
        }

        option.innerHTML = `
            <span class="pisi-tag-option-code">${pisiEscapeHtml(item.typedToken)}</span>
            <span class="pisi-tag-option-desc">${pisiEscapeHtml(item.description)}</span>
        `;

        option.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            pisiTagMenuState.selectedIndex = index;
            applyPisiTagMenuItem(editor, item);
        });

        menu.appendChild(option);
    });

    menu.hidden = false;
    positionPisiTagMenuAtSelection();
}

function applyPisiTagMenuItem(editor, item) {
    if (!item) return;

    const command = pisiTagMenuState.command;

    if (item.kind === 'todo-start') {
        openPisiTodoPriorityMenu(editor, command);
        return;
    }

    if (item.kind === 'todo-priority') {
        openPisiTodoDateMenu(editor, item.priority, command);
        return;
    }

    if (item.kind === 'todo-done') {
        window.applyPisiDoneCommandToEditor?.(editor, command);
        return;
    }

    if (item.kind === 'system') {
        applyPisiSystemTagToEditor(editor, item);
        return;
    }

    applyPisiUserTagToEditor(editor, item.label);
}

function closePisiTagMenu() {
    const menu = document.getElementById('pisi-tag-menu');

    if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
    }

    pisiTagMenuState = {
        active: false,
        mode: null,
        editor: null,
        command: null,
        selectedIndex: 0,
        items: [],
        todoPriority: null
    };
}

function movePisiTagSelection(delta) {
    if (!pisiTagMenuState.active || !pisiTagMenuState.items.length) return;

    const count = pisiTagMenuState.items.length;

    pisiTagMenuState.selectedIndex =
        (pisiTagMenuState.selectedIndex + delta + count) % count;

    const menu = document.getElementById('pisi-tag-menu');

    menu?.querySelectorAll('.pisi-tag-option').forEach((option, index) => {
        option.classList.toggle(
            'active',
            index === pisiTagMenuState.selectedIndex
        );
    });
}

function applyPisiSystemTagToEditor(editor, item, commandOverride = null) {
    const command = commandOverride || pisiTagMenuState.command;

    if (!command || !item?.headingLevel) return;

    applyPisiHeadingTagToEditor(editor, item.headingLevel, command);
    closePisiTagMenu();

    editor.focus();

    editor.dispatchEvent(new Event('input', {
        bubbles: true
    }));
}

function applyPisiHeadingTagToEditor(editor, headingLevel, command) {
    const block = command.block;
    const fullText = block.textContent || '';

    const beforeToken = fullText.slice(0, command.tokenStartInText);
    const afterToken = fullText.slice(command.tokenEndInText);

    const cleanText = `${beforeToken}${afterToken}`
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .trim();

    const heading = document.createElement(`h${headingLevel}`);

    if (cleanText) {
        heading.textContent = cleanText;
    } else {
        heading.innerHTML = '<br>';
    }

    if (block === editor) {
        editor.innerHTML = '';
        editor.appendChild(heading);
    } else {
        block.replaceWith(heading);
    }

    placeCaretAtEnd(heading);
}

function applyPisiUserTagToEditor(editor, rawTag, commandOverride = null) {
    const command =
        commandOverride ||
        pisiTagMenuState.command ||
        getPisiEditorCommandAtCaret(editor);

    const tag = normalizePisiUserTag(rawTag);

    if (!command || !tag || !isValidPisiUserTag(tag)) return;

    const range = makeRangeInElementByTextOffsets(
        command.block,
        command.tokenStartInText,
        command.tokenEndInText
    );

    if (!range) return;

    const tagEl = createPisiUserTagElement(tag);

    const trailingSpace = document.createTextNode(' ');

    range.deleteContents();
    range.insertNode(trailingSpace);
    range.insertNode(tagEl);

    PISI_USER_TAG_CACHE.add(tag);

    const afterSpaceRange = document.createRange();
    afterSpaceRange.setStartAfter(trailingSpace);
    afterSpaceRange.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(afterSpaceRange);

    closePisiTagMenu();
    editor.focus();

    editor.dispatchEvent(new Event('input', {
        bubbles: true
    }));
}

function normalizePisiUserTag(value) {
    return String(value || '')
        .trim()
        .replace(/^\.\./, '')
        .replace(/^\//, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');
}

function isValidPisiUserTag(value) {
    const tagChars = 'A-Za-z0-9ğüşöçıİĞÜŞÖÇ_-';
    const tagRegex = new RegExp(`^[${tagChars}]+(?:\\.[${tagChars}]+)*$`);

    return tagRegex.test(String(value || ''));
}

function makeRangeInElementByTextOffsets(root, startOffset, endOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let currentOffset = 0;
    let startNode = null;
    let startNodeOffset = 0;
    let endNode = null;
    let endNodeOffset = 0;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const nextOffset = currentOffset + node.nodeValue.length;

        if (!startNode && startOffset >= currentOffset && startOffset <= nextOffset) {
            startNode = node;
            startNodeOffset = startOffset - currentOffset;
        }

        if (!endNode && endOffset >= currentOffset && endOffset <= nextOffset) {
            endNode = node;
            endNodeOffset = endOffset - currentOffset;
            break;
        }

        currentOffset = nextOffset;
    }

    if (!startNode || !endNode) return null;

    const range = document.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);

    return range;
}

function getPisiCurrentEditorBlock(editor, node) {
    let el = node.nodeType === Node.ELEMENT_NODE
        ? node
        : node.parentElement;

    while (el && el !== editor) {
        if (el.matches && el.matches('div, p, h1, h2, h3, h4, h5, h6')) {
            return el;
        }

        el = el.parentElement;
    }

    return editor;
}

function placeCaretAtEnd(element) {
    const range = document.createRange();
    const selection = window.getSelection();

    range.selectNodeContents(element);
    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);
}

function positionPisiTagMenuAtSelection() {
    const menu = document.getElementById('pisi-tag-menu');

    if (!menu || menu.hidden) return;

    const rect = getSelectionClientRect();

    if (!rect) return;

    const menuRect = menu.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 8;

    left = Math.max(12, Math.min(left, window.innerWidth - menuRect.width - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - menuRect.height - 12));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function getSelectionClientRect() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0).cloneRange();

    let rect = range.getBoundingClientRect();

    if (rect && (rect.width || rect.height)) {
        return rect;
    }

    const marker = document.createElement('span');
    marker.textContent = '\u200b';

    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
    marker.remove();

    return rect;
}

function pisiEscapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeHtml(value) {
    return pisiEscapeHtml(value);
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "markPisiMissionDone": {
        enumerable: true,
        get() { return markPisiMissionDone; }
    },
    "reopenPisiMission": {
        enumerable: true,
        get() { return reopenPisiMission; }
    },
    "PISI_SYSTEM_TAGS": {
        enumerable: true,
        get() { return PISI_SYSTEM_TAGS; }
    },
    "isPisiTodoCommand": {
        enumerable: true,
        get() { return isPisiTodoCommand; }
    },
    "isPisiDoneCommand": {
        enumerable: true,
        get() { return isPisiDoneCommand; }
    },
    "buildPisiTodoPriorityItems": {
        enumerable: true,
        get() { return buildPisiTodoPriorityItems; }
    },
    "openPisiTodoPriorityMenu": {
        enumerable: true,
        get() { return openPisiTodoPriorityMenu; }
    },
    "openPisiTodoDateMenu": {
        enumerable: true,
        get() { return openPisiTodoDateMenu; }
    },
    "bindPisiTagControls": {
        enumerable: true,
        get() { return bindPisiTagControls; }
    },
    "bindPisiTagControlsForEditor": {
        enumerable: true,
        get() { return bindPisiTagControlsForEditor; }
    },
    "updatePisiTagMenuForEditor": {
        enumerable: true,
        get() { return updatePisiTagMenuForEditor; }
    },
    "getPisiEditorCommandAtCaret": {
        enumerable: true,
        get() { return getPisiEditorCommandAtCaret; }
    },
    "buildPisiTagMenuItems": {
        enumerable: true,
        get() { return buildPisiTagMenuItems; }
    },
    "getExactPisiSystemTag": {
        enumerable: true,
        get() { return getExactPisiSystemTag; }
    },
    "collectPisiUserTagsFromEditor": {
        enumerable: true,
        get() { return collectPisiUserTagsFromEditor; }
    },
    "collectPisiUserTagSuggestions": {
        enumerable: true,
        get() { return collectPisiUserTagSuggestions; }
    },
    "openPisiTagMenuForEditor": {
        enumerable: true,
        get() { return openPisiTagMenuForEditor; }
    },
    "applyPisiTagMenuItem": {
        enumerable: true,
        get() { return applyPisiTagMenuItem; }
    },
    "closePisiTagMenu": {
        enumerable: true,
        get() { return closePisiTagMenu; }
    },
    "movePisiTagSelection": {
        enumerable: true,
        get() { return movePisiTagSelection; }
    },
    "applyPisiSystemTagToEditor": {
        enumerable: true,
        get() { return applyPisiSystemTagToEditor; }
    },
    "applyPisiHeadingTagToEditor": {
        enumerable: true,
        get() { return applyPisiHeadingTagToEditor; }
    },
    "applyPisiUserTagToEditor": {
        enumerable: true,
        get() { return applyPisiUserTagToEditor; }
    },
    "normalizePisiUserTag": {
        enumerable: true,
        get() { return normalizePisiUserTag; }
    },
    "isValidPisiUserTag": {
        enumerable: true,
        get() { return isValidPisiUserTag; }
    },
    "makeRangeInElementByTextOffsets": {
        enumerable: true,
        get() { return makeRangeInElementByTextOffsets; }
    },
    "getPisiCurrentEditorBlock": {
        enumerable: true,
        get() { return getPisiCurrentEditorBlock; }
    },
    "placeCaretAtEnd": {
        enumerable: true,
        get() { return placeCaretAtEnd; }
    },
    "positionPisiTagMenuAtSelection": {
        enumerable: true,
        get() { return positionPisiTagMenuAtSelection; }
    },
    "getSelectionClientRect": {
        enumerable: true,
        get() { return getSelectionClientRect; }
    },
    "pisiEscapeHtml": {
        enumerable: true,
        get() { return pisiEscapeHtml; }
    },
    "escapeHtml": {
        enumerable: true,
        get() { return escapeHtml; }
    }
});
registerModule("tags.editor", moduleApi);
