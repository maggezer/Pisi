import { registerModule } from '../core/module-registry.mjs';
import { splitNoteBlocks } from '../../shared/note-blocks.mjs';
import { capturePisiSelectionBookmark, rebasePisiSelectionBookmark, restorePisiSelectionBookmark } from '../editor/pisi-selection-bookmarks.mjs';

// The renderer side of a sync turn (docs/sync-plan.md S3, rules SV4 and SV5).
// - Before a turn main asks for the pending saves to be written; we answer with
//   the open documents that still have unsaved edits, and keep main told while
//   that set changes, so the turn defers those files.
// - After a turn main sends the changed paths. Only those surfaces update: the
//   open note in place, block by block, with the caret and scroll kept; the
//   open map through the existing external-change path; the tree only when
//   files were added or removed. The task store follows the main process's
//   task events (pisi:tasks-changed, source 'sync'). A removed open document closes and the user is told; a rename keeps its tab.
// The project is never reloaded.

const pisiSyncLiveState = {
    initialized: false,
    // Editor content of the open note as it was on disk after the last flush (the merge base).
    flushed: new Map(),
    reportedDirty: '',
    dirtyTimer: null,
    appliedCount: 0
};

function normalizePisiSyncLivePath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function pisiSyncLiveTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

/** Absolute paths of open documents with edits that are not on disk yet. */
function collectPisiSyncDirtyPaths() {
    const paths = new Set();
    const center = window.activeCenterNode;
    if (center?.path && (center.dirty || window.centerNodeSaveTimer)) paths.add(center.path);
    const modal = window.activeModalNode;
    if (modal?.path && modal.dirty) paths.add(modal.path);
    if (window.activeMapPath && (window.mapSaveTimer || window.mapCameraSaveTimer)) paths.add(window.activeMapPath);
    return [...paths];
}

function reportPisiSyncDirtyPaths() {
    const paths = collectPisiSyncDirtyPaths();
    const key = paths.join('\n');
    if (key !== pisiSyncLiveState.reportedDirty) {
        pisiSyncLiveState.reportedDirty = key;
        window.pisiSyncClient?.reportDirty?.(paths);
    }
    clearInterval(pisiSyncLiveState.dirtyTimer);
    pisiSyncLiveState.dirtyTimer = paths.length ? setInterval(reportPisiSyncDirtyPaths, 1000) : null;
}

function rememberPisiSyncFlushedContent() {
    const center = window.activeCenterNode;
    const editor = window.getCenterNodeEditorElements?.().contentEditor;
    pisiSyncLiveState.flushed.clear();
    if (center?.path && editor && !center.dirty) pisiSyncLiveState.flushed.set(normalizePisiSyncLivePath(center.path), window.getPisiEditorContent(editor));
}

/** Answer to main's flush request: write pending saves, report what is still dirty. */
async function handlePisiSyncFlushRequest() {
    let ok = true;
    if (typeof window.flushPisiPendingSaves === 'function') ok = (await window.flushPisiPendingSaves()) !== false;
    // Task titles typed but not written yet go to tasks.json before the turn (SV4).
    await window.flushPisiTaskTitles?.();
    rememberPisiSyncFlushedContent();
    const dirtyPaths = collectPisiSyncDirtyPaths();
    pisiSyncLiveState.reportedDirty = dirtyPaths.join('\n');
    return { ok, dirtyPaths };
}

// ---- The open note, block by block ------------------------------------------------

// The diary's task section is drawn from tasks.json by its rule (GV15) and is
// never merged: it is left out here and drawn again after the update.
const isPisiSyncTaskSection = (html) => /^<[^>]*data-pisi-block-type="diary-tasks"/.test(String(html || ''));

