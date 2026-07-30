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

function ensurePisiEditorBlocks(editor) {
    if (!editor) return;

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

function ensurePisiTagsPanelDom() {
    const panel = document.getElementById('pisi-tags-panel');

    if (!panel) return null;

    let pickerButton = document.getElementById('pisi-tag-picker-button');
    let pickerMenu = document.getElementById('pisi-tag-picker-menu');
    let resultsEl = document.getElementById('pisi-tag-block-results');

    if (!pickerButton || !pickerMenu || !resultsEl) {
        panel.innerHTML = `
            <div class="pisi-tag-picker">
                <button id="pisi-tag-picker-button" type="button">
                    Choose tag
                </button>

                <div
                    id="pisi-tag-picker-menu"
                    class="pisi-tag-picker-menu"
                    hidden
                ></div>
            </div>

            <div id="pisi-tag-block-results" class="pisi-tag-block-results"></div>
        `;

        pickerButton = document.getElementById('pisi-tag-picker-button');
        pickerMenu = document.getElementById('pisi-tag-picker-menu');
        resultsEl = document.getElementById('pisi-tag-block-results');
    }

    if (!pickerButton || !pickerMenu || !resultsEl) return null;

    return {
        pickerButton,
        pickerMenu,
        resultsEl
    };
}

function renderPisiTagsPanel() {
    const dom = ensurePisiTagsPanelDom();

    if (!dom) {
        console.error('[PISI] Tags panel DOM bulunamadı.');
        return;
    }

    const {
        pickerButton,
        pickerMenu,
        resultsEl
    } = dom;

    const index = Array.isArray(pisiTagsPanelState.index)
        ? pisiTagsPanelState.index
        : [];

    const counts = new Map();

for (const block of index) {
    const blockTags = Array.isArray(block.tags) ? block.tags : [];

    for (const tag of blockTags) {
        const normalizedTag = normalizePisiUserTag(tag);

        // Missions'a özel ..todo.priority.finishdate etiketleri
        // Tags sekmesinde listelenmesin.
        if (parsePisiTodoTag(normalizedTag)) {
            continue;
        }

        counts.set(normalizedTag, (counts.get(normalizedTag) || 0) + 1);
    }
}

const tags = Array.from(counts.keys()).sort((a, b) => {
    return a.localeCompare(b, 'tr');
});

    if (!tags.length) {
        pisiTagsPanelState.selectedTag = null;
        pisiTagsPanelState.dropdownOpen = false;

        pickerButton.disabled = true;
        pickerButton.textContent = 'Choose tag';
        pickerMenu.hidden = true;
        pickerMenu.innerHTML = '';

        resultsEl.innerHTML = `
            <div class="right-panel-empty">
                Bu map veya günlük notlar içinde kullanıcı etiketi içeren blok yok.
            </div>
        `;

        return;
    }

    if (
        pisiTagsPanelState.selectedTag &&
        !counts.has(pisiTagsPanelState.selectedTag)
    ) {
        pisiTagsPanelState.selectedTag = null;
    }

    const selectedTag = pisiTagsPanelState.selectedTag || tags[0];

    pisiTagsPanelState.selectedTag = selectedTag;

    pickerButton.disabled = false;
    pickerButton.textContent = `#${selectedTag} (${counts.get(selectedTag)})`;
    pickerButton.setAttribute(
        'aria-expanded',
        pisiTagsPanelState.dropdownOpen ? 'true' : 'false'
    );

    pickerButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        pisiTagsPanelState.dropdownOpen = !pisiTagsPanelState.dropdownOpen;
        renderPisiTagsPanel();
    };

    pickerMenu.hidden = !pisiTagsPanelState.dropdownOpen;
    pickerMenu.innerHTML = '';

    for (const tag of tags) {
        const option = document.createElement('button');

        option.type = 'button';
        option.className = 'pisi-tag-picker-option';
        option.classList.toggle('active', tag === selectedTag);

        option.innerHTML = `
            <span class="pisi-tag-picker-name">#${escapeHtml(tag)}</span>
            <span class="pisi-tag-picker-count">${counts.get(tag)}</span>
        `;

        option.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            pisiTagsPanelState.selectedTag = tag;
            pisiTagsPanelState.dropdownOpen = false;

            renderPisiTagsPanel();
        });

        pickerMenu.appendChild(option);
    }

   const matchingBlocks = index.filter((block) => {
    return Array.isArray(block.tags) &&
        block.tags.some((tag) => {
            return normalizePisiUserTag(tag) === selectedTag;
        });
    });

    resultsEl.innerHTML = '';

    for (const block of matchingBlocks) {
        const card = document.createElement('button');

        card.type = 'button';
        card.className = 'pisi-tag-result-card';

        card.innerHTML = `
            <div class="pisi-tag-result-node">
                ${escapeHtml(block.nodeTitle || 'Node')}
            </div>

            <div class="pisi-tag-result-text">
                ${escapeHtml(block.text || '(boş blok)')}
            </div>
        `;

        card.addEventListener('click', async () => {
            await openPisiTagBlockResult(block);
        });

        resultsEl.appendChild(card);
    }
}

