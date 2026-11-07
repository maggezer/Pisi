import { beginPisiWorkspaceNavigation, isPisiWorkspaceNavigationCurrent } from '../editor/pisi-editor-navigation.mjs';
import { registerModule } from '../core/module-registry.mjs';

function getPisiOpenTabsState() {
    if (!window.Pisi) {
        window.Pisi = {
            state: {},
            api: window.pisiProject,
            ui: {},
            tree: {},
            map: {},
            tags: {},
            connections: {}
        };
    }

    if (!window.Pisi.state) {
        window.Pisi.state = {};
    }

    if (!Array.isArray(window.Pisi.state.openTabs)) {
        window.Pisi.state.openTabs = [];
    }

    if (typeof window.Pisi.state.activeTabPath === 'undefined') {
        window.Pisi.state.activeTabPath = null;
    }

    return window.Pisi.state;
}

function pisiSameTabPath(a, b) {
    if (!a || !b) return false;

    if (typeof sameClientPath === 'function') {
        return sameClientPath(a, b);
    }

    return String(a) === String(b);
}

function getPisiOpenTabType(item) {
    const fileName = item?.name || '';

    if (fileName.toLowerCase().endsWith('.map')) return 'map';
    if (fileName.toLowerCase().endsWith('.node')) return 'node';

    return 'file';
}

function getPisiOpenTabTitle(item) {
    const rawName = item?.metadata?.title || item?.displayName || item?.name || item?.fileName || 'Untitled';

    return String(rawName).replace(/\.(map|node)$/i, '');
}

function clonePisiTabItem(item) {
    return {
        name: item.name || item.fileName,
        fileName: item.fileName || item.name,
        fullPath: item.fullPath,
        type: item.type,
        isFile: item.isFile !== false,
        isDirectory: Boolean(item.isDirectory),
        displayName: item.displayName,
        sidecarPath: item.sidecarPath,
        metadata: {
            ...(item.metadata || {})
        }
    };
}

function ensurePisiOpenTab(item) {
    if (!item || !item.fullPath || item.isDirectory) return null;

    const type = getPisiOpenTabType(item);

    if (type !== 'map' && type !== 'node') return null;

    const state = getPisiOpenTabsState();

    let tab = state.openTabs.find((existingTab) => {
        return pisiSameTabPath(existingTab.path, item.fullPath);
    });

    if (tab) {
        tab.title = getPisiOpenTabTitle(item);
        tab.type = type;
        tab.item = clonePisiTabItem(item);
        return tab;
    }

    tab = {
        path: item.fullPath,
        type,
        title: getPisiOpenTabTitle(item),
        item: clonePisiTabItem(item)
    };

    state.openTabs.push(tab);

    return tab;
}

async function openPisiFileTab(item) {
    const tab = ensurePisiOpenTab(item);

    if (!tab) return false;

    return activatePisiOpenTab(tab.path);
}

