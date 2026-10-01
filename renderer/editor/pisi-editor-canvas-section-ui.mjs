const PISI_CANVAS_DEFAULT_TITLE = 'Canvas';

function normalizePisiCanvasSectionTitle(value) {
    return String(
        value || PISI_CANVAS_DEFAULT_TITLE
    ).trim().slice(0, 80) ||
        PISI_CANVAS_DEFAULT_TITLE;
}

function getPisiCanvasSectionBlock(canvas) {
    return canvas?.closest?.(
        '.pisi-canvas-block'
    ) || null;
}

function syncPisiCanvasSectionTitleWidth(input) {
    if (!input) return;

    const length = Math.max(
        6,
        String(input.value || '').length
    );

    input.style.width =
        String(
            Math.min(
                360,
                Math.max(92, length * 7.4 + 22)
            )
        ) + 'px';
}

function clearPisiCanvasDocumentSelection(block) {
    const selection = window.getSelection?.();

    if (!selection || !selection.rangeCount) return;

    const ranges = Array.from(
        { length: selection.rangeCount },
        (_, index) => selection.getRangeAt(index)
    );
    const intersects = ranges.some((range) => {
        try {
            return range.intersectsNode(block);
        } catch {
            return false;
        }
    });

    if (intersects) {
        selection.removeAllRanges();
    }
}

function notifyPisiCanvasSectionChanged(block) {
    const editor = block?.closest?.(
        '.pisi-rich-editor'
    );

    if (!editor) return;

    editor.dispatchEvent(
        new InputEvent('input', {
            bubbles: true,
            inputType: 'formatSet'
        })
    );
}

function getPisiCanvasSectionLabels(collapsed) {
    return {
        toggle: collapsed
            ? (
                window.pisiT?.("Canvas'ı aç") ||
                "Canvas'ı aç"
            )
            : (
                window.pisiT?.("Canvas'ı kapat") ||
                "Canvas'ı kapat"
            ),
        title:
            window.pisiT?.('Canvas başlığı') ||
            'Canvas başlığı',
        delete:
            window.pisiT?.("Canvas'ı sil") ||
            "Canvas'ı sil"
    };
}

function syncPisiCanvasSectionState(
    canvas,
    header
) {
    const block =
        getPisiCanvasSectionBlock(canvas);

    if (!block || !header) return null;

    const title =
        normalizePisiCanvasSectionTitle(
            block.dataset.pisiCanvasTitle
        );
    const collapsed =
        block.dataset.pisiCanvasCollapsed === '1';
    const labels =
        getPisiCanvasSectionLabels(collapsed);

    block.dataset.pisiCanvasTitle = title;
    block.dataset.pisiCanvasCollapsed =
        collapsed ? '1' : '0';
    block.classList.toggle(
        'pisi-canvas-collapsed',
        collapsed
    );

    const toggle = header.querySelector(
        '[data-pisi-canvas-section-toggle]'
    );
    const input = header.querySelector(
        '[data-pisi-canvas-section-title]'
    );

    if (toggle) {
        toggle.setAttribute(
            'aria-expanded',
            collapsed ? 'false' : 'true'
        );
        toggle.setAttribute(
            'aria-label',
            labels.toggle
        );
        toggle.title = labels.toggle;
    }

    if (
        input &&
        document.activeElement !== input
    ) {
        input.value = title;
        input.setAttribute(
            'aria-label',
            labels.title
        );
        syncPisiCanvasSectionTitleWidth(input);
    }

    return {
        title,
        collapsed
    };
}

function commitPisiCanvasSectionTitle(
    canvas,
    input
) {
    const block =
        getPisiCanvasSectionBlock(canvas);

    if (!block || !input) return false;

    const next =
        normalizePisiCanvasSectionTitle(
            input.value
        );
    const original =
        normalizePisiCanvasSectionTitle(
            input.dataset.pisiCanvasOriginalTitle ||
            block.dataset.pisiCanvasTitle
        );
    const changed = original !== next;

    block.dataset.pisiCanvasTitle = next;
    input.dataset.pisiCanvasOriginalTitle = next;
    input.value = next;
    syncPisiCanvasSectionTitleWidth(input);

    if (changed) {
        notifyPisiCanvasSectionChanged(block);
    }

    return changed;
}

function togglePisiCanvasSection(
    canvas,
    header
) {
    const block =
        getPisiCanvasSectionBlock(canvas);

    if (!block) return false;

    const collapsed =
        block.dataset.pisiCanvasCollapsed !== '1';

    block.dataset.pisiCanvasCollapsed =
        collapsed ? '1' : '0';

    syncPisiCanvasSectionState(
        canvas,
        header
    );
    notifyPisiCanvasSectionChanged(block);
    return true;
}

function deletePisiCanvasSection(canvas) {
    const block =
        getPisiCanvasSectionBlock(canvas);
    const editor =
        block?.closest?.('.pisi-rich-editor') ||
        block?.parentElement ||
        null;

    if (!block || !editor) return false;

    if (
        window.__pisiPaintState?.activeCanvas === canvas
    ) {
        window.__pisiPaintState.activeCanvas = null;
    }

    try {
        clearPisiCanvasDocumentSelection(block);
    } catch {
        window.getSelection?.()?.removeAllRanges?.();
    }

    block.remove();

    editor.dispatchEvent(
        new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContent'
        })
    );

    return true;
}

