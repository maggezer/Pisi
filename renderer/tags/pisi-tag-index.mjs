import { registerModule } from '../core/module-registry.mjs';

// The Tags panel index: blocks with user tags in the active map, the open note
// and the diaries. Tasks are not read from notes any more (docs/task-plan.md
// G2): they come from tasks.json through renderer/tasks/pisi-task-store.mjs.
// The index only reads; it never writes a note (GK4).

function bindPisiBlockIndexControls() {
    const editors = [document.getElementById('node-modal-content'), document.getElementById('center-node-editor-content')].filter(Boolean);
    for (const editor of editors) {
        if (editor.dataset.pisiBlockIndexBound === '1') continue;
        editor.dataset.pisiBlockIndexBound = '1';
        editor.addEventListener('input', () => {
            ensurePisiEditorBlocks(editor);
            refreshPisiTagsPanelSoon();
        });
    }
    if (typeof bindPisiTagPickerOutsideClose === 'function') {
        bindPisiTagPickerOutsideClose();
    }
    refreshPisiTagsPanelSoon();
}

function bindPisiTagPickerOutsideClose() {
    if (window.__pisiTagPickerOutsideCloseBound === true) return;
    window.__pisiTagPickerOutsideCloseBound = true;

    document.addEventListener('mousedown', (event) => {
        if (!pisiTagsPanelState?.dropdownOpen) return;

        if (event.target.closest('#pisi-tags-panel')) {
            return;
        }

        pisiTagsPanelState.dropdownOpen = false;
        renderPisiTagsPanel();
    });
}

function extractPisiTagsFromBlock(block) {
    return Array.from(block.querySelectorAll('.pisi-user-tag[data-pisi-tag]'))
        .map((tagEl) => normalizePisiUserTag(tagEl.dataset.pisiTag || tagEl.textContent || ''))
        .filter(Boolean);
}

function refreshPisiTagsPanelSoon() {
    clearTimeout(pisiTagsPanelRefreshTimer);

    pisiTagsPanelRefreshTimer = setTimeout(async () => {
        pisiTagsPanelRefreshTimer = null;
        await refreshPisiTagsPanel();
    }, 1000);
}

function resetPisiTagsForProject() {
    clearTimeout(pisiTagsPanelRefreshTimer);
    pisiTagsPanelRefreshTimer = null;

    if (PISI_USER_TAG_CACHE instanceof Set) {
        PISI_USER_TAG_CACHE.clear();
    }

    pisiTagsPanelState = {
        selectedTag: null,
        dropdownOpen: false,
        index: []
    };

    if (typeof closePisiTagMenu === 'function') {
        closePisiTagMenu();
    }

    renderPisiTagsPanel();
}

async function refreshPisiTagsPanel() {
    try {
        const index = await buildPisiTagBlockIndex();

        pisiTagsPanelState.index = Array.isArray(index) ? index : [];
        renderPisiTagsPanel();
    } catch (error) {
        console.error('[PISI] Etiket paneli yenilenemedi:', error);
    }
}

