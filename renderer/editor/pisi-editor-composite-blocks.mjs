const PISI_COMPOSITE_CLIPBOARD_PREFIX =
    'PISI_COMPOSITE_BLOCK_V1:';

let pisiCompositeClipboardText = '';

const pisiActiveCompositeContexts = new WeakMap();
const PISI_COMPOSITE_ACTIVE_CLASS =
    'pisi-composite-alignment-active';

function normalizePisiCompositeAlignment(value) {
    return ['left', 'center', 'right'].includes(value)
        ? value
        : 'center';
}

function ensurePisiCompositeAlignment(block) {
    if (!block) return 'center';

    const alignment =
        normalizePisiCompositeAlignment(
            block.dataset.pisiCompositeAlign
        );

    block.dataset.pisiCompositeAlign = alignment;
    return alignment;
}

const PISI_COMPOSITE_LAYOUT_STYLE_PROPERTIES =
    Object.freeze([
        'width',
        'max-width',
        'margin',
        'margin-left',
        'margin-right',
        'margin-inline',
        'margin-inline-start',
        'margin-inline-end',
        'left',
        'right',
        'transform',
        'text-align'
    ]);

function normalizePisiCompositeBlockLayout(block) {
    if (!block) return false;

    ensurePisiCompositeAlignment(block);

    const style = block.style;
    if (!style) return false;

    let changed = false;

    for (
        const property
        of PISI_COMPOSITE_LAYOUT_STYLE_PROPERTIES
    ) {
        if (!style.getPropertyValue(property)) {
            continue;
        }

        style.removeProperty(property);
        changed = true;
    }

    if (!String(style.cssText || '').trim()) {
        block.removeAttribute('style');
    }

    return changed;
}

function setPisiCompositeAlignment(
    block,
    alignment,
    options = {}
) {
    if (!block) return false;

    normalizePisiCompositeBlockLayout(block);

    const next =
        normalizePisiCompositeAlignment(alignment);
    const changed =
        block.dataset.pisiCompositeAlign !== next;

    block.dataset.pisiCompositeAlign = next;

    if (
        changed &&
        options.notify !== false
    ) {
        const editor =
            getPisiCompositeEditor(block);

        editor?.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'formatSet'
            })
        );
    }

    return changed;
}

function getPisiCompositeAlignment(block) {
    return ensurePisiCompositeAlignment(block);
}

function clearPisiCompositeAlignmentContext(editor) {
    if (!editor) return;

    editor.querySelectorAll(
        '.' + PISI_COMPOSITE_ACTIVE_CLASS
    ).forEach((block) => {
        block.classList.remove(
            PISI_COMPOSITE_ACTIVE_CLASS
        );
    });

    pisiActiveCompositeContexts.delete(editor);
}

function selectPisiCompositeAlignmentBlock(block) {
    const editor = getPisiCompositeEditor(block);

    if (!block || !editor) return false;

    normalizePisiCompositeBlockLayout(block);

    editor.querySelectorAll(
        '.pisi-paint-canvas.selected'
    ).forEach((canvas) => {
        if (
            canvas.closest('.pisi-canvas-block') !==
            block
        ) {
            canvas.classList.remove('selected');
        }
    });

    clearPisiCompositeAlignmentContext(editor);

    block.classList.add(
        PISI_COMPOSITE_ACTIVE_CLASS
    );
    pisiActiveCompositeContexts.set(
        editor,
        {
            block,
            wholeBlock: true
        }
    );

    editor.dispatchEvent(
        new CustomEvent(
            'pisi:composite-context-changed',
            {
                bubbles: false,
                detail: {
                    block,
                    alignment:
                        getPisiCompositeAlignment(block)
                }
            }
        )
    );

    return true;
}

function isPisiCompositeWholeBlockTarget(
    target,
    block = getPisiCompositeBlock(target)
) {
    if (
        !(target instanceof Element) ||
        !block ||
        !block.contains(target)
    ) {
        return false;
    }

    return Boolean(
        target.closest(
            '.pisi-sheet-section-header, ' +
            '.pisi-sheet-search, ' +
            '.pisi-sheet-selection-surface, ' +
            '.pisi-canvas-section-header, ' +
            '.pisi-paint-canvas'
        )
    );
}

function getPisiSelectedCanvasAlignmentBlock(editor) {
    if (!editor) return null;

    const selectedCanvas = editor.querySelector(
        '.pisi-paint-canvas.selected'
    );
    const block =
        getPisiCompositeBlock(selectedCanvas);

    return (
        block?.isConnected &&
        editor.contains(block)
    )
        ? block
        : null;
}

