const PISI_EDITOR_TAB_TEXT = '\u00a0'.repeat(4);
const PISI_MAP_RENAME_WAIT_MS = 5000;

let pisiTitlebarLanguageObserver = null;

function getActivePisiMapRenameInput() {
    return document.querySelector('.map-node-title-input');
}

function finishPisiMapRenameOnOutsidePointer(event) {
    const input = getActivePisiMapRenameInput();
    if (!input) return false;
    if (event.target === input || input.contains?.(event.target)) return false;

    // Rename açıkken dışarı yapılan ilk pointer olayı yalnızca rename'i
    // sonlandırsın. Aynı olay pan, node drag veya sağ-tık seçimine dönüşmesin.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    input.blur();
    return true;
}

function finishPisiMapRenameOnOutsideContextMenu(event) {
    if (!getActivePisiMapRenameInput()) return;
    finishPisiMapRenameOnOutsidePointer(event);
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
    if (preview && event.type !== 'dblclick') return;
    if (openButton && event.type !== 'click') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void openPisiMapNodeAfterRename(box);
}

function insertPisiEditorTab(event) {
    if (
        event.key !== 'Tab' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
    ) {
        return false;
    }

    const editor = event.target?.closest?.(
        '.pisi-rich-editor[contenteditable="true"]'
    );
    const nestedEditable = event.target?.closest?.('[contenteditable="true"]');

    // Normal editör blokları contenteditable özelliğini üst editörden miras
    // alır. Sheet hücresi gibi kendi editable alanı olan kontroller kendi Tab
    // davranışını korur.
    if (!editor || (nestedEditable && nestedEditable !== editor)) return false;

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

async function handlePisiNodeModalEscapeCapture(event) {
    if (event.key !== 'Escape') return;

    const modalOverlay = document.getElementById('node-modal-overlay');
    if (!modalOverlay?.classList.contains('visible')) return;

    // Modal açıkken ESC her zaman modal katmanına aittir. Böylece arkadaki
    // map rename input'u ilk ESC'yi yutamaz.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const tagMenu = document.getElementById('pisi-tag-menu');
    if (tagMenu && !tagMenu.hidden) {
        window.closePisiTagMenu?.();
        return;
    }

    const saved = await window.closeNodeModalAndSave?.();
    if (saved) {
        window.refreshAllPisiMapNodePreviewsFromDisk?.();
    }
}

function removePisiTitlebarLanguageToggle() {
    document.getElementById('pisi-language-toggle')?.remove();
}

function watchPisiTitlebarLanguageToggle() {
    const controls = document.getElementById('window-controls');
    if (!controls || pisiTitlebarLanguageObserver) return;

    pisiTitlebarLanguageObserver = new MutationObserver(() => {
        removePisiTitlebarLanguageToggle();
    });
    pisiTitlebarLanguageObserver.observe(controls, { childList: true });
    removePisiTitlebarLanguageToggle();
}

function closePisiAppMenuForModal() {
    const button = document.getElementById('pisi-app-menu-button');
    const menu = document.getElementById('pisi-app-menu-dropdown');

    if (button) button.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
}

function syncPisiModalChrome() {
    const modalVisible = document
        .getElementById('node-modal-overlay')
        ?.classList.contains('visible');
    const appMenuButton = document.getElementById('pisi-app-menu-button');

    if (modalVisible) {
        closePisiAppMenuForModal();
    }

    if (appMenuButton) {
        appMenuButton.disabled = Boolean(modalVisible);
        appMenuButton.setAttribute(
            'aria-disabled',
            String(Boolean(modalVisible))
        );
    }

    removePisiTitlebarLanguageToggle();
}

function installPisiInteractionRegressionFixes() {
    removePisiTitlebarLanguageToggle();
    watchPisiTitlebarLanguageToggle();

    // preload titlebar kontrollerini DOMContentLoaded sırasında kurar; geç
    // eklenen dil butonunu da aynı turda temizle.
    queueMicrotask(removePisiTitlebarLanguageToggle);
    setTimeout(removePisiTitlebarLanguageToggle, 0);

    // Edge deletion is deliberately not intercepted here. The canonical
    // map.edges handler owns deletion so focus/reset behavior cannot diverge.
    document.addEventListener('mousedown', finishPisiMapRenameOnOutsidePointer, true);
    document.addEventListener('contextmenu', finishPisiMapRenameOnOutsideContextMenu, true);
    document.addEventListener('dblclick', handlePisiMapOpenWhileRenaming, true);
    document.addEventListener('click', handlePisiMapOpenWhileRenaming, true);
    document.addEventListener('keydown', handlePisiNodeModalEscapeCapture, true);
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
