import { pisiSearchPathKey } from './pisi-search-core.mjs';
import { rememberPisiSearchResult } from './pisi-search-history.mjs';

const PISI_SEARCH_MAP_FOCUS_CLASS = 'pisi-search-map-focus';
const PISI_SEARCH_EDITOR_FOCUS_CLASS = 'pisi-search-editor-focus';
let pisiSearchHighlightTimer = null;

function selectPisiSearchMapMembership(result = {}) {
    const memberships = Array.isArray(result.memberships)
        ? result.memberships.filter((item) => item?.mapPath)
        : [];
    const activeMapKey = pisiSearchPathKey(window.activeMapPath || '');
    const current = memberships.find((membership) => {
        return activeMapKey && pisiSearchPathKey(membership.mapPath) === activeMapKey;
    });
    if (current) return current;
    if (result.mapPath) {
        return memberships.find((membership) => {
            return pisiSearchPathKey(membership.mapPath) === pisiSearchPathKey(result.mapPath);
        }) || {
            mapPath: result.mapPath,
            mapTitle: result.mapTitle || '',
            mapItem: result.mapItem || null
        };
    }
    return memberships[0] || null;
}

function getPisiSearchMapItem(result) {
    const membership = selectPisiSearchMapMembership(result);
    if (membership?.mapItem?.fullPath) return membership.mapItem;
    const mapPath = membership?.mapPath || result?.mapPath;
    if (!mapPath) return null;
    const fileName = String(mapPath).split(/[\\/]/).pop() || 'Map.map';
    return {
        name: fileName,
        fileName,
        fullPath: mapPath,
        type: 'file',
        isFile: true,
        isDirectory: false,
        metadata: {
            type: 'map',
            title: membership?.mapTitle || result?.mapTitle || fileName.replace(/\.map$/i, '')
        }
    };
}

function getPisiSearchNodeItem(result) {
    if (result?.nodeItem?.fullPath) {
        return {
            ...result.nodeItem,
            fullPath: result.nodePath || result.nodeItem.fullPath
        };
    }
    if (!result?.nodePath) return null;
    const fileName = result.fileName || String(result.nodePath).split(/[\\/]/).pop() || 'Node.node';
    return {
        name: fileName,
        fileName,
        fullPath: result.nodePath,
        mapPath: result.mapPath || null,
        type: 'file',
        isFile: true,
        isDirectory: false,
        displayName: result.nodeTitle || result.title || fileName.replace(/\.node$/i, ''),
        metadata: {
            type: 'node',
            title: result.nodeTitle || result.title || fileName.replace(/\.node$/i, '')
        }
    };
}

async function waitForPisiSearchMapBox(nodePath) {
    const key = pisiSearchPathKey(nodePath);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const box = Array.from(document.querySelectorAll('.map-node-box[data-node-path]'))
            .find((candidate) => pisiSearchPathKey(candidate.dataset.nodePath) === key);
        if (box) return box;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return null;
}

function clearPisiSearchMapFocus() {
    document.querySelectorAll('.' + PISI_SEARCH_MAP_FOCUS_CLASS)
        .forEach((element) => element.classList.remove(PISI_SEARCH_MAP_FOCUS_CLASS));
}

function focusPisiSearchMapBox(box, nodePath) {
    if (!box) return false;
    clearPisiSearchMapFocus();
    const node = Array.isArray(window.activeMapNodes)
        ? window.activeMapNodes.find((candidate) => {
            return pisiSearchPathKey(candidate?.fullPath) === pisiSearchPathKey(nodePath);
        })
        : null;
    const canvas = document.getElementById('map-canvas');
    const rect = canvas?.getBoundingClientRect();
    if (node?.layout && rect) {
        const currentZoom = Number(window.activeMapCamera?.zoom) || 1;
        const zoom = Math.min(1.25, Math.max(0.7, currentZoom));
        const centerX = Number(node.layout.x || 0) + Number(node.layout.width || 220) / 2;
        const centerY = Number(node.layout.y || 0) + Number(node.layout.height || 92) / 2;
        window.activeMapCamera = {
            ...(window.activeMapCamera || {}),
            zoom,
            x: rect.width / 2 - centerX * zoom,
            y: rect.height / 2 - centerY * zoom
        };
        window.applyMapCamera?.();
        window.saveActiveMapCameraSoon?.();
    }
    window.clearSelectedMapNodes?.();
    box.classList.add('selected', PISI_SEARCH_MAP_FOCUS_CLASS);
    box.focus({ preventScroll: true });
    box.addEventListener('animationend', () => {
        box.classList.remove(PISI_SEARCH_MAP_FOCUS_CLASS);
    }, { once: true });
    return true;
}

