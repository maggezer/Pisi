import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommand } from "../core/pisi-command-registry.mjs";
import { registerPisiExtension } from "../core/pisi-extension-api.mjs";

const PISI_BLOCK_TYPES = Object.freeze([
    Object.freeze({ id: 'paragraph', label: 'Paragraf', tag: 'div' }),
    Object.freeze({ id: 'heading1', label: 'Başlık 1', tag: 'h1' }),
    Object.freeze({ id: 'heading2', label: 'Başlık 2', tag: 'h2' }),
    Object.freeze({ id: 'heading3', label: 'Başlık 3', tag: 'h3' }),
    Object.freeze({ id: 'quote', label: 'Alıntı', tag: 'blockquote' }),
    Object.freeze({ id: 'code', label: 'Kod', tag: 'pre' }),
    Object.freeze({ id: 'bullet', label: 'Madde işareti', tag: 'div' }),
    Object.freeze({ id: 'number', label: 'Numaralı madde', tag: 'div' }),
    Object.freeze({ id: 'task', label: 'Görev bloğu', tag: 'div' })
]);

const pisiBlocksEditorState = {
    editor: null,
    block: null,
    toolbar: null,
    slashMenu: null,
    slashIndex: 0,
    draggedBlockId: null,
    sourceOverlay: null,
    sourceEditor: null,
    sourceTextarea: null
};

function pisiBlockTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function escapePisiBlockHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sanitizePisiBlockUrl(value = '') {
    const url = String(value || '').trim();
    return /^(?:https?:|mailto:)/i.test(url) ? url : '';
}

function pisiInlineMarkdownToHtml(value = '') {
    let html = escapePisiBlockHtml(value);
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    html = html.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_all, label, url) => {
        const safe = sanitizePisiBlockUrl(url);
        return safe ? `<a href="${escapePisiBlockHtml(safe)}">${label}</a>` : label;
    });
    return html;
}

function makePisiBlockHtml(type, content) {
    const record = PISI_BLOCK_TYPES.find((item) => item.id === type) || PISI_BLOCK_TYPES[0];
    const blockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return `<${record.tag} class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-block-type="${record.id}">${content || '<br>'}</${record.tag}>`;
}

