import { registerModule } from "../core/module-registry.mjs";

// Comic Sans is never bundled: Pisi only asks the operating system for it.
// Comic Neue and Vincendo are bundled locally under SIL OFL 1.1.
const PISI_EDITOR_EXTRA_FONT_OPTIONS = Object.freeze([
    Object.freeze({
        value: '"Comic Sans MS", "Comic Sans", cursive',
        label: 'Comic Sans MS',
        source: 'system'
    }),
    Object.freeze({
        value: 'Comic Neue',
        label: 'Comic Neue',
        source: 'bundled'
    }),
    Object.freeze({
        value: 'Vincendo',
        label: 'Vincendo',
        source: 'bundled'
    })
]);

/** @param {Document | Element | Node} [root] */
function collectPisiFontSelects(root = document) {
    if (!root) return [];
    const selects = [];

    if (root instanceof Element && root.matches('.pisi-font-family-select')) {
        selects.push(root);
    }
    if (root.querySelectorAll) {
        selects.push(...root.querySelectorAll('.pisi-font-family-select'));
    }

    return Array.from(new Set(selects));
}

/** @param {Document | Element | Node} [root] */
function ensurePisiEditorExtraFontOptions(root = document) {
    let added = 0;

    collectPisiFontSelects(root).forEach((select) => {
        for (const font of PISI_EDITOR_EXTRA_FONT_OPTIONS) {
            const exists = Array.from(select.options || []).some((option) => (
                option.value === font.value || option.textContent === font.label
            ));
            if (exists) continue;

            const option = document.createElement('option');
            option.value = font.value;
            option.textContent = font.label;
            option.dataset.pisiExtraFont = font.source;
            select.appendChild(option);
            added += 1;
        }
    });

    return added;
}

// Backward-compatible name used by earlier tests/integration points.
/** @param {Document | Element | Node} [root] */
function ensurePisiEditorSystemFontOptions(root = document) {
    return ensurePisiEditorExtraFontOptions(root);
}

function refreshPisiEditorExtraFontOptions() {
    ensurePisiEditorExtraFontOptions(document);
    // Bundled-font module owns the actual Comic Neue FontFace load.
    void window.loadPisiComicNeueFont?.();
}

function setupPisiEditorSystemFonts() {
    refreshPisiEditorExtraFontOptions();

    if (document.documentElement?.dataset.pisiSystemFontsBound === '1') {
        return;
    }
    document.documentElement.dataset.pisiSystemFontsBound = '1';

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) {
                if (node?.nodeType !== Node.ELEMENT_NODE) continue;
                if (
                    node.matches?.('.pisi-font-family-select') ||
                    node.querySelector?.('.pisi-font-family-select')
                ) {
                    ensurePisiEditorExtraFontOptions(node);
                }
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // setupPisiRichToolbars() runs from a DOMContentLoaded listener registered
    // later in bootstrap. Queueing a task guarantees the final toolbar markup
    // has been created before we reconcile its native <select> options.
    const reconcileAfterToolbarSetup = () => {
        setTimeout(refreshPisiEditorExtraFontOptions, 0);
        setTimeout(refreshPisiEditorExtraFontOptions, 100);
    };

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            reconcileAfterToolbarSetup,
            { once: true }
        );
    } else {
        reconcileAfterToolbarSetup();
    }

    // Last-line guarantee for toolbars that are rebuilt later (modal/center
    // editor). Reconcile synchronously before the native select opens.
    document.addEventListener('mousedown', (event) => {
        const select = event.target?.closest?.('.pisi-font-family-select');
        if (!select) return;
        ensurePisiEditorExtraFontOptions(select);
        void window.loadPisiComicNeueFont?.();
    }, true);

    document.addEventListener('focusin', (event) => {
        const select = event.target?.closest?.('.pisi-font-family-select');
        if (!select) return;
        ensurePisiEditorExtraFontOptions(select);
        void window.loadPisiComicNeueFont?.();
    }, true);
}

setupPisiEditorSystemFonts();

const moduleApi = {
    PISI_EDITOR_EXTRA_FONT_OPTIONS,
    PISI_SYSTEM_FONT_OPTIONS: PISI_EDITOR_EXTRA_FONT_OPTIONS,
    collectPisiFontSelects,
    ensurePisiEditorExtraFontOptions,
    ensurePisiEditorSystemFontOptions,
    refreshPisiEditorExtraFontOptions,
    setupPisiEditorSystemFonts
};

registerModule('editor.systemFonts', moduleApi);
