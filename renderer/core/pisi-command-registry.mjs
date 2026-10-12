import { getPisiNodeRecoveryWarning, protectPisiEditorRecovery } from '../editor/pisi-editor-recovery-policy.mjs';
import { isPisiEditorWriteBlocked, runPisiEditorWrite } from '../editor/pisi-editor-restore.mjs';
import { registerModule } from './module-registry.mjs';

const PISI_SHORTCUT_STORAGE_KEY = 'pisi.shortcuts.v1';
const pisiCommandRegistry = new Map();
let pisiShortcutOverrides = loadPisiShortcutOverrides();
let pisiCommandPaletteState = null;

function normalizePisiCommandId(value = '') {
    const id = String(value || '')
        .trim()
        .toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id)) {
        throw new TypeError('Komut kimliği geçersiz.');
    }
    return id.slice(0, 140);
}

function normalizePisiShortcut(value = '') {
    const aliases = {
        control: 'Ctrl',
        ctrl: 'Ctrl',
        meta: 'Meta',
        cmd: 'Meta',
        command: 'Meta',
        mod: 'Mod',
        alt: 'Alt',
        option: 'Alt',
        shift: 'Shift',
        escape: 'Escape',
        esc: 'Escape',
        space: 'Space',
        slash: '/',
        plus: '+'
    };
    const pieces = String(value || '')
        .split('+')
        .map((item) => item.trim())
        .filter(Boolean);
    const modifiers = new Set();
    let key = '';
    for (const piece of pieces) {
        const normalized = aliases[piece.toLowerCase()] || (piece.length === 1 ? piece.toUpperCase() : piece);
        if (['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'].includes(normalized)) {
            modifiers.add(normalized);
        } else {
            key = normalized;
        }
    }
    if (!key) return '';
    return [...['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'].filter((item) => modifiers.has(item)), key].join('+');
}

function getPisiEventShortcut(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('Mod');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    let key = event.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(key)) parts.push(key);
    return normalizePisiShortcut(parts.join('+'));
}

