import { registerModule } from '../core/module-registry.mjs';

const PISI_LATEX_COMMANDS_STORAGE_KEY = 'pisi.editor.latexCommands.v1';
const PISI_DOUBLE_DOT_COMMANDS_STORAGE_KEY = 'pisi.editor.doubleDotCommands.v1';

let editorCommandPreferenceObserver = null;

function readPisiBooleanPreference(key, defaultValue) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        const value = String(raw).trim().toLowerCase();
        if (['1', 'true', 'on', 'yes'].includes(value)) return true;
        if (['0', 'false', 'off', 'no'].includes(value)) return false;
        return defaultValue;
    } catch {
        return defaultValue;
    }
}

function writePisiBooleanPreference(key, enabled) {
    const normalized = enabled === true;
    try {
        localStorage.setItem(key, normalized ? '1' : '0');
    } catch (error) {
        console.warn('[PISI] Editor command preference could not be saved:', error);
    }
    return normalized;
}

function getPisiLatexCommandsPreference() {
    return readPisiBooleanPreference(PISI_LATEX_COMMANDS_STORAGE_KEY, true);
}

function setPisiLatexCommandsPreference(enabled) {
    const normalized = writePisiBooleanPreference(
        PISI_LATEX_COMMANDS_STORAGE_KEY,
        enabled
    );
    if (!normalized) {
        window.closePisiUnifiedCommandMenu?.();
    }
    return normalized;
}

function getPisiDoubleDotCommandsPreference() {
    return readPisiBooleanPreference(PISI_DOUBLE_DOT_COMMANDS_STORAGE_KEY, true);
}

function setPisiDoubleDotCommandsPreference(enabled) {
    return writePisiBooleanPreference(PISI_DOUBLE_DOT_COMMANDS_STORAGE_KEY, enabled);
}

function ensurePisiEditorCommandPreferenceStyle() {
    if (document.querySelector('link[data-pisi-editor-command-preferences-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/editor/pisi-editor-command-preferences.css';
    link.dataset.pisiEditorCommandPreferencesStyle = '1';
    document.head.appendChild(link);
}

function syncPisiEditorPreferenceButton(button, enabled) {
    if (!button) return;
    button.textContent = enabled ? 'On' : 'Off';
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('active', enabled);
}

function makePisiEditorPreferenceRow({ id, labelText, descriptionText, getValue, setValue, eventKey }) {
    const row = document.createElement('div');
    row.id = id;
    row.className = 'pisi-preference-toggle-row pisi-editor-command-preference-row';

    const body = document.createElement('div');
    body.className = 'pisi-editor-command-preference-copy';

    const label = document.createElement('span');
    label.className = 'pisi-preference-toggle-label';
    label.textContent = labelText;

    const description = document.createElement('small');
    description.className = 'pisi-editor-command-preference-description';
    description.textContent = descriptionText;

    body.append(label, description);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-preference-toggle-button';
    button.setAttribute('aria-label', labelText);
    syncPisiEditorPreferenceButton(button, getValue());
    button.addEventListener('click', () => {
        const enabled = setValue(!getValue());
        syncPisiEditorPreferenceButton(button, enabled);
        document.dispatchEvent(new CustomEvent('pisi:editor-command-preferences-changed', {
            detail: { key: eventKey, enabled }
        }));
    });

    row.append(body, button);
    return row;
}

function installPisiEditorCommandPreferenceRows() {
    const commandCenter = window.Pisi?.modules?.['shell.commandCenter']?.pisiCommandCenterState;
    if (!commandCenter || commandCenter.activePage !== 'preferences') return false;

    const page = commandCenter.body?.querySelector('.pisi-preferences-page');
    if (!page) return false;

    let group = page.querySelector('#pisi-editor-command-preferences');
    if (group) {
        syncPisiEditorPreferenceButton(
            group.querySelector('#pisi-preference-latex-commands button'),
            getPisiLatexCommandsPreference()
        );
        syncPisiEditorPreferenceButton(
            group.querySelector('#pisi-preference-double-dot-commands button'),
            getPisiDoubleDotCommandsPreference()
        );
        return true;
    }

    group = document.createElement('section');
    group.id = 'pisi-editor-command-preferences';
    group.className = 'pisi-editor-command-preference-group';

    const heading = document.createElement('h3');
    heading.className = 'pisi-editor-command-preference-heading';
    heading.textContent = 'Editor commands';

    const latex = makePisiEditorPreferenceRow({
        id: 'pisi-preference-latex-commands',
        labelText: 'LaTeX support',
        descriptionText: 'Enable extended / and .. commands including formatting, blocks and LaTeX. Todo and done stay available.',
        getValue: getPisiLatexCommandsPreference,
        setValue: setPisiLatexCommandsPreference,
        eventKey: 'latex'
    });

    const doubleDot = makePisiEditorPreferenceRow({
        id: 'pisi-preference-double-dot-commands',
        labelText: '.. commands',
        descriptionText: 'Allow .. as an alternative to / for editor commands.',
        getValue: getPisiDoubleDotCommandsPreference,
        setValue: setPisiDoubleDotCommandsPreference,
        eventKey: 'doubleDot'
    });

    group.append(heading, latex, doubleDot);

    const labelsRow = page.querySelector('#pisi-preference-map-labels');
    const appearanceOptions = page.querySelector('.pisi-theme-options');
    if (labelsRow) labelsRow.insertAdjacentElement('afterend', group);
    else if (appearanceOptions) appearanceOptions.insertAdjacentElement('afterend', group);
    else page.appendChild(group);
    return true;
}

function bindPisiEditorCommandPreferences() {
    ensurePisiEditorCommandPreferenceStyle();
    installPisiEditorCommandPreferenceRows();

    if (!editorCommandPreferenceObserver && document.body) {
        editorCommandPreferenceObserver = new MutationObserver((mutations) => {
            const relevant = mutations.some((mutation) => {
                return [...mutation.addedNodes].some((node) => {
                    return node?.nodeType === Node.ELEMENT_NODE && (
                        node.matches?.('.pisi-preferences-page, .pisi-command-center-body') ||
                        node.querySelector?.('.pisi-preferences-page, .pisi-command-center-body')
                    );
                });
            });
            if (relevant) requestAnimationFrame(installPisiEditorCommandPreferenceRows);
        });
        editorCommandPreferenceObserver.observe(document.body, { childList: true, subtree: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPisiEditorCommandPreferences, { once: true });
} else {
    bindPisiEditorCommandPreferences();
}

registerModule('editor.commandPreferences', {
    bindPisiEditorCommandPreferences,
    getPisiDoubleDotCommandsPreference,
    getPisiLatexCommandsPreference,
    installPisiEditorCommandPreferenceRows,
    setPisiDoubleDotCommandsPreference,
    setPisiLatexCommandsPreference
});

export {
    bindPisiEditorCommandPreferences,
    getPisiDoubleDotCommandsPreference,
    getPisiLatexCommandsPreference,
    installPisiEditorCommandPreferenceRows,
    setPisiDoubleDotCommandsPreference,
    setPisiLatexCommandsPreference
};