function pisiBlockMarkdownToHtml(markdown = '') {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let codeLines = null;
    for (const rawLine of lines) {
        if (/^```/.test(rawLine)) {
            if (codeLines) {
                output.push(makePisiBlockHtml('code', escapePisiBlockHtml(codeLines.join('\n'))));
                codeLines = null;
            } else {
                codeLines = [];
            }
            continue;
        }
        if (codeLines) {
            codeLines.push(rawLine);
            continue;
        }
        const heading = rawLine.match(/^(#{1,3})\s+(.+)$/);
        const task = rawLine.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
        const bullet = rawLine.match(/^[-*+]\s+(.+)$/);
        const number = rawLine.match(/^\d+[.)]\s+(.+)$/);
        const quote = rawLine.match(/^>\s?(.*)$/);
        if (heading) {
            output.push(makePisiBlockHtml(`heading${heading[1].length}`, pisiInlineMarkdownToHtml(heading[2])));
        } else if (task) {
            const checked = task[1].toLowerCase() === 'x';
            output.push(makePisiBlockHtml('task', `<span class="pisi-block-task-marker" contenteditable="false">${checked ? '☑' : '☐'}</span> ${pisiInlineMarkdownToHtml(task[2])}`));
        } else if (bullet) {
            output.push(makePisiBlockHtml('bullet', pisiInlineMarkdownToHtml(bullet[1])));
        } else if (number) {
            output.push(makePisiBlockHtml('number', pisiInlineMarkdownToHtml(number[1])));
        } else if (quote) {
            output.push(makePisiBlockHtml('quote', pisiInlineMarkdownToHtml(quote[1])));
        } else {
            output.push(makePisiBlockHtml('paragraph', rawLine ? pisiInlineMarkdownToHtml(rawLine) : '<br>'));
        }
    }
    if (codeLines) output.push(makePisiBlockHtml('code', escapePisiBlockHtml(codeLines.join('\n'))));
    return output.join('');
}

function pisiInlineHtmlToMarkdown(element) {
    const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const body = Array.from(node.childNodes).map(visit).join('');
        if (node.matches('.pisi-block-task-marker')) return '';
        if (node.tagName === 'BR') return '\n';
        if (['STRONG', 'B'].includes(node.tagName)) return `**${body}**`;
        if (['EM', 'I'].includes(node.tagName)) return `*${body}*`;
        if (node.tagName === 'S') return `~~${body}~~`;
        if (node.tagName === 'CODE') return `\`${body}\``;
        if (node.tagName === 'A') {
            const href = sanitizePisiBlockUrl(node.getAttribute('href'));
            return href ? `[${body}](${href})` : body;
        }
        return body;
    };
    return Array.from(element.childNodes).map(visit).join('').trimEnd();
}

function getPisiBlockType(block) {
    const explicit = block?.dataset?.pisiBlockType;
    if (PISI_BLOCK_TYPES.some((item) => item.id === explicit)) return explicit;
    const tag = block?.tagName?.toLowerCase();
    if (/^h[1-3]$/.test(tag)) return `heading${tag.slice(1)}`;
    if (tag === 'blockquote') return 'quote';
    if (tag === 'pre') return 'code';
    return 'paragraph';
}

function pisiBlockHtmlToMarkdown(editor) {
    if (!editor) return '';
    const blocks = Array.from(editor.querySelectorAll('.pisi-editor-block')).filter((block) => {
        const parentBlock = block.parentElement?.closest?.('.pisi-editor-block');
        return !parentBlock || !editor.contains(parentBlock);
    });
    return blocks.map((block, index) => {
        const type = getPisiBlockType(block);
        const text = pisiInlineHtmlToMarkdown(block);
        if (type.startsWith('heading')) return `${'#'.repeat(Number(type.slice(-1)))} ${text}`;
        if (type === 'quote') return `> ${text}`;
        if (type === 'code') return `\`\`\`\n${block.textContent || ''}\n\`\`\``;
        if (type === 'bullet') return `- ${text}`;
        if (type === 'number') return `${index + 1}. ${text}`;
        if (type === 'task') {
            const checked = block.querySelector('.pisi-block-task-marker')?.textContent === '☑';
            return `- [${checked ? 'x' : ' '}] ${text}`;
        }
        return text;
    }).join('\n');
}

function getPisiActiveBlocksEditor() {
    if (window.activeModalNode) return document.getElementById('node-modal-content');
    if (window.activeCenterNode) return document.getElementById('center-node-editor-content');
    return pisiBlocksEditorState.editor?.isConnected ? pisiBlocksEditorState.editor : null;
}

function getPisiActiveBlock() {
    const editor = getPisiActiveBlocksEditor();
    if (!editor) return null;
    if (pisiBlocksEditorState.block && editor.contains(pisiBlocksEditorState.block)) {
        return pisiBlocksEditorState.block;
    }
    const selection = window.getSelection?.();
    const block = selection?.anchorNode
        ? window.getPisiCurrentEditorBlock?.(editor, selection.anchorNode)
        : null;
    return block && block !== editor ? block : editor.querySelector('.pisi-editor-block');
}

function decoratePisiBlockTypes(editor) {
    window.ensurePisiEditorBlocks?.(editor);
    editor?.querySelectorAll?.('.pisi-editor-block').forEach((block) => {
        if (!block.dataset.pisiBlockType) block.dataset.pisiBlockType = getPisiBlockType(block);
    });
}

function replacePisiBlockTag(block, tagName) {
    if (!block || block.tagName.toLowerCase() === tagName) return block;
    const replacement = document.createElement(tagName);
    Array.from(block.attributes).forEach((attribute) => {
        replacement.setAttribute(attribute.name, attribute.value);
    });
    while (block.firstChild) replacement.appendChild(block.firstChild);
    block.replaceWith(replacement);
    return replacement;
}

function applyPisiBlockType(block, type) {
    const record = PISI_BLOCK_TYPES.find((item) => item.id === type);
    if (!block || !record) return null;
    const editor = block.closest('.pisi-rich-editor');
    const previousType = getPisiBlockType(block);
    let next = replacePisiBlockTag(block, record.tag);
    next.classList.add('pisi-editor-block');
    next.dataset.pisiBlockType = record.id;
    if (previousType === 'task' && record.id !== 'task') {
        next.querySelector('.pisi-block-task-marker')?.remove();
    }
    if (record.id === 'task' && !next.querySelector('.pisi-block-task-marker')) {
        const marker = document.createElement('span');
        marker.className = 'pisi-block-task-marker';
        marker.contentEditable = 'false';
        marker.textContent = '☐';
        marker.addEventListener('click', () => {
            marker.textContent = marker.textContent === '☑' ? '☐' : '☑';
            editor?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        next.prepend(marker, document.createTextNode(' '));
    }
    pisiBlocksEditorState.block = next;
    editor?.dispatchEvent(new Event('input', { bubbles: true }));
    selectPisiBlock(editor, next);
    return next;
}

function movePisiBlock(block, delta) {
    if (!block) return false;
    const sibling = delta < 0 ? block.previousElementSibling : block.nextElementSibling;
    if (!sibling) return false;
    if (delta < 0) sibling.before(block);
    else sibling.after(block);
    block.closest('.pisi-rich-editor')?.dispatchEvent(new Event('input', { bubbles: true }));
    selectPisiBlock(block.closest('.pisi-rich-editor'), block);
    return true;
}

function duplicatePisiBlock(block) {
    if (!block) return null;
    const clone = block.cloneNode(true);
    clone.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    clone.classList.remove('pisi-block-active');
    block.after(clone);
    const editor = block.closest('.pisi-rich-editor');
    editor?.dispatchEvent(new Event('input', { bubbles: true }));
    selectPisiBlock(editor, clone);
    return clone;
}

function deletePisiBlock(block) {
    if (!block) return false;
    const editor = block.closest('.pisi-rich-editor');
    const focusTarget = block.nextElementSibling || block.previousElementSibling;
    block.remove();
    window.ensurePisiEditorBlocks?.(editor);
    editor?.dispatchEvent(new Event('input', { bubbles: true }));
    selectPisiBlock(editor, focusTarget || editor?.querySelector('.pisi-editor-block'));
    return true;
}

function copyPisiBlockReference(block = getPisiActiveBlock()) {
    const editor = block?.closest('.pisi-rich-editor');
    const nodePath = editor?.id === 'node-modal-content'
        ? window.activeModalNode?.path
        : window.activeCenterNode?.path;
    if (!block?.dataset.pisiBlockId || !nodePath) return false;
    const reference = `${nodePath}#${block.dataset.pisiBlockId}`;
    window.pisiClipboard?.writeText?.(reference);
    return reference;
}

function ensurePisiBlockToolbar() {
    if (pisiBlocksEditorState.toolbar?.isConnected) return pisiBlocksEditorState.toolbar;
    const toolbar = document.createElement('div');
    toolbar.className = 'pisi-block-toolbar';
    toolbar.hidden = true;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'pisi-block-drag-handle';
    handle.textContent = '⋮⋮';
    handle.title = pisiBlockTranslate('Bloğu sürükle');
    handle.draggable = true;
    handle.addEventListener('dragstart', (event) => {
        const block = getPisiActiveBlock();
        if (!block) return;
        pisiBlocksEditorState.draggedBlockId = block.dataset.pisiBlockId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/x-pisi-block', block.dataset.pisiBlockId);
    });
    const type = document.createElement('select');
    type.className = 'pisi-block-type-select';
    for (const record of PISI_BLOCK_TYPES) {
        const option = document.createElement('option');
        option.value = record.id;
        option.textContent = pisiBlockTranslate(record.label);
        type.appendChild(option);
    }
    type.addEventListener('change', () => applyPisiBlockType(getPisiActiveBlock(), type.value));
    const makeAction = (label, title, action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = pisiBlockTranslate(title);
        button.addEventListener('click', () => action(getPisiActiveBlock()));
        return button;
    };
    toolbar.append(
        handle,
        type,
        makeAction('↑', 'Bloğu yukarı taşı', (block) => movePisiBlock(block, -1)),
        makeAction('↓', 'Bloğu aşağı taşı', (block) => movePisiBlock(block, 1)),
        makeAction('⧉', 'Bloğu çoğalt', duplicatePisiBlock),
        makeAction('↗', 'Blok referansını kopyala', copyPisiBlockReference),
        makeAction('×', 'Bloğu sil', deletePisiBlock)
    );
    document.body.appendChild(toolbar);
    pisiBlocksEditorState.toolbar = toolbar;
    return toolbar;
}

function positionPisiBlockToolbar(block) {
    const toolbar = ensurePisiBlockToolbar();
    if (!block?.isConnected) {
        toolbar.hidden = true;
        return;
    }
    const rect = block.getBoundingClientRect();
    toolbar.hidden = false;
    toolbar.querySelector('.pisi-block-type-select').value = getPisiBlockType(block);
    toolbar.style.left = `${Math.max(8, rect.left - toolbar.offsetWidth - 8)}px`;
    toolbar.style.top = `${Math.max(8, rect.top)}px`;
}

function selectPisiBlock(editor, block) {
    if (!editor || !block || !editor.contains(block)) return null;
    pisiBlocksEditorState.editor?.querySelectorAll('.pisi-block-active')
        .forEach((item) => item.classList.remove('pisi-block-active'));
    pisiBlocksEditorState.editor = editor;
    pisiBlocksEditorState.block = block;
    block.classList.add('pisi-block-active');
    positionPisiBlockToolbar(block);
    document.dispatchEvent(new CustomEvent('pisi:block-selected', {
        detail: {
            nodePath: editor.id === 'node-modal-content'
                ? window.activeModalNode?.path
                : window.activeCenterNode?.path,
            blockId: block.dataset.pisiBlockId,
            type: getPisiBlockType(block),
            text: String(block.textContent || '').replace(/\s+/g, ' ').trim()
        }
    }));
    return block;
}

function getPisiBlockAtEvent(editor, target) {
    const block = target?.closest?.('.pisi-editor-block');
    return block && editor.contains(block) ? block : null;
}

function ensurePisiSlashMenu() {
    if (pisiBlocksEditorState.slashMenu?.isConnected) return pisiBlocksEditorState.slashMenu;
    const menu = document.createElement('div');
    menu.className = 'pisi-block-slash-menu';
    menu.hidden = true;
    document.body.appendChild(menu);
    pisiBlocksEditorState.slashMenu = menu;
    return menu;
}

function renderPisiSlashMenu(block) {
    const menu = ensurePisiSlashMenu();
    const fragment = document.createDocumentFragment();
    PISI_BLOCK_TYPES.forEach((record, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-block-slash-item';
        button.classList.toggle('selected', index === pisiBlocksEditorState.slashIndex);
        button.textContent = `${pisiBlockTranslate(record.label)} · /${record.id}`;
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
            applyPisiBlockType(block, record.id)?.focus?.();
            closePisiSlashMenu();
        });
        fragment.appendChild(button);
    });
    menu.replaceChildren(fragment);
}

function openPisiSlashMenu(block) {
    const menu = ensurePisiSlashMenu();
    pisiBlocksEditorState.slashIndex = 0;
    renderPisiSlashMenu(block);
    const rect = block.getBoundingClientRect();
    menu.style.left = `${Math.max(8, rect.left + 18)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 300, rect.bottom + 4)}px`;
    menu.hidden = false;
}

function closePisiSlashMenu() {
    if (pisiBlocksEditorState.slashMenu) pisiBlocksEditorState.slashMenu.hidden = true;
}

function applyPisiMarkdownBlockShortcut(event, block) {
    if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return false;
    const marker = String(block.textContent || '').trim();
    const type = {
        '#': 'heading1',
        '##': 'heading2',
        '###': 'heading3',
        '>': 'quote',
        '-': 'bullet',
        '*': 'bullet',
        '1.': 'number',
        '[]': 'task',
        '[ ]': 'task'
    }[marker];
    if (!type) return false;
    event.preventDefault();
    block.textContent = '';
    const next = applyPisiBlockType(block, type);
    if (next && !next.childNodes.length) next.appendChild(document.createTextNode(''));
    next?.focus?.();
    return true;
}

function handlePisiBlocksEditorKeydown(editor, event) {
    const block = getPisiBlockAtEvent(editor, event.target) || getPisiActiveBlock();
    if (!block) return;
    if (!pisiBlocksEditorState.slashMenu?.hidden) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            pisiBlocksEditorState.slashIndex = (
                pisiBlocksEditorState.slashIndex + delta + PISI_BLOCK_TYPES.length
            ) % PISI_BLOCK_TYPES.length;
            renderPisiSlashMenu(block);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            applyPisiBlockType(block, PISI_BLOCK_TYPES[pisiBlocksEditorState.slashIndex].id);
            closePisiSlashMenu();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closePisiSlashMenu();
            return;
        }
    }
    if (event.key === '/' && !String(block.textContent || '').trim()) {
        event.preventDefault();
        openPisiSlashMenu(block);
        return;
    }
    applyPisiMarkdownBlockShortcut(event, block);
}