function loadPisiShortcutOverrides() {
    try {
        const value = JSON.parse(localStorage.getItem(PISI_SHORTCUT_STORAGE_KEY) || '{}');
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function savePisiShortcutOverrides() {
    localStorage.setItem(PISI_SHORTCUT_STORAGE_KEY, JSON.stringify(pisiShortcutOverrides));
}

function getPisiCommandShortcut(commandOrId) {
    const command = typeof commandOrId === 'string' ? pisiCommandRegistry.get(normalizePisiCommandId(commandOrId)) : commandOrId;
    if (!command) return '';
    const override = pisiShortcutOverrides[command.id];
    return override === null ? '' : normalizePisiShortcut(override || command.defaultShortcut || '');
}

function formatPisiShortcutForDisplay(shortcut) {
    const normalized = normalizePisiShortcut(shortcut);
    if (!normalized) return '';
    const platform = String(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
    const modifier = /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';
    return normalized.replace(/\bMod\b/g, modifier);
}

function findPisiShortcutConflict(shortcut, exceptId = '') {
    const normalized = normalizePisiShortcut(shortcut);
    if (!normalized) return null;
    return (
        Array.from(pisiCommandRegistry.values()).find((command) => {
            return command.id !== exceptId && getPisiCommandShortcut(command) === normalized;
        }) || null
    );
}

function setPisiCommandShortcut(id, shortcut, options = {}) {
    const commandId = normalizePisiCommandId(id);
    if (!pisiCommandRegistry.has(commandId)) throw new Error('Komut bulunamadı.');
    const normalized = normalizePisiShortcut(shortcut);
    const conflict = findPisiShortcutConflict(normalized, commandId);
    if (conflict && options.replace !== true) {
        return { ok: false, conflict };
    }
    if (conflict) pisiShortcutOverrides[conflict.id] = null;
    pisiShortcutOverrides[commandId] = normalized || null;
    savePisiShortcutOverrides();
    document.dispatchEvent(
        new CustomEvent('pisi:shortcuts-changed', {
            detail: { id: commandId, shortcut: normalized, conflict: conflict?.id || null }
        })
    );
    return { ok: true, shortcut: normalized, replaced: conflict?.id || null };
}

function resetPisiCommandShortcut(id) {
    const commandId = normalizePisiCommandId(id);
    delete pisiShortcutOverrides[commandId];
    savePisiShortcutOverrides();
    document.dispatchEvent(
        new CustomEvent('pisi:shortcuts-changed', {
            detail: { id: commandId, reset: true }
        })
    );
    return getPisiCommandShortcut(commandId);
}

function registerPisiCommand(command = {}) {
    const id = normalizePisiCommandId(command.id);
    if (pisiCommandRegistry.has(id)) throw new Error(`Pisi komutu zaten kayıtlı: ${id}`);
    if (typeof command.handler !== 'function') throw new TypeError('Komut handler gerektirir.');
    const record = Object.freeze({
        ...command,
        id,
        label: String(command.label || id).slice(0, 140),
        description: String(command.description || '').slice(0, 300),
        category: String(command.category || 'Pisi').slice(0, 80),
        owner: String(command.owner || 'host').slice(0, 120),
        defaultShortcut: normalizePisiShortcut(command.defaultShortcut || ''),
        allowInInput: command.allowInInput === true
    });
    pisiCommandRegistry.set(id, record);
    document.dispatchEvent(
        new CustomEvent('pisi:commands-changed', {
            detail: { action: 'registered', command: record }
        })
    );
    return () => {
        if (pisiCommandRegistry.get(id) !== record) return false;
        pisiCommandRegistry.delete(id);
        document.dispatchEvent(
            new CustomEvent('pisi:commands-changed', {
                detail: { action: 'unregistered', command: record }
            })
        );
        return true;
    };
}

function listPisiCommands() {
    return Array.from(pisiCommandRegistry.values()).sort((a, b) => {
        const category = a.category.localeCompare(b.category, 'tr');
        return category || a.label.localeCompare(b.label, 'tr');
    });
}

async function runPisiCommand(id, context = {}) {
    const command = pisiCommandRegistry.get(normalizePisiCommandId(id));
    if (!command) return { ok: false, error: 'Komut bulunamadı.' };
    if (typeof command.when === 'function' && !command.when(context)) {
        return { ok: false, unavailable: true };
    }
    try {
        const value = await command.handler({
            ...context,
            command,
            projectFolder: window.currentProjectFolder || null,
            activeNodePath: window.activeModalNode?.path || window.activeCenterNode?.path || null
        });
        document.dispatchEvent(
            new CustomEvent('pisi:command-ran', {
                detail: { id: command.id }
            })
        );
        return { ok: true, value };
    } catch (error) {
        console.error('[PISI] Komut çalıştırılamadı:', command.id, error);
        return { ok: false, error: error.message };
    }
}

function isPisiEditableTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function handlePisiCommandShortcut(event) {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (event.target?.closest?.('.pisi-rename-input')) return;
    if (event.target?.classList?.contains('capturing')) return;
    const shortcut = getPisiEventShortcut(event);
    if (!shortcut) return;
    const command = Array.from(pisiCommandRegistry.values()).find((candidate) => {
        return getPisiCommandShortcut(candidate) === shortcut;
    });
    if (!command) return;
    if (isPisiEditableTarget(event.target) && !command.allowInInput) return;
    const context = { event, target: event.target };
    if (typeof command.when === 'function' && !command.when(context)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void runPisiCommand(command.id, context);
}

function ensurePisiCommandPalette() {
    if (pisiCommandPaletteState?.overlay?.isConnected) return pisiCommandPaletteState;
    const overlay = document.createElement('div');
    overlay.className = 'pisi-command-palette-overlay';
    overlay.hidden = true;
    const dialog = document.createElement('section');
    dialog.className = 'pisi-command-palette';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'pisi-command-palette-input';
    input.placeholder = window.pisiT?.('Komut ara') || 'Komut ara';
    const results = document.createElement('div');
    results.className = 'pisi-command-palette-results';
    dialog.append(input, results);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const state = { overlay, dialog, input, results, selected: 0, matches: [], returnFocus: null };
    const render = () => renderPisiCommandPalette(state);
    input.addEventListener('input', () => {
        state.selected = 0;
        render();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closePisiCommandPalette();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            state.selected = Math.max(0, Math.min(state.matches.length - 1, state.selected + delta));
            render();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const command = state.matches[state.selected];
            if (command) {
                closePisiCommandPalette();
                void runPisiCommand(command.id, { source: 'palette' });
            }
        }
    });
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiCommandPalette();
    });
    pisiCommandPaletteState = state;
    return state;
}

function renderPisiCommandPalette(state = ensurePisiCommandPalette()) {
    const query = String(state.input.value || '')
        .toLocaleLowerCase('tr-TR')
        .trim();
    state.matches = listPisiCommands()
        .filter((command) => {
            if (!query) return true;
            return `${command.label} ${command.description} ${command.category}`.toLocaleLowerCase('tr-TR').includes(query);
        })
        .slice(0, 60);
    state.selected = Math.min(state.selected, Math.max(0, state.matches.length - 1));
    const fragment = document.createDocumentFragment();
    state.matches.forEach((command, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-command-palette-item';
        button.classList.toggle('selected', index === state.selected);
        const label = document.createElement('span');
        label.textContent = window.pisiT?.(command.label) || command.label;
        const shortcut = document.createElement('kbd');
        shortcut.textContent = formatPisiShortcutForDisplay(getPisiCommandShortcut(command));
        button.append(label, shortcut);
        button.addEventListener('click', () => {
            closePisiCommandPalette();
            void runPisiCommand(command.id, { source: 'palette' });
        });
        fragment.appendChild(button);
    });
    state.results.replaceChildren(fragment);
}

function openPisiCommandPalette() {
    const state = ensurePisiCommandPalette();
    state.returnFocus = document.activeElement;
    state.overlay.hidden = false;
    state.input.value = '';
    state.selected = 0;
    renderPisiCommandPalette(state);
    state.input.focus();
}

function closePisiCommandPalette() {
    if (!pisiCommandPaletteState) return;
    pisiCommandPaletteState.overlay.hidden = true;
    pisiCommandPaletteState.returnFocus?.focus?.({ preventScroll: true });
}

function renderPisiShortcutSettings(container) {
    const heading = document.createElement('div');
    heading.className = 'pisi-command-section-heading';
    const title = document.createElement('h2');
    title.textContent = window.pisiT?.('Klavye kısayolları') || 'Klavye kısayolları';
    heading.appendChild(title);
    const list = document.createElement('div');
    list.className = 'pisi-shortcut-list';
    for (const command of listPisiCommands()) {
        const row = document.createElement('div');
        row.className = 'pisi-shortcut-row';
        const body = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = window.pisiT?.(command.label) || command.label;
        const description = document.createElement('small');
        description.textContent = window.pisiT?.(command.description) || command.description;
        body.append(label, description);
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'pisi-shortcut-capture';
        key.textContent = formatPisiShortcutForDisplay(getPisiCommandShortcut(command)) || window.pisiT?.('Atanmamış') || 'Atanmamış';
        key.addEventListener('click', () => {
            key.textContent = window.pisiT?.('Yeni kısayola basın…') || 'Yeni kısayola basın…';
            key.classList.add('capturing');
            key.focus();
        });
        key.addEventListener('keydown', (event) => {
            if (!key.classList.contains('capturing')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.key === 'Escape') {
                key.classList.remove('capturing');
                key.textContent = formatPisiShortcutForDisplay(getPisiCommandShortcut(command)) || 'Atanmamış';
                return;
            }
            const shortcut = getPisiEventShortcut(event);
            if (!shortcut || ['Mod', 'Alt', 'Shift'].includes(shortcut)) return;
            const result = setPisiCommandShortcut(command.id, shortcut);
            if (!result.ok) {
                const replace = confirm(
                    `${window.pisiT?.('Kısayol çakışması') || 'Kısayol çakışması'}: ${result.conflict.label}. ` +
                        `${window.pisiT?.('Mevcut atamayı değiştir?') || 'Mevcut atamayı değiştir?'}`
                );
                if (replace) setPisiCommandShortcut(command.id, shortcut, { replace: true });
            }
            key.classList.remove('capturing');
            window.renderPisiCommandCenterPage?.();
        });
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'pisi-secondary-button';
        reset.textContent = window.pisiT?.('Sıfırla') || 'Sıfırla';
        reset.addEventListener('click', () => {
            resetPisiCommandShortcut(command.id);
            window.renderPisiCommandCenterPage?.();
        });
        row.append(body, key, reset);
        list.appendChild(row);
    }
    container.append(heading, list);
}

function initializePisiCommandRegistry() {
    document.addEventListener('keydown', handlePisiCommandShortcut, true);
    registerPisiCommand({
        id: 'pisi.command-palette',
        label: 'Komut paletini aç',
        description: 'Tüm Pisi komutlarını arayın ve çalıştırın.',
        category: 'Gezinme',
        defaultShortcut: 'Mod+K',
        allowInInput: true,
        handler: openPisiCommandPalette
    });
    registerPisiCommand({
        id: 'pisi.shortcuts',
        label: 'Klavye kısayollarını aç',
        description: 'Kısayolları görüntüleyin, değiştirin ve çakışmaları çözün.',
        category: 'Ayarlar',
        defaultShortcut: 'Mod+/',
        allowInInput: true,
        handler: () => window.openPisiCommandCenter?.('shortcuts')
    });
    registerPisiCommand({
        id: 'pisi.save',
        label: 'Açık node’u kaydet',
        description: 'Aktif editördeki değişiklikleri sürüm geçmişiyle kaydeder.',
        category: 'Düzenleme',
        defaultShortcut: 'Mod+S',
        allowInInput: true,
        when: () => Boolean(window.activeModalNode || window.activeCenterNode),
        handler: async () => {
            if (isPisiEditorWriteBlocked()) return false;
            if (window.activeModalNode) {
                const modal = window.activeModalNode;
                const editor = document.getElementById('node-modal-content');
                if (getPisiNodeRecoveryWarning(modal)) return false;
                const content = window.getPisiEditorContent?.(editor) || editor?.innerHTML || '';
                if (protectPisiEditorRecovery(modal, editor, document.getElementById('node-modal-title'), content)) return false;
                const revision = Number(modal.revision || 0);
                const result = await runPisiEditorWrite(() => window.pisiProject?.saveNodeContent?.(modal.path, content));
                if (!result?.ok) throw new Error(result?.error || 'Node kaydedilemedi.');
                if (window.activeModalNode === modal && Number(modal.revision || 0) === revision) modal.dirty = false;
                return result;
            }
            return window.saveCurrentCenterNodeEditor?.();
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        window.registerPisiCommandCenterPage?.({
            id: 'shortcuts',
            label: 'Kısayollar',
            order: 80,
            render: renderPisiShortcutSettings
        });
    });
}

const moduleApi = {
    PISI_SHORTCUT_STORAGE_KEY,
    normalizePisiShortcut,
    getPisiEventShortcut,
    registerPisiCommand,
    listPisiCommands,
    runPisiCommand,
    getPisiCommandShortcut,
    formatPisiShortcutForDisplay,
    findPisiShortcutConflict,
    setPisiCommandShortcut,
    resetPisiCommandShortcut,
    openPisiCommandPalette,
    closePisiCommandPalette,
    renderPisiShortcutSettings,
    initializePisiCommandRegistry
};

registerModule('core.commands', moduleApi);
initializePisiCommandRegistry();

export {
    PISI_SHORTCUT_STORAGE_KEY,
    closePisiCommandPalette,
    findPisiShortcutConflict,
    formatPisiShortcutForDisplay,
    getPisiCommandShortcut,
    getPisiEventShortcut,
    listPisiCommands,
    normalizePisiShortcut,
    openPisiCommandPalette,
    registerPisiCommand,
    renderPisiShortcutSettings,
    resetPisiCommandShortcut,
    runPisiCommand,
    setPisiCommandShortcut
};
