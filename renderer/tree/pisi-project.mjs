import { registerModule } from '../core/module-registry.mjs';

const MAP_ZOOM_STEP = 1.1;

const MAP_ZOOM_MIN = 0.1;

const MAP_ZOOM_MAX = 3;

const MAP_ZOOM_HOLD_INTERVAL = 400;

function getPisiProjectTitleFromPath(folderPath) {
    if (!folderPath) return 'Explorer';

    const parts = String(folderPath).split(/[\\/]/).filter(Boolean);

    return parts[parts.length - 1] || 'Explorer';
}

function updatePisiProjectTitle(folderPath) {
    const titleEl = document.getElementById('project-title');
    if (!titleEl) return;

    titleEl.textContent = getPisiProjectTitleFromPath(folderPath);
    titleEl.title = folderPath || '';
}

function suppressNextFileSystemRefresh(duration = 900) {
    suppressFileSystemRefreshUntil = Date.now() + duration;
}

function shouldSuppressFileSystemRefresh() {
    return Date.now() < suppressFileSystemRefreshUntil;
}

async function validateCurrentProject() {
    const folderPath = window.currentProjectFolder;

    if (!folderPath) {
        showProjectModal();
        return false;
    }

    const exists = await window.pisiProject?.folderExists?.(folderPath);

    if (!exists) {
        window.currentProjectFolder = null;
        updatePisiProjectTitle(null);

        const treeEl = document.getElementById('file-tree');
        if (treeEl) {
            treeEl.innerHTML = '';
        }

        showProjectModal();
        return false;
    }

    return true;
}

let pisiProjectRefreshSequence = 0;

/** @type {Promise<boolean | void>} */
let pisiProjectRefreshTail = Promise.resolve();

const pisiProjectRefreshWaiters = [];

function resolvePisiProjectRefreshWaiters(completedSequence, result) {
    for (let index = pisiProjectRefreshWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = pisiProjectRefreshWaiters[index];
        if (waiter.sequence > completedSequence) continue;

        pisiProjectRefreshWaiters.splice(index, 1);
        waiter.resolve(result);
    }
}

function refreshCurrentProjectTree() {
    clearTimeout(projectRefreshTimer);
    const sequence = ++pisiProjectRefreshSequence;
    const resultPromise = new Promise((resolve) => {
        pisiProjectRefreshWaiters.push({
            sequence,
            resolve
        });
    });

    projectRefreshTimer = setTimeout(() => {
        const batchSequence = sequence;

        pisiProjectRefreshTail = pisiProjectRefreshTail
            .catch(() => false)
            .then(async () => {
                const valid = await validateCurrentProject();

                if (valid && window.currentProjectFolder) {
                    await renderFolderTree(window.currentProjectFolder);
                }

                return valid;
            })
            .then((result) => {
                resolvePisiProjectRefreshWaiters(batchSequence, result);
                return result;
            })
            .catch((error) => {
                console.error('[PISI] Proje ağacı yenilenemedi:', error);
                resolvePisiProjectRefreshWaiters(batchSequence, false);
                return false;
            });
    }, 250);

    return resultPromise;
}

function showProjectModal() {
    const projectModal = document.getElementById('project-modal');
    projectModal?.classList.add('visible');
}

function hideProjectModal() {
    const projectModal = document.getElementById('project-modal');
    projectModal?.classList.remove('visible');
}

function normalizePisiProjectSelection(selection) {
    if (selection?.ok === true && typeof selection.folderPath === 'string' && selection.folderPath.trim()) {
        return {
            ok: true,
            folderPath: selection.folderPath
        };
    }

    if (!selection || selection.cancelled === true) {
        return {
            ok: false,
            cancelled: true
        };
    }

    return {
        ok: false,
        code: selection.code || 'PROJECT_OPEN_FAILED',
        error: selection.error || 'Proje klasörü açılamadı.',
        reported: selection.reported === true
    };
}

function reportPisiProjectLoadError(error) {
    const message = String(error || 'Proje klasörü yüklenemedi.');
    console.error('[PISI] Proje yüklenemedi:', message);
    pisiNotifyError(message);
}