function handlePisiBlockDrop(editor, event) {
    const target = getPisiBlockAtEvent(editor, event.target);
    const dragged = editor.querySelector(
        `.pisi-editor-block[data-pisi-block-id="${CSS.escape(pisiBlocksEditorState.draggedBlockId || '')}"]`
    );
    if (!target || !dragged || target === dragged) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) target.before(dragged);
    else target.after(dragged);
    pisiBlocksEditorState.draggedBlockId = null;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    selectPisiBlock(editor, dragged);
}

function bindPisiBlocksEditor(editor) {
    if (!editor || editor.dataset.pisiBlocksEditorBound === '1') return false;
    editor.dataset.pisiBlocksEditorBound = '1';
    editor.classList.add('pisi-block-system');
    decoratePisiBlockTypes(editor);
    editor.addEventListener('focusin', (event) => {
        const block = getPisiBlockAtEvent(editor, event.target) || getPisiActiveBlock();
        if (block) selectPisiBlock(editor, block);
    });
    editor.addEventListener('pointerup', (event) => {
        const block = getPisiBlockAtEvent(editor, event.target);
        if (block) selectPisiBlock(editor, block);
    });
    editor.addEventListener('keydown', (event) => handlePisiBlocksEditorKeydown(editor, event));
    editor.addEventListener('input', () => {
        decoratePisiBlockTypes(editor);
        const block = getPisiActiveBlock();
        if (block) selectPisiBlock(editor, block);
    });
    editor.addEventListener('dragover', (event) => {
        if (pisiBlocksEditorState.draggedBlockId && getPisiBlockAtEvent(editor, event.target)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
        }
    });
    editor.addEventListener('drop', (event) => handlePisiBlockDrop(editor, event));
    return true;
}

