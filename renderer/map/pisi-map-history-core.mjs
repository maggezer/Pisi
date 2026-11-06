// Pure rules for map undo/redo: no DOM, no IPC, unit-tested directly.
//
// A step records one user action on one map as data. Undo and redo never touch
// files themselves: getPisiMapStepCommands() turns a step into the same domain
// commands the original action used (docs/domain-command-query.md), and
// applyPisiMapStepResults() folds what those commands returned back into the
// step (a new Trash id, a renamed path) so the next undo or redo stays valid.
// Camera movement (zoom/pan) is never a step.

export const PISI_MAP_HISTORY_LIMIT = 200;

export const PISI_MAP_STEP_LABELS = Object.freeze({
    layout: 'Taşıma',
    resize: 'Boyutlandırma',
    'node-create': 'Düğüm oluşturma',
    'node-delete': 'Düğüm silme',
    'reference-detach': 'Referansı kaldırma',
    'reference-attach': 'Referans ekleme',
    batch: 'Toplu düzenleme',
    paste: 'Yapıştırma',
    duplicate: 'Çoğaltma',
    align: 'Hizalama',
    distribute: 'Dağıtma',
    'auto-layout': 'Otomatik yerleşim',
    nudge: 'Kaydırma',
    'edge-add': 'Bağlantı ekleme',
    'edge-delete': 'Bağlantı silme',
    'edge-change': 'Bağlantı türünü değiştirme',
    collapse: 'Hub daraltma/açma',
    rename: 'Başlık düzenleme'
});

const PISI_LAYOUT_KEYS = ['x', 'y', 'width', 'height'];

function clonePisiMapValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * @param {{ limit?: number }} [options]
 */
export function createPisiMapHistory(options = {}) {
    const limit = Math.max(1, Number(options.limit) || PISI_MAP_HISTORY_LIMIT);
    let undoStack = [];
    let redoStack = [];

    return {
        push(step) {
            if (!step?.kind || !step.mapPath) return false;
            undoStack.push(clonePisiMapValue(step));
            if (undoStack.length > limit) undoStack = undoStack.slice(undoStack.length - limit);
            redoStack = [];
            return true;
        },
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        peekUndo: () => (undoStack.length ? clonePisiMapValue(undoStack[undoStack.length - 1]) : null),
        peekRedo: () => (redoStack.length ? clonePisiMapValue(redoStack[redoStack.length - 1]) : null),
        /** Moves the top undo step, as updated after running it, onto the redo stack. */
        commitUndo(updatedStep) {
            const step = undoStack.pop();
            if (!step) return false;
            redoStack.push(clonePisiMapValue(updatedStep || step));
            return true;
        },
        commitRedo(updatedStep) {
            const step = redoStack.pop();
            if (!step) return false;
            undoStack.push(clonePisiMapValue(updatedStep || step));
            if (undoStack.length > limit) undoStack = undoStack.slice(undoStack.length - limit);
            return true;
        },
        clear() {
            undoStack = [];
            redoStack = [];
        },
        size: () => ({ undo: undoStack.length, redo: redoStack.length })
    };
}

function normalizePisiLayoutEntry(entry) {
    if (!entry?.id) return null;
    const normalized = { id: String(entry.id) };
    for (const key of PISI_LAYOUT_KEYS) {
        const value = Math.round(Number(entry[key]));
        if (Number.isFinite(value)) normalized[key] = value;
    }
    return normalized;
}

function isSamePisiLayout(a, b) {
    return PISI_LAYOUT_KEYS.every((key) => a?.[key] === b?.[key]);
}

/**
 * One drag, multi-selection drag or resize becomes one step. Nodes that did not
 * change are dropped; no change at all means no step.
 * @param {string} mapPath
 * @param {any[]} before
 * @param {any[]} after
 * @param {string} [kind] 'layout' or 'resize'
 */
export function makePisiMapLayoutStep(mapPath, before = [], after = [], kind = 'layout') {
    const previous = new Map(
        before
            .map(normalizePisiLayoutEntry)
            .filter(Boolean)
            .map((entry) => [entry.id, entry])
    );
    const changedBefore = [];
    const changedAfter = [];
    for (const raw of after) {
        const next = normalizePisiLayoutEntry(raw);
        const old = next && previous.get(next.id);
        if (!old || isSamePisiLayout(old, next)) continue;
        changedBefore.push(old);
        changedAfter.push(next);
    }
    if (!changedAfter.length) return null;
    return { kind: kind === 'resize' ? 'resize' : 'layout', mapPath, before: changedBefore, after: changedAfter };
}