async function activatePisiOpenTab(path) {
    const state = getPisiOpenTabsState();
    const previousActiveTabPath = state.activeTabPath;

    const tab = state.openTabs.find((existingTab) => {
        return pisiSameTabPath(existingTab.path, path);
    });

    if (!tab) return false;
    const request = beginPisiWorkspaceNavigation();

    const alreadyActive = state.activeTabPath && pisiSameTabPath(state.activeTabPath, tab.path);

    const alreadyLoaded = typeof activeMapPath !== 'undefined' && activeMapPath && pisiSameTabPath(activeMapPath, tab.path);

    state.activeTabPath = tab.path;
    renderPisiOpenTabs();

    if (alreadyActive && alreadyLoaded) {
        selectPisiTreeFileByPath(tab.path);
        document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
        return true;
    }

    if (
        typeof saveCurrentCenterNodeEditor === 'function' &&
        activeCenterNode &&
        (!activeCenterNode.path || !pisiSameTabPath(activeCenterNode.path, tab.path))
    ) {
        const saved = await saveCurrentCenterNodeEditor({ allowDiscardRecovery: true });
        if (!isPisiWorkspaceNavigationCurrent(request)) return false;
        if (!saved) {
            state.activeTabPath = previousActiveTabPath;
            renderPisiOpenTabs();
            return false;
        }
    }

    if (typeof saveCurrentMapLayout === 'function' && typeof activeMapPath !== 'undefined' && activeMapPath && !pisiSameTabPath(activeMapPath, tab.path)) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!isPisiWorkspaceNavigationCurrent(request)) return false;
        if (!layoutSaved) {
            state.activeTabPath = previousActiveTabPath;
            renderPisiOpenTabs();
            return false;
        }
    }

    if (tab.type === 'map' && typeof openMapInWorkspace === 'function') {
        const opened = await openMapInWorkspace(tab.item, request);
        if (!isPisiWorkspaceNavigationCurrent(request)) return false;
        if (!opened) {
            state.activeTabPath = previousActiveTabPath;
            renderPisiOpenTabs();
            return false;
        }
    }

    if (tab.type === 'node' && typeof openCenterNodeEditor === 'function') {
        const opened = await openCenterNodeEditor(tab.item, request);
        if (!isPisiWorkspaceNavigationCurrent(request)) return false;
        if (!opened) {
            state.activeTabPath = previousActiveTabPath;
            renderPisiOpenTabs();
            return false;
        }
    }

    selectPisiTreeFileByPath(tab.path);
    document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
    return true;
}

async function cyclePisiOpenTabs(direction = 1) {
    const state = getPisiOpenTabsState();
    const tabs = Array.isArray(state.openTabs) ? state.openTabs : [];

    if (!tabs.length) return false;
    if (tabs.length === 1) {
        return activatePisiOpenTab(tabs[0].path);
    }

    const currentIndex = state.activeTabPath ? tabs.findIndex((tab) => pisiSameTabPath(tab.path, state.activeTabPath)) : -1;
    const step = direction < 0 ? -1 : 1;
    const nextIndex = currentIndex === -1 ? (step > 0 ? 0 : tabs.length - 1) : (currentIndex + step + tabs.length) % tabs.length;
    const targetTab = tabs[nextIndex];

    if (!targetTab?.path) return false;

    if (typeof closeNodeModalAndSave === 'function' && typeof activeModalNode !== 'undefined' && activeModalNode) {
        const modalSaved = await closeNodeModalAndSave();
        if (!modalSaved) return false;
    }

    return activatePisiOpenTab(targetTab.path);
}

function initializePisiTabShortcuts() {
    if (typeof window === 'undefined' || typeof window.registerPisiCommand !== 'function') return;
    window.registerPisiCommand({
        id: 'pisi.tabs.next',
        label: 'Sonraki sekmeye geç',
        description: 'Açık çalışma alanı sekmeleri arasında sonraki sekmeye geçer.',
        category: 'Gezinme',
        defaultShortcut: 'Mod+Tab',
        allowInInput: true,
        when: () => (getPisiOpenTabsState().openTabs?.length || 0) > 0,
        handler: () => cyclePisiOpenTabs(1)
    });
    window.registerPisiCommand({
        id: 'pisi.tabs.previous',
        label: 'Önceki sekmeye geç',
        description: 'Açık çalışma alanı sekmeleri arasında önceki sekmeye geçer.',
        category: 'Gezinme',
        defaultShortcut: 'Mod+Shift+Tab',
        allowInInput: true,
        when: () => (getPisiOpenTabsState().openTabs?.length || 0) > 0,
        handler: () => cyclePisiOpenTabs(-1)
    });
}

async function closePisiOpenTab(path, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const state = getPisiOpenTabsState();

    const isActive = state.activeTabPath && pisiSameTabPath(state.activeTabPath, path);
    if (isActive) beginPisiWorkspaceNavigation();

    if (isActive && typeof saveCurrentCenterNodeEditor === 'function' && activeCenterNode) {
        const saved = await saveCurrentCenterNodeEditor({ allowDiscardRecovery: true });
        if (!saved) return false;
    }

    if (isActive && typeof saveCurrentMapLayout === 'function' && typeof activeMapPath !== 'undefined' && activeMapPath) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) return false;
    }

    await removePisiOpenTabByPath(path);
    return true;
}