function normalizeClientPathForTags(filePath) {
    const normalized = String(filePath || '').replace(/[\\/]+/g, '/');

    return window.pisiEnvironment?.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePisiPathForTags(a, b) {
    if (!a || !b) return false;

    if (typeof pisiSameTabPath === 'function') {
        return pisiSameTabPath(a, b);
    }

    return String(a) === String(b);
}

function getPisiTagsActiveMapPath() {
    if (activeMapPath) {
        return activeMapPath;
    }

    const state = window.Pisi?.state;

    if (!state?.activeTabPath || !Array.isArray(state.openTabs)) {
        return null;
    }

    const activeTab = state.openTabs.find((tab) => {
        return samePisiPathForTags(tab.path, state.activeTabPath);
    });

    if (activeTab?.type === 'map') {
        return activeTab.path;
    }

    return null;
}

async function getPisiTagsActiveMapNodes(mapPath) {
    if (!mapPath) return [];

    if (activeMapPath && samePisiPathForTags(activeMapPath, mapPath) && Array.isArray(activeMapNodes) && activeMapNodes.length) {
        return activeMapNodes;
    }

    const result = await window.pisiProject?.listMapNodes?.(mapPath);

    if (!result?.ok) {
        return [];
    }

    return Array.isArray(result.nodes) ? result.nodes : [];
}

async function collectPisiDiaryTagNodeItems(scanState = null) {
    const projectFolder = window.currentProjectFolder;

    if (!projectFolder || !window.pisiProject?.listDiaryDates) {
        return [];
    }

    const datesResult = await window.pisiProject.listDiaryDates(projectFolder);

    if (!datesResult?.ok) {
        if (scanState) {
            scanState.complete = false;
            scanState.errors.push(datesResult?.error || 'Günlük notları listelenemedi.');
        }
        return [];
    }

    const dates = Array.isArray(datesResult?.dates) ? datesResult.dates : [];
    const nodes = [];

    for (const date of dates) {
        const result = await window.pisiProject?.getOrCreateDiaryNode?.(projectFolder, date);

        if (!result?.ok || !result.fullPath) {
            if (scanState) {
                scanState.complete = false;
                scanState.errors.push(result?.error || `Günlük notu okunamadı: ${date}`);
            }
            continue;
        }

        nodes.push({
            name: result.name || result.fileName || `${date}.node`,
            fileName: result.fileName || result.name || `${date}.node`,
            fullPath: result.fullPath,
            type: 'file',
            isDirectory: false,
            isFile: true,
            displayName: result.displayName || result.metadata?.title || date,
            metadata: result.metadata || null,
            sidecarPath: result.sidecarPath || null,
            isDiaryNode: true
        });
    }

    return nodes;
}

async function extractPisiTagBlocksForNodeItem(node) {
    const nodePath = node?.fullPath;

    if (!nodePath) return [];

    const fallbackTitle = node.metadata?.title || node.displayName || node.fileName || node.name || 'Node';

    let html = '';
    let nodeTitle = fallbackTitle;

    if (activeCenterNode?.path && samePisiPathForTags(activeCenterNode.path, nodePath)) {
        const editor = document.getElementById('center-node-editor-content');
        ensurePisiEditorBlocks(editor);

        html = editor?.innerHTML || '';
        nodeTitle = activeCenterNode.metadata?.title || fallbackTitle;
    } else if (activeModalNode?.path && samePisiPathForTags(activeModalNode.path, nodePath)) {
        const editor = document.getElementById('node-modal-content');
        ensurePisiEditorBlocks(editor);

        html = editor?.innerHTML || '';
        nodeTitle = activeModalNode.metadata?.title || fallbackTitle;
    } else {
        const doc = await window.pisiProject?.getPisiDocument?.(nodePath);

        if (!doc?.ok) return [];

        html = doc.data?.content || '';
        nodeTitle = doc.metadata?.title || fallbackTitle;
    }

    const detailed = extractPisiTagBlocksFromHtmlDetailed({
        html,
        nodePath,
        nodeTitle: node.isDiaryNode ? `Günlük · ${nodeTitle}` : nodeTitle
    });

    return detailed.blocks.map((block) => ({
        ...block,
        fileName: node.fileName || node.name || '',
        isDiaryNode: Boolean(node.isDiaryNode)
    }));
}

async function buildPisiTagBlockIndex() {
    const results = [];
    const seenPaths = new Set();

    // Tags paneli aktif map'i ve günlük notları birlikte tarar.
    // activeMapPath boşsa aktif tab üzerinden map yolunu bulur.
    const mapPath = getPisiTagsActiveMapPath();
    const mapNodes = await getPisiTagsActiveMapNodes(mapPath);
    const diaryNodes = await collectPisiDiaryTagNodeItems();
    const standaloneNode =
        activeCenterNode?.path &&
        (!mapPath ||
            !Array.isArray(mapNodes) ||
            !mapNodes.some((node) => {
                return samePisiPathForTags(node?.fullPath, activeCenterNode.path);
            }))
            ? [
                  {
                      ...(activeCenterNode.item || {}),
                      fullPath: activeCenterNode.path,
                      metadata: activeCenterNode.metadata || activeCenterNode.item?.metadata || {},
                      isFile: true,
                      isDirectory: false,
                      type: 'file'
                  }
              ]
            : [];

    const allNodes = [...(Array.isArray(mapNodes) ? mapNodes : []), ...(Array.isArray(diaryNodes) ? diaryNodes : []), ...standaloneNode];

    for (const node of allNodes) {
        if (!node?.fullPath) continue;

        const normalizedPath = normalizeClientPathForTags(node.fullPath);
        if (seenPaths.has(normalizedPath)) continue;
        seenPaths.add(normalizedPath);

        results.push(...(await extractPisiTagBlocksForNodeItem(node)));
    }

    return results;
}

function extractPisiTagBlocksFromHtmlDetailed({ html, nodePath, nodeTitle, mapPath = null, mapTitle = '' }) {
    const template = createPisiInertHtmlTemplate(html);
    const container = template.content;

    const blocks = getPisiBlockElementsFromContainer(container);
    const results = [];
    let assignedMissingBlockId = false;

    for (const block of blocks) {
        if (block.classList.contains('pisi-diary-managed-block') || block.closest('.pisi-diary-managed-block')) {
            continue;
        }

        if (!block.dataset.pisiBlockId) {
            assignedMissingBlockId = true;
        }

        decoratePisiEditorBlock(block);

        const tags = Array.from(new Set(extractPisiTagsFromBlock(block)));
        if (!tags.length) continue;

        const text = block.textContent.replace(/\s+/g, ' ').trim();

        results.push({
            blockId: block.dataset.pisiBlockId,
            nodePath,
            nodeTitle,
            mapPath,
            mapTitle,
            tags,
            text,
            html: sanitizePisiEditorHtml(block.outerHTML)
        });
    }

    return {
        blocks: results,
        html: template.innerHTML,
        assignedMissingBlockId
    };
}

function extractPisiTagBlocksFromHtml(options) {
    return extractPisiTagBlocksFromHtmlDetailed(options).blocks;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    bindPisiBlockIndexControls: {
        enumerable: true,
        get() {
            return bindPisiBlockIndexControls;
        }
    },
    bindPisiTagPickerOutsideClose: {
        enumerable: true,
        get() {
            return bindPisiTagPickerOutsideClose;
        }
    },
    extractPisiTagsFromBlock: {
        enumerable: true,
        get() {
            return extractPisiTagsFromBlock;
        }
    },
    refreshPisiTagsPanelSoon: {
        enumerable: true,
        get() {
            return refreshPisiTagsPanelSoon;
        }
    },
    resetPisiTagsForProject: {
        enumerable: true,
        get() {
            return resetPisiTagsForProject;
        }
    },
    refreshPisiTagsPanel: {
        enumerable: true,
        get() {
            return refreshPisiTagsPanel;
        }
    },
    normalizeClientPathForTags: {
        enumerable: true,
        get() {
            return normalizeClientPathForTags;
        }
    },
    samePisiPathForTags: {
        enumerable: true,
        get() {
            return samePisiPathForTags;
        }
    },
    getPisiTagsActiveMapPath: {
        enumerable: true,
        get() {
            return getPisiTagsActiveMapPath;
        }
    },
    getPisiTagsActiveMapNodes: {
        enumerable: true,
        get() {
            return getPisiTagsActiveMapNodes;
        }
    },
    collectPisiDiaryTagNodeItems: {
        enumerable: true,
        get() {
            return collectPisiDiaryTagNodeItems;
        }
    },
    extractPisiTagBlocksForNodeItem: {
        enumerable: true,
        get() {
            return extractPisiTagBlocksForNodeItem;
        }
    },
    buildPisiTagBlockIndex: {
        enumerable: true,
        get() {
            return buildPisiTagBlockIndex;
        }
    },
    extractPisiTagBlocksFromHtmlDetailed: {
        enumerable: true,
        get() {
            return extractPisiTagBlocksFromHtmlDetailed;
        }
    },
    extractPisiTagBlocksFromHtml: {
        enumerable: true,
        get() {
            return extractPisiTagBlocksFromHtml;
        }
    }
});
registerModule('tags.index', moduleApi);