function stripPisiEdgeForStep(edge) {
    if (!edge?.id || !edge.sourceId || !edge.targetId) return null;
    const copy = clonePisiMapValue(edge);
    delete copy.confirmSecondParentAsStream;
    return copy;
}

export function makePisiMapEdgeStep(mapPath, kind, before = null, after = null) {
    if (kind === 'edge-add') {
        const edge = stripPisiEdgeForStep(after);
        return edge ? { kind, mapPath, edge } : null;
    }
    if (kind === 'edge-delete') {
        const edge = stripPisiEdgeForStep(before);
        return edge ? { kind, mapPath, edge } : null;
    }
    if (kind === 'edge-change') {
        const previous = stripPisiEdgeForStep(before);
        const next = stripPisiEdgeForStep(after);
        if (!previous || !next || previous.id !== next.id || JSON.stringify(previous) === JSON.stringify(next)) return null;
        return { kind, mapPath, before: previous, after: next };
    }
    return null;
}

export function makePisiMapCollapseStep(mapPath, before = [], after = []) {
    const previous = Array.from(new Set(before)).map(String).sort();
    const next = Array.from(new Set(after)).map(String).sort();
    if (JSON.stringify(previous) === JSON.stringify(next)) return null;
    return { kind: 'collapse', mapPath, before: previous, after: next };
}

/**
 * @param {string} mapPath
 * @param {any} [details]
 */
export function makePisiMapRenameStep(mapPath, { nodeId, beforePath, afterPath, beforeTitle, afterTitle } = {}) {
    if (!beforePath || !afterPath || !beforeTitle || !afterTitle || beforeTitle === afterTitle) return null;
    return { kind: 'rename', mapPath, nodeId: nodeId || null, beforePath, afterPath, beforeTitle, afterTitle };
}

/**
 * @param {string} mapPath
 * @param {string} kind
 * @param {any} [details]
 */
export function makePisiMapNodeStep(mapPath, kind, { nodeId, nodePath, trashId = null } = {}) {
    if (!['node-create', 'node-delete'].includes(kind) || !nodeId || !nodePath) return null;
    if (kind === 'node-delete' && !trashId) return null;
    return { kind, mapPath, nodeId, nodePath, trashId: trashId || null };
}

/**
 * @param {string} mapPath
 * @param {any} [details]
 */
export function makePisiMapReferenceStep(mapPath, { reference, layout = null, kind = 'reference-detach' } = {}) {
    if (!reference?.id || !reference.path) return null;
    return {
        kind: kind === 'reference-attach' ? 'reference-attach' : 'reference-detach',
        mapPath,
        reference: clonePisiMapValue(reference),
        layout: clonePisiMapValue(layout)
    };
}

/**
 * Several steps that undo and redo together. Undo runs them last to first,
 * redo first to last. `label` names the user action (paste, align …).
 * One step is returned unchanged with its label; no steps means no step.
 * @param {string} mapPath
 * @param {any[]} steps
 * @param {string} [label]
 */
export function makePisiMapBatchStep(mapPath, steps = [], label = 'batch') {
    const list = steps.filter((step) => step?.kind && step.mapPath === mapPath);
    if (!list.length) return null;
    if (list.length === 1) return { ...clonePisiMapValue(list[0]), label };
    return { kind: 'batch', mapPath, label, steps: clonePisiMapValue(list) };
}

/** Sub-step indices of a batch in the order the given direction runs them. */
export function getPisiMapBatchOrder(step, direction) {
    const indices = (step?.steps || []).map((_item, index) => index);
    return direction === 'undo' ? indices.reverse() : indices;
}

/**
 * The domain commands that undo ('undo') or redo ('redo') a step.
 * @param {any} step
 * @param {'undo' | 'redo'} direction
 * @param {{ projectFolder?: string | null, camera?: any }} [context]
 * @returns {{ name: string, payload: any }[]}
 */