async function removePisiOpenTabByPath(path) {
    const state = getPisiOpenTabsState();

    const index = state.openTabs.findIndex((tab) => {
        return pisiSameTabPath(tab.path, path);
    });

    const wasActive = state.activeTabPath && pisiSameTabPath(state.activeTabPath, path);

    if (index === -1) {
        if (typeof activeMapPath !== 'undefined' && activeMapPath && pisiSameTabPath(activeMapPath, path) && typeof clearMapWorkspace === 'function') {
            clearMapWorkspace();
        }

        renderPisiOpenTabs();
        return;
    }

    state.openTabs.splice(index, 1);

    if (!wasActive) {
        renderPisiOpenTabs();
        return;
    }

    const nextTab = state.openTabs[index] || state.openTabs[index - 1] || null;

    if (nextTab) {
        await activatePisiOpenTab(nextTab.path);
        return;
    }

    state.activeTabPath = null;

    if (typeof clearCenterNodeEditor === 'function') {
        clearCenterNodeEditor();
    }

    if (typeof clearMapWorkspace === 'function') {
        clearMapWorkspace();
    }

    renderPisiOpenTabs();
}

function resetPisiOpenTabs() {
    const state = getPisiOpenTabsState();

    state.openTabs = [];
    state.activeTabPath = null;

    renderPisiOpenTabs();
}

function updatePisiOpenTabAfterRename(oldPath, result) {
    if (!oldPath || !result || !result.ok) return;

    const state = getPisiOpenTabsState();

    const tab = state.openTabs.find((existingTab) => {
        return pisiSameTabPath(existingTab.path, oldPath);
    });

    if (tab) {
        tab.path = result.fullPath;
        tab.title = result.metadata?.title || String(result.fileName || '').replace(/\.(map|node)$/i, '');

        tab.item = {
            ...tab.item,
            name: result.fileName,
            fileName: result.fileName,
            fullPath: result.fullPath,
            displayName: result.metadata?.title || result.fileName,
            metadata: {
                ...(result.metadata || {})
            },
            sidecarPath: result.sidecarPath || tab.item?.sidecarPath
        };
    }

    if (state.activeTabPath && pisiSameTabPath(state.activeTabPath, oldPath)) {
        state.activeTabPath = result.fullPath;
    }

    if (typeof activeMapPath !== 'undefined' && activeMapPath && pisiSameTabPath(activeMapPath, oldPath)) {
        activeMapPath = result.fullPath;
    }

    if (Array.isArray(result.pathChanges)) {
        applyPisiPathChanges(result.pathChanges);
    }

    renderPisiOpenTabs();
}

function replacePisiClientPathPrefix(targetPath, oldPrefix, newPrefix) {
    if (!targetPath || !oldPrefix || !newPrefix) return targetPath;

    const normalizedTarget = String(targetPath).replace(/[\\/]+/g, '/');
    const normalizedOld = String(oldPrefix)
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');
    const normalizedNew = String(newPrefix)
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');
    const caseInsensitive = window.pisiEnvironment?.platform === 'win32';
    const comparableTarget = caseInsensitive ? normalizedTarget.toLowerCase() : normalizedTarget;
    const comparableOld = caseInsensitive ? normalizedOld.toLowerCase() : normalizedOld;

    if (comparableTarget !== comparableOld && !comparableTarget.startsWith(`${comparableOld}/`)) {
        return targetPath;
    }

    return `${normalizedNew}${normalizedTarget.slice(normalizedOld.length)}`;
}

