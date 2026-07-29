function bindKediBlockIndexControls() {
    const editors = [
        document.getElementById('node-modal-content'),
        document.getElementById('center-node-editor-content')
    ].filter(Boolean);

    for (const editor of editors) {
        if (editor.dataset.kediBlockIndexBound === '1') continue;

        editor.dataset.kediBlockIndexBound = '1';

        editor.addEventListener('input', () => {
            ensureKediEditorBlocks(editor);
            refreshKediTagsPanelSoon();
        });
    }

    if (typeof bindKediTagPickerOutsideClose === 'function') {
        bindKediTagPickerOutsideClose();
    }

    refreshKediTagsPanelSoon();
}

function bindKediTagPickerOutsideClose() {
    if (window.__kediTagPickerOutsideCloseBound === true) return;

    window.__kediTagPickerOutsideCloseBound = true;

    document.addEventListener('mousedown', (event) => {
        if (!kediTagsPanelState?.dropdownOpen) return;

        if (event.target.closest('#kedi-tags-panel')) {
            return;
        }

        kediTagsPanelState.dropdownOpen = false;
        renderKediTagsPanel();
    });
}

function makeKediBlockId() {
    if (window.crypto?.randomUUID) {
        return `blk_${window.crypto.randomUUID()}`;
    }

    return `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isKediEditorBlockElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    return /^(DIV|P|H2|H3|H4|H5|H6)$/i.test(element.tagName);
}

function decorateKediEditorBlock(element) {
    if (!isKediEditorBlockElement(element)) return;

    element.classList.add('kedi-editor-block');

    if (!element.dataset.kediBlockId) {
        element.dataset.kediBlockId = makeKediBlockId();
    }
}

function ensureKediEditorBlocks(editor) {
    if (!editor) return;

    const childNodes = Array.from(editor.childNodes);

    if (!childNodes.length) {
        const block = document.createElement('div');
        block.innerHTML = '<br>';
        decorateKediEditorBlock(block);
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
            decorateKediEditorBlock(block);
            node.replaceWith(block);
            continue;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'BR') {
                const block = document.createElement('div');
                block.innerHTML = '<br>';
                decorateKediEditorBlock(block);
                node.replaceWith(block);
                continue;
            }

            if (isKediEditorBlockElement(node)) {
                decorateKediEditorBlock(node);
            }
        }
    }
}

function getKediBlockElementsFromContainer(container) {
    if (!container) return [];

    return Array.from(container.children).filter((element) => {
        return isKediEditorBlockElement(element);
    });
}

function extractKediTagsFromBlock(block) {
    return Array.from(block.querySelectorAll('.kedi-user-tag[data-kedi-tag]'))
        .map((tagEl) => normalizeKediUserTag(tagEl.dataset.kediTag || tagEl.textContent || ''))
        .filter(Boolean);
}

function refreshKediTagsPanelSoon() {
    clearTimeout(kediTagsPanelRefreshTimer);

    kediTagsPanelRefreshTimer = setTimeout(async () => {
        kediTagsPanelRefreshTimer = null;
        await refreshKediTagsPanel();
    }, 250);
}

async function refreshKediTagsPanel() {
    try {
        const index = await buildKediTagBlockIndex();

        kediTagsPanelState.index = Array.isArray(index) ? index : [];

        const missionsPageIsActive = document
            .getElementById('right-tab-missions')
            ?.classList
            .contains('active');

        if (
            missionsPageIsActive ||
            !Array.isArray(kediTagsPanelState.missionIndex)
        ) {
            const missionIndex = await buildKediMissionBlockIndex();
            kediTagsPanelState.missionIndex = Array.isArray(missionIndex)
                ? missionIndex
                : [];
        }

        renderKediTagsPanel();

        if (typeof renderKediMissionsPanel === 'function') {
            renderKediMissionsPanel();
        }
    } catch (error) {
        console.error('[KEDI] Tags/Missions refresh hatası:', error);
    }
}

function sameKediPathForTags(a, b) {
    if (!a || !b) return false;

    if (typeof kediSameTabPath === 'function') {
        return kediSameTabPath(a, b);
    }

    return String(a) === String(b);
}

function getKediTagsActiveMapPath() {
    if (activeMapPath) {
        return activeMapPath;
    }

    const state = window.Kedi?.state;

    if (!state?.activeTabPath || !Array.isArray(state.openTabs)) {
        return null;
    }

    const activeTab = state.openTabs.find((tab) => {
        return sameKediPathForTags(tab.path, state.activeTabPath);
    });

    if (activeTab?.type === 'map') {
        return activeTab.path;
    }

    return null;
}

async function getKediTagsActiveMapNodes(mapPath) {
    if (!mapPath) return [];

    if (
        activeMapPath &&
        sameKediPathForTags(activeMapPath, mapPath) &&
        Array.isArray(activeMapNodes) &&
        activeMapNodes.length
    ) {
        return activeMapNodes;
    }

    const result = await window.kediProject?.listMapNodes?.(mapPath);

    if (!result?.ok) {
        return [];
    }

    return Array.isArray(result.nodes) ? result.nodes : [];
}

function isKediMissionNodeFileName(fileName = '') {
    return String(fileName || '').toLowerCase().endsWith('.node');
}

function isKediMissionMapFileName(fileName = '') {
    return String(fileName || '').toLowerCase().endsWith('.map');
}

function makeKediMissionNodeItem(item) {
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

async function collectKediMissionNodeItemsFromFolder(
    folderPath,
    seenPaths = new Set()
) {
    const nodes = [];

    if (!folderPath) return nodes;

    const result = await window.kediProject?.listFolder?.(folderPath);

    if (!result?.ok || !Array.isArray(result.items)) {
        return nodes;
    }

    for (const item of result.items) {
        if (item?.isDirectory) {
            nodes.push(
                ...(await collectKediMissionNodeItemsFromFolder(
                    item.fullPath,
                    seenPaths
                ))
            );
            continue;
        }

        if (!item?.isFile || !item.fullPath) continue;

        if (isKediMissionNodeFileName(item.name || item.fileName)) {
            const nodeItem = makeKediMissionNodeItem(item);

            if (nodeItem && !seenPaths.has(nodeItem.fullPath)) {
                seenPaths.add(nodeItem.fullPath);
                nodes.push(nodeItem);
            }

            continue;
        }

        if (isKediMissionMapFileName(item.name || item.fileName)) {
            const mapNodesResult = await window.kediProject?.listMapNodes?.(
                item.fullPath
            );

            const mapNodes = Array.isArray(mapNodesResult?.nodes)
                ? mapNodesResult.nodes
                : [];

            for (const mapNode of mapNodes) {
                const nodeItem = makeKediMissionNodeItem(mapNode);

                if (nodeItem && !seenPaths.has(nodeItem.fullPath)) {
                    seenPaths.add(nodeItem.fullPath);
                    nodes.push(nodeItem);
                }
            }
        }
    }

    return nodes;
}

async function buildKediMissionBlockIndex() {
    const results = [];
    const projectFolder = window.currentProjectFolder;

    if (!projectFolder) return results;

    const nodeItems = await collectKediMissionNodeItemsFromFolder(projectFolder);

    for (const node of nodeItems) {
        const nodePath = node.fullPath;

        if (!nodePath) continue;

        if (activeCenterNode?.path === nodePath) {
            const editor = document.getElementById('center-node-editor-content');

            ensureKediEditorBlocks(editor);

            results.push(...extractKediTagBlocksFromHtml({
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

        if (activeModalNode?.path === nodePath) {
            const editor = document.getElementById('node-modal-content');

            ensureKediEditorBlocks(editor);

            results.push(...extractKediTagBlocksFromHtml({
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

        const doc = await window.kediProject?.getKediDocument?.(nodePath);

        if (!doc?.ok) continue;

        results.push(...extractKediTagBlocksFromHtml({
            html: doc.data?.content || '',
            nodePath,
            nodeTitle:
                doc.metadata?.title ||
                node.metadata?.title ||
                node.displayName ||
                node.fileName ||
                node.name ||
                'Node'
        }));
    }

    return results;
}

async function buildKediTagBlockIndex() {
    const results = [];

    // Tags paneli aktif map'i tarar.
    // activeMapPath boşsa aktif tab üzerinden map yolunu bulur.
    const mapPath = getKediTagsActiveMapPath();
    const mapNodes = await getKediTagsActiveMapNodes(mapPath);

    if (!mapPath || !mapNodes.length) {
        return results;
    }

    for (const node of mapNodes) {
        const nodePath = node.fullPath;

        // Eğer bu node orta panel editoründe açıksa,
        // kaydedilmemiş en güncel içeriği DOM'dan oku.
        if (activeCenterNode?.path === nodePath) {
            const editor = document.getElementById('center-node-editor-content');
            ensureKediEditorBlocks(editor);

            results.push(...extractKediTagBlocksFromHtml({
                html: editor?.innerHTML || '',
                nodePath,
                nodeTitle:
                    activeCenterNode.metadata?.title ||
                    node.metadata?.title ||
                    node.fileName ||
                    node.name ||
                    'Node'
            }));

            continue;
        }

        // Eğer bu node modalda açıksa,
        // kaydedilmemiş en güncel içeriği DOM'dan oku.
        if (activeModalNode?.path === nodePath) {
            const editor = document.getElementById('node-modal-content');
            ensureKediEditorBlocks(editor);

            results.push(...extractKediTagBlocksFromHtml({
                html: editor?.innerHTML || '',
                nodePath,
                nodeTitle:
                    activeModalNode.metadata?.title ||
                    node.metadata?.title ||
                    node.fileName ||
                    node.name ||
                    'Node'
            }));

            continue;
        }

        const doc = await window.kediProject?.getKediDocument?.(nodePath);

        if (!doc || !doc.ok) continue;

        results.push(...extractKediTagBlocksFromHtml({
            html: doc.data?.content || '',
            nodePath,
            nodeTitle:
                doc.metadata?.title ||
                node.metadata?.title ||
                node.fileName ||
                node.name ||
                'Node'
        }));
    }

    return results;
}

function extractKediTagBlocksFromHtml({ html, nodePath, nodeTitle }) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = sanitizeKediEditorHtml(String(html || ''));

    const blocks = getKediBlockElementsFromContainer(wrapper);
    const results = [];

    for (const block of blocks) {
        decorateKediEditorBlock(block);

        const tags = Array.from(new Set(extractKediTagsFromBlock(block)));

        if (!tags.length) continue;

        const text = block.textContent
            .replace(/\s+/g, ' ')
            .trim();

        results.push({
            blockId: block.dataset.kediBlockId,
            nodePath,
            nodeTitle,
            tags,
            text,
            html: block.outerHTML
        });
    }

    return results;
}

function ensureKediTagsPanelDom() {
    const panel = document.getElementById('kedi-tags-panel');

    if (!panel) return null;

    let pickerButton = document.getElementById('kedi-tag-picker-button');
    let pickerMenu = document.getElementById('kedi-tag-picker-menu');
    let resultsEl = document.getElementById('kedi-tag-block-results');

    if (!pickerButton || !pickerMenu || !resultsEl) {
        panel.innerHTML = `
            <div class="kedi-tag-picker">
                <button id="kedi-tag-picker-button" type="button">
                    Choose tag
                </button>

                <div
                    id="kedi-tag-picker-menu"
                    class="kedi-tag-picker-menu"
                    hidden
                ></div>
            </div>

            <div id="kedi-tag-block-results" class="kedi-tag-block-results"></div>
        `;

        pickerButton = document.getElementById('kedi-tag-picker-button');
        pickerMenu = document.getElementById('kedi-tag-picker-menu');
        resultsEl = document.getElementById('kedi-tag-block-results');
    }

    if (!pickerButton || !pickerMenu || !resultsEl) return null;

    return {
        pickerButton,
        pickerMenu,
        resultsEl
    };
}

function renderKediTagsPanel() {
    const dom = ensureKediTagsPanelDom();

    if (!dom) {
        console.error('[KEDI] Tags panel DOM bulunamadı.');
        return;
    }

    const {
        pickerButton,
        pickerMenu,
        resultsEl
    } = dom;

    const index = Array.isArray(kediTagsPanelState.index)
        ? kediTagsPanelState.index
        : [];

    const counts = new Map();

for (const block of index) {
    const blockTags = Array.isArray(block.tags) ? block.tags : [];

    for (const tag of blockTags) {
        const normalizedTag = normalizeKediUserTag(tag);

        // Missions'a özel ..todo.priority.finishdate etiketleri
        // Tags sekmesinde listelenmesin.
        if (parseKediTodoTag(normalizedTag)) {
            continue;
        }

        counts.set(normalizedTag, (counts.get(normalizedTag) || 0) + 1);
    }
}

const tags = Array.from(counts.keys()).sort((a, b) => {
    return a.localeCompare(b, 'tr');
});

    if (!tags.length) {
        kediTagsPanelState.selectedTag = null;
        kediTagsPanelState.dropdownOpen = false;

        pickerButton.disabled = true;
        pickerButton.textContent = 'Choose tag';
        pickerMenu.hidden = true;
        pickerMenu.innerHTML = '';

        resultsEl.innerHTML = `
            <div class="right-panel-empty">
                Bu map içinde kullanıcı etiketi içeren blok yok.
            </div>
        `;

        return;
    }

    if (
        kediTagsPanelState.selectedTag &&
        !counts.has(kediTagsPanelState.selectedTag)
    ) {
        kediTagsPanelState.selectedTag = null;
    }

    const selectedTag = kediTagsPanelState.selectedTag || tags[0];

    kediTagsPanelState.selectedTag = selectedTag;

    pickerButton.disabled = false;
    pickerButton.textContent = `#${selectedTag} (${counts.get(selectedTag)})`;
    pickerButton.setAttribute(
        'aria-expanded',
        kediTagsPanelState.dropdownOpen ? 'true' : 'false'
    );

    pickerButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        kediTagsPanelState.dropdownOpen = !kediTagsPanelState.dropdownOpen;
        renderKediTagsPanel();
    };

    pickerMenu.hidden = !kediTagsPanelState.dropdownOpen;
    pickerMenu.innerHTML = '';

    for (const tag of tags) {
        const option = document.createElement('button');

        option.type = 'button';
        option.className = 'kedi-tag-picker-option';
        option.classList.toggle('active', tag === selectedTag);

        option.innerHTML = `
            <span class="kedi-tag-picker-name">#${escapeHtml(tag)}</span>
            <span class="kedi-tag-picker-count">${counts.get(tag)}</span>
        `;

        option.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            kediTagsPanelState.selectedTag = tag;
            kediTagsPanelState.dropdownOpen = false;

            renderKediTagsPanel();
        });

        pickerMenu.appendChild(option);
    }

   const matchingBlocks = index.filter((block) => {
    return Array.isArray(block.tags) &&
        block.tags.some((tag) => {
            return normalizeKediUserTag(tag) === selectedTag;
        });
    });

    resultsEl.innerHTML = '';

    for (const block of matchingBlocks) {
        const card = document.createElement('button');

        card.type = 'button';
        card.className = 'kedi-tag-result-card';

        card.innerHTML = `
            <div class="kedi-tag-result-node">
                ${escapeHtml(block.nodeTitle || 'Node')}
            </div>

            <div class="kedi-tag-result-text">
                ${escapeHtml(block.text || '(boş blok)')}
            </div>
        `;

        card.addEventListener('click', async () => {
            await openKediTagBlockResult(block);
        });

        resultsEl.appendChild(card);
    }
}

