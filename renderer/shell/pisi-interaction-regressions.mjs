const PISI_EDITOR_TAB_TEXT = '\u00a0'.repeat(4);
const PISI_MAP_RENAME_WAIT_MS = 5000;

function getActivePisiMapRenameInput() {
    return document.querySelector('.map-node-title-input');
}

function finishPisiMapRenameOnOutsidePointer(event) {
    const input = getActivePisiMapRenameInput();
    if (!input) return;
    if (event.target === input || input.contains?.(event.target)) return;

    input.blur();
}

function waitForPisiMapRename(box) {
    if (!box || box.dataset.renaming !== '1') {
        return Promise.resolve(Boolean(box?.isConnected));
    }

    return new Promise((resolve) => {
        const startedAt = Date.now();

        const check = () => {
            if (!box.isConnected) {
                resolve(false);
                return;
            }

            if (box.dataset.renaming !== '1') {
                resolve(true);
                return;
            }

            if (Date.now() - startedAt >= PISI_MAP_RENAME_WAIT_MS) {
                resolve(false);
                return;
            }

            setTimeout(check, 16);
        };

        check();
    });
}

async function openPisiMapNodeAfterRename(box) {
    if (!box?.isConnected) return false;

    box.querySelector('.map-node-title-input')?.blur?.();

    const ready = await waitForPisiMapRename(box);
    if (!ready || !box.isConnected) return false;

    return Boolean(await window.openNodeModalFromBox?.(box));
}

function handlePisiMapOpenWhileRenaming(event) {
    const preview = event.target?.closest?.('.map-node-preview');
    const openButton = event.target?.closest?.('.map-node-open');
    const box = (preview || openButton)?.closest?.('.map-node-box');

    if (!box || box.dataset.renaming !== '1') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void openPisiMapNodeAfterRename(box);
}

function insertPisiEditorTab(event) {
    if (
        event.key !== 'Tab' ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
    ) {
        return false;
    }

    const editor = event.target?.closest?.(
        '.pisi-rich-editor[contenteditable="true"]'
    );

    // Nested editable controls (for example sheet cells) keep their own Tab logic.
    if (!editor || event.target !== editor) return false;

    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return false;

    const range = selection.getRangeAt(0);
    if (
        range.startContainer !== editor &&
        !editor.contains(range.startContainer)
    ) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    range.deleteContents();

    const tabNode = document.createTextNode(PISI_EDITOR_TAB_TEXT);
    range.insertNode(tabNode);
    range.setStartAfter(tabNode);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function removePisiTitlebarLanguageToggle() {
    document.getElementById('pisi-language-toggle')?.remove();
}

function syncPisiModalChrome() {
    const modalVisible = document
        .getElementById('node-modal-overlay')
        ?.classList.contains('visible');

    if (modalVisible) {
        window.closePisiAppMenu?.();
    }

    removePisiTitlebarLanguageToggle();
}

function installPisiInteractionRegressionFixes() {
    removePisiTitlebarLanguageToggle();

    // preload creates titlebar controls on DOMContentLoaded as well.
    queueMicrotask(removePisiTitlebarLanguageToggle);
    setTimeout(removePisiTitlebarLanguageToggle, 0);

    // Edge deletion is deliberately not intercepted here. The canonical
    // map.edges handler owns deletion so focus/reset behavior cannot diverge.
    document.addEventListener('mousedown', finishPisiMapRenameOnOutsidePointer, true);
    document.addEventListener('dblclick', handlePisiMapOpenWhileRenaming, true);
    document.addEventListener('click', handlePisiMapOpenWhileRenaming, true);
    document.addEventListener('keydown', insertPisiEditorTab, true);
    document.addEventListener('pisi:active-node-changed', syncPisiModalChrome);
    document.addEventListener('pisi:language-changed', removePisiTitlebarLanguageToggle);
}

if (document.readyState === 'loading') {
    document.addEventListener(
        'DOMContentLoaded',
        installPisiInteractionRegressionFixes,
        { once: true }
    );
} else {
    installPisiInteractionRegressionFixes();
}

export {};