function rememberPisiCompositeContext(event) {
    const target = event?.target;

    if (!(target instanceof Element)) return;

    const editor = target.closest(
        '.pisi-rich-editor'
    );

    if (!editor) return;

    const block =
        getPisiCompositeBlock(target);
    const wholeBlock =
        isPisiCompositeWholeBlockTarget(
            target,
            block
        );

    clearPisiCompositeAlignmentContext(editor);

    if (!block || !wholeBlock) {
        editor.querySelectorAll(
            '.pisi-paint-canvas.selected'
        ).forEach((canvas) => {
            canvas.classList.remove('selected');
        });
        return;
    }

    selectPisiCompositeAlignmentBlock(block);
}

function getPisiActiveCompositeAlignmentBlock(editor) {
    if (!editor) return null;

    const selectedCanvas =
        getPisiSelectedCanvasAlignmentBlock(editor);

    if (selectedCanvas) {
        return selectedCanvas;
    }

    const marked = editor.querySelector(
        '.pisi-sheet-block.' +
        PISI_COMPOSITE_ACTIVE_CLASS +
        ', .pisi-canvas-block.' +
        PISI_COMPOSITE_ACTIVE_CLASS
    );

    if (
        marked?.isConnected &&
        editor.contains(marked)
    ) {
        return marked;
    }

    const context =
        pisiActiveCompositeContexts.get(editor);

    if (
        !context?.wholeBlock ||
        !context.block?.isConnected ||
        !editor.contains(context.block)
    ) {
        return null;
    }

    return context.block;
}

function makePisiCompositeId(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.();

    if (uuid) return prefix + '-' + uuid;

    return (
        prefix + '-' +
        Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 10)
    );
}

function getPisiCompositeBlock(element) {
    return element?.closest?.(
        '.pisi-sheet-block, .pisi-canvas-block'
    ) || null;
}

function getPisiCompositeEditor(block) {
    return block?.closest?.(
        '.pisi-rich-editor'
    ) || null;
}

function getPisiTopLevelEditorChild(editor, element) {
    let current = element;

    while (
        current &&
        current.parentElement &&
        current.parentElement !== editor
    ) {
        current = current.parentElement;
    }

    return current?.parentElement === editor
        ? current
        : null;
}

function getPisiCompositePayload(block) {
    if (!block) return null;

    const table = block.querySelector(
        'table[data-pisi-sheet]'
    );

    if (table) {
        const database =
            window.getPisiSheetDatabase?.(table) ||
            (() => {
                try {
                    return JSON.parse(
                        table.dataset.pisiSheetModel || '{}'
                    );
                } catch {
                    return null;
                }
            })();

        if (!database?.databaseId) return null;

        return {
            version: 1,
            type: 'sheet',
            alignment:
                getPisiCompositeAlignment(block),
            database: structuredClone(database)
        };
    }

    const canvas = block.querySelector(
        'canvas[data-pisi-canvas]'
    );

    if (!canvas) return null;

    const image =
        window.savePisiCanvasData?.(canvas) ||
        canvas.dataset.image ||
        '';

    return {
        version: 1,
        type: 'canvas',
        alignment:
            getPisiCompositeAlignment(block),
        title: String(
            block.dataset.pisiCanvasTitle || 'Canvas'
        ).slice(0, 80),
        collapsed:
            block.dataset.pisiCanvasCollapsed === '1',
        width: Math.max(
            1,
            Number(canvas.width) || 520
        ),
        height: Math.max(
            1,
            Number(canvas.height) || 320
        ),
        image
    };
}

function serializePisiCompositePayload(payload) {
    if (!payload) return '';

    return (
        PISI_COMPOSITE_CLIPBOARD_PREFIX +
        JSON.stringify(payload)
    );
}