function parsePisiTodoTag(tag) {
    const normalized = normalizePisiUserTag(tag);

    const match = normalized.match(
        /^todo\.([1-9])\.(\d{2})-(\d{2})-(\d{2}|\d{4})$/
    );

    if (!match) return null;

    const priority = Number(match[1]);
    const day = Number(match[2]);
    const month = Number(match[3]);
    const year = match[4].length === 2
        ? 2000 + Number(match[4])
        : Number(match[4]);

    const finishDate = new Date(year, month - 1, day);

    if (
        finishDate.getFullYear() !== year ||
        finishDate.getMonth() !== month - 1 ||
        finishDate.getDate() !== day
    ) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    finishDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.floor(
        (finishDate.getTime() - today.getTime()) / 86400000
    );

    const workorder = daysLeft / priority;

    return {
        tag: normalized,
        priority,
        finishDate,
        daysLeft,
        workorder
    };
}

function formatPisiMissionDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());

    return `${day}-${month}-${year}`;
}

function getPisiMissionsFromIndex(options = {}) {
    const missions = [];
    const includeCompleted = options.includeCompleted === true;

    const sourceIndex = Array.isArray(pisiTagsPanelState.missionIndex)
        ? pisiTagsPanelState.missionIndex
        : [];

    for (const block of sourceIndex) {
        const tags = Array.isArray(block.tags) ? block.tags : [];
        const doneFor = new Set(
            Array.isArray(block.doneFor)
                ? block.doneFor.map(normalizePisiUserTag)
                : []
        );

        const hasLegacyDone = block.legacyDone === true;

        for (const tag of tags) {
            const todo = parsePisiTodoTag(tag);

            if (!todo) continue;
            const completed = hasLegacyDone || doneFor.has(todo.tag);
            if (completed && !includeCompleted) continue;

            missions.push({
                ...block,
                todoTag: todo.tag,
                priority: todo.priority,
                finishDate: todo.finishDate,
                daysLeft: todo.daysLeft,
                workorder: todo.workorder,
                completed
            });
        }
    }

    missions.sort((a, b) => {
        if (a.workorder !== b.workorder) {
            return a.workorder - b.workorder;
        }

        if (a.finishDate.getTime() !== b.finishDate.getTime()) {
            return a.finishDate.getTime() - b.finishDate.getTime();
        }

        return b.priority - a.priority;
    });

    return missions;
}

function escapePisiMissionRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPisiMissionDisplayText(mission) {
    let text = String(mission?.text || '')
        .replace(/\s+/g, ' ')
        .trim();

    const todoTag = String(mission?.todoTag || '').trim();

    if (todoTag) {
        const todoTagPattern = new RegExp(
            `(^|\\s)(?:#|\\.\\.)?${escapePisiMissionRegExp(todoTag)}(?=\\s|$)`,
            'gi'
        );

        text = text.replace(todoTagPattern, ' ');
    }

    text = text.replace(
        /(^|\s)(?:#|\.\.)?todo\.[1-9]\.\d{2}-\d{2}-(?:\d{2}|\d{4})(?=\s|$)/gi,
        ' '
    );

    return text
        .replace(/\s+/g, ' ')
        .trim();
}

function renderPisiMissionsPanel() {
    const panelEl = document.getElementById('pisi-missions-panel');
    const listEl = document.getElementById('pisi-missions-list');

    if (!panelEl || !listEl) return;

    let toolbarEl = panelEl.querySelector('.pisi-missions-toolbar');
    if (!toolbarEl) {
        toolbarEl = document.createElement('div');
        toolbarEl.className = 'pisi-missions-toolbar';
        panelEl.insertBefore(toolbarEl, listEl);
    }

    if (!window.currentProjectFolder) {
    toolbarEl.innerHTML = '';
    listEl.innerHTML = `
        <div class="right-panel-empty">
            Missions için önce bir proje klasörü seç.
        </div>
    `;
    return;
}

    const allMissions = getPisiMissionsFromIndex({
        includeCompleted: true
    });
    const completedCount = allMissions.filter((mission) => {
        return mission.completed;
    }).length;
    const showCompleted = pisiTagsPanelState.showCompletedMissions === true;
    const missions = showCompleted
        ? allMissions
        : allMissions.filter((mission) => !mission.completed);

    toolbarEl.innerHTML = '';
    const completedToggle = document.createElement('button');
    completedToggle.type = 'button';
    completedToggle.className = 'pisi-missions-completed-toggle';
    completedToggle.setAttribute('aria-pressed', showCompleted ? 'true' : 'false');
    completedToggle.textContent = showCompleted
        ? `Tamamlananları gizle (${completedCount})`
        : `Tamamlananları göster (${completedCount})`;
    completedToggle.disabled = completedCount === 0;
    completedToggle.addEventListener('click', () => {
        pisiTagsPanelState.showCompletedMissions = !showCompleted;
        renderPisiMissionsPanel();
    });
    toolbarEl.appendChild(completedToggle);

    if (!missions.length) {
        listEl.innerHTML = `
            <div class="right-panel-empty">
                ${showCompleted
                    ? 'Bu projede görev yok.'
                    : 'Bu projede açık görev yok.'}
            </div>
        `;
        return;
    }

    listEl.innerHTML = '';

    for (const mission of missions) {
        const item = document.createElement('div');
        item.className = 'pisi-mission-card';
        item.classList.toggle('completed', mission.completed === true);

        const isLate = mission.daysLeft < 0;

        item.innerHTML = `
            <label class="pisi-mission-check-wrap" title="Tamamlandı olarak işaretle">
                <input class="pisi-mission-check" type="checkbox">
            </label>

            <button class="pisi-mission-main" type="button">
                <div class="pisi-mission-top">
                </div>

                <div class="pisi-mission-text">
                    ${escapeHtml(getPisiMissionDisplayText(mission) || '(boş blok)')}
                </div>

                <div class="pisi-mission-meta">
                    <span class="${isLate ? 'late' : ''}">
                        ${formatPisiMissionDate(mission.finishDate)}
                    </span>
                    <span>workorder: ${mission.workorder.toFixed(2)}</span>
                </div>

                <div class="pisi-mission-node">
                    ${escapeHtml(mission.nodeTitle)}
                </div>
            </button>
        `;

        const checkbox = item.querySelector('.pisi-mission-check');
        const mainButton = item.querySelector('.pisi-mission-main');

        if (checkbox) {
            checkbox.checked = mission.completed === true;
            checkbox.title = mission.completed
                ? 'Görevi yeniden aç'
                : 'Tamamlandı olarak işaretle';
        }

        checkbox?.addEventListener('click', async (event) => {
    event.stopPropagation();

    checkbox.disabled = true;

    const result = checkbox.checked
        ? await markPisiMissionDone(mission)
        : await reopenPisiMission(mission);

    if (!result?.ok) {
        checkbox.checked = mission.completed === true;
        checkbox.disabled = false;
        alert(
            result?.error ||
            (mission.completed
                ? 'Görev yeniden açılamadı.'
                : 'Görev tamamlandı olarak işaretlenemedi.')
        );
        return;
    }

    refreshPisiTagsPanelSoon();
    });

        mainButton?.addEventListener('click', async () => {
            await openPisiTagBlockResult(mission);
        });

        listEl.appendChild(item);
    }
}

function normalizePisiBlockText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function createPisiDoneTagElement(todoTag) {
    const tagEl = document.createElement('span');
    const normalizedTodoTag = normalizePisiUserTag(todoTag);

    tagEl.className = 'pisi-user-tag';
    tagEl.dataset.pisiTag = 'done';
    if (normalizedTodoTag) {
        tagEl.dataset.pisiDoneFor = normalizedTodoTag;
    }
    tagEl.contentEditable = 'false';
    tagEl.textContent = 'done';

    return tagEl;
}

function blockHasPisiDoneTag(block, todoTag = null) {
    const normalizedTodoTag = normalizePisiUserTag(todoTag);

    return Array.from(block.querySelectorAll('.pisi-user-tag[data-pisi-tag]'))
        .some((tagEl) => {
            const isDone = normalizePisiUserTag(
                tagEl.dataset.pisiTag || tagEl.textContent || ''
            ) === 'done';

            if (!isDone) return false;
            if (!normalizedTodoTag) return true;

            const doneFor = normalizePisiUserTag(
                tagEl.dataset.pisiDoneFor || ''
            );

            return !doneFor || doneFor === normalizedTodoTag;
        });
}

function blockHasPisiTag(block, targetTag) {
    const normalizedTarget = normalizePisiUserTag(targetTag);

    return Array.from(block.querySelectorAll('.pisi-user-tag[data-pisi-tag]'))
        .some((tagEl) => {
            return normalizePisiUserTag(
                tagEl.dataset.pisiTag || tagEl.textContent || ''
            ) === normalizedTarget;
        });
}

function appendPisiDoneTagToBlock(block, todoTag) {
    if (!block || blockHasPisiDoneTag(block, todoTag)) return false;

    decoratePisiEditorBlock(block);

    block.appendChild(document.createTextNode(' '));
    block.appendChild(createPisiDoneTagElement(todoTag));
    block.appendChild(document.createTextNode(' '));

    return true;
}

function removePisiDoneTagFromBlock(block, todoTag) {
    if (!block) return false;

    const normalizedTodoTag = normalizePisiUserTag(todoTag);
    let removed = false;

    Array.from(
        block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')
    ).forEach((tagEl) => {
        const isDone = normalizePisiUserTag(
            tagEl.dataset.pisiTag || tagEl.textContent || ''
        ) === 'done';
        const doneFor = normalizePisiUserTag(
            tagEl.dataset.pisiDoneFor || ''
        );

        if (
            isDone &&
            (!doneFor || !normalizedTodoTag || doneFor === normalizedTodoTag)
        ) {
            tagEl.remove();
            removed = true;
        }
    });

    return removed;
}

function findPisiMissionBlockInContainer(container, mission) {
    if (!container || !mission) return null;

    ensurePisiEditorBlocks(container);

    const blocks = getPisiBlockElementsFromContainer(container);
    const targetTodoTag = normalizePisiUserTag(mission.todoTag);
    const targetText = normalizePisiBlockText(mission.text);

    let textFallback = null;
    let tagFallback = null;

    for (const block of blocks) {
        decoratePisiEditorBlock(block);

        const hasTodo = blockHasPisiTag(block, targetTodoTag);

        if (!hasTodo) continue;

        if (
            mission.blockId &&
            block.dataset.pisiBlockId === mission.blockId
        ) {
            return block;
        }

        if (
            !textFallback &&
            normalizePisiBlockText(block.textContent) === targetText
        ) {
            textFallback = block;
        }

        if (!tagFallback) {
            tagFallback = block;
        }
    }

    return textFallback || tagFallback;
}

function setPisiMissionCompletionInBlock(block, mission, completed) {
    if (!block) {
        return {
            changed: false,
            previousHtml: ''
        };
    }

    const previousHtml = block.innerHTML;
    const changed = completed
        ? appendPisiDoneTagToBlock(block, mission.todoTag)
        : removePisiDoneTagFromBlock(block, mission.todoTag);

    return {
        changed,
        previousHtml
    };
}

function rollbackPisiMissionBlock(block, previousHtml) {
    if (!block) return;

    block.innerHTML = previousHtml;

    if (typeof initializePisiAdvancedEditorContent === 'function') {
        initializePisiAdvancedEditorContent(block);
    }
}

async function setPisiMissionCompletion(mission, completed) {
    if (!mission?.nodePath) {
        return {
            ok: false,
            error: 'Görev node yolu bulunamadı.'
        };
    }

    try {
        // 1) Görev şu an center editor içindeyse DOM ve disk birlikte güncellenir.
        if (samePisiPathForTags(activeCenterNode?.path, mission.nodePath)) {
            const editor = document.getElementById('center-node-editor-content');

            const block = findPisiMissionBlockInContainer(editor, mission);

            if (!block) {
                return {
                    ok: false,
                    error: 'Görev bloğu center editor içinde bulunamadı.'
                };
            }

            const change = setPisiMissionCompletionInBlock(
                block,
                mission,
                completed
            );

            if (!change.changed) {
                return {
                    ok: true,
                    unchanged: true
                };
            }

            editor.dispatchEvent(new Event('input', {
                bubbles: true
            }));

            let saveSucceeded = false;
            let saveError = 'Node kaydedilemedi.';

            if (typeof saveCurrentCenterNodeEditor === 'function') {
                saveSucceeded = await saveCurrentCenterNodeEditor();
            } else {
                const saveResult = await window.pisiProject?.saveNodeContent?.(
                    mission.nodePath,
                    getPisiEditorContent(editor)
                );

                saveSucceeded = saveResult?.ok === true;
                saveError = saveResult?.error || saveError;
            }

            if (!saveSucceeded) {
                rollbackPisiMissionBlock(block, change.previousHtml);
                refreshPisiTagsPanelSoon();
                return {
                    ok: false,
                    error: saveError
                };
            }

            return { ok: true };
        }

        // 2) Görev modal içindeyse başarısız kayıtta DOM geri alınır.
        if (samePisiPathForTags(activeModalNode?.path, mission.nodePath)) {
            const editor = document.getElementById('node-modal-content');

            const block = findPisiMissionBlockInContainer(editor, mission);

            if (!block) {
                return {
                    ok: false,
                    error: 'Görev bloğu modal içinde bulunamadı.'
                };
            }

            const change = setPisiMissionCompletionInBlock(
                block,
                mission,
                completed
            );

            if (!change.changed) {
                return {
                    ok: true,
                    unchanged: true
                };
            }

            editor.dispatchEvent(new Event('input', {
                bubbles: true
            }));

            const saveResult = await window.pisiProject?.saveNodeContent?.(
                mission.nodePath,
                getPisiEditorContent(editor)
            );

            if (!saveResult?.ok) {
                rollbackPisiMissionBlock(block, change.previousHtml);
                refreshPisiTagsPanelSoon();
                return {
                    ok: false,
                    error: saveResult?.error || 'Node kaydedilemedi.'
                };
            }

            if (activeModalNode) {
                activeModalNode.dirty = false;
            }
            return { ok: true };
        }

        // 3) Görev kapalı node içindeyse dosyayı oku, HTML içinde bul, kaydet.
        const doc = await window.pisiProject?.getPisiDocument?.(mission.nodePath);

        if (!doc?.ok) {
            return {
                ok: false,
                error: doc?.error || 'Node okunamadı.'
            };
        }

        const template = createPisiInertHtmlTemplate(doc.data?.content || '');

        const block = findPisiMissionBlockInContainer(
            template.content,
            mission
        );

        if (!block) {
            return {
                ok: false,
                error: 'Görev bloğu node HTML içinde bulunamadı.'
            };
        }

        const change = setPisiMissionCompletionInBlock(
            block,
            mission,
            completed
        );

        if (!change.changed) {
            return {
                ok: true,
                unchanged: true
            };
        }

        const saveResult = await window.pisiProject?.saveNodeContent?.(
            mission.nodePath,
            template.innerHTML
        );

        if (!saveResult?.ok) {
            return {
                ok: false,
                error: saveResult?.error || 'Node kaydedilemedi.'
            };
        }

        return { ok: true };
    } catch (error) {
        console.error('[PISI] Mission durum işaretleme hatası:', error);

        return {
            ok: false,
            error:
                error.message ||
                (completed
                    ? 'Görev tamamlandı olarak işaretlenemedi.'
                    : 'Görev yeniden açılamadı.')
        };
    }
}

async function markPisiMissionDone(mission) {
    return setPisiMissionCompletion(mission, true);
}

async function reopenPisiMission(mission) {
    return setPisiMissionCompletion(mission, false);
}

async function openPisiTagBlockResult(block) {
    if (!block?.nodePath) return;

    const escapedPath = CSS.escape(block.nodePath);
    const box = document.querySelector(`.map-node-box[data-node-path="${escapedPath}"]`);

    if (box) {
    await openNodeModalFromBox(box);
} else if (typeof openPisiFileTab === 'function') {
    await openPisiFileTab({
        name: block.fileName || `${block.nodeTitle || 'Node'}.node`,
        fileName: block.fileName || `${block.nodeTitle || 'Node'}.node`,
        fullPath: block.nodePath,
        type: 'file',
        isDirectory: false,
        isFile: true,
        metadata: {
            type: 'node',
            title: block.nodeTitle || 'Node'
        }
    });
}

setTimeout(() => {
    highlightPisiEditorBlock(block.blockId);
}, 120);
}

function highlightPisiEditorBlock(blockId) {
    if (!blockId) return;

    const centerEditor = document.getElementById('center-node-editor-content');
    const modalEditor = document.getElementById('node-modal-content');

    const centerVisible =
        centerEditor &&
        !document.getElementById('center-node-editor')?.hidden;

    const editor = centerVisible ? centerEditor : modalEditor;

    if (!editor) return;

    editor.querySelectorAll('.pisi-block-highlight').forEach((block) => {
        block.classList.remove('pisi-block-highlight');
    });

    const block = editor.querySelector(
        `.pisi-editor-block[data-pisi-block-id="${CSS.escape(blockId)}"]`
    );

    if (!block) return;

    block.classList.add('pisi-block-highlight');
    block.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
    });

    setTimeout(() => {
        block.classList.remove('pisi-block-highlight');
    }, 2200);
}