function ensurePisiMarkdownSourceDialog() {
    if (pisiBlocksEditorState.sourceOverlay?.isConnected) return pisiBlocksEditorState.sourceOverlay;
    const overlay = document.createElement('div');
    overlay.className = 'pisi-markdown-source-overlay';
    overlay.hidden = true;
    const dialog = document.createElement('section');
    dialog.className = 'pisi-markdown-source-dialog';
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = pisiBlockTranslate('Markdown kaynak görünümü');
    const actions = document.createElement('div');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pisi-secondary-button';
    cancel.textContent = pisiBlockTranslate('İptal');
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'pisi-primary-button';
    apply.textContent = pisiBlockTranslate('WYSIWYG görünümüne uygula');
    actions.append(cancel, apply);
    header.append(title, actions);
    const textarea = document.createElement('textarea');
    textarea.className = 'pisi-markdown-source-textarea';
    textarea.spellcheck = false;
    dialog.append(header, textarea);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    cancel.addEventListener('click', closePisiMarkdownSource);
    apply.addEventListener('click', () => {
        const editor = pisiBlocksEditorState.sourceEditor;
        if (!editor) return closePisiMarkdownSource();
        editor.innerHTML = pisiBlockMarkdownToHtml(textarea.value);
        decoratePisiBlockTypes(editor);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        closePisiMarkdownSource();
        editor.focus();
    });
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiMarkdownSource();
    });
    pisiBlocksEditorState.sourceOverlay = overlay;
    pisiBlocksEditorState.sourceTextarea = textarea;
    return overlay;
}

