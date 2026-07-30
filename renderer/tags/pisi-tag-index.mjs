import { registerModule } from "../core/module-registry.mjs";

function bindPisiBlockIndexControls() {
    const editors = [
        document.getElementById('node-modal-content'),
        document.getElementById('center-node-editor-content')
    ].filter(Boolean);

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

function makePisiBlockId() {
    if (window.crypto?.randomUUID) {
        return `blk_${window.crypto.randomUUID()}`;
    }

    return `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isPisiEditorBlockElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    return /^(DIV|P|H2|H3|H4|H5|H6)$/i.test(element.tagName);
}

function decoratePisiEditorBlock(element) {
    if (!isPisiEditorBlockElement(element)) return;

    element.classList.add('pisi-editor-block');

    if (!element.dataset.pisiBlockId) {
        element.dataset.pisiBlockId = makePisiBlockId();
    }
}

function getPisiEditorNodePath(editor, node) {
    const nodePath = [];
    let current = node;
    while (current && current !== editor) {
        const parent = current.parentNode;
        if (!parent) return null;
        const index = Array.prototype.indexOf.call(parent.childNodes, current);
        if (index < 0) return null;
        nodePath.unshift(index);
        current = parent;
    }
    return current === editor ? nodePath : null;
}

function resolvePisiEditorNodePath(editor, nodePath) {
    if (!Array.isArray(nodePath)) return null;
    let current = editor;
    for (const index of nodePath) {
        if (!current?.childNodes || index < 0 || index >= current.childNodes.length) return null;
        current = current.childNodes[index];
    }
    return current;
}

function capturePisiEditorSelection(editor) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;

    const makePoint = (container, offset) => {
        const prefix = range.cloneRange();
        prefix.selectNodeContents(editor);
        prefix.setEnd(container, offset);
        return {
            nodePath: getPisiEditorNodePath(editor, container),
            offset,
            textOffset: prefix.toString().length
        };
    };
    return {
        start: makePoint(range.startContainer, range.startOffset),
        end: makePoint(range.endContainer, range.endOffset)
    };
}

function resolvePisiEditorTextPosition(editor, targetOffset) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, Number(targetOffset) || 0);
    let lastTextNode = null;
    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        const length = textNode.nodeValue?.length || 0;
        lastTextNode = textNode;
        if (remaining <= length) return { node: textNode, offset: remaining };
        remaining -= length;
    }
    if (lastTextNode) {
        return { node: lastTextNode, offset: lastTextNode.nodeValue?.length || 0 };
    }
    return {
        node: editor.querySelector?.('.pisi-editor-block') || editor.firstElementChild || editor,
        offset: 0
    };
}

function isValidPisiEditorRangeOffset(node, offset) {
    if (!node || !Number.isInteger(offset) || offset < 0) return false;
    const limit = node.nodeType === Node.TEXT_NODE
        ? node.nodeValue?.length || 0
        : node.childNodes?.length || 0;
    return offset <= limit;
}

function resolvePisiEditorSelectionPoint(editor, point) {
    const pathNode = resolvePisiEditorNodePath(editor, point?.nodePath);
    if (isValidPisiEditorRangeOffset(pathNode, point?.offset)) {
        return { node: pathNode, offset: point.offset };
    }
    return resolvePisiEditorTextPosition(editor, point?.textOffset);
}

function restorePisiEditorSelection(editor, snapshot) {
    if (!snapshot) return;
    const selection = window.getSelection?.();
    if (!selection) return;
    const start = resolvePisiEditorSelectionPoint(editor, snapshot.start);
    const end = resolvePisiEditorSelectionPoint(editor, snapshot.end);
    const range = document.createRange();
    try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (error) {
        console.warn('[PISI] Editör imleci geri yüklenemedi:', error);
    }
}

function ensurePisiEditorBlocks(editor, options = {}) {
    if (!editor) return;

    const preserveSelection = options.preserveSelection !== false;
    const selectionSnapshot = preserveSelection
        ? capturePisiEditorSelection(editor)
        : null;

    try {
        const childNodes = Array.from(editor.childNodes);

        if (!childNodes.length) {
            const block = document.createElement('div');
            block.innerHTML = '<br>';
            decoratePisiEditorBlock(block);
            editor.appendChild(block);
            return;
        }

        for (const node of childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (!node.textContent.trim()) {
                    node.remove();
                    continue;
                }

                const block = document.createElement('div');
                block.textContent = node.textContent;
                decoratePisiEditorBlock(block);
                node.replaceWith(block);
                continue;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'BR') {
                    const block = document.createElement('div');
                    block.innerHTML = '<br>';
                    decoratePisiEditorBlock(block);
                    node.replaceWith(block);
                    continue;
                }

                if (isPisiEditorBlockElement(node)) {
                    decoratePisiEditorBlock(node);
                }
            }
        }
    } finally {
        if (selectionSnapshot) {
            restorePisiEditorSelection(editor, selectionSnapshot);
        }
    }
}

function getPisiBlockElementsFromContainer(container) {
    if (!container) return [];

    return Array.from(container.children).filter((element) => {
        return isPisiEditorBlockElement(element);
    });
}

function createPisiInertHtmlTemplate(html = '') {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    return template;
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
        index: [],
        missionIndex: [],
        showCompletedMissions: false
    };

    if (typeof closePisiTagMenu === 'function') {
        closePisiTagMenu();
    }

    renderPisiTagsPanel();
    renderPisiMissionsPanel();
}

async function refreshPisiTagsPanel() {
    try {
        const index = await buildPisiTagBlockIndex();

        pisiTagsPanelState.index = Array.isArray(index) ? index : [];

        const missionsPageIsActive = document
            .getElementById('right-tab-missions')
            ?.classList
            .contains('active');

        if (
            missionsPageIsActive ||
            !Array.isArray(pisiTagsPanelState.missionIndex)
        ) {
            const missionIndexResult = await buildPisiMissionBlockIndex();
            pisiTagsPanelState.missionIndex = Array.isArray(
                missionIndexResult?.blocks
            )
                ? missionIndexResult.blocks
                : [];
            pisiTagsPanelState.missionIndexComplete =
                missionIndexResult?.complete === true;

            if (
                typeof syncPisiDiaryFromMissionIndex === 'function' &&
                pisiTagsPanelState.missionIndexComplete
            ) {
                await syncPisiDiaryFromMissionIndex(
                    pisiTagsPanelState.missionIndex,
                    { complete: true }
                );
            } else if (!pisiTagsPanelState.missionIndexComplete) {
                console.warn(
                    '[PISI] Görev indeksi eksik kaldığı için diary eşitlemesi yapılmadı:',
                    missionIndexResult?.errors || []
                );
            }
        }

        renderPisiTagsPanel();

        if (typeof renderPisiMissionsPanel === 'function') {
            renderPisiMissionsPanel();
        }
    } catch (error) {
        console.error('[PISI] Tags/Missions refresh hatası:', error);
    }
}

function normalizeClientPathForTags(filePath) {
    const normalized = String(filePath || '')
        .replace(/[\\/]+/g, '/');

    return window.pisiEnvironment?.platform === 'win32'
        ? normalized.toLowerCase()
        : normalized;
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

    if (
        activeMapPath &&
        samePisiPathForTags(activeMapPath, mapPath) &&
        Array.isArray(activeMapNodes) &&
        activeMapNodes.length
    ) {
        return activeMapNodes;
    }

    const result = await window.pisiProject?.listMapNodes?.(mapPath);

    if (!result?.ok) {
        return [];
    }

    return Array.isArray(result.nodes) ? result.nodes : [];
}

async function collectPisiDiaryTagNodeItems() {
    const projectFolder = window.currentProjectFolder;

    if (!projectFolder || !window.pisiProject?.listDiaryDates) {
        return [];
    }

    const datesResult = await window.pisiProject.listDiaryDates(projectFolder);
    const dates = Array.isArray(datesResult?.dates) ? datesResult.dates : [];
    const nodes = [];

    for (const date of dates) {
        const result = await window.pisiProject?.getOrCreateDiaryNode?.(projectFolder, date);

        if (!result?.ok || !result.fullPath) continue;

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

    const fallbackTitle =
        node.metadata?.title ||
        node.displayName ||
        node.fileName ||
        node.name ||
        'Node';

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

    if (
        !samePisiPathForTags(activeCenterNode?.path, nodePath) &&
        !samePisiPathForTags(activeModalNode?.path, nodePath)
    ) {
        await persistPisiAssignedBlockIds({
            nodePath,
            detailed,
            originalHtml: html
        });
    }

    return detailed.blocks.map((block) => ({
        ...block,
        fileName: node.fileName || node.name || '',
        isDiaryNode: Boolean(node.isDiaryNode)
    }));
}

function isPisiMissionNodeFileName(fileName = '') {
    return String(fileName || '').toLowerCase().endsWith('.node');
}

function isPisiMissionMapFileName(fileName = '') {
    return String(fileName || '').toLowerCase().endsWith('.map');
}

function makePisiMissionNodeItem(item) {
    if (!item?.fullPath) return null;

    return {
        name: item.name || item.fileName || '',
        fileName: item.fileName || item.name || '',
        fullPath: item.fullPath,
        type: 'file',
        isDirectory: false,
        isFile: true,
        metadata: item.metadata || null,
        displayName:
            item.displayName ||
            item.metadata?.title ||
            String(item.fileName || item.name || '').replace(/\.node$/i, '') ||
            'Node'
    };
}

async function collectPisiMissionNodeItemsFromFolder(
    folderPath,
    seenPaths = new Set(),
    scanState = { complete: true, errors: [] }
) {
    const nodes = [];

    if (!folderPath) return nodes;

    const result = await window.pisiProject?.listFolder?.(folderPath);

    if (!result?.ok || !Array.isArray(result.items)) {
        scanState.complete = false;
        scanState.errors.push(
            result?.error || `Klasör listelenemedi: ${folderPath}`
        );
        return nodes;
    }

    for (const item of result.items) {
        if (item?.isDirectory) {
            nodes.push(
                ...(await collectPisiMissionNodeItemsFromFolder(
                    item.fullPath,
                    seenPaths,
                    scanState
                ))
            );
            continue;
        }

        if (!item?.isFile || !item.fullPath) continue;

        if (isPisiMissionNodeFileName(item.name || item.fileName)) {
            const nodeItem = makePisiMissionNodeItem(item);
            const normalizedNodePath = normalizeClientPathForTags(
                nodeItem?.fullPath
            );

            if (nodeItem && !seenPaths.has(normalizedNodePath)) {
                seenPaths.add(normalizedNodePath);
                nodes.push(nodeItem);
            }

            continue;
        }

        if (isPisiMissionMapFileName(item.name || item.fileName)) {
            const mapNodesResult = await window.pisiProject?.listMapNodes?.(
                item.fullPath
            );

            const mapNodes = Array.isArray(mapNodesResult?.nodes)
                ? mapNodesResult.nodes
                : [];

            if (!mapNodesResult?.ok) {
                scanState.complete = false;
                scanState.errors.push(
                    mapNodesResult?.error ||
                    `Map node listesi okunamadı: ${item.fullPath}`
                );
            }

            for (const mapNode of mapNodes) {
                const nodeItem = makePisiMissionNodeItem(mapNode);
                const normalizedNodePath = normalizeClientPathForTags(
                    nodeItem?.fullPath
                );

                if (nodeItem && !seenPaths.has(normalizedNodePath)) {
                    seenPaths.add(normalizedNodePath);
                    nodes.push(nodeItem);
                }
            }
        }
    }

    return nodes;
}

async function buildPisiMissionBlockIndex() {
    const results = [];
    const projectFolder = window.currentProjectFolder;
    const scanState = {
        complete: true,
        errors: []
    };

    if (!projectFolder) {
        return {
            blocks: results,
            complete: false,
            errors: ['Aktif proje klasörü yok.']
        };
    }

    const nodeItems = await collectPisiMissionNodeItemsFromFolder(
        projectFolder,
        new Set(),
        scanState
    );

    for (const node of nodeItems) {
        const nodePath = node.fullPath;

        if (!nodePath) continue;

        if (samePisiPathForTags(activeCenterNode?.path, nodePath)) {
            const editor = document.getElementById('center-node-editor-content');

            ensurePisiEditorBlocks(editor);

            results.push(...extractPisiTagBlocksFromHtml({
                html: editor?.innerHTML || '',
                nodePath,
                nodeTitle:
                    activeCenterNode.metadata?.title ||
                    node.metadata?.title ||
                    node.displayName ||
                    node.fileName ||
                    node.name ||
                    'Node'
            }));

            continue;
        }

        if (samePisiPathForTags(activeModalNode?.path, nodePath)) {
            const editor = document.getElementById('node-modal-content');

            ensurePisiEditorBlocks(editor);

            results.push(...extractPisiTagBlocksFromHtml({
                html: editor?.innerHTML || '',
                nodePath,
                nodeTitle:
                    activeModalNode.metadata?.title ||
                    node.metadata?.title ||
                    node.displayName ||
                    node.fileName ||
                    node.name ||
                    'Node'
            }));

            continue;
        }

        const doc = await window.pisiProject?.getPisiDocument?.(nodePath);

        if (!doc?.ok) {
            scanState.complete = false;
            scanState.errors.push(
                doc?.error || `Node okunamadı: ${nodePath}`
            );
            continue;
        }

        const originalHtml = doc.data?.content || '';
        const detailed = extractPisiTagBlocksFromHtmlDetailed({
            html: originalHtml,
            nodePath,
            nodeTitle:
                doc.metadata?.title ||
                node.metadata?.title ||
                node.displayName ||
                node.fileName ||
                node.name ||
                'Node'
        });

        results.push(...detailed.blocks);
        const idsPersisted = await persistPisiAssignedBlockIds({
            nodePath,
            detailed,
            originalHtml
        });

        if (!idsPersisted) {
            scanState.complete = false;
            scanState.errors.push(
                `Block kimlikleri kaydedilemedi: ${nodePath}`
            );
        }
    }

    return {
        blocks: results,
        complete: scanState.complete,
        errors: scanState.errors
    };
}

async function buildPisiTagBlockIndex() {
    const results = [];
    const seenPaths = new Set();

    // Tags paneli aktif map'i ve günlük notları birlikte tarar.
    // activeMapPath boşsa aktif tab üzerinden map yolunu bulur.
    const mapPath = getPisiTagsActiveMapPath();
    const mapNodes = await getPisiTagsActiveMapNodes(mapPath);
    const diaryNodes = await collectPisiDiaryTagNodeItems();
    const standaloneNode = (
        activeCenterNode?.path &&
        (!mapPath || !Array.isArray(mapNodes) || !mapNodes.some((node) => {
            return samePisiPathForTags(node?.fullPath, activeCenterNode.path);
        }))
    )
        ? [{
            ...(activeCenterNode.item || {}),
            fullPath: activeCenterNode.path,
            metadata: activeCenterNode.metadata || activeCenterNode.item?.metadata || {},
            isFile: true,
            isDirectory: false,
            type: 'file'
        }]
        : [];

    const allNodes = [
        ...(Array.isArray(mapNodes) ? mapNodes : []),
        ...(Array.isArray(diaryNodes) ? diaryNodes : []),
        ...standaloneNode
    ];

    for (const node of allNodes) {
        if (!node?.fullPath) continue;

        const normalizedPath = normalizeClientPathForTags(node.fullPath);
        if (seenPaths.has(normalizedPath)) continue;
        seenPaths.add(normalizedPath);

        results.push(...(await extractPisiTagBlocksForNodeItem(node)));
    }

    return results;
}

function extractPisiTagBlocksFromHtmlDetailed({ html, nodePath, nodeTitle }) {
    const template = createPisiInertHtmlTemplate(html);
    const container = template.content;

    const blocks = getPisiBlockElementsFromContainer(container);
    const results = [];
    let assignedMissingBlockId = false;

    for (const block of blocks) {
        if (
            block.classList.contains('pisi-diary-managed-block') ||
            block.closest('.pisi-diary-managed-block')
        ) {
            continue;
        }

        if (!block.dataset.pisiBlockId) {
            assignedMissingBlockId = true;
        }

        decoratePisiEditorBlock(block);

        const tags = Array.from(new Set(extractPisiTagsFromBlock(block)));
        const doneTagElements = Array.from(
            block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')
        );
        const doneFor = doneTagElements
            .filter((tagEl) => {
                return normalizePisiUserTag(
                    tagEl.dataset.pisiTag || tagEl.textContent || ''
                ) === 'done' && Boolean(tagEl.dataset.pisiDoneFor);
            })
            .map((tagEl) => {
                return normalizePisiUserTag(
                    tagEl.dataset.pisiDoneFor || ''
                );
            })
            .filter(Boolean);

        if (!tags.length) continue;

        const text = block.textContent
            .replace(/\s+/g, ' ')
            .trim();

        results.push({
            blockId: block.dataset.pisiBlockId,
            nodePath,
            nodeTitle,
            tags,
            doneFor: Array.from(new Set(doneFor)),
            legacyDone: doneTagElements.some((tagEl) => {
                return (
                    normalizePisiUserTag(
                        tagEl.dataset.pisiTag || tagEl.textContent || ''
                    ) === 'done' &&
                    !tagEl.dataset.pisiDoneFor
                );
            }),
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

async function persistPisiAssignedBlockIds({
    nodePath,
    detailed,
    originalHtml
}) {
    if (!detailed?.assignedMissingBlockId || !nodePath) {
        return true;
    }

    if (
        samePisiPathForTags(activeCenterNode?.path, nodePath) ||
        samePisiPathForTags(activeModalNode?.path, nodePath)
    ) {
        return true;
    }

    const normalizedOriginal = String(originalHtml || '');
    if (detailed.html === normalizedOriginal) {
        return true;
    }

    const result = await window.pisiProject?.saveNodeContent?.(
        nodePath,
        detailed.html
    );

    if (!result?.ok) {
        console.warn(
            `[PISI] Block kimlikleri kalıcılaştırılamadı (${nodePath}):`,
            result?.error || 'Bilinmeyen kayıt hatası'
        );
        return false;
    }

    return true;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "bindPisiBlockIndexControls": {
        enumerable: true,
        get() { return bindPisiBlockIndexControls; }
    },
    "bindPisiTagPickerOutsideClose": {
        enumerable: true,
        get() { return bindPisiTagPickerOutsideClose; }
    },
    "makePisiBlockId": {
        enumerable: true,
        get() { return makePisiBlockId; }
    },
    "isPisiEditorBlockElement": {
        enumerable: true,
        get() { return isPisiEditorBlockElement; }
    },
    "decoratePisiEditorBlock": {
        enumerable: true,
        get() { return decoratePisiEditorBlock; }
    },
    "ensurePisiEditorBlocks": {
        enumerable: true,
        get() { return ensurePisiEditorBlocks; }
    },
    "getPisiBlockElementsFromContainer": {
        enumerable: true,
        get() { return getPisiBlockElementsFromContainer; }
    },
    "createPisiInertHtmlTemplate": {
        enumerable: true,
        get() { return createPisiInertHtmlTemplate; }
    },
    "extractPisiTagsFromBlock": {
        enumerable: true,
        get() { return extractPisiTagsFromBlock; }
    },
    "refreshPisiTagsPanelSoon": {
        enumerable: true,
        get() { return refreshPisiTagsPanelSoon; }
    },
    "resetPisiTagsForProject": {
        enumerable: true,
        get() { return resetPisiTagsForProject; }
    },
    "refreshPisiTagsPanel": {
        enumerable: true,
        get() { return refreshPisiTagsPanel; }
    },
    "normalizeClientPathForTags": {
        enumerable: true,
        get() { return normalizeClientPathForTags; }
    },
    "samePisiPathForTags": {
        enumerable: true,
        get() { return samePisiPathForTags; }
    },
    "getPisiTagsActiveMapPath": {
        enumerable: true,
        get() { return getPisiTagsActiveMapPath; }
    },
    "getPisiTagsActiveMapNodes": {
        enumerable: true,
        get() { return getPisiTagsActiveMapNodes; }
    },
    "collectPisiDiaryTagNodeItems": {
        enumerable: true,
        get() { return collectPisiDiaryTagNodeItems; }
    },
    "extractPisiTagBlocksForNodeItem": {
        enumerable: true,
        get() { return extractPisiTagBlocksForNodeItem; }
    },
    "isPisiMissionNodeFileName": {
        enumerable: true,
        get() { return isPisiMissionNodeFileName; }
    },
    "isPisiMissionMapFileName": {
        enumerable: true,
        get() { return isPisiMissionMapFileName; }
    },
    "makePisiMissionNodeItem": {
        enumerable: true,
        get() { return makePisiMissionNodeItem; }
    },
    "collectPisiMissionNodeItemsFromFolder": {
        enumerable: true,
        get() { return collectPisiMissionNodeItemsFromFolder; }
    },
    "buildPisiMissionBlockIndex": {
        enumerable: true,
        get() { return buildPisiMissionBlockIndex; }
    },
    "buildPisiTagBlockIndex": {
        enumerable: true,
        get() { return buildPisiTagBlockIndex; }
    },
    "extractPisiTagBlocksFromHtmlDetailed": {
        enumerable: true,
        get() { return extractPisiTagBlocksFromHtmlDetailed; }
    },
    "extractPisiTagBlocksFromHtml": {
        enumerable: true,
        get() { return extractPisiTagBlocksFromHtml; }
    },
    "persistPisiAssignedBlockIds": {
        enumerable: true,
        get() { return persistPisiAssignedBlockIds; }
    }
});
registerModule("tags.index", moduleApi);