function applyPisiPathChanges(pathChanges = []) {
    const changes = pathChanges.filter((change) => change?.oldPath && change?.newPath).sort((a, b) => String(b.oldPath).length - String(a.oldPath).length);

    if (!changes.length) return;

    const replacePath = (targetPath) => {
        let nextPath = targetPath;
        for (const change of changes) {
            nextPath = replacePisiClientPathPrefix(nextPath, change.oldPath, change.newPath);
        }
        return nextPath;
    };
    const state = getPisiOpenTabsState();

    state.openTabs.forEach((tab) => {
        tab.path = replacePath(tab.path);
        if (tab.item?.fullPath) {
            tab.item.fullPath = replacePath(tab.item.fullPath);
        }
        if (tab.item?.sidecarPath) {
            tab.item.sidecarPath = replacePath(tab.item.sidecarPath);
        }
    });

    if (state.activeTabPath) {
        state.activeTabPath = replacePath(state.activeTabPath);
    }

    if (typeof activeMapPath !== 'undefined' && activeMapPath) {
        activeMapPath = replacePath(activeMapPath);
    }

    if (Array.isArray(activeMapNodes)) {
        activeMapNodes.forEach((node) => {
            node.fullPath = replacePath(node.fullPath);
        });
    }

    document.querySelectorAll('.map-node-box[data-node-path]').forEach((box) => {
        box.dataset.nodePath = replacePath(box.dataset.nodePath);
    });

    if (activeCenterNode?.path) {
        activeCenterNode.path = replacePath(activeCenterNode.path);
        if (activeCenterNode.item?.fullPath) {
            activeCenterNode.item.fullPath = replacePath(activeCenterNode.item.fullPath);
        }
        if (activeCenterNode.item?.sidecarPath) {
            activeCenterNode.item.sidecarPath = replacePath(activeCenterNode.item.sidecarPath);
        }
    }

    if (activeModalNode?.path) {
        activeModalNode.path = replacePath(activeModalNode.path);
        if (activeModalNode.box?.dataset.nodePath) {
            activeModalNode.box.dataset.nodePath = replacePath(activeModalNode.box.dataset.nodePath);
        }
    }

    renderPisiOpenTabs();
}

function isPisiPathAtOrBelow(targetPath, prefixPath) {
    return replacePisiClientPathPrefix(targetPath, prefixPath, '__PISI_MATCH__') !== targetPath;
}

async function removePisiOpenTabsForDeletedPaths(paths = []) {
    const prefixes = paths.filter(Boolean);
    if (!prefixes.length) return;

    const isDeletedPath = (targetPath) => {
        return prefixes.some((prefix) => {
            return isPisiPathAtOrBelow(targetPath, prefix);
        });
    };
    const state = getPisiOpenTabsState();
    const activeWasDeleted = isDeletedPath(state.activeTabPath);

    state.openTabs = state.openTabs.filter((tab) => {
        return !isDeletedPath(tab.path);
    });

    if (activeCenterNode?.path && isDeletedPath(activeCenterNode.path)) {
        if (typeof clearCenterNodeEditor === 'function') {
            clearCenterNodeEditor();
        }
    }

    if (activeModalNode?.path && isDeletedPath(activeModalNode.path)) {
        if (typeof closeNodeModalWithoutSaving === 'function') {
            closeNodeModalWithoutSaving();
        }
    }

    if (typeof activeMapPath !== 'undefined' && activeMapPath && isDeletedPath(activeMapPath)) {
        if (typeof clearMapWorkspace === 'function') {
            clearMapWorkspace();
        }
    }

    if (activeWasDeleted) {
        state.activeTabPath = null;
        const nextTab = state.openTabs[0] || null;
        if (nextTab) {
            await activatePisiOpenTab(nextTab.path);
            return;
        }
    }

    renderPisiOpenTabs();
}

function pisiClientPathsOverlap(firstPath, secondPath) {
    if (!firstPath || !secondPath) return false;

    return isPisiPathAtOrBelow(firstPath, secondPath) || isPisiPathAtOrBelow(secondPath, firstPath);
}

function getActiveMapTabItemForReload() {
    if (typeof activeMapPath === 'undefined' || !activeMapPath) {
        return null;
    }

    const state = getPisiOpenTabsState();
    const tab = state.openTabs.find((item) => {
        return pisiSameTabPath(item.path, activeMapPath);
    });
    const fileName = String(activeMapPath).split(/[\\/]/).pop() || 'Map.map';

    return {
        ...(tab?.item || {}),
        name: tab?.item?.name || fileName,
        fileName: tab?.item?.fileName || fileName,
        fullPath: activeMapPath,
        metadata: tab?.item?.metadata || null,
        sidecarPath: tab?.item?.sidecarPath || null,
        isFile: true,
        isDirectory: false,
        type: 'file'
    };
}

