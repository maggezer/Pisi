import { registerModule } from "../core/module-registry.mjs";

function beginPisiOpenTabTitleRename(tab, titleEl) {
    if (!tab || !titleEl || titleEl.dataset.renaming === '1') return;

    titleEl.dataset.renaming = '1';

    const input = document.createElement('input');
    input.className = 'center-tab-rename-input pisi-rename-input';
    input.type = 'text';
    input.value = tab.title || 'Untitled';

    titleEl.replaceWith(input);

    let finished = false;

    async function finish(commit) {
        if (finished) return;
        finished = true;

        const newTitle = input.value.trim();

        if (!commit || !newTitle || newTitle === tab.title) {
            renderPisiOpenTabs();
            return;
        }

        await renamePisiOpenTabTitle(tab, newTitle);
    }

    input.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('dblclick', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('keydown', async (event) => {
        event.stopPropagation();

        if (event.key === 'Enter') {
            event.preventDefault();
            await finish(true);
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            await finish(false);
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            finish(true);
        }, 0);
    });

    focusPisiTextInput(input, true);
}

function selectPisiTreeFileByPath(path) {
    if (
        typeof findTreeNodeByPath !== 'function' ||
        typeof selectTreeFile !== 'function'
    ) {
        return;
    }

    const treeNode = findTreeNodeByPath(path);

    if (!treeNode) return;

    const row = Array.from(treeNode.children).find((child) => {
        return child.classList?.contains('tree-row');
    });

    if (!row || !treeNode.__pisiItem) return;

    selectTreeFile(treeNode.__pisiItem, row);
}

function renderPisiOpenTabs() {
    const tabsEl = document.getElementById('center-tabs');
    if (!tabsEl) return;

    const state = getPisiOpenTabsState();

    tabsEl.innerHTML = '';

    if (!state.openTabs.length) {
        const empty = document.createElement('div');
        empty.className = 'center-tabs-empty';
        empty.textContent = 'Açık dosya yok';
        tabsEl.appendChild(empty);
        return;
    }

    for (const tab of state.openTabs) {
        const tabEl = document.createElement('div');
        tabEl.className = 'center-tab';
        tabEl.title = tab.path;

        if (state.activeTabPath && pisiSameTabPath(state.activeTabPath, tab.path)) {
            tabEl.classList.add('active');
        }

        const icon = document.createElement('span');
        icon.className = 'center-tab-icon';
        icon.textContent = tab.type === 'map' ? '🗺️' : '📄';

        const title = document.createElement('span');
        title.className = 'center-tab-title';
        title.title = 'Yeniden adlandırmak için çift tıkla';
        title.textContent = tab.title || 'Untitled';

        title.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            beginPisiOpenTabTitleRename(tab, title);
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'center-tab-close';
        closeBtn.type = 'button';
        closeBtn.title = 'Sekmeyi kapat';
        closeBtn.textContent = '×';

        tabEl.appendChild(icon);
        tabEl.appendChild(title);
        tabEl.appendChild(closeBtn);

        tabEl.addEventListener('click', async (event) => {
            if (event.target.closest('.center-tab-close')) return;

            await activatePisiOpenTab(tab.path);
        });

        closeBtn.addEventListener('click', async (event) => {
            await closePisiOpenTab(tab.path, event);
        });

        tabsEl.appendChild(tabEl);
    }
}

async function setupProjectStartup() {



    const projectModal = document.getElementById('project-modal');
    const modalChooseBtn = document.getElementById('modal-choose-project-btn');
    const changeProjectBtn = document.getElementById('change-project-btn');

    const addMapBtn = document.getElementById('add-map-btn');
    const addNodeBtn = document.getElementById('add-node-btn');

    window.pisiProject?.onFileSystemChanged?.((payload) => {
        handlePisiExternalFileSystemChange(payload);
    });
   

    modalChooseBtn?.addEventListener('click', async () => {
        await chooseAndLoadProject();
    });

    changeProjectBtn?.addEventListener('click', async () => {
        await chooseAndLoadProject();
    });

    addMapBtn?.addEventListener('click', async () => {
    await createPisiFileInCurrentProject('.map');
    });

    addNodeBtn?.addEventListener('click', async () => {
    await createPisiFileInCurrentProject('.node');
    });

    const lastFolder = await window.pisiProject?.getLastFolder?.();

    if (lastFolder) {
        await loadProject(lastFolder);
    } else {
        showProjectModal();
    }
}

