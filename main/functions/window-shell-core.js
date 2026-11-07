// Pure rules for the window shell: the native context menu template, the
// interface zoom range and the spell checker languages. No Electron; unit-tested.

export const PISI_ZOOM_MIN = 0.8;
export const PISI_ZOOM_MAX = 2;
export const PISI_ZOOM_STEP = 0.1;
export const PISI_ZOOM_DEFAULT = 1;
export const PISI_SPELLING_SUGGESTION_LIMIT = 5;

/** Clamps a zoom factor to 80–200 % on the 10 % grid; anything invalid is 100 %. */
export function clampPisiZoomFactor(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return PISI_ZOOM_DEFAULT;
    const stepped = Math.round(number / PISI_ZOOM_STEP) * PISI_ZOOM_STEP;
    return Math.round(Math.min(PISI_ZOOM_MAX, Math.max(PISI_ZOOM_MIN, stepped)) * 100) / 100;
}

/** direction > 0 zooms in, < 0 zooms out, 0 resets to 100 %. */
export function stepPisiZoomFactor(current, direction) {
    if (!direction) return PISI_ZOOM_DEFAULT;
    return clampPisiZoomFactor(clampPisiZoomFactor(current) + Math.sign(direction) * PISI_ZOOM_STEP);
}

/** Every selectable zoom level, 0.8 … 2.0. */
export function listPisiZoomLevels() {
    const levels = [];
    for (let percent = PISI_ZOOM_MIN * 100; percent <= PISI_ZOOM_MAX * 100; percent += PISI_ZOOM_STEP * 100) levels.push(percent / 100);
    return levels;
}

/**
 * Stored shell settings with defaults: zoom 100 %, spell checking on.
 * @param {{ zoomFactor?: unknown, spellcheck?: unknown } | null | undefined} [raw]
 */
export function normalizePisiShellSettings(raw = {}) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return { zoomFactor: clampPisiZoomFactor(value.zoomFactor ?? PISI_ZOOM_DEFAULT), spellcheck: value.spellcheck !== false };
}

/**
 * Turkish and US English, the interface language first. When the platform
 * reports its dictionaries, unavailable ones are left out (Windows throws on them).
 * @param {string} language 'tr' or 'eng'
 * @param {string[]} [available]
 */
export function getPisiSpellCheckerLanguages(language, available = []) {
    const wanted = language === 'eng' ? ['en-US', 'tr'] : ['tr', 'en-US'];
    if (!Array.isArray(available) || !available.length) return wanted;
    const list = available.map((item) => String(item));
    const pick = (wantedItem) => {
        const lower = wantedItem.toLowerCase();
        const base = lower.split('-')[0];
        return list.find((item) => item.toLowerCase() === lower) || list.find((item) => item.toLowerCase().split('-')[0] === base) || '';
    };
    return wanted.map(pick).filter(Boolean);
}

function tidySeparators(items) {
    const result = [];
    for (const item of items) {
        if (item.type === 'separator' && (!result.length || result[result.length - 1].type === 'separator')) continue;
        result.push(item);
    }
    while (result.length && result[result.length - 1].type === 'separator') result.pop();
    return result;
}

/**
 * Menu items for Electron's `context-menu` params. Items carry either an
 * Electron `role` or an `action` the main process performs. An empty list
 * means no menu (e.g. a right click on empty, non-editable space).
 * @param {{ isEditable?: boolean, selectionText?: string, linkURL?: string, misspelledWord?: string,
 *   dictionarySuggestions?: string[], editFlags?: Record<string, boolean> }} params
 * @param {{ translate?: (text: string) => string, isLinkAllowed?: (url: string) => boolean, spellcheck?: boolean }} [options]
 */
export function buildPisiContextMenuTemplate(params = {}, options = {}) {
    const t = options.translate || ((text) => text);
    const flags = params.editFlags || {};
    const items = [];
    const word = String(params.misspelledWord || '');
    if (params.isEditable && word && options.spellcheck !== false) {
        const suggestions = (params.dictionarySuggestions || []).slice(0, PISI_SPELLING_SUGGESTION_LIMIT);
        for (const suggestion of suggestions) items.push({ id: 'spelling-suggestion', label: suggestion, action: 'replace-misspelling', value: suggestion });
        if (!suggestions.length) items.push({ id: 'spelling-none', label: t('Öneri yok'), enabled: false });
        items.push({ type: 'separator' });
        items.push({ id: 'add-to-dictionary', label: t('Sözlüğe ekle'), action: 'add-to-dictionary', value: word });
        items.push({ type: 'separator' });
    }
    const link = String(params.linkURL || '');
    if (link && (options.isLinkAllowed ? options.isLinkAllowed(link) : true)) {
        items.push({ id: 'open-link', label: t('Bağlantıyı aç'), action: 'open-link', value: link });
        items.push({ id: 'copy-link', label: t('Bağlantıyı kopyala'), action: 'copy-link', value: link });
        items.push({ type: 'separator' });
    }
    if (params.isEditable) {
        items.push({ id: 'cut', label: t('Kes'), role: 'cut', enabled: flags.canCut !== false });
        items.push({ id: 'copy', label: t('Kopyala'), role: 'copy', enabled: flags.canCopy !== false });
        items.push({ id: 'paste', label: t('Yapıştır'), role: 'paste', enabled: flags.canPaste !== false });
        items.push({ id: 'paste-plain', label: t('Biçimsiz yapıştır'), role: 'pasteAndMatchStyle', enabled: flags.canPaste !== false });
        items.push({ type: 'separator' });
        items.push({ id: 'select-all', label: t('Tümünü seç'), role: 'selectAll', enabled: flags.canSelectAll !== false });
    } else if (String(params.selectionText || '').trim()) {
        items.push({ id: 'copy', label: t('Kopyala'), role: 'copy', enabled: flags.canCopy !== false });
    }
    return tidySeparators(items);
}