function isExternalChangeRelevantToActiveMap(changedPaths) {
    if (typeof activeMapPath === 'undefined' || !activeMapPath || !Array.isArray(changedPaths)) {
        return false;
    }

    const mapItem = getActiveMapTabItemForReload();
    const relevantPaths = [activeMapPath, mapItem?.sidecarPath, ...(Array.isArray(activeMapNodes) ? activeMapNodes.map((node) => node?.fullPath) : [])].filter(
        Boolean
    );

    return changedPaths.some((changedPath) => {
        return relevantPaths.some((relevantPath) => {
            return pisiClientPathsOverlap(changedPath, relevantPath);
        });
    });
}

async function confirmPisiExternalReload(message) {
    return pisiConfirm(message, {
        title: 'Dış değişiklik algılandı',
        confirmText: 'Diskten yeniden yükle',
        cancelText: 'Ekrandaki sürümü koru',
        danger: true
    });
}

async function reloadPisiWorkspaceAfterExternalChange(changedPaths) {
    if (!Array.isArray(changedPaths) || !changedPaths.length) return;

    if (
        activeCenterNode?.path &&
        changedPaths.some((changedPath) => {
            return pisiClientPathsOverlap(changedPath, activeCenterNode.path);
        })
    ) {
        if (activeCenterNode.dirty) {
            const reload = await confirmPisiExternalReload(
                'Açık node hem PISI içinde değiştirilmiş hem de diskten güncellenmiş. Diskteki sürüm yüklensin mi? Ekrandaki kaydedilmemiş değişiklikler korunmayacak.'
            );
            if (!reload) return;
        }

        const item = {
            ...(activeCenterNode.item || {}),
            fullPath: activeCenterNode.path
        };
        clearTimeout(centerNodeSaveTimer);
        centerNodeSaveTimer = null;
        activeCenterNode.dirty = false;
        await openCenterNodeEditor(item);
        return;
    }

    if (!isExternalChangeRelevantToActiveMap(changedPaths)) return;

    const mapItem = getActiveMapTabItemForReload();
    if (!mapItem || typeof openMapInWorkspace !== 'function') return;

    const modalPath = activeModalNode?.path || null;
    const modalWasAffected =
        modalPath &&
        changedPaths.some((changedPath) => {
            return pisiClientPathsOverlap(changedPath, modalPath);
        });
    const hasPendingMapSave = Boolean(mapSaveTimer || mapCameraSaveTimer);
    const hasUnsavedWork = hasPendingMapSave || (modalWasAffected && activeModalNode?.dirty);

    if (hasUnsavedWork) {
        const reload = await confirmPisiExternalReload(
            'Açık map veya node dışarıdan değiştirildi. Diskteki sürüm yüklensin mi? Henüz diske yazılmamış ekrandaki değişiklikler korunmayacak.'
        );
        if (!reload) return;
    }

    clearTimeout(mapSaveTimer);
    clearTimeout(mapCameraSaveTimer);
    mapSaveTimer = null;
    mapCameraSaveTimer = null;

    if (modalWasAffected && typeof closeNodeModalWithoutSaving === 'function') {
        closeNodeModalWithoutSaving();
    }

    const reloaded = await openMapInWorkspace(mapItem);

    if (reloaded && modalWasAffected && modalPath) {
        const escapedPath = CSS.escape(modalPath);
        const newBox = document.querySelector(`.map-node-box[data-node-path="${escapedPath}"]`);

        if (newBox && typeof openNodeModalFromBox === 'function') {
            await openNodeModalFromBox(newBox);
        }
    }
}

let pisiFileSystemRefreshTail = Promise.resolve();
let pisiFileSystemRefreshTimer = null;
const pisiPendingFileSystemPaths = new Set();
let pisiPendingFileSystemTreeRefresh = false;

