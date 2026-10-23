import { createPisiTaskBlockKeyboard } from './pisi-task-block-keyboard.mjs';
import { bindPisiEditorHistory } from './pisi-editor-history.mjs';
import { getPisiBlockKeyboardContext, pisiBeforeInputAsKey, insertPisiKeyboardLineBreak } from './pisi-block-keyboard-context.mjs';
import { handlePisiBlockBoundaryKey } from './pisi-block-keyboard-boundaries.mjs';
import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
const PISI_BLOCK_TYPES = Object.freeze([
    Object.freeze({ id: 'paragraph', label: 'Paragraf', tag: 'div' }),
    Object.freeze({ id: 'heading1', label: 'Başlık 1', tag: 'h1' }),
    Object.freeze({ id: 'heading2', label: 'Başlık 2', tag: 'h2' }),
    Object.freeze({ id: 'heading3', label: 'Başlık 3', tag: 'h3' }),
    Object.freeze({ id: 'heading4', label: 'Başlık 4', tag: 'h4' }),
    Object.freeze({ id: 'heading5', label: 'Başlık 5', tag: 'h5' }),
    Object.freeze({ id: 'quote', label: 'Alıntı', tag: 'blockquote' }),
    Object.freeze({ id: 'code', label: 'Kod', tag: 'pre' }),
    Object.freeze({ id: 'bullet', label: 'Madde işareti', tag: 'div' }),
    Object.freeze({ id: 'number', label: 'Numaralı madde', tag: 'div' }),
    Object.freeze({ id: 'task', label: 'Görev bloğu', tag: 'div' }),
    Object.freeze({ id: 'rollup', label: 'Rollup bloğu', tag: 'div' })
]);
const PISI_BLOCK_SLASH_COMMANDS = Object.freeze([
    ...PISI_BLOCK_TYPES.filter((record) => record.id !== 'rollup').map((record) =>
        Object.freeze({
            ...record,
            slash: record.id === 'task' ? 'todo' : record.id,
            action: record.id === 'task' ? 'todo' : 'block'
        })
    ),
    Object.freeze({ id: 'done', label: 'Tamamlanmış görev', slash: 'done', action: 'done' })
]);
const { splitPisiTaskBlockOnEnter, handlePisiTaskBlockBackspace, removePisiTaskMetadataAndMarkerFromBlock, placeCaretAtEndOfPisiBlock } =
    createPisiTaskBlockKeyboard({
        getPisiBlockType,
        selectPisiBlock,
        placeCaretAtStartOfPisiBlock
    });