const PISI_SYSTEM_TAGS = [
    { id: 'h2', label: 'h2', description: 'Heading 2', headingLevel: 2 },
    { id: 'h3', label: 'h3', description: 'Heading 3', headingLevel: 3 },
    { id: 'h4', label: 'h4', description: 'Heading 4', headingLevel: 4 },
    { id: 'h5', label: 'h5', description: 'Heading 5', headingLevel: 5 }
];

function bindPisiTagControls() {
    const menu = document.getElementById('pisi-tag-menu');

    if (!menu) return;

    const editors = [
        document.getElementById('node-modal-content'),
        document.getElementById('center-node-editor-content')
    ].filter(Boolean);

    for (const editor of editors) {
        bindPisiTagControlsForEditor(editor);
    }

    if (document.body.dataset.pisiTagOutsideBound === '1') return;

    document.body.dataset.pisiTagOutsideBound = '1';

    document.addEventListener('mousedown', (event) => {
        if (!pisiTagMenuState.active) return;

        const activeEditor = pisiTagMenuState.editor;

        if (
            event.target.closest('#pisi-tag-menu') ||
            event.target === activeEditor ||
            activeEditor?.contains(event.target)
        ) {
            return;
        }

        closePisiTagMenu();
    });
}

function bindPisiTagControlsForEditor(editor) {
    if (!editor) return;
    if (editor.dataset.pisiTagsBound === '1') return;

    editor.dataset.pisiTagsBound = '1';

    editor.addEventListener('input', () => {
        ensurePisiEditorBlocks(editor);
        collectPisiUserTagsFromEditor(editor);
        updatePisiTagMenuForEditor(editor, true);
        refreshPisiTagsPanelSoon();
    });

    editor.addEventListener('keyup', (event) => {
        if (
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            event.key === 'Enter' ||
            event.key === 'Tab' ||
            event.key === 'Escape' ||
            event.key === ' '
        ) {
            return;
        }

        updatePisiTagMenuForEditor(editor, false);
    });

    editor.addEventListener('keydown', (event) => {
        // Kullanıcı tagı boşlukla biter.
        // Örnek: ..hayvan[space] => mavi tag chip.
        if (event.key === ' ') {
            const command = getPisiEditorCommandAtCaret(editor);

            if (command && command.body && !getExactPisiSystemTag(command.body)) {
                event.preventDefault();
                applyPisiUserTagToEditor(editor, command.body, command);
                return;
            }
        }

        if (!pisiTagMenuState.active) return;
        if (pisiTagMenuState.editor !== editor) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            movePisiTagSelection(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            movePisiTagSelection(-1);
            return;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();

            const selectedItem = pisiTagMenuState.items[pisiTagMenuState.selectedIndex];

            if (selectedItem) {
                applyPisiTagMenuItem(editor, selectedItem);
            }

            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closePisiTagMenu();
        }
    });

    editor.addEventListener('click', () => {
        updatePisiTagMenuForEditor(editor, false);
    });
}

