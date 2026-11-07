import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import {
    applyPisiMapStepResults,
    createPisiMapHistory,
    getPisiMapBatchOrder,
    getPisiMapStepCommands,
    getPisiMapStepLabel,
    makePisiMapCollapseStep,
    makePisiMapEdgeStep,
    makePisiMapLayoutStep,
    makePisiMapNodeStep,
    makePisiMapReferenceStep,
    makePisiMapRenameStep
} from './pisi-map-history-core.mjs';

// Map undo/redo. Map code records a step after an action succeeded; undo and
// redo send the inverse or original domain commands (see pisi-map-history-core)
// and reload the map from disk. The history belongs to one map: opening another
// map, closing the project or an external change to the map file clears it.
//
// Keyboard ownership (docs/editor-keyboard-rules.md): the shortcuts run only
// while the map owns the keyboard. A focused note editor, modal, Sheet, input or
// any contenteditable keeps its own history, because the command registry
// never dispatches these commands to editable targets.

const pisiMapHistoryState = {
    history: createPisiMapHistory(),
    mapPath: null,
    projectFolder: null,
    running: false,
    undoButton: null,
    redoButton: null,
    initialized: false
};

function pisiMapHistoryTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function samePisiMapHistoryPath(a, b) {
    if (!a || !b) return false;
    return String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase();
}

function getPisiActiveMapPath() {
    return typeof window.activeMapPath === 'string' && window.activeMapPath ? window.activeMapPath : null;
}

/** Clears the history when the active map or project is no longer the one it belongs to. */
function syncPisiMapHistoryOwner() {
    const mapPath = getPisiActiveMapPath();
    const projectFolder = window.currentProjectFolder || null;
    if (!samePisiMapHistoryPath(mapPath, pisiMapHistoryState.mapPath) || projectFolder !== pisiMapHistoryState.projectFolder) {
        pisiMapHistoryState.history.clear();
        pisiMapHistoryState.mapPath = mapPath;
        pisiMapHistoryState.projectFolder = projectFolder;
    }
}

function clearPisiMapHistory() {
    pisiMapHistoryState.history.clear();
    updatePisiMapHistoryButtons();
}

function normalizePisiMapStep(step) {
    if (step?.kind === 'node-create' || step?.kind === 'node-delete') return makePisiMapNodeStep(step.mapPath, step.kind, step);
    if (step?.kind === 'rename') return makePisiMapRenameStep(step.mapPath, step);
    if (step?.kind === 'reference-detach' || step?.kind === 'reference-attach') return makePisiMapReferenceStep(step.mapPath, step);
    return step || null;
}

/** Called by map code after an action succeeded. Replays never record. */
function recordPisiMapStep(rawStep) {
    const step = normalizePisiMapStep(rawStep);
    if (!step || pisiMapHistoryState.running) return false;
    syncPisiMapHistoryOwner();
    if (!samePisiMapHistoryPath(step.mapPath, pisiMapHistoryState.mapPath)) return false;
    const pushed = pisiMapHistoryState.history.push(step);
    updatePisiMapHistoryButtons();
    return pushed;
}

function recordPisiMapHistoryLayout(mapPath, before, after, kind = 'layout') {
    return recordPisiMapStep(makePisiMapLayoutStep(mapPath, before, after, kind));
}

function recordPisiMapHistoryEdge(mapPath, kind, before, after) {
    return recordPisiMapStep(makePisiMapEdgeStep(mapPath, kind, before, after));
}

function recordPisiMapHistoryCollapse(mapPath, before, after) {
    return recordPisiMapStep(makePisiMapCollapseStep(mapPath, before, after));
}

function isPisiMapHistoryContext() {
    if (!getPisiActiveMapPath() || window.activeModalNode) return false;
    const canvas = document.getElementById('map-canvas');
    if (!canvas || canvas.hidden || canvas.offsetParent === null) return false;
    if (document.getElementById('center-node-editor')?.hidden === false) return false;
    if (document.querySelector('dialog[open], .pisi-dialog-backdrop:not([hidden]), .pisi-modal-backdrop:not([hidden])')) return false;
    return true;
}

async function flushPisiMapPendingSaves() {
    const layoutSaved = typeof window.saveCurrentMapLayout === 'function' ? await window.saveCurrentMapLayout() : true;
    const cameraSaved = typeof window.flushActiveMapCameraSave === 'function' ? await window.flushActiveMapCameraSave() : true;
    return layoutSaved !== false && cameraSaved !== false;
}