function openPisiMarkdownSource(editor = getPisiActiveBlocksEditor()) {
    if (!editor) return false;
    const overlay = ensurePisiMarkdownSourceDialog();
    pisiBlocksEditorState.sourceEditor = editor;
    pisiBlocksEditorState.sourceTextarea.value = pisiBlockHtmlToMarkdown(editor);
    overlay.hidden = false;
    pisiBlocksEditorState.sourceTextarea.focus();
    return true;
}

function closePisiMarkdownSource() {
    if (pisiBlocksEditorState.sourceOverlay) pisiBlocksEditorState.sourceOverlay.hidden = true;
    pisiBlocksEditorState.sourceEditor = null;
}

function addPisiBlockBelow(block = getPisiActiveBlock()) {
    const editor = block?.closest('.pisi-rich-editor') || getPisiActiveBlocksEditor();
    if (!editor) return null;
    const next = document.createElement('div');
    next.className = 'pisi-editor-block';
    next.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}`;
    next.dataset.pisiBlockType = 'paragraph';
    next.innerHTML = '<br>';
    if (block) block.after(next);
    else editor.appendChild(next);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    selectPisiBlock(editor, next);
    next.focus();
    return next;
}

function initializePisiBlocksEditor() {
    const bindAll = () => [
        document.getElementById('center-node-editor-content'),
        document.getElementById('node-modal-content')
    ].forEach(bindPisiBlocksEditor);
    document.addEventListener('DOMContentLoaded', bindAll);
    document.addEventListener('pisi:active-node-changed', () => {
        bindAll();
        const editor = getPisiActiveBlocksEditor();
        if (editor) decoratePisiBlockTypes(editor);
    });
    window.addEventListener('resize', () => positionPisiBlockToolbar(getPisiActiveBlock()));
    window.addEventListener('scroll', () => positionPisiBlockToolbar(getPisiActiveBlock()), true);
    registerPisiCommand({
        id: 'pisi.block.markdown-source',
        label: 'Markdown kaynak görünümünü aç',
        description: 'Aktif node’u Markdown olarak düzenler ve WYSIWYG bloklarına uygular.',
        category: 'Bloklar',
        defaultShortcut: 'Mod+Shift+M',
        allowInInput: true,
        when: () => Boolean(getPisiActiveBlocksEditor()),
        handler: () => openPisiMarkdownSource()
    });
    registerPisiCommand({
        id: 'pisi.block.add-below',
        label: 'Aşağıya blok ekle',
        description: 'Aktif bloğun altına yeni bir paragraf bloğu ekler.',
        category: 'Bloklar',
        defaultShortcut: 'Mod+Enter',
        allowInInput: true,
        when: () => Boolean(getPisiActiveBlocksEditor()),
        handler: () => addPisiBlockBelow()
    });
    registerPisiCommand({
        id: 'pisi.block.move-up',
        label: 'Bloğu yukarı taşı',
        category: 'Bloklar',
        defaultShortcut: 'Alt+Shift+ArrowUp',
        allowInInput: true,
        when: () => Boolean(getPisiActiveBlock()),
        handler: () => movePisiBlock(getPisiActiveBlock(), -1)
    });
    registerPisiCommand({
        id: 'pisi.block.move-down',
        label: 'Bloğu aşağı taşı',
        category: 'Bloklar',
        defaultShortcut: 'Alt+Shift+ArrowDown',
        allowInInput: true,
        when: () => Boolean(getPisiActiveBlock()),
        handler: () => movePisiBlock(getPisiActiveBlock(), 1)
    });
    registerPisiExtension('toolbarTool', {
        id: 'core.markdown-source',
        label: 'Markdown kaynak görünümü',
        icon: 'MD',
        run: () => openPisiMarkdownSource()
    });
}

const moduleApi = {
    PISI_BLOCK_TYPES,
    pisiBlocksEditorState,
    pisiBlockMarkdownToHtml,
    pisiBlockHtmlToMarkdown,
    getPisiBlockType,
    getPisiActiveBlocksEditor,
    getPisiActiveBlock,
    decoratePisiBlockTypes,
    applyPisiBlockType,
    movePisiBlock,
    duplicatePisiBlock,
    deletePisiBlock,
    copyPisiBlockReference,
    bindPisiBlocksEditor,
    openPisiMarkdownSource,
    closePisiMarkdownSource,
    addPisiBlockBelow,
    initializePisiBlocksEditor
};

registerModule('editor.blocks', moduleApi);
initializePisiBlocksEditor();

export {
    PISI_BLOCK_TYPES,
    addPisiBlockBelow,
    applyPisiBlockType,
    bindPisiBlocksEditor,
    closePisiMarkdownSource,
    copyPisiBlockReference,
    decoratePisiBlockTypes,
    deletePisiBlock,
    duplicatePisiBlock,
    getPisiActiveBlock,
    getPisiActiveBlocksEditor,
    getPisiBlockType,
    movePisiBlock,
    openPisiMarkdownSource,
    pisiBlocksEditorState,
    pisiBlockHtmlToMarkdown,
    pisiBlockMarkdownToHtml
};