function splitPisiSyncLiveUnits(html) {
    const units = new Map();
    const order = [];
    for (const segment of splitNoteBlocks(html)) {
        if (segment.kind === 'text' && !segment.html.trim()) continue;
        if (segment.kind === 'element' && isPisiSyncTaskSection(segment.html)) continue;
        if (segment.kind !== 'element' || !segment.blockId || units.has(segment.blockId)) return null;
        units.set(segment.blockId, segment.html);
        order.push(segment.blockId);
    }
    return { units, order };
}

function makePisiSyncBlockElement(html) {
    const template = document.createElement('template');
    template.innerHTML = window.sanitizePisiEditorHtml(html);
    return template.content.firstElementChild;
}

/**
 * Updates `editor` from `remote` without rebuilding it. `base` is the content
 * the editor started from (disk at the last flush) and `local` what it holds
 * now. A block only the remote side changed is replaced; one the user changed
 * too stays as it is and is reported as a conflict. Untouched block elements —
 * and with them the caret — stay in place. Returns `{ ok, replaced, conflicts }`;
 * `ok: false` when the content has blocks without ids (the caller falls back).
 */
function applyPisiSyncRemoteNoteBlocks(editor, base, local, remote) {
    const baseUnits = splitPisiSyncLiveUnits(base);
    const localUnits = splitPisiSyncLiveUnits(local);
    const remoteUnits = splitPisiSyncLiveUnits(remote);
    if (!baseUnits || !localUnits || !remoteUnits) return { ok: false, replaced: [], conflicts: [] };
    const elements = new Map();
    for (const child of editor.children) {
        const id = child.dataset?.pisiBlockId;
        // A task block being made is not on disk yet; the diary section is not merged.
        if (child.matches?.('.pisi-diary-tasks, .pisi-task-pending')) continue;
        if (id) elements.set(id, child);
    }
    if (elements.size !== localUnits.order.length) return { ok: false, replaced: [], conflicts: [] };
    const sameUnit = (left, right) =>
        left === undefined || right === undefined ? left === right : window.sanitizePisiEditorHtml(left) === window.sanitizePisiEditorHtml(right);
    const replaced = [];
    const conflicts = [];
    // Removed remotely and untouched here.
    for (const id of baseUnits.order) {
        if (remoteUnits.units.has(id)) continue;
        if (!sameUnit(localUnits.units.get(id), baseUnits.units.get(id))) {
            conflicts.push(id);
            continue;
        }
        elements.get(id)?.remove();
        elements.delete(id);
        replaced.push(id);
    }
    let previous = null;
    for (const id of remoteUnits.order) {
        const remoteHtml = remoteUnits.units.get(id);
        const baseHtml = baseUnits.units.get(id);
        let element = elements.get(id) || null;
        if (!sameUnit(remoteHtml, baseHtml)) {
            if (element && !sameUnit(localUnits.units.get(id), baseHtml)) {
                conflicts.push(id);
            } else {
                const next = makePisiSyncBlockElement(remoteHtml);
                if (next) {
                    if (element) element.replaceWith(next);
                    element = next;
                    elements.set(id, next);
                    replaced.push(id);
                }
            }
        }
        if (!element) continue;
        const wanted = previous ? previous.nextElementSibling : editor.firstElementChild;
        if (wanted !== element) {
            if (previous) previous.after(element);
            else editor.prepend(element);
            if (!replaced.includes(id)) replaced.push(id);
        }
        previous = element;
    }
    return { ok: true, replaced, conflicts };
}