async function reloadPisiActiveMap() {
    const mapItem = window.getActiveMapTabItemForReload?.();
    if (mapItem && typeof window.openMapInWorkspace === 'function') await window.openMapInWorkspace(mapItem);
    await window.refreshActiveMapTreeBranch?.();
    window.refreshPisiTagsPanelSoon?.();
}

/** Runs one step's commands (a batch runs its sub-steps in order) and folds results back in. */
async function runPisiMapStepCommands(step, direction) {
    if (step.kind === 'batch') {
        const steps = [...step.steps];
        const results = [];
        for (const index of getPisiMapBatchOrder(step, direction)) {
            const run = await runPisiMapStepCommands(steps[index], direction);
            results.push(...run.results);
            if (!run.ok) return { ok: false, result: run.result, results };
            steps[index] = run.step;
        }
        return { ok: true, step: { ...step, steps }, results };
    }
    const commands = getPisiMapStepCommands(step, direction, {
        projectFolder: window.currentProjectFolder,
        camera: { ...(window.activeMapCamera || { x: 0, y: 0, zoom: 1 }) }
    });
    const results = [];
    for (const command of commands) {
        window.suppressNextFileSystemRefresh?.(4000);
        const result = await window.pisiDomain?.command?.(command.name, command.payload);
        results.push(result);
        if (!result?.ok) return { ok: false, result, results };
    }
    return { ok: true, step: applyPisiMapStepResults(step, direction, results), results };
}

async function runPisiMapHistory(direction) {
    if (pisiMapHistoryState.running) return { ok: false, code: 'BUSY' };
    syncPisiMapHistoryOwner();
    const history = pisiMapHistoryState.history;
    const step = direction === 'undo' ? history.peekUndo() : history.peekRedo();
    if (!step) return { ok: false, code: 'EMPTY' };
    pisiMapHistoryState.running = true;
    updatePisiMapHistoryButtons();
    try {
        if (!(await flushPisiMapPendingSaves())) {
            pisiNotifyError(pisiMapHistoryTranslate('Harita kaydedilemediği için geri alınamadı.'));
            return { ok: false, code: 'SAVE_FAILED' };
        }
        const run = await runPisiMapStepCommands(step, direction);
        if (!run.ok) {
            // The step stays where it is; the map shows what is on disk.
            pisiNotifyError(
                `${pisiMapHistoryTranslate(direction === 'undo' ? 'Geri alınamadı' : 'Yinelenemedi')}: ${pisiMapHistoryTranslate(getPisiMapStepLabel(step))}` +
                    (run.result?.error ? `\n${run.result.error}` : '')
            );
            await reloadPisiActiveMap();
            return { ok: false, code: 'COMMAND_FAILED', result: run.result };
        }
        if (direction === 'undo') history.commitUndo(run.step);
        else history.commitRedo(run.step);
        const removedPaths = run.results.filter((result) => result?.movedToTrash).map((result) => result.deletedPath);
        if (removedPaths.length) await window.removePisiOpenTabsForDeletedPaths?.(removedPaths);
        await reloadPisiActiveMap();
        return { ok: true, step: run.step };
    } finally {
        pisiMapHistoryState.running = false;
        updatePisiMapHistoryButtons();
    }
}

function undoPisiMapStep() {
    return runPisiMapHistory('undo');
}

function redoPisiMapStep() {
    return runPisiMapHistory('redo');
}

function getPisiMapHistoryShortcutLabel(id) {
    const shortcut = window.getPisiCommandShortcut?.(id) || '';
    return shortcut ? window.formatPisiShortcutForDisplay?.(shortcut) || shortcut : '';
}

function makePisiMapHistoryButton(label, glyph, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-zoom-btn pisi-map-history-btn';
    button.textContent = glyph;
    button.setAttribute('aria-label', pisiMapHistoryTranslate(label));
    button.disabled = true;
    // Keep keyboard focus on the map instead of the button.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => void handler());
    return button;
}