async function createPisiFileInCurrentProject(ext) {
    if (!window.currentProjectFolder) {
        showProjectModal();
        return;
    }

    suppressNextFileSystemRefresh(1500);

    const result = await window.pisiProject?.createPisiFile?.(
        window.currentProjectFolder,
        ext
    );

    if (!result || !result.ok) {
        alert(result?.error || 'Dosya oluşturulamadı.');
        return;
    }

    const rootNode = findTreeNodeByPath(window.currentProjectFolder);
    const rootChildren = rootNode?.querySelector('.tree-children');

    if (!rootNode || !rootChildren) {
        await renderFolderTree(window.currentProjectFolder);
        return;
    }

    rootNode.classList.add('expanded');
    expandedTreePaths.add(window.currentProjectFolder);

    const newItem = makeTreeItemFromCreateResult(result);

    await appendTreeItemToContainer(rootChildren, newItem, 1);
}

function refocusPisiRenderer() {
    window.electronWindow?.focusRenderer?.();
    window.focus();

    if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
    }

    document.body.focus({ preventScroll: true });

    const selection = window.getSelection?.();

    if (selection?.removeAllRanges) {
        selection.removeAllRanges();
    }
}

function focusPisiTextInput(input, shouldSelect = true) {
    if (!input) return;

    input.disabled = false;
    input.readOnly = false;
    input.draggable = false;
    input.autocomplete = 'off';
    input.classList.add('pisi-rename-input');

    if (input.dataset.pisiTextInputBound !== '1') {
        input.dataset.pisiTextInputBound = '1';
        input.addEventListener('beforeinput', () => {
            input.dataset.pisiUserEdited = '1';
        });
        input.addEventListener('dragstart', (event) => {
            event.preventDefault();
        });
    }

    window.focus();

    const focusInput = () => {
        if (!input.isConnected) return;
        input.focus({ preventScroll: true });

        if (shouldSelect && input.dataset.pisiUserEdited !== '1') {
            input.select?.();
        }
    };

    focusInput();
    requestAnimationFrame(focusInput);
    setTimeout(focusInput, 60);
}

function escapePisiConfirmText(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function resetPisiKeyboardAndPointerState() {
    try {
        window.getSelection?.()?.removeAllRanges?.();
    } catch (error) {}

    document.querySelectorAll('.map-node-box.dragging').forEach((el) => {
        el.classList.remove('dragging');
    });

    document.querySelectorAll('.map-port.connecting-source').forEach((el) => {
        el.classList.remove('connecting-source');
    });

    document.querySelectorAll('.map-selection-box').forEach((el) => {
        el.remove();
    });

    document.getElementById('map-canvas')?.classList.remove('panning');
    document.getElementById('map-temp-edge')?.remove();

    try {
        if (typeof currentConnectionDrag !== 'undefined') {
            currentConnectionDrag = null;
        }
    } catch (error) {}

    try {
        if (typeof currentMapBoxSelection !== 'undefined') {
            currentMapBoxSelection = null;
        }
    } catch (error) {}

    if (typeof resetPisiMapConnectionInteractions === 'function') {
        resetPisiMapConnectionInteractions();
    }

    if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
    }

    window.focus();
    document.body.focus({ preventScroll: true });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "beginPisiOpenTabTitleRename": {
        enumerable: true,
        get() { return beginPisiOpenTabTitleRename; }
    },
    "selectPisiTreeFileByPath": {
        enumerable: true,
        get() { return selectPisiTreeFileByPath; }
    },
    "renderPisiOpenTabs": {
        enumerable: true,
        get() { return renderPisiOpenTabs; }
    },
    "setupProjectStartup": {
        enumerable: true,
        get() { return setupProjectStartup; }
    },
    "createPisiFileInCurrentProject": {
        enumerable: true,
        get() { return createPisiFileInCurrentProject; }
    },
    "refocusPisiRenderer": {
        enumerable: true,
        get() { return refocusPisiRenderer; }
    },
    "focusPisiTextInput": {
        enumerable: true,
        get() { return focusPisiTextInput; }
    },
    "escapePisiConfirmText": {
        enumerable: true,
        get() { return escapePisiConfirmText; }
    },
    "resetPisiKeyboardAndPointerState": {
        enumerable: true,
        get() { return resetPisiKeyboardAndPointerState; }
    }
});
registerModule("shell.startup", moduleApi);