function updatePisiTagMenuForEditor(editor, allowExactTransform) {
    const command = getPisiEditorCommandAtCaret(editor);

    if (!command) {
        closePisiTagMenu();
        return;
    }

    const exactSystem = getExactPisiSystemTag(command.body);

    if (allowExactTransform && exactSystem) {
        applyPisiSystemTagToEditor(editor, exactSystem, command);
        return;
    }

    const items = buildPisiTagMenuItems(command);

    if (!items.length) {
        closePisiTagMenu();
        return;
    }

    openPisiTagMenuForEditor(editor, {
        ...command,
        items
    });
}

function getPisiEditorCommandAtCaret(editor) {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return null;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.startContainer)) {
        return null;
    }

    const block = getPisiCurrentEditorBlock(editor, range.startContainer);

    if (!block) return null;

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(block);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const beforeText = beforeRange.toString();

    const tagChars = 'A-Za-z0-9ğüşöçıİĞÜŞÖÇ_-';
    const commandRegex = new RegExp(
        `(^|\\s)((?:\\.\\.|/)[${tagChars}]*(?:\\.[${tagChars}]*)*)$`
    );

    const match = beforeText.match(commandRegex);

    if (!match) return null;

    const token = match[2];
    const trigger = token.startsWith('..') ? '..' : '/';
    const body = trigger === '..' ? token.slice(2) : token.slice(1);

    return {
        editor,
        block,
        range,
        token,
        trigger,
        body,
        tokenStartInText: beforeText.length - token.length,
        tokenEndInText: beforeText.length
    };
}