function ensurePisiMapHistoryButtons() {
    if (pisiMapHistoryState.undoButton?.isConnected) return true;
    const controls = document.getElementById('map-zoom-controls');
    if (!controls) return false;
    pisiMapHistoryState.undoButton = makePisiMapHistoryButton('Geri al', '↶', undoPisiMapStep);
    pisiMapHistoryState.undoButton.id = 'map-history-undo';
    pisiMapHistoryState.redoButton = makePisiMapHistoryButton('Yinele', '↷', redoPisiMapStep);
    pisiMapHistoryState.redoButton.id = 'map-history-redo';
    controls.append(pisiMapHistoryState.undoButton, pisiMapHistoryState.redoButton);
    return true;
}

function updatePisiMapHistoryButtons() {
    if (!ensurePisiMapHistoryButtons()) return;
    syncPisiMapHistoryOwner();
    const history = pisiMapHistoryState.history;
    const pairs = [
        [pisiMapHistoryState.undoButton, history.peekUndo(), 'Geri al', 'pisi.map.undo', 'Geri alınacak adım yok'],
        [pisiMapHistoryState.redoButton, history.peekRedo(), 'Yinele', 'pisi.map.redo', 'Yinelenecek adım yok']
    ];
    for (const [button, step, label, commandId, emptyLabel] of pairs) {
        button.disabled = pisiMapHistoryState.running || !step;
        const shortcut = getPisiMapHistoryShortcutLabel(commandId);
        const text = step ? `${pisiMapHistoryTranslate(label)}: ${pisiMapHistoryTranslate(getPisiMapStepLabel(step))}` : pisiMapHistoryTranslate(emptyLabel);
        button.title = shortcut ? `${text} (${shortcut})` : text;
    }
}

function handlePisiMapHistoryFileSystemChange(payload = {}) {
    const mapPath = pisiMapHistoryState.mapPath;
    if (!mapPath || pisiMapHistoryState.running) return;
    // Pisi's own writes are filtered out in main; an event naming this map is external.
    if ((payload.changedPaths || []).some((changedPath) => samePisiMapHistoryPath(changedPath, mapPath))) clearPisiMapHistory();
}

function registerPisiMapHistoryCommands() {
    const base = { category: 'Harita', allowInInput: false, when: isPisiMapHistoryContext };
    registerPisiCommand({
        ...base,
        id: 'pisi.map.undo',
        label: 'Haritada geri al',
        description: 'Haritadaki son düzenlemeyi geri alır.',
        defaultShortcut: 'Mod+Z',
        handler: undoPisiMapStep
    });
    registerPisiCommand({
        ...base,
        id: 'pisi.map.redo',
        label: 'Haritada yinele',
        description: 'Geri alınan harita düzenlemesini yeniden uygular.',
        defaultShortcut: 'Mod+Shift+Z',
        handler: redoPisiMapStep
    });
    registerPisiCommand({
        ...base,
        id: 'pisi.map.redo-alt',
        label: 'Haritada yinele (alternatif)',
        description: 'Geri alınan harita düzenlemesini yeniden uygular.',
        defaultShortcut: 'Mod+Y',
        handler: redoPisiMapStep
    });
}

function initializePisiMapHistory() {
    if (pisiMapHistoryState.initialized) return false;
    pisiMapHistoryState.initialized = true;
    registerPisiMapHistoryCommands();
    ensurePisiMapHistoryButtons();
    document.addEventListener('pisi:map-customization-context-changed', updatePisiMapHistoryButtons);
    document.addEventListener('pisi:commands-changed', updatePisiMapHistoryButtons);
    window.pisiProject?.onFileSystemChanged?.(handlePisiMapHistoryFileSystemChange);
    updatePisiMapHistoryButtons();
    return true;
}

const moduleApi = {
    pisiMapHistoryState,
    isPisiMapHistoryContext,
    recordPisiMapStep,
    recordPisiMapHistoryLayout,
    recordPisiMapHistoryEdge,
    recordPisiMapHistoryCollapse,
    clearPisiMapHistory,
    undoPisiMapStep,
    redoPisiMapStep,
    updatePisiMapHistoryButtons,
    initializePisiMapHistory
};

registerModule('map.history', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiMapHistory, { once: true });
} else {
    initializePisiMapHistory();
}

export {
    clearPisiMapHistory,
    initializePisiMapHistory,
    pisiMapHistoryState,
    recordPisiMapHistoryCollapse,
    recordPisiMapHistoryEdge,
    recordPisiMapHistoryLayout,
    recordPisiMapStep,
    redoPisiMapStep,
    undoPisiMapStep,
    updatePisiMapHistoryButtons
};
