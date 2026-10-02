const nativeAlert = window.alert.bind(window);
const nativeConfirm = window.confirm.bind(window);
const nativePrompt = window.prompt.bind(window);

const PISI_SUPPLEMENTAL_ATTRIBUTES = ['title', 'aria-label', 'alt', 'placeholder'];
const PISI_SUPPLEMENTAL_USER_CONTENT_SELECTOR = [
    'input',
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '.pisi-rich-editor',
    '.map-node-title',
    '.map-node-preview',
    '.tree-name',
    '.center-tab-title',
    '.pisi-tag-result-text',
    '.pisi-tag-result-node',
    '.pisi-mission-text',
    '.pisi-mission-node',
    '[data-pisi-user-content]'
].join(', ');

let pisiSupplementalTranslations = { tr: {}, eng: {} };
let pisiSupplementalSourceByRenderedText = new Map();
let pisiSupplementalObserver = null;
let pisiSupplementalApplying = false;

function getPisiSupplementalLanguage() {
    return window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
}

function rebuildPisiSupplementalReverseIndex() {
    const reverse = new Map();
    for (const language of ['tr', 'eng']) {
        for (const [source, rendered] of Object.entries(pisiSupplementalTranslations[language] || {})) {
            if (!reverse.has(source)) reverse.set(source, source);
            if (!reverse.has(rendered)) reverse.set(rendered, source);
        }
    }
    pisiSupplementalSourceByRenderedText = reverse;
}

function resolvePisiSupplementalSource(value) {
    const raw = String(value ?? '');
    const leading = raw.match(/^\s*/u)?.[0] || '';
    const trailing = raw.match(/\s*$/u)?.[0] || '';
    const endIndex = Math.max(leading.length, raw.length - trailing.length);
    const core = raw.slice(leading.length, endIndex).replace(/\s+/gu, ' ');
    const source = pisiSupplementalSourceByRenderedText.get(core) || core;
    return { raw, leading, trailing, core, source };
}

function translatePisiSupplementalText(value) {
    const parts = resolvePisiSupplementalSource(value);
    if (!parts.core) return parts.raw;
    const language = getPisiSupplementalLanguage();
    const translated = pisiSupplementalTranslations[language]?.[parts.source];
    if (translated === undefined) return null;
    return `${parts.leading}${translated}${parts.trailing}`;
}

function translatePisiUiText(value) {
    const source = String(value ?? '');
    const supplemental = translatePisiSupplementalText(source);
    if (supplemental !== null) return supplemental;
    return window.pisiI18n?.translate?.(source) ?? source;
}

function isPisiSupplementalUserContent(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest?.(PISI_SUPPLEMENTAL_USER_CONTENT_SELECTOR));
}

function applyPisiSupplementalTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || isPisiSupplementalUserContent(node)) {
        return false;
    }
    const translated = translatePisiSupplementalText(node.nodeValue || '');
    if (translated === null || translated === node.nodeValue) return false;
    node.nodeValue = translated;
    return true;
}

function applyPisiSupplementalAttributes(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    let changed = false;
    for (const attribute of PISI_SUPPLEMENTAL_ATTRIBUTES) {
        if (!element.hasAttribute(attribute)) continue;
        const current = element.getAttribute(attribute) || '';
        const translated = translatePisiSupplementalText(current);
        if (translated === null || translated === current) continue;
        element.setAttribute(attribute, translated);
        changed = true;
    }
    return changed;
}

/** @param {Document | Element | Node} [root] */
function applyPisiSupplementalRoot(root = document) {
    if (!root || pisiSupplementalApplying) return;
    pisiSupplementalApplying = true;
    try {
        if (root.nodeType === Node.TEXT_NODE) {
            applyPisiSupplementalTextNode(root);
            return;
        }
        const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [...document.querySelectorAll('*')];
        for (const element of elements) {
            applyPisiSupplementalAttributes(element);
            for (const child of element.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) applyPisiSupplementalTextNode(child);
            }
        }
    } finally {
        pisiSupplementalApplying = false;
    }
}

function installPisiSupplementalObserver() {
    if (pisiSupplementalObserver || !document.body) return;
    pisiSupplementalObserver = new MutationObserver((mutations) => {
        if (pisiSupplementalApplying) return;
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                applyPisiSupplementalTextNode(mutation.target);
                continue;
            }
            if (mutation.type === 'attributes') {
                applyPisiSupplementalAttributes(mutation.target);
                continue;
            }
            for (const node of mutation.addedNodes) applyPisiSupplementalRoot(node);
        }
    });
    pisiSupplementalObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: PISI_SUPPLEMENTAL_ATTRIBUTES
    });
}

async function initializePisiSupplementalTranslations() {
    await window.pisiI18n?.ready?.();
    const response = await fetch(new URL('locales/ui-translations.json', window.location.href));
    if (!response.ok) throw new Error(`Supplemental locale could not be loaded (${response.status}).`);
    const parsed = await response.json();
    pisiSupplementalTranslations = {
        tr: parsed?.tr && typeof parsed.tr === 'object' ? parsed.tr : {},
        eng: parsed?.eng && typeof parsed.eng === 'object' ? parsed.eng : {}
    };
    rebuildPisiSupplementalReverseIndex();
    applyPisiSupplementalRoot(document);
    installPisiSupplementalObserver();
}

window.pisiT = translatePisiUiText;
window.alert = (message) => nativeAlert(translatePisiUiText(message));
window.confirm = (message) => nativeConfirm(translatePisiUiText(message));
window.prompt = (message, defaultValue = '') => {
    return nativePrompt(translatePisiUiText(message), defaultValue);
};

document.addEventListener('pisi:language-changed', () => {
    requestAnimationFrame(() => applyPisiSupplementalRoot(document));
});

await initializePisiSupplementalTranslations().catch((error) => {
    console.error('[Pisi] Renderer supplemental localization could not initialize:', error);
});

export { applyPisiSupplementalRoot, translatePisiSupplementalText, translatePisiUiText };