function flushPisiExternalFileSystemChanges() {
    clearTimeout(pisiFileSystemRefreshTimer);
    pisiFileSystemRefreshTimer = null;

    const changedPaths = Array.from(pisiPendingFileSystemPaths);
    const refreshTree = pisiPendingFileSystemTreeRefresh;

    pisiPendingFileSystemPaths.clear();
    pisiPendingFileSystemTreeRefresh = false;

    pisiFileSystemRefreshTail = pisiFileSystemRefreshTail
        .catch(() => undefined)
        .then(async () => {
            if (refreshTree) {
                await refreshCurrentProjectTree();
            }
            await reloadPisiWorkspaceAfterExternalChange(changedPaths);
        })
        .catch((error) => {
            console.error('[PISI] Dış dosya değişikliği yenilenemedi:', error);
        });

    return pisiFileSystemRefreshTail;
}

function handlePisiExternalFileSystemChange(payload = {}) {
    if (typeof shouldSuppressFileSystemRefresh === 'function' && shouldSuppressFileSystemRefresh()) {
        return pisiFileSystemRefreshTail;
    }

    const changedPaths = Array.isArray(payload?.changedPaths) ? payload.changedPaths.filter(Boolean) : [];

    changedPaths.forEach((changedPath) => {
        pisiPendingFileSystemPaths.add(changedPath);
    });

    const reason = String(payload?.reason || '').toLowerCase();
    if (!changedPaths.length || reason === 'rename' || reason === 'filesystem') {
        pisiPendingFileSystemTreeRefresh = true;
    }

    clearTimeout(pisiFileSystemRefreshTimer);
    pisiFileSystemRefreshTimer = setTimeout(() => {
        flushPisiExternalFileSystemChanges();
    }, 220);

    return pisiFileSystemRefreshTail;
}