function parsePisiCompositePayload(value) {
    const text = String(value || '');

    if (
        !text.startsWith(
            PISI_COMPOSITE_CLIPBOARD_PREFIX
        )
    ) {
        return null;
    }

    try {
        const payload = JSON.parse(
            text.slice(
                PISI_COMPOSITE_CLIPBOARD_PREFIX.length
            )
        );

        if (
            payload?.version !== 1 ||
            !['sheet', 'canvas'].includes(payload.type)
        ) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

function copyPisiCompositeBlock(block) {
    const payload = getPisiCompositePayload(block);
    if (!payload) return false;

    const serialized =
        serializePisiCompositePayload(payload);

    pisiCompositeClipboardText = serialized;

    try {
        const clipboard = window.pisiClipboard;

        if (
            clipboard &&
            typeof clipboard.writeText === 'function'
        ) {
            clipboard.writeText(serialized);
        }
    } catch {
        // The in-memory clipboard keeps in-app copy/paste working.
    }

    return true;
}

function createPisiEditableLine() {
    const line = document.createElement('div');

    line.innerHTML = '<br>';
    return line;
}

function focusPisiEditableLine(line) {
    if (!line) return false;

    const editor = line.closest?.(
        '.pisi-rich-editor'
    );

    window.ensurePisiEditorBlocks?.(editor);

    line.setAttribute('contenteditable', 'true');
    line.focus({ preventScroll: true });

    const selection = window.getSelection?.();
    if (!selection) return true;

    const range = document.createRange();

    range.selectNodeContents(line);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function ensurePisiEditableLineAfter(
    block,
    options = {}
) {
    const editor = getPisiCompositeEditor(block);

    if (!block || !editor) return null;

    let line = block.nextElementSibling;

    if (
        !line ||
        line.matches?.(
            '.pisi-sheet-block, .pisi-canvas-block'
        ) ||
        String(line.textContent || '').trim()
    ) {
        line = createPisiEditableLine();
        block.after(line);
    }

    if (options.notify !== false) {
        editor.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'insertParagraph'
            })
        );
    }

    if (options.focus !== false) {
        focusPisiEditableLine(line);
    }

    return line;
}

function createPisiSheetBlockFromPayload(payload) {
    const database = structuredClone(
        payload?.database || {}
    );

    if (
        !database ||
        !Array.isArray(database.fields) ||
        !Array.isArray(database.items)
    ) {
        return null;
    }

    database.databaseId =
        makePisiCompositeId('database');

    const block = document.createElement('div');
    const table = document.createElement('table');

    block.className = 'pisi-sheet-block';
    block.contentEditable = 'false';
    block.dataset.pisiSheetBlock = '1';
    block.dataset.pisiCompositeAlign =
        normalizePisiCompositeAlignment(
            payload?.alignment
        );

    table.className = 'pisi-sheet-table';
    table.dataset.pisiSheet = '1';
    table.dataset.pisiDatabaseId =
        database.databaseId;
    table.dataset.pisiSheetModel =
        JSON.stringify(database);
    table.innerHTML =
        '<thead><tr></tr></thead><tbody></tbody>';

    block.appendChild(table);
    return block;
}

function createPisiCanvasBlockFromPayload(payload) {
    const block = document.createElement('div');
    const canvas = document.createElement('canvas');

    block.className = 'pisi-canvas-block';
    block.contentEditable = 'false';
    block.dataset.pisiCanvasBlock = '1';
    block.dataset.pisiCanvasTitle =
        String(payload?.title || 'Canvas')
            .trim()
            .slice(0, 80) ||
        'Canvas';
    block.dataset.pisiCanvasCollapsed =
        payload?.collapsed === true ? '1' : '0';
    block.dataset.pisiCompositeAlign =
        normalizePisiCompositeAlignment(
            payload?.alignment
        );

    canvas.className = 'pisi-paint-canvas';
    canvas.dataset.pisiCanvas = '1';
    canvas.width = Math.max(
        1,
        Math.min(1600, Number(payload?.width) || 520)
    );
    canvas.height = Math.max(
        1,
        Math.min(1200, Number(payload?.height) || 320)
    );

    if (
        typeof payload?.image === 'string' &&
        payload.image.startsWith('data:image/')
    ) {
        canvas.dataset.image = payload.image;
    }

    block.appendChild(canvas);
    return block;
}

function createPisiCompositeBlockFromPayload(payload) {
    if (payload?.type === 'sheet') {
        return createPisiSheetBlockFromPayload(payload);
    }

    if (payload?.type === 'canvas') {
        return createPisiCanvasBlockFromPayload(payload);
    }

    return null;
}

function resolvePisiCompositePasteReference(
    editor,
    target
) {
    const targetElement =
        target instanceof Element
            ? target
            : target?.parentElement;

    const targetBlock = targetElement?.closest?.(
        '.pisi-sheet-block, ' +
        '.pisi-canvas-block, ' +
        '.pisi-editor-block'
    );

    if (targetBlock && editor.contains(targetBlock)) {
        return getPisiTopLevelEditorChild(
            editor,
            targetBlock
        );
    }

    const selection = window.getSelection?.();
    const anchor = selection?.anchorNode;
    const anchorElement =
        anchor?.nodeType === Node.ELEMENT_NODE
            ? anchor
            : anchor?.parentElement;
    const selectionBlock = anchorElement?.closest?.(
        '.pisi-sheet-block, ' +
        '.pisi-canvas-block, ' +
        '.pisi-editor-block'
    );

    if (
        selectionBlock &&
        editor.contains(selectionBlock)
    ) {
        return getPisiTopLevelEditorChild(
            editor,
            selectionBlock
        );
    }

    return null;
}

