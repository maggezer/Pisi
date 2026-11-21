import { canHandlePisiEditorTextEvent } from '../editor/pisi-editor-input-policy.mjs';
import { registerModule } from '../core/module-registry.mjs';

/** A user tag chip; old `todo.*` tags are ordinary tags now (docs/task-plan.md §3.2.1). */
function createPisiUserTagElement(rawTag) {
    const tag = normalizePisiUserTag(rawTag);
    const element = document.createElement('span');
    element.className = 'pisi-user-tag';
    element.dataset.pisiTag = tag;
    element.contentEditable = 'false';
    element.textContent = tag;
    return element;
}

function bindPisiTagControls() {
    const menu = document.getElementById('pisi-tag-menu');
    if (!menu) return;

    const editors = [document.getElementById('node-modal-content'), document.getElementById('center-node-editor-content')].filter(Boolean);

    for (const editor of editors) {
        bindPisiTagControlsForEditor(editor);
    }

    if (document.body.dataset.pisiTagOutsideBound === '1') return;
    document.body.dataset.pisiTagOutsideBound = '1';

    document.addEventListener('mousedown', (event) => {
        if (!pisiTagMenuState.active) return;
        const activeEditor = pisiTagMenuState.editor;
        if (event.target.closest('#pisi-tag-menu') || event.target === activeEditor || activeEditor?.contains(event.target)) {
            return;
        }
        closePisiTagMenu();
    });
}

function bindPisiTagControlsForEditor(editor) {
    if (!editor || editor.dataset.pisiTagsBound === '1') return;

    editor.dataset.pisiTagsBound = '1';
    bindPisiMissionHighlightSanitizer(editor);

    editor.addEventListener('input', () => {
        ensurePisiEditorBlocks(editor);
        collectPisiUserTagsFromEditor(editor);
        refreshPisiTagsPanelSoon();
    });

    editor.addEventListener(
        'keydown',
        (event) => {
            if (!canHandlePisiEditorTextEvent(editor, event) || !pisiTagMenuState.active || pisiTagMenuState.editor !== editor) return;
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopImmediatePropagation();
                movePisiTagSelection(1);
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopImmediatePropagation();
                movePisiTagSelection(-1);
                return;
            }

            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                event.stopImmediatePropagation();
                const selectedItem = pisiTagMenuState.items[pisiTagMenuState.selectedIndex];
                if (selectedItem) applyPisiTagMenuItem(editor, selectedItem);
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                closePisiTagMenu();
            }
        },
        true
    );
}

