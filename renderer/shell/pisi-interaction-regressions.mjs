const PISI_EDITOR_TAB_TEXT = '\u00a0'.repeat(4);
const PISI_MAP_RENAME_WAIT_MS = 5000;

function refocusPisiAfterMapInteraction() {
    window.resetPisiMapConnectionInteractions?.();
    window.resetPisiKeyboardAndPointerState?.();
    window.refocusPisiRenderer?.();

    setTimeout(() => {
        window.refocusPisiRenderer?.();
    }, 80);
}

async function deletePisiMapEdgeSafely(edgeId) {
    const mapPath = window.activeMapPath;
    if (!mapPath || !edgeId) return false;

    window.resetPisiMapConnectionInteractions?.();
    window.resetPisiKeyboardAndPointerState?.();

    const confirmed = typeof window.pisiConfirm === 'function'
        ? await window.pisiConfirm('Bu bağlantı silinsin mi?', {
            title: 'Bağlantıyı sil',
            confirmText: 'Sil',
            cancelText: 'Vazgeç',
            danger: true
        })
        : window.confirm('Bu bağlantı silinsin mi?');

    window.resetPisiKeyboardAndPointerState?.();

    if (!confirmed) {
        refocusPisiAfterMapInteraction();
        return false;
    }

    try {
        window.suppressNextFileSystemRefresh?.(8000);

        const result = await window.pisiProject?.deleteMapConnection?.(
            mapPath,
            edgeId
        );

        if (!result?.ok) {
            window.alert(result?.error || 'Bağlantı silinemedi.');
            return false;
        }

        const currentEdges = Array.isArray(window.activeMapEdges)
            ? window.activeMapEdges
            : [];

        window.activeMapEdges = Array.isArray(result.edges)
            ? result.edges
            : currentEdges.filter((edge) => edge.id !== edgeId);

        window.drawMapConnections?.();

        if (typeof window.refreshActiveMapTreeBranch === 'function') {
            await window.refreshActiveMapTreeBranch();
        }

        return true;
    } catch (error) {
        console.error('[PISI] Bağlantı silme hatası:', error);
        window.alert('Bağlantı silinirken hata oluştu: ' + error.message);
        return false;
    } finally {
        refocusPisiAfterMapInteraction();
    }
}

function handlePisiMapEdgeDeleteCapture(event) {
    const deleteControl = event.target?.closest?.('.map-edge-delete');
    if (!deleteControl) return;

    const edgeId = deleteControl.dataset.edgeId ||
        deleteControl.closest?.('[data-edge-id]')?.dataset.edgeId;

    if (!edgeId) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void deletePisiMapEdgeSafely(edgeId);
}

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

    document.addEventListener('click', handlePisiMapEdgeDeleteCapture, true);
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