export function getPisiMapStepCommands(step, direction, context = {}) {
    const undo = direction === 'undo';
    const mapPath = step?.mapPath;
    switch (step?.kind) {
        case 'layout':
        case 'resize':
            return [{ name: 'map.layout.save.v1', payload: { mapPath, nodes: clonePisiMapValue(undo ? step.before : step.after) } }];
        case 'edge-add':
            return undo
                ? [{ name: 'map.relationship.delete.v1', payload: { mapPath, edgeId: step.edge.id } }]
                : [{ name: 'map.relationship.upsert.v1', payload: { mapPath, edge: clonePisiMapValue(step.edge) } }];
        case 'edge-delete':
            return undo
                ? [{ name: 'map.relationship.upsert.v1', payload: { mapPath, edge: clonePisiMapValue(step.edge) } }]
                : [{ name: 'map.relationship.delete.v1', payload: { mapPath, edgeId: step.edge.id } }];
        case 'edge-change':
            return [{ name: 'map.relationship.upsert.v1', payload: { mapPath, edge: clonePisiMapValue(undo ? step.before : step.after) } }];
        case 'collapse':
            // Only the collapsed set changes; the camera stays where the user is now.
            return [
                {
                    name: 'map.camera.save.v1',
                    payload: { mapPath, camera: { ...(context.camera || {}), collapsedHubs: [...(undo ? step.before : step.after)] } }
                }
            ];
        case 'rename':
            return [
                {
                    name: 'project.item.rename.v1',
                    payload: undo ? { oldPath: step.afterPath, newBaseName: step.beforeTitle } : { oldPath: step.beforePath, newBaseName: step.afterTitle }
                }
            ];
        case 'node-create':
            // Undoing a creation sends the node to Trash; redo restores the same node.
            return undo
                ? [{ name: 'project.item.delete.v1', payload: { targetPath: step.nodePath } }]
                : [{ name: 'trash.restore.v1', payload: { projectFolder: context.projectFolder, trashId: step.trashId } }];
        case 'node-delete':
            return undo
                ? [{ name: 'trash.restore.v1', payload: { projectFolder: context.projectFolder, trashId: step.trashId } }]
                : [{ name: 'project.item.delete.v1', payload: { targetPath: step.nodePath } }];
        case 'reference-attach':
            return undo
                ? [{ name: 'map.reference.detach.v1', payload: { mapPath, nodeId: step.reference.id } }]
                : [
                      {
                          name: 'map.reference.attach.v1',
                          payload: { mapPath, reference: clonePisiMapValue(step.reference), layout: clonePisiMapValue(step.layout) }
                      }
                  ];
        case 'reference-detach':
            return undo
                ? [
                      {
                          name: 'map.reference.attach.v1',
                          payload: { mapPath, reference: clonePisiMapValue(step.reference), layout: clonePisiMapValue(step.layout) }
                      }
                  ]
                : [{ name: 'map.reference.detach.v1', payload: { mapPath, nodeId: step.reference.id } }];
        default:
            return [];
    }
}

/** Folds command results into the step so it can run in the other direction later. */
export function applyPisiMapStepResults(step, direction, results = []) {
    const next = clonePisiMapValue(step);
    const result = results[results.length - 1] || {};
    const undo = direction === 'undo';
    if (step.kind === 'rename' && result.fullPath) {
        if (undo) next.beforePath = result.fullPath;
        else next.afterPath = result.fullPath;
    }
    if (step.kind === 'node-create') next.trashId = undo ? result.trashId || null : null;
    if (step.kind === 'node-delete') next.trashId = undo ? null : result.trashId || next.trashId;
    if ((step.kind === 'node-create' || step.kind === 'node-delete') && result.restoredPath) next.nodePath = result.restoredPath;
    if (step.kind === 'reference-detach' && !undo && result.layout) next.layout = clonePisiMapValue(result.layout);
    if (step.kind === 'reference-attach' && undo && result.layout) next.layout = clonePisiMapValue(result.layout);
    return next;
}

export function getPisiMapStepLabel(step) {
    return PISI_MAP_STEP_LABELS[step?.label] || PISI_MAP_STEP_LABELS[step?.kind] || '';
}