const pisiHydratedTaskMarkers = new WeakSet();
const pisiBlocksEditorState = {
    editor: null,
    block: null,
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
    return /^(?:https?:|mailto:|#|\/|\.)/i.test(url) ? url : '';
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
function extractPisiBlockMeta(block) {
    const meta = {};
    const ds = block?.dataset || {};
    if (ds.pisiBlockId) meta.id = ds.pisiBlockId;
    if (ds.pisiTaskId) meta.taskId = ds.pisiTaskId;
    if (ds.pisiHeadingParent) meta.headingParent = ds.pisiHeadingParent;
    if (ds.pisiTodoParent) meta.todoParent = ds.pisiTodoParent;
    if (ds.pisiBlockRef) meta.blockRef = ds.pisiBlockRef;
    if (ds.pisiBulletIndent) meta.indent = Number(ds.pisiBulletIndent);
    if (ds.pisiBulletCollapsed === 'true') meta.collapsed = true;
    if (ds.pisiTodoRepeat) meta.repeat = ds.pisiTodoRepeat;
    if (ds.pisiTodoScheduledAt) meta.scheduledAt = ds.pisiTodoScheduledAt;
    if (ds.pisiTodoDeadline) meta.deadline = ds.pisiTodoDeadline;
    if (ds.pisiTodoReminderAt) meta.reminderAt = ds.pisiTodoReminderAt;
    const tagEl = block.querySelector?.('.pisi-user-tag[data-pisi-tag]');
    if (tagEl) {
        const tag = tagEl.dataset.pisiTag;
        if (tag && tag !== 'done') meta.tag = tag;
    }
    return Object.keys(meta).length ? meta : null;
}
function buildExtraBlockAttrs(meta) {
    if (!meta || typeof meta !== 'object') return '';
    let attrs = '';
    const map = {
        taskId: 'data-pisi-task-id',
        headingParent: 'data-pisi-heading-parent',
        todoParent: 'data-pisi-todo-parent',
        blockRef: 'data-pisi-block-ref',
        repeat: 'data-pisi-todo-repeat',
        scheduledAt: 'data-pisi-todo-scheduled-at',
        deadline: 'data-pisi-todo-deadline',
        reminderAt: 'data-pisi-todo-reminder-at'
    };
    for (const [key, attr] of Object.entries(map)) {
        if (meta[key]) attrs += ` ${attr}="${escapePisiBlockHtml(meta[key])}"`;
    }
    if (meta.collapsed) attrs += ' data-pisi-bullet-collapsed="true"';
    return attrs;
}
function makePisiBlockHtml(type, content, indent = 0, meta = null) {
    const record = PISI_BLOCK_TYPES.find((item) => item.id === type) || PISI_BLOCK_TYPES[0];
    const blockId = meta?.id || window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const ind = meta?.indent !== undefined ? meta.indent : indent;
    const indentAttr = ind > 0 ? ` data-pisi-bullet-indent="${ind}" style="--pisi-bullet-indent:${ind};"` : '';
    const extra = buildExtraBlockAttrs(meta);
    return `<${record.tag} class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-block-type="${record.id}"${indentAttr}${extra}>${content || '<br>'}</${record.tag}>`;
}
const encodePisiRollupMarkdownValue = (value = '') => encodeURIComponent(String(value || ''));
function decodePisiRollupMarkdownValue(value = '') {
    try {
        return decodeURIComponent(String(value || ''));
    } catch {
        return '';
    }
}
function makePisiRollupBlockHtml(config = {}) {
    const blockId = config.blockId || window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const relation = escapePisiBlockHtml(config.relationProperty || '');
    const target = escapePisiBlockHtml(config.targetProperty || '');
    const aggregate = /^(?:count|sum|average|min|max|unique|join)$/.test(config.aggregate) ? config.aggregate : 'count';
    const extra = buildExtraBlockAttrs(config.meta);
    return `<div class="pisi-editor-block pisi-rollup-block" data-pisi-block-id="${blockId}" data-pisi-block-type="rollup" data-pisi-rollup-relation="${relation}" data-pisi-rollup-target="${target}" data-pisi-rollup-aggregate="${aggregate}" contenteditable="false"${extra}><div class="pisi-rollup-block-loading">Rollup</div></div>`;
}
function pisiBlockMarkdownToHtml(markdown = '') {
    const lines = String(markdown || '')
        .replace(/\r\n?/g, '\n')
        .split('\n');
    const output = [];
    let codeLines = null,
        codeMeta = null;
    for (const rawLine of lines) {
        if (/^\`\`\`/.test(rawLine)) {
            if (codeLines) {
                const closingMeta = rawLine.match(/\s*<!--\s*pisi:meta\s+(\{[\s\S]*?\})\s*-->\s*$/);
                if (closingMeta) {
                    try {
                        codeMeta = JSON.parse(closingMeta[1]);
                    } catch {
                        // Keep metadata from the opening fence if closing metadata is malformed.
                    }
                }
                output.push(makePisiBlockHtml('code', escapePisiBlockHtml(codeLines.join('\n')), 0, codeMeta));
                codeLines = null;
                codeMeta = null;
            } else {
                codeLines = [];
                const m = rawLine.match(/\s*<!--\s*pisi:meta\s+(\{[\s\S]*?\})\s*-->\s*$/);
                if (m) {
                    try {
                        codeMeta = JSON.parse(m[1]);
                    } catch {}
                }
            }
            continue;
        }
        if (codeLines) {
            codeLines.push(rawLine);
            continue;
        }
        let meta = null;
        const metaMatch = rawLine.match(/\s*<!--\s*pisi:meta\s+(\{[\s\S]*?\})\s*-->\s*$/);
        let line = rawLine;
        if (metaMatch) {
            try {
                meta = JSON.parse(metaMatch[1]);
                line = rawLine.slice(0, metaMatch.index);
            } catch {}
        }
        if (/^<!--\s*pisi:section-end(?:\s*-->)?/.test(line)) {
            const blockId = meta?.id || window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            output.push(
                `<div class="pisi-editor-block pisi-section-break" data-pisi-block-id="${blockId}" data-pisi-section-break="true"${buildExtraBlockAttrs(meta)}><br></div>`
            );
            continue;
        }
        const rollup = line.match(/^\{\{pisi-rollup:([^:]*):([^:]*):(count|sum|average|min|max|unique|join)\}\}/);
        const heading = line.match(/^(#{1,5})\s+(.+)$/);
        const task = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
        const bullet = line.match(/^(\s*)([-*+])\s+(.+)$/);
        const number = line.match(/^\d+[.)]\s+(.+)$/);
        const quote = line.match(/^>\s?(.*)$/);
        if (rollup) {
            output.push(
                makePisiRollupBlockHtml({
                    relationProperty: decodePisiRollupMarkdownValue(rollup[1]),
                    targetProperty: decodePisiRollupMarkdownValue(rollup[2]),
                    aggregate: rollup[3],
                    blockId: meta?.id,
                    meta
                })
            );
        } else if (heading) {
            output.push(makePisiBlockHtml(`heading${heading[1].length}`, pisiInlineMarkdownToHtml(heading[2]), 0, meta));
        } else if (task) {
            const checked = task[1].toLowerCase() === 'x';
            const taskText = pisiInlineMarkdownToHtml(task[2]);
            let taskContent = '';
            if (meta?.tag) {
                const tag = escapePisiBlockHtml(meta.tag);
                const taskIdAttr = meta.taskId ? ` data-pisi-task-id="${escapePisiBlockHtml(meta.taskId)}"` : '';
                const marker = `<span class="pisi-block-task-marker" contenteditable="false" data-pisi-todo-checkbox="${tag}" role="checkbox" aria-checked="${checked}">${checked ? '☑' : '☐'}</span>`;
                const tagEl = `<span class="pisi-user-tag pisi-task-metadata" data-pisi-tag="${tag}"${taskIdAttr} contenteditable="false" aria-hidden="true">${tag}</span>`;
                const doneEl = checked
                    ? `<span class="pisi-user-tag pisi-task-metadata" data-pisi-tag="done" data-pisi-done-for="${tag}" contenteditable="false" aria-hidden="true">done</span>`
                    : '';
                const source = `<span class="pisi-todo-source" data-pisi-todo-for="${tag}">${taskText || '&nbsp;'}</span>`;
                taskContent = `${marker}${tagEl}${doneEl} ${source}`;
            } else {
                taskContent = `<span class="pisi-block-task-marker" contenteditable="false">${checked ? '☑' : '☐'}</span> ${taskText}`;
            }
            output.push(makePisiBlockHtml('task', taskContent, 0, meta));
        } else if (bullet) {
            const indent = Math.min(Math.floor(bullet[1].replace(/\t/g, '  ').length / 2), 6);
            output.push(makePisiBlockHtml('bullet', pisiInlineMarkdownToHtml(bullet[3]), indent, meta));
        } else if (number) {
            output.push(makePisiBlockHtml('number', pisiInlineMarkdownToHtml(number[1]), 0, meta));
        } else if (quote) {
            output.push(makePisiBlockHtml('quote', pisiInlineMarkdownToHtml(quote[1]), 0, meta));
        } else {
            output.push(makePisiBlockHtml('paragraph', line ? pisiInlineMarkdownToHtml(line) : '<br>', 0, meta));
        }
    }
    if (codeLines) output.push(makePisiBlockHtml('code', escapePisiBlockHtml(codeLines.join('\n')), 0, codeMeta));
    return output.join('');
}
function pisiInlineHtmlToMarkdown(element) {
    const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const body = Array.from(node.childNodes).map(visit).join('');
        if (node.matches('.pisi-block-task-marker')) return '';
        if (
            node.matches('.pisi-task-metadata') ||
            node.matches('.pisi-user-tag[data-pisi-tag="done"]') ||
            node.matches('.pisi-user-tag[data-pisi-tag^="todo."]')
        ) {
            return '';
        }
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
    if (/^h[1-5]$/.test(tag)) return `heading${tag.slice(1)}`;
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
    let numberRun = 0;
    return blocks
        .map((block) => {
            const type = getPisiBlockType(block);
            const meta = extractPisiBlockMeta(block);
            const metaStr = meta ? ` <!-- pisi:meta ${JSON.stringify(meta)} -->` : '';
            if (type === 'rollup') {
                const relation = encodePisiRollupMarkdownValue(block.dataset.pisiRollupRelation || '');
                const target = encodePisiRollupMarkdownValue(block.dataset.pisiRollupTarget || '');
                const aggregate = /^(?:count|sum|average|min|max|unique|join)$/.test(block.dataset.pisiRollupAggregate)
                    ? block.dataset.pisiRollupAggregate
                    : 'count';
                return `{{pisi-rollup:${relation}:${target}:${aggregate}}}${metaStr}`;
            }
            const text = pisiInlineHtmlToMarkdown(block);
            if (block.classList.contains('pisi-section-break') || block.dataset?.pisiSectionBreak === 'true') {
                return `<!-- pisi:section-end -->${metaStr}`;
            }
            if (type.startsWith('heading')) return `${'#'.repeat(Number(type.slice(-1)))} ${text}${metaStr}`;
            if (type === 'quote') return `> ${text}${metaStr}`;
            if (type === 'code') return '```\n' + (block.textContent || '') + '\n```' + metaStr;
            if (type === 'bullet') {
                const indent = Number(block.dataset?.pisiBulletIndent || 0);
                return `${'  '.repeat(indent)}- ${text}${metaStr}`;
            }
            if (type === 'number') return `${++numberRun}. ${text}${metaStr}`;
            numberRun = 0;
            if (type === 'task') {
                const marker = block.querySelector('.pisi-block-task-marker');
                const checked =
                    marker?.textContent === '☑' ||
                    marker?.getAttribute('aria-checked') === 'true' ||
                    Boolean(block.querySelector('.pisi-user-tag[data-pisi-tag="done"]'));
                return `- [${checked ? 'x' : ' '}] ${text.trimStart()}${metaStr}`;
            }
            return `${text}${metaStr}`;
        })
        .join('\n');
}
function getPisiActiveBlocksEditor() {
    if (window.activeModalNode) return document.getElementById('node-modal-content');
    if (window.activeCenterNode) return document.getElementById('center-node-editor-content');
    return pisiBlocksEditorState.editor?.isConnected ? pisiBlocksEditorState.editor : null;
}
function getPisiSelectionBlock(editor) {
    if (!editor) return null;
    const selection = window.getSelection?.();
    let anchorNode = selection?.anchorNode || (selection?.rangeCount ? selection.getRangeAt(0)?.startContainer : null);
    if (!anchorNode || !editor.contains?.(anchorNode)) return null;
    if (anchorNode === editor) {
        const offset = selection?.anchorNode === editor ? selection.anchorOffset : selection.getRangeAt(0)?.startOffset || 0;
        anchorNode = editor.childNodes[offset] || editor.childNodes[offset - 1] || null;
        if (!anchorNode) return null;
    }
    const block =
        window.getPisiCurrentEditorBlock?.(editor, anchorNode) ||
        (anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement)?.closest?.('.pisi-editor-block');
    return block && block !== editor && editor.contains?.(block) ? block : null;
}
function getPisiActiveBlock() {
    const editor = getPisiActiveBlocksEditor();
    if (!editor) return null;
    const selectedBlock = getPisiSelectionBlock(editor);
    if (selectedBlock) return selectedBlock;
    if (pisiBlocksEditorState.block && editor.contains(pisiBlocksEditorState.block)) return pisiBlocksEditorState.block;
    return editor.querySelector('.pisi-editor-block');
}
function setPisiBlockTaskMarkerState(marker, checked) {
    if (!marker) return;
    marker.contentEditable = 'false';
    const nextText = checked ? '☑' : '☐';
    if (marker.textContent !== nextText) {
        marker.textContent = nextText;
    }
    marker.setAttribute('role', 'checkbox');
    marker.setAttribute('aria-checked', String(Boolean(checked)));
    marker.setAttribute('aria-label', checked ? 'Görevi yeniden aç' : 'Görevi tamamla');
    marker.tabIndex = 0;
}
function hydratePisiBlockTaskMarker(block, markerOverride = null) {
    const marker = markerOverride || block?.querySelector?.('.pisi-block-task-marker');
    if (!block || !marker) return null;
    const checked = marker.getAttribute('aria-checked') === 'true' || marker.textContent === '☑';
    setPisiBlockTaskMarkerState(marker, checked);
    if (pisiHydratedTaskMarkers.has(marker)) return marker;
    pisiHydratedTaskMarkers.add(marker);
    const toggle = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextChecked = marker.getAttribute('aria-checked') !== 'true';
        if (marker.dataset.pisiTodoCheckbox && typeof window.setPisiTodoBlockCompletion === 'function') {
            window.setPisiTodoBlockCompletion(block, nextChecked, {
                todoTag: marker.dataset.pisiTodoCheckbox
            });
            return;
        }
        setPisiBlockTaskMarkerState(marker, nextChecked);
        block.closest('.pisi-rich-editor')?.dispatchEvent(new Event('input', { bubbles: true }));
    };
    marker.addEventListener('click', toggle);
    marker.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') toggle(event);
    });
    return marker;
}
function decoratePisiBlockTypes(editor) {
    window.ensurePisiEditorBlocks?.(editor);
    window.syncPisiTodoBlockMarkers?.(editor);
    editor?.querySelectorAll?.('.pisi-editor-block').forEach((block) => {
        if (!block.dataset.pisiBlockType) block.dataset.pisiBlockType = getPisiBlockType(block);
        if (getPisiBlockType(block) === 'task') hydratePisiBlockTaskMarker(block);
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
// Centralized finalization for structural block edits. Keep the existing
// editor input/save pipeline as the single persistence authority.
function commitPisiBlockMutation(editor, selectedBlock, options = {}) {
    if (!editor) return false;
    if (options.normalize) window.ensurePisiEditorBlocks?.(editor);
    window.syncPisiWordHeadingCollapse?.(editor);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (selectedBlock?.isConnected && editor.contains(selectedBlock)) selectPisiBlock(editor, selectedBlock);
    return true;
}
function applyPisiBlockType(block, type) {
    const record = PISI_BLOCK_TYPES.find((item) => item.id === type);
    if (!block || !record) return null;
    const editor = block.closest('.pisi-rich-editor');
    const previousType = getPisiBlockType(block);
    let next = replacePisiBlockTag(block, record.tag);
    next.classList.add('pisi-editor-block');
    if (previousType === 'task' && record.id !== 'task') removePisiTaskMetadataAndMarkerFromBlock(next);
    if (record.id !== 'bullet') {
        delete next.dataset.pisiBulletIndent;
        delete next.dataset.pisiBulletCollapsed;
        delete next.dataset.pisiBulletHasChildren;
        next.style?.removeProperty?.('--pisi-bullet-indent');
        next.classList.remove('pisi-bullet-collapsed', 'pisi-bullet-has-children', 'pisi-bullet-hidden');
    }
    next.dataset.pisiBlockType = record.id;
    if (record.id !== 'task' && !next.textContent && !next.querySelector?.('br')) next.innerHTML = '<br>';
    if (record.id === 'task' && !next.querySelector('.pisi-block-task-marker')) {
        const marker = document.createElement('span');
        marker.className = 'pisi-block-task-marker';
        setPisiBlockTaskMarkerState(marker, false);
        next.prepend(marker);
    }
    if (record.id === 'task') hydratePisiBlockTaskMarker(next);
    pisiBlocksEditorState.block = next;
    commitPisiBlockMutation(editor, next);
    return next;
}
function getPisiMovableBlockSection(editor, block) {
    if (!editor || !block || block.parentElement !== editor || !block.classList.contains('pisi-editor-block')) return [];
    const descendants =
        (block.dataset?.pisiBlockType === 'bullet' ? window.getPisiBulletDescendants?.(editor, block) : window.getPisiHeadingSectionBlocks?.(editor, block)) ||
        [];
    const section = [block, ...descendants];
    // A section must be a contiguous sequence of direct editor children.
    if (section.some((item, index) => item.parentElement !== editor || (index > 0 && section[index - 1].nextElementSibling !== item))) return [];
    return section;
}
function getPisiBlockSectionEnd(editor, block) {
    const section = getPisiMovableBlockSection(editor, block);
    return section.length ? section[section.length - 1] : null;
}
function getPisiMoveHeadingLevel(block) {
    const match = String(block?.dataset?.pisiBlockType || '').match(/^heading([1-5])$/);
    return match ? Number(match[1]) : 0;
}
function getPisiHeadingBoundary(editor, target, movingHeadingLevel) {
    if (!movingHeadingLevel) return target;
    // Resolve a paragraph inside another heading's section to its containing
    // heading at or above the moving heading's level. Never split that section.
    let current = target;
    while (current && current.parentElement === editor) {
        const level = getPisiMoveHeadingLevel(current);
        if (level && level <= movingHeadingLevel) return current;
        if (current.dataset?.pisiSectionBreak === 'true' && !current.dataset?.pisiSectionExit) break;
        current = current.previousElementSibling;
    }
    return target;
}
function movePisiBlock(block, delta) {
    if (!block || (delta !== -1 && delta !== 1)) return false;
    const editor = block.closest('.pisi-rich-editor');
    const items = getPisiMovableBlockSection(editor, block);
    if (!items.length) return false;
    const last = items[items.length - 1];
    const headingLevel = getPisiMoveHeadingLevel(block);
    if (delta < 0) {
        const prev = block.previousElementSibling;
        if (!prev) return false;
        const anchor = getPisiHeadingBoundary(editor, prev, headingLevel);
        if (!anchor || items.includes(anchor)) return false;
        anchor.before(...items);
    } else {
        const next = last.nextElementSibling;
        if (!next) return false;
        const boundary = getPisiHeadingBoundary(editor, next, headingLevel);
        const targetEnd = getPisiBlockSectionEnd(editor, boundary);
        if (!targetEnd || items.includes(targetEnd)) return false;
        targetEnd.after(...items);
    }
    commitPisiBlockMutation(editor, block);
    return true;
}
function duplicatePisiBlock(block) {
    if (!block) return null;
    const editor = block.closest?.('.pisi-rich-editor');
    const children =
        (block.dataset?.pisiBlockType === 'bullet' ? window.getPisiBulletDescendants?.(editor, block) : window.getPisiHeadingSectionBlocks?.(editor, block)) ||
        [];
    const sourceBlocks = [block, ...children];
    const clones = sourceBlocks.map((item) => item.cloneNode(true));
    const blockIdMap = new Map();
    const taskIdMap = new Map();
    const makeBlockId = () => window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const makeTaskId = () => window.makePisiFirstClassTaskId?.() || `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    for (const clone of clones) {
        const blocks = [clone, ...(clone.querySelectorAll?.('[data-pisi-block-id], .pisi-editor-block') || [])];
        for (const el of new Set(blocks)) {
            const oldId = el.dataset?.pisiBlockId;
            const newId = makeBlockId();
            if (oldId) blockIdMap.set(oldId, newId);
            el.dataset.pisiBlockId = newId;
            if (el.id && oldId && el.id === oldId) el.id = newId;
        }
        for (const el of new Set([clone, ...(clone.querySelectorAll?.('[data-pisi-task-id]') || [])])) {
            const oldTaskId = el.dataset?.pisiTaskId;
            if (oldTaskId && !taskIdMap.has(oldTaskId)) taskIdMap.set(oldTaskId, makeTaskId());
            if (oldTaskId) el.dataset.pisiTaskId = taskIdMap.get(oldTaskId);
        }
    }
    const remapAttrs = [
        'pisiHeadingParent',
        'pisiRollupTarget',
        'pisiRollupRelation',
        'pisiTodoFor',
        'pisiDoneFor',
        'pisiBlockRef',
        'pisiDiaryBlockId',
        'pisiDiaryParent'
    ];
    for (const clone of clones) {
        for (const el of [clone, ...(clone.querySelectorAll?.('*') || [])]) {
            el.classList?.remove?.('pisi-block-active', 'pisi-heading-collapsed', 'pisi-heading-section-hidden');
            if (el.dataset?.pisiTaskId && taskIdMap.has(el.dataset.pisiTaskId)) el.dataset.pisiTaskId = taskIdMap.get(el.dataset.pisiTaskId);
            for (const attr of remapAttrs) if (el.dataset?.[attr] && blockIdMap.has(el.dataset[attr])) el.dataset[attr] = blockIdMap.get(el.dataset[attr]);
            if (el.dataset?.pisiTodoParent) {
                let pVal = el.dataset.pisiTodoParent;
                for (const [o, n] of taskIdMap) pVal = pVal.split(o).join(n);
                for (const [o, n] of blockIdMap) pVal = pVal.split(o).join(n);
                el.dataset.pisiTodoParent = pVal;
            }
            if (el.tagName === 'A' && el.getAttribute?.('href')) {
                let href = el.getAttribute('href');
                for (const [o, n] of blockIdMap) if (href.includes('#' + o)) href = href.split('#' + o).join('#' + n);
                el.setAttribute('href', href);
            }
        }
        const markers = clone.querySelectorAll?.('.pisi-block-task-marker');
        if (markers?.length) markers.forEach((m) => hydratePisiBlockTaskMarker(m.closest('.pisi-editor-block') || clone, m));
        else hydratePisiBlockTaskMarker(clone);
    }
    const lastSource = sourceBlocks[sourceBlocks.length - 1];
    if (typeof lastSource.after === 'function') lastSource.after(...clones);
    else if (lastSource.parentNode) {
        const next = lastSource.nextSibling;
        clones.forEach((clone) => lastSource.parentNode.insertBefore(clone, next));
    }
    commitPisiBlockMutation(editor, clones[0]);
    return clones[0];
}
function deletePisiBlock(block) {
    if (!block) return false;
    const editor = block.closest('.pisi-rich-editor');
    const focusTarget = block.nextElementSibling || block.previousElementSibling;
    block.remove();
    commitPisiBlockMutation(editor, focusTarget || editor?.querySelector('.pisi-editor-block'), { normalize: true });
    return true;
}
function copyPisiBlockReference(block = getPisiActiveBlock()) {
    const editor = block?.closest('.pisi-rich-editor');
    if (!editor || !block?.isConnected || !editor.contains(block)) return false;
    const node = editor.id === 'node-modal-content' ? window.activeModalNode : editor.id === 'center-node-editor-content' ? window.activeCenterNode : null;
    const blockId = block.dataset?.pisiBlockId;
    if (!node?.path || !blockId) return false;
    // Never publish an ambiguous link while pasted/duplicated blocks still
    // have a duplicate identity. Normalization will repair the IDs.
    const matches = Array.from(editor.querySelectorAll('[data-pisi-block-id]')).filter((item) => item.dataset.pisiBlockId === blockId);
    if (matches.length !== 1 || matches[0] !== block) return false;
    const reference = `${node.path}#${blockId}`;
    window.pisiClipboard?.writeText?.(reference);
    return reference;
}
function selectPisiBlock(editor, block) {
    if (!editor || !block || !editor.contains(block)) return null;
    pisiBlocksEditorState.editor?.querySelectorAll('.pisi-block-active').forEach((item) => item.classList.remove('pisi-block-active'));
    pisiBlocksEditorState.editor = editor;
    pisiBlocksEditorState.block = block;
    block.classList.add('pisi-block-active');
    document.dispatchEvent(
        new CustomEvent('pisi:block-selected', {
            detail: {
                nodePath: editor.id === 'node-modal-content' ? window.activeModalNode?.path : window.activeCenterNode?.path,
                blockId: block.dataset.pisiBlockId,
                type: getPisiBlockType(block),
                text: String(block.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
            }
        })
    );
    return block;
}
function getPisiBlockAtEvent(editor, target) {
    if (target?.closest?.('.pisi-sheet-block, ' + '.pisi-sheet-caret-anchor, ' + '.pisi-canvas-block')) {
        return null;
    }
    const block = target?.closest?.('.pisi-editor-block');
    return block && editor.contains(block) ? block : null;
}
function applyPisiMarkdownBlockShortcut(event, block) {
    if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return false;
    const marker = String(block.textContent || '').trim();
    const type = {
        '#': 'heading1',
        '##': 'heading2',
        '###': 'heading3',
        '####': 'heading4',
        '#####': 'heading5',
        '>': 'quote',
        '-': 'bullet',
        '*': 'bullet',
        '1.': 'number',
        '[]': 'task',
        '[ ]': 'task'
    }[marker];
    if (!type) return false;
    event.preventDefault();
    event.stopPropagation();
    block.innerHTML = type === 'task' ? '' : '<br>';
    const next = applyPisiBlockType(block, type);
    if (next) {
        next.closest('.pisi-rich-editor')?.focus?.({ preventScroll: true });
        if (type === 'task') placeCaretAtEndOfPisiBlock(window.getSelection?.(), next);
        else placeCaretAtStartOfPisiBlock(window.getSelection?.(), next);
    }
    return true;
}
function placeCaretAtStartOfPisiBlock(selection, block) {
    if (!selection || !block || typeof document.createRange !== 'function') return;
    if (!block.textContent && !block.querySelector?.('br')) block.innerHTML = '<br>';
    const caret = document.createRange();
    if (block.firstChild && block.firstChild.nodeType === Node.TEXT_NODE && block.firstChild.nodeValue?.length) {
        caret.setStart(block.firstChild, 0);
    } else {
        caret.setStart(block, 0);
    }
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
}
window.placeCaretAtStartOfPisiBlock = placeCaretAtStartOfPisiBlock;
window.getPisiSelectionBlock = getPisiSelectionBlock;
function handlePisiBlocksEditorKeydown(editor, event) {
    const context = getPisiBlockKeyboardContext(editor, event);
    if (!context) return;
    const { block, range } = context;
    if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !window.pisiTagMenuState?.active) {
        event.preventDefault();
        event.stopImmediatePropagation();
        insertPisiKeyboardLineBreak(editor, block, range);
        commitPisiBlockMutation(editor, block);
        return;
    }
    if (splitPisiTaskBlockOnEnter(editor, block, event)) return;
    if (window.handlePisiBulletKeydown?.(editor, event, block)) return;
    if (window.handlePisiHeadingSectionKeydown?.(editor, event, block)) return;
    if (handlePisiTaskBlockBackspace(editor, block, event)) return;
    if (handlePisiBlockBoundaryKey(editor, event, removePisiTaskMetadataAndMarkerFromBlock)) return;
    applyPisiMarkdownBlockShortcut(event, block);
}
function handlePisiBlockDrop(editor, event) {
    const target = getPisiBlockAtEvent(editor, event.target);
    const draggedId = pisiBlocksEditorState.draggedBlockId;
    if (!draggedId) return;
    const dragged = Array.from(editor.children).find((item) => item.dataset?.pisiBlockId === draggedId);
    const items = getPisiMovableBlockSection(editor, dragged);
    if (!target || target.parentElement !== editor || !items.length || items.includes(target)) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    const boundary = getPisiHeadingBoundary(editor, target, getPisiMoveHeadingLevel(dragged));
    const anchor = before ? boundary : getPisiBlockSectionEnd(editor, boundary);
    if (!anchor || items.includes(anchor)) return;
    if (before) anchor.before(...items);
    else anchor.after(...items);
    pisiBlocksEditorState.draggedBlockId = null;
    commitPisiBlockMutation(editor, dragged);
}
function bindPisiBlocksEditor(editor) {
    if (!editor || editor.dataset.pisiBlocksEditorBound === '1') return false;
    editor.dataset.pisiBlocksEditorBound = '1';
    editor.classList.add('pisi-block-system');
    decoratePisiBlockTypes(editor);
    bindPisiEditorHistory(editor);
    editor.addEventListener('focusin', (event) => {
        const block = getPisiSelectionBlock(editor) || getPisiBlockAtEvent(editor, event.target) || getPisiActiveBlock();
        if (block) selectPisiBlock(editor, block);
    });
    editor.addEventListener('pointerup', (event) => {
        const block = getPisiBlockAtEvent(editor, event.target) || getPisiSelectionBlock(editor);
        if (block) selectPisiBlock(editor, block);
    });
    editor.addEventListener('keydown', (event) => handlePisiBlocksEditorKeydown(editor, event));
    editor.addEventListener('beforeinput', (event) => {
        const keyEvent = pisiBeforeInputAsKey(event);
        if (keyEvent) handlePisiBlocksEditorKeydown(editor, keyEvent);
    });
    editor.addEventListener('keyup', () => {
        const block = getPisiSelectionBlock(editor);
        if (block && block !== pisiBlocksEditorState.block) {
            selectPisiBlock(editor, block);
        }
    });
    editor.addEventListener('input', () => {
        decoratePisiBlockTypes(editor);
        const block = getPisiSelectionBlock(editor) || getPisiActiveBlock();
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
    overlay.innerHTML = `<section class="pisi-markdown-source-dialog"><header><strong>${pisiBlockTranslate('Markdown kaynak görünümü')}</strong><div><button type="button" class="pisi-secondary-button pisi-cancel-md">${pisiBlockTranslate('İptal')}</button><button type="button" class="pisi-primary-button pisi-apply-md">${pisiBlockTranslate('WYSIWYG görünümüne uygula')}</button></div></header><div class="pisi-markdown-source-warning" style="display:none;padding:6px 12px;background:#fff3cd;color:#856404;font-size:12px;"></div><textarea class="pisi-markdown-source-textarea" spellcheck="false"></textarea></section>`;
    document.body.appendChild(overlay);
    const cancel = overlay.querySelector('.pisi-cancel-md');
    const apply = overlay.querySelector('.pisi-apply-md');
    const textarea = overlay.querySelector('.pisi-markdown-source-textarea');
    const warning = overlay.querySelector('.pisi-markdown-source-warning');
    cancel.addEventListener('click', closePisiMarkdownSource);
    apply.addEventListener('click', () => {
        const editor = pisiBlocksEditorState.sourceEditor;
        if (!editor) return closePisiMarkdownSource();
        if (editor.querySelector?.('.pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet]')) {
            window.alert?.(
                pisiBlockTranslate(
                    'Sheet veya Canvas içeren notlarda Markdown kaynağı uygulanamaz. Veri kaybını önlemek için bu blokları ayrı bir nota taşıyın.'
                )
            );
            return;
        }
        editor.innerHTML = pisiBlockMarkdownToHtml(textarea.value);
        decoratePisiBlockTypes(editor);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        closePisiMarkdownSource();
        editor.focus?.();
    });
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiMarkdownSource();
    });
    pisiBlocksEditorState.sourceOverlay = overlay;
    pisiBlocksEditorState.sourceTextarea = textarea;
    pisiBlocksEditorState.sourceWarning = warning;
    return overlay;
}
function openPisiMarkdownSource(editor = getPisiActiveBlocksEditor()) {
    if (!editor) return false;
    const overlay = ensurePisiMarkdownSourceDialog();
    pisiBlocksEditorState.sourceEditor = editor;
    pisiBlocksEditorState.sourceTextarea.value = pisiBlockHtmlToMarkdown(editor);
    const hasSpecial = Boolean(editor.querySelector?.('.pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet]'));
    if (pisiBlocksEditorState.sourceWarning) {
        pisiBlocksEditorState.sourceWarning.style.display = hasSpecial ? 'block' : 'none';
        pisiBlocksEditorState.sourceWarning.textContent = hasSpecial
            ? pisiBlockTranslate('Dikkat: Bu notta Sheet veya Canvas blokları bulunmaktadır. WYSIWYG görünümüne uygulandığında bu bloklar sıfırlanabilir.')
            : '';
    }
    overlay.hidden = false;
    pisiBlocksEditorState.sourceTextarea.focus?.();
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
    const bindAll = () => [document.getElementById('center-node-editor-content'), document.getElementById('node-modal-content')].forEach(bindPisiBlocksEditor);
    if (document.readyState !== 'loading') bindAll();
    document.addEventListener('DOMContentLoaded', bindAll);
    document.addEventListener('pisi:active-node-changed', () => {
        bindAll();
        const editor = getPisiActiveBlocksEditor();
        if (editor) decoratePisiBlockTypes(editor);
    });
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
}
const moduleApi = {
    PISI_BLOCK_TYPES,
    PISI_BLOCK_SLASH_COMMANDS,
    pisiBlocksEditorState,
    pisiBlockMarkdownToHtml,
    pisiBlockHtmlToMarkdown,
    getPisiBlockType,
    getPisiActiveBlocksEditor,
    getPisiActiveBlock,
    hydratePisiBlockTaskMarker,
    decoratePisiBlockTypes,
    applyPisiBlockType,
    movePisiBlock,
    duplicatePisiBlock,
    deletePisiBlock,
    copyPisiBlockReference,
    selectPisiBlock,
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
    PISI_BLOCK_SLASH_COMMANDS,
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
    hydratePisiBlockTaskMarker,
    movePisiBlock,
    openPisiMarkdownSource,
    pisiBlocksEditorState,
    pisiBlockHtmlToMarkdown,
    pisiBlockMarkdownToHtml,
    selectPisiBlock
};