function createPisiCanvasSectionHeader(canvas) {
    const header = document.createElement('div');
    const toggle = document.createElement('button');
    const title = document.createElement('input');
    const remove = document.createElement('button');

    header.className =
        'pisi-canvas-section-header';
    header.dataset.pisiCanvasSectionHeader = '1';
    header.setAttribute(
        'contenteditable',
        'false'
    );

    toggle.type = 'button';
    toggle.className =
        'pisi-canvas-section-toggle';
    toggle.dataset.pisiCanvasSectionToggle = '1';

    title.type = 'text';
    title.className =
        'pisi-canvas-section-title';
    title.dataset.pisiCanvasSectionTitle = '1';
    title.maxLength = 80;
    title.autocomplete = 'off';
    title.spellcheck = false;

    remove.type = 'button';
    remove.className = 'pisi-section-delete';
    remove.dataset.pisiCanvasSectionDelete = '1';
    remove.setAttribute('contenteditable', 'false');

    toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const block =
            getPisiCanvasSectionBlock(canvas);
        clearPisiCanvasDocumentSelection(block);
        togglePisiCanvasSection(
            canvas,
            header
        );
    });

    const stopEditorEvent = (event) => {
        event.stopPropagation();
    };

    [
        'pointerdown',
        'pointerup',
        'mousedown',
        'mouseup',
        'click',
        'dblclick',
        'focusin',
        'focusout',
        'keyup',
        'compositionstart',
        'compositionupdate',
        'compositionend'
    ].forEach((type) => {
        title.addEventListener(
            type,
            stopEditorEvent
        );
    });

    title.addEventListener('focus', () => {
        const block =
            getPisiCanvasSectionBlock(canvas);

        clearPisiCanvasDocumentSelection(block);
        title.dataset.pisiCanvasOriginalTitle =
            String(
                block?.dataset.pisiCanvasTitle ||
                PISI_CANVAS_DEFAULT_TITLE
            );
    });

    title.addEventListener('beforeinput', (event) => {
        event.stopPropagation();
    });

    title.addEventListener('input', (event) => {
        event.stopPropagation();

        const block =
            getPisiCanvasSectionBlock(canvas);

        if (block) {
            block.dataset.pisiCanvasTitle =
                String(title.value || '').slice(0, 80);
        }

        syncPisiCanvasSectionTitleWidth(title);
    });

    title.addEventListener('change', (event) => {
        event.stopPropagation();
        commitPisiCanvasSectionTitle(
            canvas,
            title
        );
    });

    remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        deletePisiCanvasSection(canvas);
    });

    title.addEventListener('keydown', (event) => {
        event.stopPropagation();

        if (event.key === 'Enter') {
            event.preventDefault();
            title.blur();
            return;
        }

        if (event.key !== 'Escape') return;

        event.preventDefault();

        const block =
            getPisiCanvasSectionBlock(canvas);
        const original =
            title.dataset.pisiCanvasOriginalTitle ||
            PISI_CANVAS_DEFAULT_TITLE;

        if (block) {
            block.dataset.pisiCanvasTitle = original;
        }

        title.value =
            normalizePisiCanvasSectionTitle(
                original
            );
        syncPisiCanvasSectionTitleWidth(title);
        title.blur();
    });

    header.append(toggle, title, remove);

    const labels = getPisiCanvasSectionLabels(
        getPisiCanvasSectionBlock(canvas)
            ?.dataset.pisiCanvasCollapsed === '1'
    );
    remove.setAttribute(
        'aria-label',
        labels.delete
    );
    remove.title = labels.delete;

    return header;
}

function ensurePisiCanvasSectionHeader(canvas) {
    const block =
        getPisiCanvasSectionBlock(canvas);

    if (!block) return null;

    block.classList.remove(
        'pisi-editor-block',
        'pisi-block-active'
    );
    delete block.dataset.pisiBlockId;
    delete block.dataset.pisiBlockType;

    block
        .querySelectorAll(
            ':scope > .pisi-canvas-toolbar-hint'
        )
        .forEach((element) => element.remove());

    const headers = Array.from(
        block.children
    ).filter((child) => (
        child.classList?.contains(
            'pisi-canvas-section-header'
        )
    ));
    let header = headers.find((candidate) => (
        candidate.dataset
            ?.pisiCanvasSectionHeader === '1' &&
        candidate.querySelector(
            '[data-pisi-canvas-section-toggle]'
        ) &&
        candidate.querySelector(
            '[data-pisi-canvas-section-title]'
        ) &&
        candidate.querySelector(
            '[data-pisi-canvas-section-delete]'
        )
    )) || null;

    for (const candidate of headers) {
        if (candidate !== header) {
            candidate.remove();
        }
    }

    if (!header) {
        header =
            createPisiCanvasSectionHeader(canvas);
        block.prepend(header);
    }

    syncPisiCanvasSectionState(
        canvas,
        header
    );

    return header;
}

export {
    ensurePisiCanvasSectionHeader,
    normalizePisiCanvasSectionTitle
};