function buildPisiTagMenuItems(command) {
    const body = normalizePisiUserTag(command.body);
    const lowerBody = body.toLowerCase();
    const items = [];

    const systemItems = PISI_SYSTEM_TAGS
        .filter((item) => {
            if (body.includes('.')) return false;
            return item.label.toLowerCase().startsWith(lowerBody);
        })
        .map((item) => ({
            kind: 'system',
            id: item.id,
            label: item.label,
            typedToken: `${command.trigger}${item.label}`,
            description: item.description,
            headingLevel: item.headingLevel
        }));

    items.push(...systemItems);

    const userItems = collectPisiUserTagSuggestions(command.editor)
        .filter((tag) => {
            if (!body) return true;
            return tag.toLowerCase().startsWith(lowerBody);
        })
        .map((tag) => ({
            kind: 'user',
            id: tag,
            label: tag,
            typedToken: `${command.trigger}${tag}`,
            description: 'Kullanıcı etiketi'
        }));

    items.push(...userItems);

    const existsAsUser = userItems.some((item) => {
        return item.label.toLowerCase() === lowerBody;
    });

    const existsAsSystem = systemItems.some((item) => {
        return item.label.toLowerCase() === lowerBody;
    });

    if (body && !existsAsUser && !existsAsSystem && isValidPisiUserTag(body)) {
        items.unshift({
            kind: 'new-user',
            id: body,
            label: body,
            typedToken: `${command.trigger}${body}`,
            description: 'Yeni kullanıcı etiketi'
        });
    }

    return items;
}