async function renamePisiOpenTabTitle(tab, newTitle) {
    const cleanTitle = String(newTitle || '').trim();

    if (!tab?.path || !cleanTitle || cleanTitle === tab.title) {
        renderPisiOpenTabs();
        return;
    }

    try {
        if (typeof saveCurrentCenterNodeEditor === 'function' && activeCenterNode?.path && pisiSameTabPath(activeCenterNode.path, tab.path)) {
            const centerSaved = await saveCurrentCenterNodeEditor();
            if (!centerSaved) {
                renderPisiOpenTabs();
                return false;
            }
        }

        if (typeof saveCurrentMapLayout === 'function' && typeof activeMapPath !== 'undefined' && activeMapPath && pisiSameTabPath(activeMapPath, tab.path)) {
            const layoutSaved = await saveCurrentMapLayout();
            if (!layoutSaved) {
                pisiNotifyError('Harita yerleşimi kaydedilemedi; başlık değiştirilmedi.');
                renderPisiOpenTabs();
                return false;
            }
        }

        suppressNextFileSystemRefresh(3000);

        const oldPath = tab.path;
        const result = await renamePisiItemWithLinkReview(oldPath, cleanTitle);

        if (!result || !result.ok) {
            pisiNotifyError(result?.error || 'Sekme başlığı değiştirilemedi.');
            renderPisiOpenTabs();
            return false;
        }

        if (typeof updateTreeItemAfterRename === 'function') {
            updateTreeItemAfterRename(oldPath, result);
        }

        if (typeof updateOpenMapNodeAfterRename === 'function') {
            updateOpenMapNodeAfterRename(oldPath, result);
        }

        if (typeof updatePisiOpenTabAfterRename === 'function') {
            updatePisiOpenTabAfterRename(oldPath, result);
        }

        if (activeCenterNode?.path && pisiSameTabPath(activeCenterNode.path, oldPath)) {
            activeCenterNode.path = result.fullPath;
            activeCenterNode.metadata = result.metadata || activeCenterNode.metadata || {};
            activeCenterNode.item = {
                ...(activeCenterNode.item || {}),
                name: result.fileName,
                fileName: result.fileName,
                fullPath: result.fullPath,
                displayName: result.metadata?.title || result.fileName,
                metadata: {
                    ...(result.metadata || {})
                },
                sidecarPath: result.sidecarPath || activeCenterNode.item?.sidecarPath
            };
        }

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }

        selectPisiTreeFileByPath(result.fullPath);
        return true;
    } catch (error) {
        console.error('[PISI] Sekme başlığı değiştirme hatası:', error);
        pisiNotifyError('Sekme başlığı değiştirilirken hata oluştu.', { detail: error?.message });
        renderPisiOpenTabs();
        return false;
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    getPisiOpenTabsState: {
        enumerable: true,
        get() {
            return getPisiOpenTabsState;
        }
    },
    pisiSameTabPath: {
        enumerable: true,
        get() {
            return pisiSameTabPath;
        }
    },
    getPisiOpenTabType: {
        enumerable: true,
        get() {
            return getPisiOpenTabType;
        }
    },
    getPisiOpenTabTitle: {
        enumerable: true,
        get() {
            return getPisiOpenTabTitle;
        }
    },
    clonePisiTabItem: {
        enumerable: true,
        get() {
            return clonePisiTabItem;
        }
    },
    ensurePisiOpenTab: {
        enumerable: true,
        get() {
            return ensurePisiOpenTab;
        }
    },
    openPisiFileTab: {
        enumerable: true,
        get() {
            return openPisiFileTab;
        }
    },
    activatePisiOpenTab: {
        enumerable: true,
        get() {
            return activatePisiOpenTab;
        }
    },
    cyclePisiOpenTabs: {
        enumerable: true,
        get() {
            return cyclePisiOpenTabs;
        }
    },
    closePisiOpenTab: {
        enumerable: true,
        get() {
            return closePisiOpenTab;
        }
    },
    removePisiOpenTabByPath: {
        enumerable: true,
        get() {
            return removePisiOpenTabByPath;
        }
    },
    resetPisiOpenTabs: {
        enumerable: true,
        get() {
            return resetPisiOpenTabs;
        }
    },
    updatePisiOpenTabAfterRename: {
        enumerable: true,
        get() {
            return updatePisiOpenTabAfterRename;
        }
    },
    replacePisiClientPathPrefix: {
        enumerable: true,
        get() {
            return replacePisiClientPathPrefix;
        }
    },
    applyPisiPathChanges: {
        enumerable: true,
        get() {
            return applyPisiPathChanges;
        }
    },
    isPisiPathAtOrBelow: {
        enumerable: true,
        get() {
            return isPisiPathAtOrBelow;
        }
    },
    removePisiOpenTabsForDeletedPaths: {
        enumerable: true,
        get() {
            return removePisiOpenTabsForDeletedPaths;
        }
    },
    pisiClientPathsOverlap: {
        enumerable: true,
        get() {
            return pisiClientPathsOverlap;
        }
    },
    getActiveMapTabItemForReload: {
        enumerable: true,
        get() {
            return getActiveMapTabItemForReload;
        }
    },
    isExternalChangeRelevantToActiveMap: {
        enumerable: true,
        get() {
            return isExternalChangeRelevantToActiveMap;
        }
    },
    confirmPisiExternalReload: {
        enumerable: true,
        get() {
            return confirmPisiExternalReload;
        }
    },
    reloadPisiWorkspaceAfterExternalChange: {
        enumerable: true,
        get() {
            return reloadPisiWorkspaceAfterExternalChange;
        }
    },
    pisiFileSystemRefreshTail: {
        enumerable: true,
        get() {
            return pisiFileSystemRefreshTail;
        },
        set(value) {
            pisiFileSystemRefreshTail = value;
        }
    },
    handlePisiExternalFileSystemChange: {
        enumerable: true,
        get() {
            return handlePisiExternalFileSystemChange;
        }
    },
    renamePisiOpenTabTitle: {
        enumerable: true,
        get() {
            return renamePisiOpenTabTitle;
        }
    }
});
registerModule('shell.tabs', moduleApi);
initializePisiTabShortcuts();
