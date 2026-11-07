import { registerModule } from '../core/module-registry.mjs';
import { getPisiCommandShortcut, registerPisiCommand, runPisiCommand } from '../core/pisi-command-registry.mjs';

// Interface zoom, printing and the "Görünüm" settings (zoom level, spell
// checking). The native context menu, spell checker languages and the zoom
// factor itself live in main (main/functions/window-shell.js).
//
// Keyboard rule (docs/editor-keyboard-rules.md): Mod+= / Mod+- / Mod+0 always
// zoom the interface, also while a map is focused. Map zoom stays on the wheel,
// pinch and the map's own +/− buttons.

const PISI_ZOOM_COMMANDS = Object.freeze({ in: 'pisi.view.zoom-in', out: 'pisi.view.zoom-out', reset: 'pisi.view.zoom-reset' });
const pisiWindowShellState = { initialized: false, zoomFactor: 1, zoomLevels: [], spellcheck: true };

function pisiWindowShellTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function applyPisiWindowShellSettings(settings = {}) {
    if (Number(settings.zoomFactor) > 0) pisiWindowShellState.zoomFactor = Number(settings.zoomFactor);
    if (Array.isArray(settings.zoomLevels)) pisiWindowShellState.zoomLevels = settings.zoomLevels;
    if (typeof settings.spellcheck === 'boolean') pisiWindowShellState.spellcheck = settings.spellcheck;
    document.dispatchEvent(new CustomEvent('pisi:window-shell-changed', { detail: { ...pisiWindowShellState } }));
    return pisiWindowShellState;
}

async function stepPisiInterfaceZoom(direction) {
    const result = await window.pisiDomain?.command?.('shell.zoom.step.v1', { direction });
    if (result?.ok) applyPisiWindowShellSettings(result.settings);
    return result;
}

async function updatePisiWindowShellSettings(patch) {
    const result = await window.pisiDomain?.command?.('shell.settings.update.v1', patch);
    if (result?.ok) applyPisiWindowShellSettings(result.settings);
    else if (result?.error) pisiNotifyError(pisiWindowShellTranslate(result.error));
    return result;
}

function getPisiActiveNotePath() {
    return window.activeModalNode?.path || window.activeCenterNode?.path || null;
}

/** Prints a note through the PDF export template and the system print dialog. */
async function printPisiNote(nodePath = getPisiActiveNotePath()) {
    if (!nodePath) return { ok: false, error: 'Yazdırılacak açık not yok.' };
    await flushPisiPendingSaves();
    const result = await window.pisiDomain?.command?.('note.print.v1', { nodePath });
    if (!result?.ok) pisiNotifyError(pisiWindowShellTranslate(result?.error || 'Yazdırılamadı.'));
    return result;
}

/**
 * Keyboard layouts put "+" and "=" on different keys (Turkish Q: Shift+0 is
 * "=", Shift+4 is "+"), and the registry cannot name "+" as a key. While the
 * zoom shortcuts are the defaults, these variants run the same commands.
 */
function getPisiZoomShortcutVariant(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return '';
    const key = event.key;
    if (key === '+' || (key === '=' && event.shiftKey)) return 'in';
    if ((key === '_' || key === '-') && event.shiftKey) return 'out';
    if (event.code === 'NumpadAdd') return 'in';
    if (event.code === 'NumpadSubtract') return 'out';
    if (event.code === 'Numpad0') return 'reset';
    return '';
}

function handlePisiZoomShortcutVariant(event) {
    if (event.defaultPrevented || event.isComposing) return;
    const variant = getPisiZoomShortcutVariant(event);
    if (!variant) return;
    const defaults = { in: 'Mod+=', out: 'Mod+-', reset: 'Mod+0' };
    if (getPisiCommandShortcut(PISI_ZOOM_COMMANDS[variant]) !== defaults[variant]) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat || variant !== 'reset') void runPisiCommand(PISI_ZOOM_COMMANDS[variant]);
}

function formatPisiZoomPercent(factor) {
    return `%${Math.round(Number(factor) * 100)}`;
}