function insertPisiCompositePayload(
    editor,
    payload,
    reference = null
) {
    if (!editor || !payload) return null;

    const block =
        createPisiCompositeBlockFromPayload(payload);

    if (!block) return null;

    const topLevelReference =
        reference &&
        editor.contains(reference)
            ? getPisiTopLevelEditorChild(
                editor,
                reference
            )
            : null;

    if (
        topLevelReference?.classList?.contains(
            'pisi-editor-block'
        ) &&
        !String(
            topLevelReference.textContent || ''
        ).trim()
    ) {
        topLevelReference.replaceWith(block);
    } else if (topLevelReference) {
        topLevelReference.after(block);
    } else {
        editor.appendChild(block);
    }

    window.initializePisiAdvancedEditorContent?.(
        editor
    );

    ensurePisiEditableLineAfter(block, {
        notify: false,
        focus: true
    });

    editor.dispatchEvent(
        new InputEvent('input', {
            bubbles: true,
            inputType: 'insertFromPaste'
        })
    );

    return block;
}

function readPisiCompositeClipboard(event) {
    if (event?.clipboardData) {
        const eventText =
            event.clipboardData.getData?.(
                'text/plain'
            ) || '';
        const eventPayload =
            parsePisiCompositePayload(eventText);

        if (eventPayload) {
            return eventPayload;
        }

        if (eventText) {
            return null;
        }
    }

    let bridgeText = '';

    try {
        const clipboard = window.pisiClipboard;

        if (
            clipboard &&
            typeof clipboard.readText === 'function'
        ) {
            bridgeText = clipboard.readText() || '';
        }
    } catch {
        bridgeText = '';
    }

    return parsePisiCompositePayload(
        bridgeText ||
        pisiCompositeClipboardText
    );
}

function handlePisiCompositeClick(event) {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const copyButton = target.closest(
        '[data-pisi-composite-copy]'
    );

    if (copyButton) {
        const block =
            getPisiCompositeBlock(copyButton);

        if (!block) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        copyPisiCompositeBlock(block);
        return;
    }

    const lineButton = target.closest(
        '[data-pisi-composite-new-line]'
    );

    if (!lineButton) return;

    const block =
        getPisiCompositeBlock(lineButton);

    if (!block) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    ensurePisiEditableLineAfter(block);
}

function handlePisiCompositeKeydown(event) {
    if (
        !event ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        String(event.key || '').toLowerCase() !== 'c'
    ) {
        return;
    }

    const target = event.target;
    const element =
        target instanceof Element
            ? target
            : target?.parentElement;

    const title = element?.closest?.(
        '[data-pisi-sheet-section-title], ' +
        '[data-pisi-canvas-section-title]'
    );

    if (!title) return;

    const block =
        getPisiCompositeBlock(title);

    if (!block) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    copyPisiCompositeBlock(block);
}

function handlePisiCompositePaste(event) {
    const target = event.target;
    const element =
        target instanceof Element
            ? target
            : target?.parentElement;
    const editor =
        element?.closest?.('.pisi-rich-editor') ||
        document.activeElement?.closest?.(
            '.pisi-rich-editor'
        );

    if (!editor) return;

    const payload =
        readPisiCompositeClipboard(event);

    if (!payload) return;

    const reference =
        resolvePisiCompositePasteReference(
            editor,
            element
        );

    event.preventDefault();
    event.stopImmediatePropagation();

    insertPisiCompositePayload(
        editor,
        payload,
        reference
    );
}

if (typeof document !== 'undefined') {
    document.addEventListener(
        'pointerdown',
        rememberPisiCompositeContext,
        true
    );
    document.addEventListener(
        'focusin',
        rememberPisiCompositeContext,
        true
    );
    document.addEventListener(
        'click',
        handlePisiCompositeClick,
        true
    );
    document.addEventListener(
        'keydown',
        handlePisiCompositeKeydown,
        true
    );
    document.addEventListener(
        'paste',
        handlePisiCompositePaste,
        true
    );
}

export {
    copyPisiCompositeBlock,
    ensurePisiCompositeAlignment,
    ensurePisiEditableLineAfter,
    getPisiActiveCompositeAlignmentBlock,
    getPisiCompositeAlignment,
    insertPisiCompositePayload,
    normalizePisiCompositeBlockLayout,
    parsePisiCompositePayload,
    serializePisiCompositePayload,
    setPisiCompositeAlignment,
    selectPisiCompositeAlignmentBlock
};
