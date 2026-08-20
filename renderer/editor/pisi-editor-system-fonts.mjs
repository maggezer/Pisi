import { registerModule } from "../core/module-registry.mjs";

// Pisi intentionally does not bundle or redistribute Comic Sans font files.
// The editor only references an already-installed system font and falls back
// to the browser's generic cursive family when it is unavailable.
const PISI_SYSTEM_FONT_OPTIONS = Object.freeze([
    Object.freeze({
        value: 'Comic Sans MS',
        label: 'Comic Sans MS',
        cssFamily: '"Comic Sans MS", "Comic Sans", cursive'
    })
]);

function ensurePisiEditorSystemFontOptions(root = document) {
    if (!root?.querySelectorAll) return 0;

    let added = 0;
    root.querySelectorAll('.pisi-font-family-select').forEach((select) => {
        for (const font of PISI_SYSTEM_FONT_OPTIONS) {
            const exists = Array.from(select.options || []).some((option) => (
                option.value === font.value
            ));
            if (exists) continue;

            const option = document.createElement('option');
            option.value = font.value;
            option.textContent = font.label;
            option.dataset.pisiSystemFont = 'true';
            select.appendChild(option);
            added += 1;
        }
    });

    return added;
}

function setupPisiEditorSystemFonts() {
    ensurePisiEditorSystemFontOptions(document);

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
                    ensurePisiEditorSystemFontOptions(node.parentElement || node);
                }
            }
        }
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });
}

setupPisiEditorSystemFonts();

const moduleApi = {
    PISI_SYSTEM_FONT_OPTIONS,
    ensurePisiEditorSystemFontOptions,
    setupPisiEditorSystemFonts
};

registerModule('editor.systemFonts', moduleApi);