function getPisiSyncScrollContainer(editor) {
    let node = editor;
    while (node && node !== document.body) {
        if (node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
        node = node.parentElement;
    }
    return document.scrollingElement;
}

/** Brings the open center note up to date with its file after a turn wrote it. */
async function updatePisiCenterNoteFromDisk(node) {
    const { contentEditor: editor, titleInput } = window.getCenterNodeEditorElements?.() || {};
    if (!editor || !node?.path) return false;
    const result = await window.pisiProject?.getPisiDocument?.(node.path);
    if (!result?.ok || window.activeCenterNode !== node) return false;
    const remote = String(result.data?.content || '');
    const key = normalizePisiSyncLivePath(node.path);
    const local = window.getPisiEditorContent(editor);
    const base = pisiSyncLiveState.flushed.get(key) ?? local;
    const scroller = getPisiSyncScrollContainer(editor);
    const scrollTop = scroller?.scrollTop ?? 0;
    const selection = window.getSelection?.();
    const bookmark = selection?.rangeCount && editor.contains(selection.anchorNode) ? capturePisiSelectionBookmark(editor) : null;

    let outcome = applyPisiSyncRemoteNoteBlocks(editor, base, local, remote);
    if (!outcome.ok) {
        if (node.dirty) {
            // Unidentified content changed on both sides: keep the user's text, keep the disk version as a copy (SV3).
            await window.pisiSyncClient?.keepConflictCopy?.(node.path);
            outcome = { ok: true, replaced: [], conflicts: ['*'] };
        } else {
            window.setPisiEditorContent(editor, remote);
            outcome = { ok: true, replaced: ['*'], conflicts: [] };
        }
    } else if (outcome.conflicts.length) {
        await window.pisiSyncClient?.keepConflictCopy?.(node.path);
    }
    if (outcome.replaced.length && outcome.replaced[0] !== '*') {
        window.ensurePisiEditorBlocks?.(editor);
        window.decoratePisiBlockTypes?.(editor);
        window.syncPisiWordHeadingCollapse?.(editor);
        window.initializePisiAdvancedEditorContent?.(editor);
    }
    window.renderPisiTaskBlocksIn?.(editor);
    if (bookmark && outcome.replaced.length) {
        const caretBlockKept = bookmark.anchor?.block?.isConnected && bookmark.focus?.block?.isConnected;
        if (!caretBlockKept || outcome.replaced[0] === '*') {
            const rebased = rebasePisiSelectionBookmark(editor, bookmark);
            if (rebased) restorePisiSelectionBookmark(editor, rebased);
        }
    }
    if (scroller) scroller.scrollTop = scrollTop;
    node.metadata = result.metadata || node.metadata;
    const title = result.metadata?.title;
    if (title && titleInput && document.activeElement !== titleInput && titleInput.value !== title && !node.dirty) titleInput.value = title;
    if (!node.dirty) pisiSyncLiveState.flushed.set(key, window.getPisiEditorContent(editor));
    if (outcome.conflicts.length)
        pisiNotifyWarning(pisiSyncLiveTranslate('Bu not başka bir cihazda da değişti; öbür sürüm çakışma kopyası olarak kaydedildi.'));
    document.dispatchEvent(
        new CustomEvent('pisi:sync-note-updated', { detail: { path: node.path, replaced: outcome.replaced, conflicts: outcome.conflicts } })
    );
    return true;
}

// ---- Applied changes --------------------------------------------------------------

const samePisiSyncPath = (left, right) => {
    const a = normalizePisiSyncLivePath(left);
    const b = normalizePisiSyncLivePath(right);
    return window.pisiEnvironment?.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
};

async function readPisiSyncDocumentId(filePath) {
    if (!/\.(node|map)$/i.test(filePath)) return null;
    const result = await window.pisiProject?.getPisiDocument?.(filePath);
    return result?.ok ? result.data?.pisi?.id || result.metadata?.id || null : null;
}

/** Open tabs of removed files: a rename (same document id in an added file) keeps the tab; otherwise it closes. */
async function handlePisiSyncRemovedPaths(removedPaths, addedPaths) {
    const state = window.Pisi?.state || {};
    const openTabs = Array.isArray(state.openTabs) ? state.openTabs : [];
    const removedOpen = openTabs.filter((tab) => removedPaths.some((removed) => samePisiSyncPath(removed, tab.path)));
    if (!removedOpen.length) return;
    const addedIds = new Map();
    for (const added of addedPaths) {
        const id = await readPisiSyncDocumentId(added);
        if (id) addedIds.set(id, added);
    }
    const deleted = [];
    for (const tab of removedOpen) {
        const id = tab.item?.metadata?.id || window.activeCenterNode?.metadata?.id || null;
        const target = id ? addedIds.get(id) : null;
        if (target) {
            const result = await window.pisiProject?.getPisiDocument?.(target);
            const fileName = target.split(/[\\/]/).pop();
            const renamed = { ok: true, fullPath: target, fileName, metadata: result?.metadata || {} };
            window.updatePisiOpenTabAfterRename?.(tab.path, renamed);
            if (window.activeCenterNode && samePisiSyncPath(window.activeCenterNode.path, tab.path)) {
                window.activeCenterNode.path = target;
                window.activeCenterNode.item = { ...window.activeCenterNode.item, fullPath: target, fileName, name: fileName };
            }
        } else {
            deleted.push(tab.path);
        }
    }
    if (deleted.length) {
        await window.removePisiOpenTabsForDeletedPaths?.(deleted);
        pisiNotifyWarning(pisiSyncLiveTranslate('Açık bir belge başka bir cihazda silindi ve kapatıldı.'));
    }
}

async function handlePisiSyncApplied(payload = {}) {
    if (!payload.folderPath || !samePisiSyncPath(payload.folderPath, window.currentProjectFolder)) return;
    pisiSyncLiveState.appliedCount += 1;
    const changed = Array.isArray(payload.changedPaths) ? payload.changedPaths : [];
    const added = Array.isArray(payload.addedPaths) ? payload.addedPaths : [];
    const removed = Array.isArray(payload.removedPaths) ? payload.removedPaths : [];
    const authorities = Array.isArray(payload.authorities) ? payload.authorities : [];

    if (payload.treeChanged) await window.refreshCurrentProjectTree?.();
    await handlePisiSyncRemovedPaths(removed, added);

    const center = window.activeCenterNode;
    if (center?.path && changed.some((filePath) => samePisiSyncPath(filePath, center.path))) await updatePisiCenterNoteFromDisk(center);

    if (!window.activeCenterNode && window.activeMapPath) {
        const mapPaths = [...changed, ...added];
        if (authorities.some((relative) => /relationships\.json$|properties\.json$/i.test(relative))) mapPaths.push(window.activeMapPath);
        if (mapPaths.length) await window.reloadPisiWorkspaceAfterExternalChange?.(mapPaths);
    }
    document.dispatchEvent(new CustomEvent('pisi:sync-applied', { detail: { changed, added, removed, authorities } }));
}

function initializePisiSyncLive() {
    if (pisiSyncLiveState.initialized || !window.pisiSyncClient) return false;
    pisiSyncLiveState.initialized = true;
    window.pisiSyncClient.onFlushRequest(handlePisiSyncFlushRequest);
    window.pisiSyncClient.onApplied((payload) => {
        void handlePisiSyncApplied(payload).catch((error) => console.error('[PISI] Senkron değişikliği uygulanamadı:', error));
    });
    document.addEventListener('input', () => queueMicrotask(reportPisiSyncDirtyPaths), true);
    document.addEventListener('pisi:active-node-changed', () => queueMicrotask(reportPisiSyncDirtyPaths));
    document.addEventListener('pisi:project-loaded', () => {
        pisiSyncLiveState.flushed.clear();
        void window.pisiSyncClient.run('open');
    });
    return true;
}

const moduleApi = {
    pisiSyncLiveState,
    collectPisiSyncDirtyPaths,
    handlePisiSyncFlushRequest,
    applyPisiSyncRemoteNoteBlocks,
    updatePisiCenterNoteFromDisk,
    handlePisiSyncApplied,
    initializePisiSyncLive
};

registerModule('sync.live', moduleApi);

initializePisiSyncLive();

export { applyPisiSyncRemoteNoteBlocks };