async function chooseAndLoadProject() {
    if (typeof flushPisiPendingSaves === 'function') {
        const saved = await flushPisiPendingSaves();
        if (!saved) return false;
    }

    let selectionResult = null;

    try {
        selectionResult = await window.pisiProject?.chooseFolder?.();
    } catch (error) {
        reportPisiProjectLoadError(error.message);
        showProjectModal();
        return false;
    }

    const selection = normalizePisiProjectSelection(selectionResult);

    if (selection.cancelled) {
        // Kullanıcı seçim penceresinde geri/iptal yaptıysa bile
        // mevcut proje hâlâ geçerli mi kontrol et ve ağacı yenile.
        if (window.currentProjectFolder) {
            await refreshCurrentProjectTree();
        } else {
            showProjectModal();
        }
        return false;
    }

    if (!selection.ok) {
        if (!selection.reported) {
            reportPisiProjectLoadError(selection.error);
        }

        if (window.currentProjectFolder) {
            await refreshCurrentProjectTree();
        } else {
            showProjectModal();
        }
        return false;
    }

    const loaded = await loadProject(selection.folderPath);

    if (loaded) {
        hideProjectModal();
    } else {
        showProjectModal();
    }

    return loaded;
}

async function loadProject(folderPath) {
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
        reportPisiProjectLoadError('Geçerli bir proje klasörü seçilmedi.');
        showProjectModal();
        return false;
    }

    let folderResult = null;

    try {
        folderResult = await window.pisiProject?.listFolder?.(folderPath);
    } catch (error) {
        reportPisiProjectLoadError(error.message);
        showProjectModal();
        return false;
    }

    if (!folderResult?.ok) {
        reportPisiProjectLoadError(folderResult?.error || 'Proje klasörü okunamadı.');
        showProjectModal();
        return false;
    }

    const previousProjectFolder = window.currentProjectFolder;
    const reloadingSameProject = Boolean(previousProjectFolder) && sameClientPath(previousProjectFolder, folderPath);

    // Pending editor/map saves are written before any timer is cancelled or any
    // surface is closed. A failed save stops the load so nothing is discarded.
    if (typeof flushPisiPendingSaves === 'function') {
        let saved = false;
        try {
            saved = await flushPisiPendingSaves();
        } catch (error) {
            console.error('[PISI] Bekleyen kayıtlar yazılamadı:', error);
        }
        if (!saved) {
            reportPisiProjectLoadError(
                window.pisiT?.('Bekleyen değişiklikler kaydedilemedi; proje yeniden yüklenmedi.') ??
                    'Bekleyen değişiklikler kaydedilemedi; proje yeniden yüklenmedi.'
            );
            return false;
        }
    }

    const workspaceSnapshot = reloadingSameProject && typeof capturePisiProjectWorkspace === 'function' ? capturePisiProjectWorkspace() : null;

    window.currentProjectFolder = folderPath;
    if (typeof invalidatePisiSearchIndex === 'function' && previousProjectFolder !== folderPath) {
        invalidatePisiSearchIndex('project-change');
    }
    updatePisiProjectTitle(folderPath);

    clearTimeout(centerNodeSaveTimer);
    clearTimeout(mapSaveTimer);
    clearTimeout(mapCameraSaveTimer);

    if (typeof clearCenterNodeEditor === 'function') {
        clearCenterNodeEditor();
    }

    if (typeof closeNodeModalWithoutSaving === 'function') {
        closeNodeModalWithoutSaving();
    }

    if (typeof resetPisiOpenTabs === 'function') {
        resetPisiOpenTabs();
    }

    if (typeof clearMapWorkspace === 'function') {
        clearMapWorkspace();
    }

    if (typeof resetPisiTagsForProject === 'function' && previousProjectFolder !== folderPath) {
        resetPisiTagsForProject();
    }

    if (typeof resetPisiCalendarForProject === 'function') {
        resetPisiCalendarForProject(folderPath);
    }

    const rendered = await renderFolderTree(folderPath);

    if (!rendered) {
        reportPisiProjectLoadError('Proje dosya ağacı yüklenemedi.');
        showProjectModal();
        return false;
    }

    if (workspaceSnapshot && typeof restorePisiProjectWorkspace === 'function') {
        await restorePisiProjectWorkspace(workspaceSnapshot);
    }

    return true;
}