function renderPisiWindowShellSettings(container) {
    if (!container || container.querySelector('.pisi-window-shell-settings')) return;
    const section = document.createElement('section');
    section.className = 'pisi-portable-section pisi-window-shell-settings';
    const heading = document.createElement('h2');
    heading.textContent = pisiWindowShellTranslate('Görünüm');
    const zoomLabel = document.createElement('label');
    zoomLabel.className = 'pisi-window-shell-setting';
    const zoomText = document.createElement('span');
    zoomText.textContent = pisiWindowShellTranslate('Arayüz yakınlaştırma');
    const zoom = document.createElement('select');
    zoom.dataset.pisiShellSetting = 'zoomFactor';
    zoomLabel.append(zoomText, zoom);
    const spellLabel = document.createElement('label');
    spellLabel.className = 'pisi-window-shell-setting';
    const spell = document.createElement('input');
    spell.type = 'checkbox';
    spell.dataset.pisiShellSetting = 'spellcheck';
    const spellText = document.createElement('span');
    spellText.textContent = pisiWindowShellTranslate('Yazım denetimi (Türkçe ve İngilizce)');
    spellLabel.append(spell, spellText);
    section.append(heading, zoomLabel, spellLabel);
    container.append(section);

    const render = () => {
        const levels = pisiWindowShellState.zoomLevels.length ? pisiWindowShellState.zoomLevels : [pisiWindowShellState.zoomFactor];
        zoom.replaceChildren(
            ...levels.map((level) => {
                const option = document.createElement('option');
                option.value = String(level);
                option.textContent = formatPisiZoomPercent(level);
                return option;
            })
        );
        zoom.value = String(pisiWindowShellState.zoomFactor);
        spell.checked = pisiWindowShellState.spellcheck;
    };
    render();
    document.addEventListener('pisi:window-shell-changed', render);
    void refreshPisiWindowShellSettings();
    zoom.addEventListener('change', () => void updatePisiWindowShellSettings({ zoomFactor: Number(zoom.value) }));
    spell.addEventListener('change', () => void updatePisiWindowShellSettings({ spellcheck: spell.checked }));
}

async function refreshPisiWindowShellSettings() {
    const result = await window.pisiDomain?.query?.('shell.settings.get.v1', {});
    if (result?.ok) applyPisiWindowShellSettings(result.settings);
    return pisiWindowShellState;
}

function registerPisiWindowShellCommands() {
    const zoom = (id, label, shortcut, direction) =>
        registerPisiCommand({
            id,
            label,
            description: 'Haritada da arayüzü yakınlaştırır; harita yakınlaştırması tekerlek ve harita düğmeleriyle yapılır.',
            category: 'Görünüm',
            defaultShortcut: shortcut,
            allowInInput: true,
            handler: () => stepPisiInterfaceZoom(direction)
        });
    zoom(PISI_ZOOM_COMMANDS.in, 'Arayüzü yakınlaştır', 'Mod+=', 1);
    zoom(PISI_ZOOM_COMMANDS.out, 'Arayüzü uzaklaştır', 'Mod+-', -1);
    zoom(PISI_ZOOM_COMMANDS.reset, 'Arayüz yakınlaştırmasını sıfırla', 'Mod+0', 0);
    registerPisiCommand({
        id: 'pisi.note.print',
        label: 'Yazdır',
        description: 'Açık notu sistem yazdırma penceresiyle yazdırır.',
        category: 'Not',
        // Mod+P stays project search.
        defaultShortcut: 'Mod+Alt+P',
        allowInInput: true,
        when: () => Boolean(getPisiActiveNotePath()),
        handler: () => printPisiNote()
    });
}

function ensurePisiWindowShellStyle() {
    if (document.querySelector('link[data-pisi-window-shell-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/shell/pisi-window-shell.css';
    link.dataset.pisiWindowShellStyle = '1';
    document.head.appendChild(link);
}

function initializePisiWindowShell() {
    if (pisiWindowShellState.initialized) return false;
    pisiWindowShellState.initialized = true;
    ensurePisiWindowShellStyle();
    registerPisiWindowShellCommands();
    window.addEventListener('keydown', handlePisiZoomShortcutVariant, true);
    document.addEventListener('pisi:render-settings-sections', (event) => renderPisiWindowShellSettings(event.detail?.container));
    void refreshPisiWindowShellSettings();
    return true;
}

const moduleApi = {
    pisiWindowShellState,
    stepPisiInterfaceZoom,
    updatePisiWindowShellSettings,
    refreshPisiWindowShellSettings,
    printPisiNote,
    renderPisiWindowShellSettings,
    initializePisiWindowShell
};

registerModule('shell.windowShell', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiWindowShell, { once: true });
} else {
    initializePisiWindowShell();
}