function getExactPisiSystemTag(body) {
    const normalized = String(body || '').toLowerCase();

    if (normalized.includes('.')) return null;

    return PISI_SYSTEM_TAGS.find((item) => {
        return item.label.toLowerCase() === normalized;
    }) || null;
}

function collectPisiUserTagsFromEditor(editor) {
    if (!editor) return;

    editor.querySelectorAll('.pisi-user-tag[data-pisi-tag]').forEach((tagEl) => {
        const tag = normalizePisiUserTag(
            tagEl.dataset.pisiTag || tagEl.textContent || ''
        );

        if (tag) {
            PISI_USER_TAG_CACHE.add(tag);
        }
    });
}

function collectPisiUserTagSuggestions(editor) {
    collectPisiUserTagsFromEditor(editor);

    return Array.from(PISI_USER_TAG_CACHE).sort((a, b) => {
        return a.localeCompare(b, 'tr');
    });
}

function openPisiTagMenuForEditor(editor, command) {
    const menu = document.getElementById('pisi-tag-menu');
    if (!menu) return;

    pisiTagMenuState = {
        active: true,
        editor,
        command,
        selectedIndex: 0,
        items: command.items
    };

    menu.innerHTML = '';

    command.items.forEach((item, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `pisi-tag-option ${item.kind}`;

        if (index === 0) {
            option.classList.add('active');
        }

        option.innerHTML = `
            <span class="pisi-tag-option-code">${pisiEscapeHtml(item.typedToken)}</span>
            <span class="pisi-tag-option-desc">${pisiEscapeHtml(item.description)}</span>
        `;

        option.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            pisiTagMenuState.selectedIndex = index;
            applyPisiTagMenuItem(editor, item);
        });

        menu.appendChild(option);
    });

    menu.hidden = false;
    positionPisiTagMenuAtSelection();
}

function applyPisiTagMenuItem(editor, item) {
    if (!item) return;

    if (item.kind === 'system') {
        applyPisiSystemTagToEditor(editor, item);
        return;
    }

    applyPisiUserTagToEditor(editor, item.label);
}

function closePisiTagMenu() {
    const menu = document.getElementById('pisi-tag-menu');

    if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
    }

    pisiTagMenuState = {
        active: false,
        editor: null,
        command: null,
        selectedIndex: 0,
        items: []
    };
}

function movePisiTagSelection(delta) {
    if (!pisiTagMenuState.active || !pisiTagMenuState.items.length) return;

    const count = pisiTagMenuState.items.length;

    pisiTagMenuState.selectedIndex =
        (pisiTagMenuState.selectedIndex + delta + count) % count;

    const menu = document.getElementById('pisi-tag-menu');

    menu?.querySelectorAll('.pisi-tag-option').forEach((option, index) => {
        option.classList.toggle(
            'active',
            index === pisiTagMenuState.selectedIndex
        );
    });
}

function applyPisiSystemTagToEditor(editor, item, commandOverride = null) {
    const command = commandOverride || pisiTagMenuState.command;

    if (!command || !item?.headingLevel) return;

    applyPisiHeadingTagToEditor(editor, item.headingLevel, command);
    closePisiTagMenu();

    editor.focus();

    editor.dispatchEvent(new Event('input', {
        bubbles: true
    }));
}

