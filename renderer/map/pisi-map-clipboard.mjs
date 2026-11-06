import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import { makePisiMapBatchStep, makePisiMapEdgeStep, makePisiMapNodeStep, makePisiMapReferenceStep } from './pisi-map-history-core.mjs';

// Map copy, paste and duplicate. Copy keeps the selected nodes, their relative
// layout and the edges among them. Paste (Mod+V) never copies notes: each note
// is added to the target map as a reference (map.reference.attach.v1). A map
// can hold a note only once, so notes already in the target are skipped.
// "Paste as copy" (Mod+Alt+V) and duplicate (Mod+D) create new notes through
// map.nodes.duplicate.v1, with the selection's edges recreated between the
// copies. Each paste or duplicate is one history step.

const PISI_MAP_DUPLICATE_OFFSET = 40;
const pisiMapClipboardState = { clip: null, pointer: null, busy: false, initialized: false };

function pisiMapClipboardTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function readPisiClipboardBoxRect(box) {
    return window.readPisiMapBoxRect?.(box) || { id: box.dataset.nodeId, x: 0, y: 0, width: 220, height: 92 };
}

function toPisiProjectRelativePath(fullPath) {
    const root = String(window.currentProjectFolder || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
    const target = String(fullPath || '').replace(/\\/g, '/');
    return root && target.toLowerCase().startsWith(root.toLowerCase() + '/') ? target.slice(root.length + 1) : null;
}

/** Copies the selected nodes and the edges whose both ends are selected. */
function copyPisiMapSelection() {
    const boxes = window.getSelectedMapNodeBoxes?.() || [];
    if (!boxes.length || !window.activeMapPath) return null;
    const rects = boxes.map(readPisiClipboardBoxRect);
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const ids = boxes.map((box) => box.dataset.nodeId);
    const nodes = boxes.map((box, index) => ({
        id: box.dataset.nodeId,
        fullPath: box.dataset.nodePath,
        title: box.querySelector('.map-node-title-text')?.textContent || '',
        offset: { x: rects[index].x - left, y: rects[index].y - top, width: rects[index].width, height: rects[index].height }
    }));
    const edges = (Array.isArray(window.activeMapEdges) ? window.activeMapEdges : [])
        .filter((edge) => ids.includes(edge.sourceId) && ids.includes(edge.targetId))
        .map((edge) => ({ ...edge, sourceIndex: ids.indexOf(edge.sourceId), targetIndex: ids.indexOf(edge.targetId) }));
    pisiMapClipboardState.clip = { sourceMapPath: window.activeMapPath, nodes, edges };
    try {
        void window.pisiClipboard?.writeText?.(nodes.map((node) => node.title).join('\n'));
    } catch {}
    window.announcePisiMap?.(pisiMapClipboardTranslate('{count} düğüm kopyalandı').replace('{count}', String(nodes.length)));
    return pisiMapClipboardState.clip;
}

function getPisiMapPasteOrigin() {
    const canvas = document.getElementById('map-canvas');
    const rect = canvas?.getBoundingClientRect();
    const pointer = pisiMapClipboardState.pointer;
    const inside = rect && pointer && pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
    const client = inside ? pointer : rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
    const world = window.getMapWorldPointFromClient?.(client.x, client.y) || { x: 0, y: 0 };
    return { x: Math.round(world.x), y: Math.round(world.y) };
}

async function reloadPisiMapAndSelect(nodeIds) {
    const mapItem = window.getActiveMapTabItemForReload?.();
    if (mapItem) await window.openMapInWorkspace?.(mapItem);
    await window.refreshActiveMapTreeBranch?.();
    window.clearSelectedMapNodes?.();
    for (const id of nodeIds) document.querySelector(`#map-board .map-node-box[data-node-id="${CSS.escape(id)}"]`)?.classList.add('selected');
    document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
}

async function runPisiMapClipboardAction(action) {
    if (pisiMapClipboardState.busy) return { ok: false, code: 'BUSY' };
    pisiMapClipboardState.busy = true;
    try {
        await window.saveCurrentMapLayout?.();
        window.suppressNextFileSystemRefresh?.(4000);
        return await action();
    } finally {
        pisiMapClipboardState.busy = false;
    }
}

function pastePisiMapReferences(clip, origin) {
    return runPisiMapClipboardAction(async () => {
        const mapPath = window.activeMapPath;
        const present = new Set((Array.isArray(window.activeMapNodes) ? window.activeMapNodes : []).map((node) => node.id));
        const operations = [];
        const steps = [];
        const pasted = [];
        let skipped = 0;
        for (const node of clip.nodes) {
            const relativePath = toPisiProjectRelativePath(node.fullPath);
            if (present.has(node.id) || !relativePath) {
                skipped += 1;
                continue;
            }
            const reference = { id: node.id, path: relativePath };
            const layout = { id: node.id, x: origin.x + node.offset.x, y: origin.y + node.offset.y, width: node.offset.width, height: node.offset.height };
            operations.push({ command: 'map.reference.attach.v1', payload: { mapPath, reference, layout } });
            steps.push(makePisiMapReferenceStep(mapPath, { kind: 'reference-attach', reference, layout }));
            pasted.push(node.id);
        }
        if (skipped) {
            window.alert(
                pisiMapClipboardTranslate('{count} not zaten bu haritada; kopya için Alt+Mod+V kullanın.')
                    .replace('{count}', String(skipped))
                    .replace('Mod', /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl')
            );
        }
        if (!operations.length) return { ok: false, code: 'NOTHING_TO_PASTE', skipped };
        // The relationship itself is project-wide; the target map needs its view
        // (ports, colour) to show it. Same id, so no new relationship is created.
        const onMap = new Set([...present, ...pasted]);
        const existingEdges = new Set((Array.isArray(window.activeMapEdges) ? window.activeMapEdges : []).map((edge) => edge.id));
        for (const edge of clip.edges) {
            if (!onMap.has(edge.sourceId) || !onMap.has(edge.targetId) || existingEdges.has(edge.id)) continue;
            const { sourceIndex: _sourceIndex, targetIndex: _targetIndex, ...view } = edge;
            operations.push({ command: 'map.relationship.upsert.v1', payload: { mapPath, edge: view } });
        }
        const result = await window.pisiDomain?.command?.('project.batch.v1', { projectFolder: window.currentProjectFolder, operations });
        if (!result?.ok) {
            window.alert(result?.error || pisiMapClipboardTranslate('Yapıştırılamadı.'));
            return result || { ok: false };
        }
        window.recordPisiMapStep?.(makePisiMapBatchStep(mapPath, steps, 'paste'));
        await reloadPisiMapAndSelect(pasted);
        window.announcePisiMap?.(pisiMapClipboardTranslate('{count} düğüm yapıştırıldı').replace('{count}', String(pasted.length)));
        return { ok: true, pasted, skipped };
    });
}

function pastePisiMapCopies(clip, origin, label = 'paste') {
    return runPisiMapClipboardAction(async () => {
        const mapPath = window.activeMapPath;
        const nodes = clip.nodes.map((node) => ({
            sourcePath: node.fullPath,
            layout: { x: origin.x + node.offset.x, y: origin.y + node.offset.y, width: node.offset.width, height: node.offset.height }
        }));
        const edges = clip.edges.map((edge) => ({
            sourceIndex: edge.sourceIndex,
            targetIndex: edge.targetIndex,
            type: edge.type,
            sourcePort: edge.sourcePort,
            targetPort: edge.targetPort,
            sourceRole: edge.sourceRole,
            targetRole: edge.targetRole,
            customization: edge.customization
        }));
        const result = await window.pisiDomain?.command?.('map.nodes.duplicate.v1', { mapPath, nodes, edges });
        if (!result?.ok) {
            window.alert(result?.error || pisiMapClipboardTranslate('Kopya oluşturulamadı.'));
            return result || { ok: false };
        }
        // Node steps first, edges last: undo deletes the edges, then sends the copies to Trash.
        const steps = [
            ...result.nodes.map((node) => makePisiMapNodeStep(mapPath, 'node-create', { nodeId: node.id, nodePath: node.fullPath })),
            ...result.edges.map((edge) => makePisiMapEdgeStep(mapPath, 'edge-add', null, edge))
        ];
        window.recordPisiMapStep?.(makePisiMapBatchStep(mapPath, steps, label));
        await reloadPisiMapAndSelect(result.nodes.map((node) => node.id));
        window.refreshPisiTagsPanelSoon?.();
        window.announcePisiMap?.(pisiMapClipboardTranslate('{count} kopya not oluşturuldu').replace('{count}', String(result.nodes.length)));
        return result;
    });
}

/** Mod+V pastes references; Mod+Alt+V (copy: true) pastes new notes. */
function pastePisiMapClipboard(options = {}) {
    const clip = pisiMapClipboardState.clip;
    if (!clip?.nodes?.length || !window.activeMapPath) return Promise.resolve({ ok: false, code: 'EMPTY' });
    const origin = getPisiMapPasteOrigin();
    return options.copy ? pastePisiMapCopies(clip, origin, 'paste') : pastePisiMapReferences(clip, origin);
}

/** A note can be in a map only once, so duplicating always creates copies. */
function duplicatePisiMapSelection() {
    const clip = copyPisiMapSelection();
    if (!clip) return Promise.resolve({ ok: false, code: 'EMPTY' });
    const rects = (window.getSelectedMapNodeBoxes?.() || []).map(readPisiClipboardBoxRect);
    const origin = {
        x: Math.min(...rects.map((rect) => rect.x)) + PISI_MAP_DUPLICATE_OFFSET,
        y: Math.min(...rects.map((rect) => rect.y)) + PISI_MAP_DUPLICATE_OFFSET
    };
    return pastePisiMapCopies(clip, origin, 'duplicate');
}

function registerPisiMapClipboardCommands() {
    const when = () => Boolean(window.isPisiMapHistoryContext?.());
    const hasSelection = () => when() && (window.getSelectedMapNodeBoxes?.() || []).length > 0;
    const hasClip = () => when() && Boolean(pisiMapClipboardState.clip?.nodes?.length);
    registerPisiCommand({
        id: 'pisi.map.copy',
        label: 'Seçili düğümleri kopyala',
        category: 'Harita',
        defaultShortcut: 'Mod+C',
        when: hasSelection,
        handler: copyPisiMapSelection
    });
    registerPisiCommand({
        id: 'pisi.map.paste',
        label: 'Haritaya yapıştır (referans)',
        description: 'Kopyalanan notları yeni not oluşturmadan bu haritaya ekler.',
        category: 'Harita',
        defaultShortcut: 'Mod+V',
        when: hasClip,
        handler: () => pastePisiMapClipboard({ copy: false })
    });
    registerPisiCommand({
        id: 'pisi.map.paste-copy',
        label: 'Kopya not olarak yapıştır',
        description: 'Kopyalanan notların kopyalarını oluşturup bu haritaya ekler.',
        category: 'Harita',
        defaultShortcut: 'Mod+Alt+V',
        when: hasClip,
        handler: () => pastePisiMapClipboard({ copy: true })
    });
    registerPisiCommand({
        id: 'pisi.map.duplicate',
        label: 'Seçili düğümleri çoğalt',
        category: 'Harita',
        defaultShortcut: 'Mod+D',
        when: hasSelection,
        handler: duplicatePisiMapSelection
    });
}

function initializePisiMapClipboard() {
    if (pisiMapClipboardState.initialized) return false;
    pisiMapClipboardState.initialized = true;
    document.addEventListener(
        'pointermove',
        (event) => {
            pisiMapClipboardState.pointer = { x: event.clientX, y: event.clientY };
        },
        { passive: true }
    );
    registerPisiMapClipboardCommands();
    return true;
}

const moduleApi = {
    pisiMapClipboardState,
    copyPisiMapSelection,
    pastePisiMapClipboard,
    duplicatePisiMapSelection,
    initializePisiMapClipboard
};

registerModule('map.clipboard', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiMapClipboard, { once: true });
} else {
    initializePisiMapClipboard();
}

export { copyPisiMapSelection, duplicatePisiMapSelection, initializePisiMapClipboard, pastePisiMapClipboard, pisiMapClipboardState };