function collectPisiUserTagsFromEditor(editor) {
    if (!editor) return;

    editor.querySelectorAll('.pisi-user-tag[data-pisi-tag]').forEach((tagEl) => {
        const tag = normalizePisiUserTag(tagEl.dataset.pisiTag || tagEl.textContent || '');
        if (tag) PISI_USER_TAG_CACHE.add(tag);
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
    if (!menu || !command || !Array.isArray(command.items)) return false;

    pisiTagMenuState = {
        active: true,
        mode: command.mode || 'hash-tags',
        editor,
        command,
        selectedIndex: 0,
        items: command.items
    };

    menu.classList.remove('pisi-unified-command-menu');
    menu.innerHTML = '';

    command.items.forEach((item, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `pisi-tag-option ${item.kind}`;
        if (index === 0) option.classList.add('active');

        option.innerHTML = `
            <span class="pisi-tag-option-code">${pisiEscapeHtml(item.typedToken)}</span>
            <span class="pisi-tag-option-desc">${pisiEscapeHtml(item.description)}</span>
        `;

        const selectOption = (event) => {
            event.preventDefault();
            event.stopPropagation();
            pisiTagMenuState.selectedIndex = index;
            applyPisiTagMenuItem(editor, item);
        };
        option.addEventListener('mousedown', selectOption);
        option.addEventListener('click', selectOption);
        menu.appendChild(option);
    });

    menu.hidden = false;
    positionPisiTagMenuAtSelection();
    return true;
}

function applyPisiTagMenuItem(editor, item) {
    if (!item) return;
    const command = pisiTagMenuState.command;

    if (String(item.kind).startsWith('wiki-')) {
        window.applyPisiWikiMenuItem?.(editor, item, command);
        return;
    }

    if (item.kind === 'user' || item.kind === 'new-user') {
        applyPisiUserTagToEditor(editor, item.label, command);
    }
}

function closePisiTagMenu() {
    const menu = document.getElementById('pisi-tag-menu');
    if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
        menu.classList.remove('pisi-unified-command-menu');
    }

    pisiTagMenuState = {
        active: false,
        mode: null,
        editor: null,
        command: null,
        selectedIndex: 0,
        items: []
    };
}

function movePisiTagSelection(delta) {
    if (!pisiTagMenuState.active || !pisiTagMenuState.items.length) return;

    const count = pisiTagMenuState.items.length;
    pisiTagMenuState.selectedIndex = (pisiTagMenuState.selectedIndex + delta + count) % count;

    const menu = document.getElementById('pisi-tag-menu');
    menu?.querySelectorAll('.pisi-tag-option').forEach((option, index) => {
        option.classList.toggle('active', index === pisiTagMenuState.selectedIndex);
    });
}

function applyPisiUserTagToEditor(editor, rawTag, commandOverride = null) {
    const command = commandOverride || pisiTagMenuState.command;
    const tag = normalizePisiUserTag(rawTag);

    if (!command || !tag || !isValidPisiUserTag(tag)) return false;

    const range = makeRangeInElementByTextOffsets(command.block, command.tokenStartInText, command.tokenEndInText);
    if (!range) return false;

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
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function normalizePisiUserTag(value) {
    return String(value || '')
        .trim()
        .replace(/^#/, '')
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
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== editor) {
        if (el.matches && el.matches('.pisi-editor-block, div, p, h1, h2, h3, h4, h5, h6, blockquote, pre, li')) {
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
    if (rect && (rect.width || rect.height)) return rect;

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
    bindPisiTagControls: {
        enumerable: true,
        get() {
            return bindPisiTagControls;
        }
    },
    bindPisiTagControlsForEditor: {
        enumerable: true,
        get() {
            return bindPisiTagControlsForEditor;
        }
    },
    collectPisiUserTagsFromEditor: {
        enumerable: true,
        get() {
            return collectPisiUserTagsFromEditor;
        }
    },
    collectPisiUserTagSuggestions: {
        enumerable: true,
        get() {
            return collectPisiUserTagSuggestions;
        }
    },
    openPisiTagMenuForEditor: {
        enumerable: true,
        get() {
            return openPisiTagMenuForEditor;
        }
    },
    applyPisiTagMenuItem: {
        enumerable: true,
        get() {
            return applyPisiTagMenuItem;
        }
    },
    closePisiTagMenu: {
        enumerable: true,
        get() {
            return closePisiTagMenu;
        }
    },
    movePisiTagSelection: {
        enumerable: true,
        get() {
            return movePisiTagSelection;
        }
    },
    applyPisiUserTagToEditor: {
        enumerable: true,
        get() {
            return applyPisiUserTagToEditor;
        }
    },
    normalizePisiUserTag: {
        enumerable: true,
        get() {
            return normalizePisiUserTag;
        }
    },
    isValidPisiUserTag: {
        enumerable: true,
        get() {
            return isValidPisiUserTag;
        }
    },
    makeRangeInElementByTextOffsets: {
        enumerable: true,
        get() {
            return makeRangeInElementByTextOffsets;
        }
    },
    getPisiCurrentEditorBlock: {
        enumerable: true,
        get() {
            return getPisiCurrentEditorBlock;
        }
    },
    placeCaretAtEnd: {
        enumerable: true,
        get() {
            return placeCaretAtEnd;
        }
    },
    positionPisiTagMenuAtSelection: {
        enumerable: true,
        get() {
            return positionPisiTagMenuAtSelection;
        }
    },
    getSelectionClientRect: {
        enumerable: true,
        get() {
            return getSelectionClientRect;
        }
    },
    pisiEscapeHtml: {
        enumerable: true,
        get() {
            return pisiEscapeHtml;
        }
    },
    escapeHtml: {
        enumerable: true,
        get() {
            return escapeHtml;
        }
    }
});

registerModule('tags.editor', moduleApi);