function applyPisiHeadingTagToEditor(editor, headingLevel, command) {
    const block = command.block;
    const fullText = block.textContent || '';

    const beforeToken = fullText.slice(0, command.tokenStartInText);
    const afterToken = fullText.slice(command.tokenEndInText);

    const cleanText = `${beforeToken}${afterToken}`
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .trim();

    const heading = document.createElement(`h${headingLevel}`);

    if (cleanText) {
        heading.textContent = cleanText;
    } else {
        heading.innerHTML = '<br>';
    }

    if (block === editor) {
        editor.innerHTML = '';
        editor.appendChild(heading);
    } else {
        block.replaceWith(heading);
    }

    placeCaretAtEnd(heading);
}

function applyPisiUserTagToEditor(editor, rawTag, commandOverride = null) {
    const command =
        commandOverride ||
        pisiTagMenuState.command ||
        getPisiEditorCommandAtCaret(editor);

    const tag = normalizePisiUserTag(rawTag);

    if (!command || !tag || !isValidPisiUserTag(tag)) return;

    const range = makeRangeInElementByTextOffsets(
        command.block,
        command.tokenStartInText,
        command.tokenEndInText
    );

    if (!range) return;

    const tagEl = document.createElement('span');
    tagEl.className = 'pisi-user-tag';
    tagEl.dataset.pisiTag = tag;
    tagEl.contentEditable = 'false';
    tagEl.textContent = tag;

    const trailingSpace = document.createTextNode(' ');

    range.deleteContents();
    range.insertNode(trailingSpace);
    range.insertNode(tagEl);

    PISI_USER_TAG_CACHE.add(tag);

    const afterSpaceRange = document.createRange();
    afterSpaceRange.setStartAfter(trailingSpace);
    afterSpaceRange.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(afterSpaceRange);

    closePisiTagMenu();
    editor.focus();

    editor.dispatchEvent(new Event('input', {
        bubbles: true
    }));
}

function normalizePisiUserTag(value) {
    return String(value || '')
        .trim()
        .replace(/^\.\./, '')
        .replace(/^\//, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');
}

function isValidPisiUserTag(value) {
    const tagChars = 'A-Za-z0-9ğüşöçıİĞÜŞÖÇ_-';
    const tagRegex = new RegExp(`^[${tagChars}]+(?:\\.[${tagChars}]+)*$`);

    return tagRegex.test(String(value || ''));
}

function makeRangeInElementByTextOffsets(root, startOffset, endOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let currentOffset = 0;
    let startNode = null;
    let startNodeOffset = 0;
    let endNode = null;
    let endNodeOffset = 0;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const nextOffset = currentOffset + node.nodeValue.length;

        if (!startNode && startOffset >= currentOffset && startOffset <= nextOffset) {
            startNode = node;
            startNodeOffset = startOffset - currentOffset;
        }

        if (!endNode && endOffset >= currentOffset && endOffset <= nextOffset) {
            endNode = node;
            endNodeOffset = endOffset - currentOffset;
            break;
        }

        currentOffset = nextOffset;
    }

    if (!startNode || !endNode) return null;

    const range = document.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);

    return range;
}

function getPisiCurrentEditorBlock(editor, node) {
    let el = node.nodeType === Node.ELEMENT_NODE
        ? node
        : node.parentElement;

    while (el && el !== editor) {
        if (el.matches && el.matches('div, p, h1, h2, h3, h4, h5, h6')) {
            return el;
        }

        el = el.parentElement;
    }

    return editor;
}

function placeCaretAtEnd(element) {
    const range = document.createRange();
    const selection = window.getSelection();

    range.selectNodeContents(element);
    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);
}

function positionPisiTagMenuAtSelection() {
    const menu = document.getElementById('pisi-tag-menu');

    if (!menu || menu.hidden) return;

    const rect = getSelectionClientRect();

    if (!rect) return;

    const menuRect = menu.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 8;

    left = Math.max(12, Math.min(left, window.innerWidth - menuRect.width - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - menuRect.height - 12));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function getSelectionClientRect() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0).cloneRange();

    let rect = range.getBoundingClientRect();

    if (rect && (rect.width || rect.height)) {
        return rect;
    }

    const marker = document.createElement('span');
    marker.textContent = '\u200b';

    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
    marker.remove();

    return rect;
}

function pisiEscapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeHtml(value) {
    return pisiEscapeHtml(value);
}