let pisiTreeRootRenderId = 0;

function isCurrentPisiTreeRootRender(renderId, rootPath) {
    return renderId === pisiTreeRootRenderId && sameClientPath(window.currentProjectFolder, rootPath);
}

async function renderFolderTree(rootPath) {
    const treeEl = document.getElementById('file-tree');
    if (!treeEl) return false;
    const renderId = ++pisiTreeRootRenderId;
    const previousScrollTop = treeEl.scrollTop;
    const nextTree = document.createElement('div');

    updatePisiProjectTitle(rootPath);

    expandedTreePaths.add(rootPath);

    bindFileTreeRootDropZone(treeEl);

    const loaded = await loadFolderChildren(rootPath, nextTree, 0, {
        renderId,
        rootPath
    });

    if (!isCurrentPisiTreeRootRender(renderId, rootPath)) {
        return false;
    }

    treeEl.replaceChildren(...Array.from(nextTree.childNodes));
    treeEl.scrollTop = previousScrollTop;
    return loaded;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    MAP_ZOOM_STEP: {
        enumerable: true,
        get() {
            return MAP_ZOOM_STEP;
        }
    },
    MAP_ZOOM_MIN: {
        enumerable: true,
        get() {
            return MAP_ZOOM_MIN;
        }
    },
    MAP_ZOOM_MAX: {
        enumerable: true,
        get() {
            return MAP_ZOOM_MAX;
        }
    },
    MAP_ZOOM_HOLD_INTERVAL: {
        enumerable: true,
        get() {
            return MAP_ZOOM_HOLD_INTERVAL;
        }
    },
    getPisiProjectTitleFromPath: {
        enumerable: true,
        get() {
            return getPisiProjectTitleFromPath;
        }
    },
    updatePisiProjectTitle: {
        enumerable: true,
        get() {
            return updatePisiProjectTitle;
        }
    },
    suppressNextFileSystemRefresh: {
        enumerable: true,
        get() {
            return suppressNextFileSystemRefresh;
        }
    },
    shouldSuppressFileSystemRefresh: {
        enumerable: true,
        get() {
            return shouldSuppressFileSystemRefresh;
        }
    },
    validateCurrentProject: {
        enumerable: true,
        get() {
            return validateCurrentProject;
        }
    },
    pisiProjectRefreshSequence: {
        enumerable: true,
        get() {
            return pisiProjectRefreshSequence;
        },
        set(value) {
            pisiProjectRefreshSequence = value;
        }
    },
    pisiProjectRefreshTail: {
        enumerable: true,
        get() {
            return pisiProjectRefreshTail;
        },
        set(value) {
            pisiProjectRefreshTail = value;
        }
    },
    pisiProjectRefreshWaiters: {
        enumerable: true,
        get() {
            return pisiProjectRefreshWaiters;
        }
    },
    resolvePisiProjectRefreshWaiters: {
        enumerable: true,
        get() {
            return resolvePisiProjectRefreshWaiters;
        }
    },
    refreshCurrentProjectTree: {
        enumerable: true,
        get() {
            return refreshCurrentProjectTree;
        }
    },
    showProjectModal: {
        enumerable: true,
        get() {
            return showProjectModal;
        }
    },
    hideProjectModal: {
        enumerable: true,
        get() {
            return hideProjectModal;
        }
    },
    chooseAndLoadProject: {
        enumerable: true,
        get() {
            return chooseAndLoadProject;
        }
    },
    loadProject: {
        enumerable: true,
        get() {
            return loadProject;
        }
    },
    pisiTreeRootRenderId: {
        enumerable: true,
        get() {
            return pisiTreeRootRenderId;
        },
        set(value) {
            pisiTreeRootRenderId = value;
        }
    },
    isCurrentPisiTreeRootRender: {
        enumerable: true,
        get() {
            return isCurrentPisiTreeRootRender;
        }
    },
    renderFolderTree: {
        enumerable: true,
        get() {
            return renderFolderTree;
        }
    }
});
registerModule('tree.project', moduleApi);