function parseKediTodoTag(tag) {
    const normalized = normalizeKediUserTag(tag);

    const match = normalized.match(/^todo\.([1-9])\.(\d{2})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const priority = Number(match[1]);
    const day = Number(match[2]);
    const month = Number(match[3]);
    const year = 2000 + Number(match[4]);

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

function formatKediMissionDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);

    return `${day}-${month}-${year}`;
}

function getKediMissionsFromIndex() {
    const missions = [];

    const sourceIndex = Array.isArray(kediTagsPanelState.missionIndex)
        ? kediTagsPanelState.missionIndex
        : [];

    for (const block of sourceIndex) {
        const tags = Array.isArray(block.tags) ? block.tags : [];

        const hasDone = tags.some((tag) => {
            return normalizeKediUserTag(tag) === 'done';
        });

        if (hasDone) continue;

        for (const tag of tags) {
            const todo = parseKediTodoTag(tag);

            if (!todo) continue;

            missions.push({
                ...block,
                todoTag: todo.tag,
                priority: todo.priority,
                finishDate: todo.finishDate,
                daysLeft: todo.daysLeft,
                workorder: todo.workorder
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

function renderKediMissionsPanel() {
    const listEl = document.getElementById('kedi-missions-list');

    if (!listEl) return;

    if (!window.currentProjectFolder) {
    listEl.innerHTML = `
        <div class="right-panel-empty">
            Missions için önce bir proje klasörü seç.
        </div>
    `;
    return;
}

    const missions = getKediMissionsFromIndex();

    if (!missions.length) {
        listEl.innerHTML = `
            <div class="right-panel-empty">
                Bu map içinde açık görev yok.
            </div>
        `;
        return;
    }

    listEl.innerHTML = '';

    for (const mission of missions) {
        const item = document.createElement('div');
        item.className = 'kedi-mission-card';

        const isLate = mission.daysLeft < 0;

        item.innerHTML = `
            <label class="kedi-mission-check-wrap" title="Tamamlandı olarak işaretle">
                <input class="kedi-mission-check" type="checkbox">
            </label>

            <button class="kedi-mission-main" type="button">
                <div class="kedi-mission-top">
                    <span class="kedi-mission-tag">..${escapeHtml(mission.todoTag)}</span>
                    <span class="kedi-mission-priority">P${mission.priority}</span>
                </div>

                <div class="kedi-mission-text">
                    ${escapeHtml(mission.text || '(boş blok)')}
                </div>

                <div class="kedi-mission-meta">
                    <span class="${isLate ? 'late' : ''}">
                        ${formatKediMissionDate(mission.finishDate)}
                    </span>
                    <span>workorder: ${mission.workorder.toFixed(2)}</span>
                </div>

                <div class="kedi-mission-node">
                    ${escapeHtml(mission.nodeTitle)}
                </div>
            </button>
        `;

        const checkbox = item.querySelector('.kedi-mission-check');
        const mainButton = item.querySelector('.kedi-mission-main');

        checkbox?.addEventListener('click', async (event) => {
    event.stopPropagation();

    checkbox.disabled = true;

    const result = await markKediMissionDone(mission);

    if (!result?.ok) {
        checkbox.checked = false;
        checkbox.disabled = false;
        alert(result?.error || 'Görev tamamlandı olarak işaretlenemedi.');
        return;
    }

    refreshKediTagsPanelSoon();
    });

        mainButton?.addEventListener('click', async () => {
            await openKediTagBlockResult(mission);
        });

        listEl.appendChild(item);
    }
}

function normalizeKediBlockText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function createKediDoneTagElement() {
    const tagEl = document.createElement('span');

    tagEl.className = 'kedi-user-tag';
    tagEl.dataset.kediTag = 'done';
    tagEl.contentEditable = 'false';
    tagEl.textContent = 'done';

    return tagEl;
}

function blockHasKediDoneTag(block) {
    return Array.from(block.querySelectorAll('.kedi-user-tag[data-kedi-tag]'))
        .some((tagEl) => {
            return normalizeKediUserTag(
                tagEl.dataset.kediTag || tagEl.textContent || ''
            ) === 'done';
        });
}

function blockHasKediTag(block, targetTag) {
    const normalizedTarget = normalizeKediUserTag(targetTag);

    return Array.from(block.querySelectorAll('.kedi-user-tag[data-kedi-tag]'))
        .some((tagEl) => {
            return normalizeKediUserTag(
                tagEl.dataset.kediTag || tagEl.textContent || ''
            ) === normalizedTarget;
        });
}

function appendKediDoneTagToBlock(block) {
    if (!block || blockHasKediDoneTag(block)) return false;

    decorateKediEditorBlock(block);

    block.appendChild(document.createTextNode(' '));
    block.appendChild(createKediDoneTagElement());
    block.appendChild(document.createTextNode(' '));

    return true;
}

function findKediMissionBlockInContainer(container, mission) {
    if (!container || !mission) return null;

    ensureKediEditorBlocks(container);

    const blocks = getKediBlockElementsFromContainer(container);
    const targetTodoTag = normalizeKediUserTag(mission.todoTag);
    const targetText = normalizeKediBlockText(mission.text);

    let textFallback = null;
    let tagFallback = null;

    for (const block of blocks) {
        decorateKediEditorBlock(block);

        const hasTodo = blockHasKediTag(block, targetTodoTag);

        if (!hasTodo) continue;

        if (
            mission.blockId &&
            block.dataset.kediBlockId === mission.blockId
        ) {
            return block;
        }

        if (
            !textFallback &&
            normalizeKediBlockText(block.textContent) === targetText
        ) {
            textFallback = block;
        }

        if (!tagFallback) {
            tagFallback = block;
        }
    }

    return textFallback || tagFallback;
}

async function markKediMissionDone(mission) {
    if (!mission?.nodePath) {
        return {
            ok: false,
            error: 'Görev node yolu bulunamadı.'
        };
    }

    try {
        // 1) Görev şu an center editor içinde açıksa önce DOM'u güncelle.
        if (activeCenterNode?.path === mission.nodePath) {
            const editor = document.getElementById('center-node-editor-content');

            const block = findKediMissionBlockInContainer(editor, mission);

            if (!block) {
                return {
                    ok: false,
                    error: 'Görev bloğu center editor içinde bulunamadı.'
                };
            }

            appendKediDoneTagToBlock(block);

            editor.dispatchEvent(new Event('input', {
                bubbles: true
            }));

            if (typeof saveCurrentCenterNodeEditor === 'function') {
                await saveCurrentCenterNodeEditor();
            } else {
                const saveResult = await window.kediProject?.saveNodeContent?.(
                    mission.nodePath,
                    getKediEditorContent(editor)
                );

                if (!saveResult?.ok) {
                    return {
                        ok: false,
                        error: saveResult?.error || 'Node kaydedilemedi.'
                    };
                }
            }

            return { ok: true };
        }

        // 2) Görev modal içinde açıksa modal DOM'unu güncelle.
        if (activeModalNode?.path === mission.nodePath) {
            const editor = document.getElementById('node-modal-content');

            const block = findKediMissionBlockInContainer(editor, mission);

            if (!block) {
                return {
                    ok: false,
                    error: 'Görev bloğu modal içinde bulunamadı.'
                };
            }

            appendKediDoneTagToBlock(block);

            editor.dispatchEvent(new Event('input', {
                bubbles: true
            }));

            const saveResult = await window.kediProject?.saveNodeContent?.(
                mission.nodePath,
                getKediEditorContent(editor)
            );

            if (!saveResult?.ok) {
                return {
                    ok: false,
                    error: saveResult?.error || 'Node kaydedilemedi.'
                };
            }

            return { ok: true };
        }

        // 3) Görev kapalı node içindeyse dosyayı oku, HTML içinde bul, kaydet.
        const doc = await window.kediProject?.getKediDocument?.(mission.nodePath);

        if (!doc?.ok) {
            return {
                ok: false,
                error: doc?.error || 'Node okunamadı.'
            };
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = sanitizeKediEditorHtml(doc.data?.content || '');

        const block = findKediMissionBlockInContainer(wrapper, mission);

        if (!block) {
            return {
                ok: false,
                error: 'Görev bloğu node HTML içinde bulunamadı.'
            };
        }

        appendKediDoneTagToBlock(block);

        const saveResult = await window.kediProject?.saveNodeContent?.(
            mission.nodePath,
            sanitizeKediEditorHtml(wrapper.innerHTML)
        );

        if (!saveResult?.ok) {
            return {
                ok: false,
                error: saveResult?.error || 'Node kaydedilemedi.'
            };
        }

        return { ok: true };
    } catch (error) {
        console.error('[KEDI] Mission done işaretleme hatası:', error);

        return {
            ok: false,
            error: error.message || 'Görev tamamlandı olarak işaretlenemedi.'
        };
    }
}

async function openKediTagBlockResult(block) {
    if (!block?.nodePath) return;

    const escapedPath = CSS.escape(block.nodePath);
    const box = document.querySelector(`.map-node-box[data-node-path="${escapedPath}"]`);

    if (box) {
    await openNodeModalFromBox(box);
} else if (typeof openKediFileTab === 'function') {
    await openKediFileTab({
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
    highlightKediEditorBlock(block.blockId);
}, 120);
}

function highlightKediEditorBlock(blockId) {
    if (!blockId) return;

    const centerEditor = document.getElementById('center-node-editor-content');
    const modalEditor = document.getElementById('node-modal-content');

    const centerVisible =
        centerEditor &&
        !document.getElementById('center-node-editor')?.hidden;

    const editor = centerVisible ? centerEditor : modalEditor;

    if (!editor) return;

    editor.querySelectorAll('.kedi-block-highlight').forEach((block) => {
        block.classList.remove('kedi-block-highlight');
    });

    const block = editor.querySelector(
        `.kedi-editor-block[data-kedi-block-id="${CSS.escape(blockId)}"]`
    );

    if (!block) return;

    block.classList.add('kedi-block-highlight');

    block.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
    });

    setTimeout(() => {
        block.classList.remove('kedi-block-highlight');
    }, 1400);
}

const KEDI_SYSTEM_TAGS = [
    { id: 'h2', label: 'h2', description: 'Heading 2', headingLevel: 2 },
    { id: 'h3', label: 'h3', description: 'Heading 3', headingLevel: 3 },
    { id: 'h4', label: 'h4', description: 'Heading 4', headingLevel: 4 },
    { id: 'h5', label: 'h5', description: 'Heading 5', headingLevel: 5 }
];

function bindKediTagControls() {
    const menu = document.getElementById('kedi-tag-menu');

    if (!menu) return;

    const editors = [
        document.getElementById('node-modal-content'),
        document.getElementById('center-node-editor-content')
    ].filter(Boolean);

    for (const editor of editors) {
        bindKediTagControlsForEditor(editor);
    }

    if (document.body.dataset.kediTagOutsideBound === '1') return;

    document.body.dataset.kediTagOutsideBound = '1';

    document.addEventListener('mousedown', (event) => {
        if (!kediTagMenuState.active) return;

        const activeEditor = kediTagMenuState.editor;

        if (
            event.target.closest('#kedi-tag-menu') ||
            event.target === activeEditor ||
            activeEditor?.contains(event.target)
        ) {
            return;
        }

        closeKediTagMenu();
    });
}

function bindKediTagControlsForEditor(editor) {
    if (!editor) return;
    if (editor.dataset.kediTagsBound === '1') return;

    editor.dataset.kediTagsBound = '1';

    editor.addEventListener('input', () => {
        ensureKediEditorBlocks(editor);
        collectKediUserTagsFromEditor(editor);
        updateKediTagMenuForEditor(editor, true);
        refreshKediTagsPanelSoon();
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

        updateKediTagMenuForEditor(editor, false);
    });

    editor.addEventListener('keydown', (event) => {
        // Kullanıcı tagı boşlukla biter.
        // Örnek: ..hayvan[space] => mavi tag chip.
        if (event.key === ' ') {
            const command = getKediEditorCommandAtCaret(editor);

            if (command && command.body && !getExactKediSystemTag(command.body)) {
                event.preventDefault();
                applyKediUserTagToEditor(editor, command.body, command);
                return;
            }
        }

        if (!kediTagMenuState.active) return;
        if (kediTagMenuState.editor !== editor) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveKediTagSelection(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveKediTagSelection(-1);
            return;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();

            const selectedItem = kediTagMenuState.items[kediTagMenuState.selectedIndex];

            if (selectedItem) {
                applyKediTagMenuItem(editor, selectedItem);
            }

            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeKediTagMenu();
        }
    });

    editor.addEventListener('click', () => {
        updateKediTagMenuForEditor(editor, false);
    });
}

function updateKediTagMenuForEditor(editor, allowExactTransform) {
    const command = getKediEditorCommandAtCaret(editor);

    if (!command) {
        closeKediTagMenu();
        return;
    }

    const exactSystem = getExactKediSystemTag(command.body);

    if (allowExactTransform && exactSystem) {
        applyKediSystemTagToEditor(editor, exactSystem, command);
        return;
    }

    const items = buildKediTagMenuItems(command);

    if (!items.length) {
        closeKediTagMenu();
        return;
    }

    openKediTagMenuForEditor(editor, {
        ...command,
        items
    });
}

function getKediEditorCommandAtCaret(editor) {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return null;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.startContainer)) {
        return null;
    }

    const block = getKediCurrentEditorBlock(editor, range.startContainer);

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

function buildKediTagMenuItems(command) {
    const body = normalizeKediUserTag(command.body);
    const lowerBody = body.toLowerCase();
    const items = [];

    const systemItems = KEDI_SYSTEM_TAGS
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

    const userItems = collectKediUserTagSuggestions(command.editor)
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

    if (body && !existsAsUser && !existsAsSystem && isValidKediUserTag(body)) {
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

function getExactKediSystemTag(body) {
    const normalized = String(body || '').toLowerCase();

    if (normalized.includes('.')) return null;

    return KEDI_SYSTEM_TAGS.find((item) => {
        return item.label.toLowerCase() === normalized;
    }) || null;
}

function collectKediUserTagsFromEditor(editor) {
    if (!editor) return;

    editor.querySelectorAll('.kedi-user-tag[data-kedi-tag]').forEach((tagEl) => {
        const tag = normalizeKediUserTag(
            tagEl.dataset.kediTag || tagEl.textContent || ''
        );

        if (tag) {
            KEDI_USER_TAG_CACHE.add(tag);
        }
    });
}

function collectKediUserTagSuggestions(editor) {
    collectKediUserTagsFromEditor(editor);

    return Array.from(KEDI_USER_TAG_CACHE).sort((a, b) => {
        return a.localeCompare(b, 'tr');
    });
}

function openKediTagMenuForEditor(editor, command) {
    const menu = document.getElementById('kedi-tag-menu');
    if (!menu) return;

    kediTagMenuState = {
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
        option.className = `kedi-tag-option ${item.kind}`;

        if (index === 0) {
            option.classList.add('active');
        }

        option.innerHTML = `
            <span class="kedi-tag-option-code">${kediEscapeHtml(item.typedToken)}</span>
            <span class="kedi-tag-option-desc">${kediEscapeHtml(item.description)}</span>
        `;

        option.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            kediTagMenuState.selectedIndex = index;
            applyKediTagMenuItem(editor, item);
        });

        menu.appendChild(option);
    });

    menu.hidden = false;
    positionKediTagMenuAtSelection();
}

function applyKediTagMenuItem(editor, item) {
    if (!item) return;

    if (item.kind === 'system') {
        applyKediSystemTagToEditor(editor, item);
        return;
    }

    applyKediUserTagToEditor(editor, item.label);
}

function closeKediTagMenu() {
    const menu = document.getElementById('kedi-tag-menu');

    if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
    }

    kediTagMenuState = {
        active: false,
        editor: null,
        command: null,
        selectedIndex: 0,
        items: []
    };
}

function moveKediTagSelection(delta) {
    if (!kediTagMenuState.active || !kediTagMenuState.items.length) return;

    const count = kediTagMenuState.items.length;

    kediTagMenuState.selectedIndex =
        (kediTagMenuState.selectedIndex + delta + count) % count;

    const menu = document.getElementById('kedi-tag-menu');

    menu?.querySelectorAll('.kedi-tag-option').forEach((option, index) => {
        option.classList.toggle(
            'active',
            index === kediTagMenuState.selectedIndex
        );
    });
}

function applyKediSystemTagToEditor(editor, item, commandOverride = null) {
    const command = commandOverride || kediTagMenuState.command;

    if (!command || !item?.headingLevel) return;

    applyKediHeadingTagToEditor(editor, item.headingLevel, command);
    closeKediTagMenu();

    editor.focus();

    editor.dispatchEvent(new Event('input', {
        bubbles: true
    }));
}

function applyKediHeadingTagToEditor(editor, headingLevel, command) {
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

function applyKediUserTagToEditor(editor, rawTag, commandOverride = null) {
    const command =
        commandOverride ||
        kediTagMenuState.command ||
        getKediEditorCommandAtCaret(editor);

    const tag = normalizeKediUserTag(rawTag);

    if (!command || !tag || !isValidKediUserTag(tag)) return;

    const range = makeRangeInElementByTextOffsets(
        command.block,
        command.tokenStartInText,
        command.tokenEndInText
    );

    if (!range) return;

    const tagEl = document.createElement('span');
    tagEl.className = 'kedi-user-tag';
    tagEl.dataset.kediTag = tag;
    tagEl.contentEditable = 'false';
    tagEl.textContent = tag;

    const trailingSpace = document.createTextNode(' ');

    range.deleteContents();
    range.insertNode(trailingSpace);
    range.insertNode(tagEl);

    KEDI_USER_TAG_CACHE.add(tag);

    const afterSpaceRange = document.createRange();
    afterSpaceRange.setStartAfter(trailingSpace);
    afterSpaceRange.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(afterSpaceRange);

    closeKediTagMenu();
    editor.focus();

    editor.dispatchEvent(new Event('input', {
        bubbles: true
    }));
}

function normalizeKediUserTag(value) {
    return String(value || '')
        .trim()
        .replace(/^\.\./, '')
        .replace(/^\//, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');
}

function isValidKediUserTag(value) {
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

function getKediCurrentEditorBlock(editor, node) {
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

function positionKediTagMenuAtSelection() {
    const menu = document.getElementById('kedi-tag-menu');

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

function kediEscapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeHtml(value) {
    return kediEscapeHtml(value);
}