function findPisiSearchEditorTarget(editor, result) {
    if (!editor) return null;
    if (result.blockId) {
        const escaped = CSS.escape(String(result.blockId));
        const exact = editor.querySelector(`[data-pisi-block-id="${escaped}"]`);
        if (exact) return exact;
    }
    const preview = String(result.preview || result.sourceText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    if (!preview) return null;
    return Array.from(editor.querySelectorAll(
        '.pisi-editor-block, p, li, h1, h2, h3, h4, h5, h6, table'
    )).find((element) => {
        return String(element.textContent || '').replace(/\s+/g, ' ').includes(preview);
    }) || null;
}

function highlightPisiSearchEditorTarget(result) {
    clearTimeout(pisiSearchHighlightTimer);
    document.querySelectorAll('.' + PISI_SEARCH_EDITOR_FOCUS_CLASS)
        .forEach((element) => element.classList.remove(PISI_SEARCH_EDITOR_FOCUS_CLASS));
    for (const editor of [
        document.getElementById('node-modal-content'),
        document.getElementById('center-node-editor-content')
    ]) {
        const target = findPisiSearchEditorTarget(editor, result);
        if (!target) continue;
        target.classList.add(PISI_SEARCH_EDITOR_FOCUS_CLASS);
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pisiSearchHighlightTimer = setTimeout(() => {
            target.classList.remove(PISI_SEARCH_EDITOR_FOCUS_CLASS);
        }, 2600);
        return true;
    }
    return false;
}

async function openPisiSearchSource(result) {
    if (result?.kind === 'task' && result?.taskId && typeof window.openPisiTagBlockResult === 'function') {
        const navigation = await window.openPisiTagBlockResult({
            ...result,
            missionId: result.taskId
        });
        return navigation?.ok === true || navigation === true;
    }
    const nodeItem = getPisiSearchNodeItem(result);
    if (!nodeItem) return false;
    const opened = await window.openPisiFileTab?.(nodeItem);
    if (!opened) return false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (result?.blockId && typeof window.highlightPisiEditorBlock === 'function') {
        const highlighted = await window.highlightPisiEditorBlock(result);
        if (highlighted) return true;
    }
    highlightPisiSearchEditorTarget(result);
    return true;
}

async function showPisiSearchResultOnMap(result) {
    const mapItem = getPisiSearchMapItem(result);
    if (!mapItem) return openPisiSearchSource(result);
    const opened = await window.openPisiFileTab?.(mapItem);
    if (!opened) return false;
    if (!result?.nodePath) return true;
    const box = await waitForPisiSearchMapBox(result.nodePath);
    if (!box) return false;
    return focusPisiSearchMapBox(box, result.nodePath);
}

function rememberSuccessfulPisiSearchNavigation(result) {
    if (!window.currentProjectFolder || !result?.id) return;
    rememberPisiSearchResult(window.currentProjectFolder, result);
    document.dispatchEvent(new CustomEvent('pisi:search-history-updated', {
        detail: { id: result.id }
    }));
}

async function openPisiSearchResult(result, options = {}) {
    if (!result) return false;
    if (window.activeModalNode && typeof window.closeNodeModalAndSave === 'function') {
        const modalSaved = await window.closeNodeModalAndSave();
        if (modalSaved === false) return false;
    }

    let opened = false;
    if (result.kind === 'map') {
        opened = Boolean(await window.openPisiFileTab?.(getPisiSearchMapItem(result)));
    } else if (options.mapOnly) {
        opened = await showPisiSearchResultOnMap(result);
    } else {
        opened = await openPisiSearchSource(result);
    }

    if (opened) rememberSuccessfulPisiSearchNavigation(result);
    document.dispatchEvent(new CustomEvent('pisi:global-search-navigation-complete', {
        detail: {
            ok: Boolean(opened),
            id: result.id || null,
            kind: result.kind || null,
            taskId: result.taskId || null,
            blockId: result.blockId || null,
            nodePath: result.nodePath || null,
            mapPath: selectPisiSearchMapMembership(result)?.mapPath || result.mapPath || null,
            mapOnly: options.mapOnly === true
        }
    }));
    return Boolean(opened);
}

export {
    clearPisiSearchMapFocus,
    findPisiSearchEditorTarget,
    focusPisiSearchMapBox,
    getPisiSearchMapItem,
    getPisiSearchNodeItem,
    highlightPisiSearchEditorTarget,
    openPisiSearchResult,
    openPisiSearchSource,
    selectPisiSearchMapMembership,
    showPisiSearchResultOnMap,
    waitForPisiSearchMapBox
};