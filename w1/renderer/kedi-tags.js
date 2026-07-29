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
    const tagsPage = document.getElementById('right-tab-tags');

    if (!tagsPage) return;

    const index = await buildKediTagBlockIndex();

    kediTagsPanelState.index = index;

    renderKediTagsPanel();
}

async function buildKediTagBlockIndex() {
    const results = [];

    // Tags paneli sadece orta alanda aktif olan map'i tarar.
    if (
        !activeMapPath ||
        !Array.isArray(activeMapNodes) ||
        !activeMapNodes.length
    ) {
        return results;
    }

    for (const node of activeMapNodes) {
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

function renderKediTagsPanel() {
    const pickerButton = document.getElementById('kedi-tag-picker-button');
    const pickerMenu = document.getElementById('kedi-tag-picker-menu');
    const resultsEl = document.getElementById('kedi-tag-block-results');

    if (!pickerButton || !pickerMenu || !resultsEl) return;

    const counts = new Map();

    for (const block of kediTagsPanelState.index) {
        for (const tag of block.tags) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        }
    }

    const tags = Array.from(counts.keys()).sort((a, b) => {
        return a.localeCompare(b, 'tr');
    });

    if (!activeMapPath) {
        kediTagsPanelState.selectedTag = null;
        kediTagsPanelState.dropdownOpen = false;

        pickerButton.disabled = true;
        pickerButton.textContent = 'Choose tag';
        pickerMenu.hidden = true;
        pickerMenu.innerHTML = '';

        resultsEl.innerHTML = `
            <div class="right-panel-empty">
                Tags paneli için önce orta alanda bir map aç.
            </div>
        `;

        return;
    }

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

    const matchingBlocks = kediTagsPanelState.index.filter((block) => {
        return block.tags.includes(selectedTag);
    });

    resultsEl.innerHTML = '';

    for (const block of matchingBlocks) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'kedi-tag-result-card';

        card.innerHTML = `
            <div class="kedi-tag-result-node">${escapeHtml(block.nodeTitle)}</div>
            <div class="kedi-tag-result-text">${escapeHtml(block.text || '(boş blok)')}</div>
           
        `;

        card.addEventListener('click', async () => {
            await openKediTagBlockResult(block);
        });

        resultsEl.appendChild(card);
    }
}

async function openKediTagBlockResult(block) {
    if (!block?.nodePath) return;

    const escapedPath = CSS.escape(block.nodePath);
    const box = document.querySelector(`.map-node-box[data-node-path="${escapedPath}"]`);

    if (box) {
        await openNodeModalFromBox(box);
    }

    setTimeout(() => {
        highlightKediEditorBlock(block.blockId);
    }, 80);
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

