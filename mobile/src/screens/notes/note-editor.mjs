// The body of an open note (docs/mobile-plan.md M7). The note's content is a
// row of segments (shared/note-blocks.mjs). Each editable block (paragraph,
// heading 1–3, list item) is its own small editing field; every other block
// is drawn by `renderProtected` and cannot be typed in, removed or moved.
//
// Nothing here writes HTML of its own making to the note: a save is a list of
// block operations (data/note-patch.mjs) that names only the blocks the user
// changed, added or removed (rules V2, V4, V8). `takePatch()` builds that
// list, `rebase()` takes the content the write left on disk, and
// `applyContent()` takes content that came from outside (sync) in place,
// block by block (note-rebase.mjs).

import { PISI_EDITABLE_BLOCK_TYPES, splitNoteBlocks } from '../../../../shared/note-blocks.mjs';
import { inlineToHtml, parseInlineHtml } from '../../data/note-inline.mjs';
import { makeBlockHtml } from '../../data/note-patch.mjs';
import { h } from '../../ui/dom.mjs';
import { buildInlineDom, getLinkNode, readInlineDom } from './inline-dom.mjs';
import { planNoteRebase } from './note-rebase.mjs';

const HEADING_CYCLE = Object.freeze(['heading1', 'heading2', 'heading3']);
const isList = (type) => type === 'bullet' || type === 'number';
const isHeading = (type) => HEADING_CYCLE.includes(type);

/**
 * `content` is the note's HTML; `newBlockId()` gives the id of a new block;
 * `renderProtected(segment)` returns the element of a block mobile does not
 * edit (or null for nothing); `getLabel(type)` names a block type for screen
 * readers. `onChange()` runs after every edit, `onState()` when the caret
 * moves, `onLink(node)` when a link is tapped. With `readOnly` nothing can be
 * typed. `placeholder` is shown in the empty paragraph of a note with no text block.
 */
export function createNoteEditor({
    document,
    content,
    newBlockId,
    renderProtected,
    getLabel,
    readOnly = false,
    placeholder = '',
    onChange,
    onState = () => {},
    onLink = () => {}
}) {
    const element = h('div', { class: 'pisi-note-editor', dataset: { editor: readOnly ? 'read-only' : 'editable' } });
    const byElement = new WeakMap();
    let items = [];
    // Blocks taken out of the note that are (or are about to be) in the file.
    let removed = [];
    let current = null;

    const serialize = (item) => inlineToHtml(readInlineDom(item.el));
    const isEmpty = (item) => serialize(item) === '<br>';

    function applyType(item) {
        item.el.dataset.type = item.type;
        item.el.setAttribute('aria-label', getLabel(item.type));
        if (item.indent > 0) item.el.style.setProperty('--pisi-note-indent', String(item.indent));
        else item.el.style.removeProperty('--pisi-note-indent');
    }

    function makeField(item, nodes) {
        const el = h('div', {
            class: 'pisi-note-block',
            role: 'textbox',
            'aria-multiline': 'true',
            contenteditable: readOnly ? null : 'true',
            spellcheck: 'true'
        });
        el.append(buildInlineDom(nodes, document));
        if (!el.firstChild) el.append(document.createElement('br'));
        item.el = el;
        byElement.set(el, item);
        applyType(item);
        return el;
    }

    function fromSegment(segment, index) {
        const item = { segment, index, el: null, type: segment.blockType, indent: 0, dirty: false, saving: false, id: segment.blockId ?? null };
        if (segment.kind === 'element' && segment.editable) {
            item.indent = segment.blockType === 'bullet' ? Number(segment.attributes['data-pisi-bullet-indent']) || 0 : 0;
            const nodes = parseInlineHtml(segment.inner);
            item.baseHtml = inlineToHtml(nodes);
            makeField(item, nodes);
        } else {
            item.el = renderProtected(segment);
        }
        return item;
    }

    items = splitNoteBlocks(content).map(fromSegment);
    element.append(...items.map((item) => item.el).filter(Boolean));

    /**
     * A paragraph to type in at the end of the note. It is "blank": while
     * nothing has been typed in it, it exists on screen only and is not saved.
     */
    function appendBlank() {
        const item = { segment: null, index: -1, el: null, type: 'paragraph', indent: 0, dirty: false, saving: false, blank: true, id: newBlockId() };
        makeField(item, []);
        items.push(item);
        element.append(item.el);
        return item;
    }
    // A note with nothing to type in (new, or only desktop blocks) gets its first line.
    if (!readOnly && !items.some((item) => item.el && byElement.get(item.el) === item)) {
        const first = appendBlank();
        if (placeholder && !items.some((item) => item.el && item !== first)) first.el.dataset.placeholder = placeholder;
    }

    const itemOf = (node) => {
        const el = node?.nodeType === 1 ? node.closest('.pisi-note-block') : node?.parentElement?.closest('.pisi-note-block');
        return (el && byElement.get(el)) || null;
    };
    const isField = (item) => Boolean(item?.el && byElement.get(item.el) === item);

    function caret() {
        const selection = document.getSelection?.();
        if (!selection?.rangeCount) return null;
        const range = selection.getRangeAt(0);
        const item = itemOf(range.startContainer);
        return item && item.el.contains(range.endContainer) ? { selection, range, item } : null;
    }

    function placeCaret(item, atEnd = false) {
        item.el.focus();
        const selection = document.getSelection?.();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(item.el);
        // After the last character, which is before the block's closing line break.
        const last = item.el.lastChild;
        if (atEnd && last?.nodeName === 'BR' && !isEmpty(item)) range.setEndBefore(last);
        range.collapse(!atEnd || isEmpty(item));
        selection.removeAllRanges();
        selection.addRange(range);
        current = item;
    }

    function changed(...touched) {
        for (const item of touched) {
            item.dirty = true;
            item.blank = false;
            delete item.el.dataset.placeholder;
        }
        onChange();
        onState();
    }

    function insertAfter(anchor, item) {
        items.splice(items.indexOf(anchor) + 1, 0, item);
        anchor.el.after(item.el);
    }

    function addBlock(anchor, type, nodes = [], before = false) {
        const item = { segment: null, index: -1, el: null, type, indent: type === 'bullet' ? anchor.indent : 0, dirty: true, saving: false, id: newBlockId() };
        makeField(item, nodes);
        if (before) {
            items.splice(items.indexOf(anchor), 0, item);
            anchor.el.before(item.el);
        } else insertAfter(anchor, item);
        return item;
    }

    function removeBlock(item) {
        items.splice(items.indexOf(item), 1);
        item.el.remove();
        if (item.segment || item.saving) removed.push(item);
        if (current === item) current = null;
    }

    function setType(item, type) {
        if (item.type === type) return;
        item.type = type;
        if (type !== 'bullet') item.indent = 0;
        applyType(item);
        changed(item);
    }

    /** True when nothing a reader would see lies between the start of the block and the caret. */
    function atStart({ range, item }) {
        if (!range.collapsed) return false;
        const before = document.createRange();
        before.selectNodeContents(item.el);
        before.setEnd(range.startContainer, range.startOffset);
        const fragment = before.cloneContents();
        return !fragment.textContent && !fragment.querySelector?.('br, a');
    }

    /** Enter: the block is cut at the caret. An empty list item ends the list instead. */
    function splitBlock() {
        const at = caret();
        if (!at) return false;
        const { range, item } = at;
        if (isList(item.type) && isEmpty(item)) {
            setType(item, 'paragraph');
            return true;
        }
        if (!range.collapsed) range.deleteContents();
        // Enter at the start of a block with text opens an empty line above it; the block keeps its type.
        if (atStart({ range, item }) && !isEmpty(item)) {
            const above = addBlock(item, isList(item.type) ? item.type : 'paragraph', [], true);
            changed(above);
            placeCaret(item);
            return true;
        }
        const tail = document.createRange();
        tail.selectNodeContents(item.el);
        tail.setStart(range.startContainer, range.startOffset);
        const moved = h('div', {});
        moved.append(tail.extractContents());
        if (!item.el.firstChild) item.el.append(document.createElement('br'));
        const next = addBlock(item, isList(item.type) ? item.type : 'paragraph', readInlineDom(moved));
        changed(item, next);
        placeCaret(next);
        return true;
    }

    /**
     * Backspace at the start of a block: a heading or list item becomes a
     * paragraph; a paragraph joins the editable block above it. A protected
     * block above is never touched.
     */
    function mergeBackward() {
        const at = caret();
        if (!at || !atStart(at)) return false;
        const { item } = at;
        if (item.type !== 'paragraph') {
            setType(item, 'paragraph');
            return true;
        }
        const above = items.slice(0, items.indexOf(item)).findLast((other) => other.el);
        if (!isField(above)) return true;
        const moved = isEmpty(item) ? [] : readInlineDom(item.el);
        if (isEmpty(above)) above.el.replaceChildren();
        const mark = document.createTextNode('');
        above.el.append(mark, buildInlineDom(moved, document));
        if (!above.el.textContent && !above.el.querySelector('br, a')) above.el.append(document.createElement('br'));
        removeBlock(item);
        above.el.focus();
        const selection = document.getSelection?.();
        if (selection) {
            const range = document.createRange();
            range.setStartAfter(mark);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        mark.remove();
        current = above;
        changed(above);
        return true;
    }

    /** Lines the browser itself put into a block (an Enter that could not be stopped) become blocks of their own. */
    function liftLines(item) {
        const lines = [...item.el.children].filter((child) => child.tagName === 'DIV' || child.tagName === 'P');
        if (!lines.length) return;
        let anchor = item;
        for (const line of lines) {
            const nodes = readInlineDom(line);
            line.remove();
            anchor = addBlock(anchor, isList(item.type) ? item.type : 'paragraph', nodes);
        }
        if (!item.el.firstChild) item.el.append(document.createElement('br'));
        placeCaret(anchor);
    }

    function insertText(text) {
        if (!text) return;
        if (document.execCommand?.('insertText', false, text)) return;
        // No editing commands (tests): the text goes in at the caret.
        const at = caret();
        if (!at) return;
        at.range.deleteContents();
        const node = document.createTextNode(text);
        at.range.insertNode(node);
        at.range.setStartAfter(node);
        at.range.collapse(true);
        at.selection.removeAllRanges();
        at.selection.addRange(at.range);
        if (isEmpty(at.item)) return;
        for (const br of [...at.item.el.querySelectorAll('br')]) if (br === at.item.el.lastChild && br.previousSibling === node) br.remove();
    }

    /** Pasted text goes in as plain text; each further line becomes a block of its own. */
    function pasteText(text) {
        const lines = String(text)
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => line.replace(/\s+$/, ''))
            .filter((line) => line.trim());
        if (!lines.length || !caret()) return;
        insertText(lines[0]);
        for (const line of lines.slice(1)) {
            // An empty list item would end the list; pasted lines always continue it.
            const at = caret();
            if (!at) break;
            const next = addBlock(at.item, isList(at.item.type) ? at.item.type : 'paragraph', [{ type: 'text', text: line }]);
            placeCaret(next, true);
        }
        const at = caret();
        if (at) changed(...items.filter((item) => isField(item) && (!item.segment || item === at.item)));
    }

    if (!readOnly) {
        element.addEventListener('beforeinput', (event) => {
            const handled =
                event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak'
                    ? splitBlock()
                    : event.inputType === 'deleteContentBackward' && caret() && atStart(caret())
                      ? mergeBackward()
                      : event.inputType?.startsWith('format')
                        ? true
                        : false;
            if (handled) event.preventDefault();
        });
        element.addEventListener('input', (event) => {
            const item = itemOf(event.target) ?? caret()?.item;
            if (!item) return;
            liftLines(item);
            changed(item);
        });
        element.addEventListener('paste', (event) => {
            event.preventDefault();
            pasteText(event.clipboardData?.getData('text/plain') ?? '');
        });
        element.addEventListener('drop', (event) => event.preventDefault());
    }
    element.addEventListener('click', (event) => {
        const link = event.target.closest?.('.pisi-note-link');
        const node = link && getLinkNode(link);
        if (!node) return;
        event.preventDefault();
        onLink(node);
    });
    element.addEventListener('keydown', (event) => {
        const link = event.key === 'Enter' && event.target.closest?.('.pisi-note-link');
        const node = link && event.target === link && getLinkNode(link);
        if (!node) return;
        event.preventDefault();
        onLink(node);
    });
    element.addEventListener('focusin', (event) => {
        current = itemOf(event.target) ?? current;
        onState();
    });

    const active = () => caret()?.item ?? (current && items.includes(current) ? current : null);

    /** The block a segment from outside now shows: the same field with new text, or a new element when it changed kind. */
    function refresh(item, segment, index) {
        if (!isField(item) || segment.kind !== 'element' || !segment.editable) return fromSegment(segment, index);
        const nodes = parseInlineHtml(segment.inner);
        item.el.replaceChildren(buildInlineDom(nodes, document));
        if (!item.el.firstChild) item.el.append(document.createElement('br'));
        Object.assign(item, { segment, index, type: segment.blockType, dirty: false, baseHtml: inlineToHtml(nodes) });
        item.indent = segment.blockType === 'bullet' ? Number(segment.attributes['data-pisi-bullet-indent']) || 0 : 0;
        applyType(item);
        return item;
    }

    /** Where the caret is, as nodes and offsets, so that it can be put back if its block had to move. */
    function saveCaret() {
        const at = caret();
        if (!at) return null;
        const { startContainer, startOffset, endContainer, endOffset } = at.range;
        return { item: at.item, startContainer, startOffset, endContainer, endOffset };
    }

    function restoreCaret(saved) {
        if (!saved?.item.el.isConnected || !saved.item.el.contains(saved.startContainer) || !saved.item.el.contains(saved.endContainer)) return;
        if (document.activeElement !== saved.item.el) saved.item.el.focus();
        const selection = document.getSelection?.();
        if (!selection) return;
        const range = document.createRange();
        try {
            range.setStart(saved.startContainer, saved.startOffset);
            range.setEnd(saved.endContainer, saved.endOffset);
        } catch {
            return;
        }
        selection.removeAllRanges();
        selection.addRange(range);
    }

    return {
        element,

        /** The block the caret is in: `{ type, canFormat }`, or null when no editable block has the focus. */
        getState() {
            const item = active();
            if (!item || readOnly) return null;
            const query = (command) => {
                try {
                    return Boolean(document.queryCommandState?.(command));
                } catch {
                    return false;
                }
            };
            // A heading is bold as a whole, so "bold" inside one has nothing to switch.
            return { type: item.type, canBold: !isHeading(item.type), bold: !isHeading(item.type) && query('bold'), italic: query('italic') };
        },

        /** Bold or italic on the selection. */
        format(command) {
            const item = active();
            if (!item || readOnly || (command === 'bold' && isHeading(item.type))) return;
            if (!caret()) placeCaret(item, true);
            document.execCommand?.(command);
            changed(item);
        },

        /** Heading button: paragraph → H1 → H2 → H3 → paragraph. */
        cycleHeading() {
            const item = active();
            if (!item || readOnly) return;
            const at = HEADING_CYCLE.indexOf(item.type);
            setType(item, at < 0 ? HEADING_CYCLE[0] : (HEADING_CYCLE[at + 1] ?? 'paragraph'));
        },

        /** List buttons: the block becomes a list item of `type`, or a paragraph again. */
        toggleList(type) {
            const item = active();
            if (!item || readOnly || !isList(type)) return;
            setType(item, item.type === type ? 'paragraph' : type);
        },

        /**
         * Puts the caret at the end of the note. When the last block is one
         * mobile does not edit, a blank paragraph is opened under it.
         */
        focusEnd() {
            if (readOnly) return;
            const last = items.findLast((item) => item.el);
            placeCaret(isField(last) ? last : appendBlank(), true);
        },

        /**
         * The block operations for everything changed since the last patch,
         * or null when there is nothing to write. The patch is handed back to
         * `rebase` when it has been written, or to `restore` when it failed.
         */
        takePatch() {
            const operations = [];
            const gone = removed.filter((item) => item.segment);
            for (const item of gone) operations.push({ op: 'remove', index: item.index, blockId: item.segment.blockId });
            const edited = [];
            let anchor = -1;
            for (const item of items) {
                if (item.segment) {
                    anchor = item.index;
                    if (!isField(item) || !item.dirty) continue;
                    edited.push(item);
                    const html = serialize(item);
                    const operation = { op: 'replace', index: item.index, blockId: item.segment.blockId };
                    if (html !== item.baseHtml) operation.html = html;
                    if (item.type !== item.segment.blockType && PISI_EDITABLE_BLOCK_TYPES.includes(item.type)) operation.type = item.type;
                    if ('html' in operation || 'type' in operation) operations.push(operation);
                } else if (isField(item) && !item.blank) {
                    edited.push(item);
                    operations.push({ op: 'insert', afterIndex: anchor, html: makeBlockHtml(item.type, item.id, serialize(item), { indent: item.indent }) });
                }
            }
            for (const item of edited) {
                item.dirty = false;
                item.saving = true;
            }
            if (!operations.length) {
                for (const item of edited) item.saving = false;
                return null;
            }
            return { operations, edited, gone, order: items.filter((item) => item.segment || edited.includes(item)) };
        },

        /** The patch is on disk and the note now holds `content`: every block takes its new place in it. */
        rebase(patch, nextContent) {
            const segments = splitNoteBlocks(nextContent);
            if (segments.length !== patch.order.length) return false;
            patch.order.forEach((item, index) => {
                item.segment = segments[index];
                item.index = index;
                item.saving = false;
                if (isField(item)) item.baseHtml = inlineToHtml(parseInlineHtml(segments[index].inner));
            });
            removed = removed.filter((item) => !patch.gone.includes(item));
            return true;
        },

        /** True while something typed, added or removed is not on disk yet. */
        hasPending: () => items.some((item) => item.dirty || item.saving) || removed.some((item) => item.segment),

        /**
         * The note's file now holds `nextContent`, written by someone else. The
         * blocks it did not change keep their elements (and the caret); changed
         * blocks show the new text; new ones appear in the file's order; blocks
         * it removed go. An edit that is not saved yet is never overwritten: when
         * the file changed that block too, the edit stays as a block of its own
         * after the file's version, to be saved as new. Returns `{ conflicts }`,
         * the number of edits kept that way.
         */
        applyContent(nextContent) {
            const saved = saveCaret();
            const plan = planNoteRebase({
                items,
                removed: removed.filter((item) => item.segment),
                segments: splitNoteBlocks(nextContent),
                isDirty: (item) => item.dirty || item.saving
            });
            items = plan.order.map((entry) => {
                if (entry.kind === 'local') return entry.item;
                if (entry.kind === 'new') return fromSegment(entry.segment, entry.index);
                if (entry.kind === 'update') return refresh(entry.item, entry.segment, entry.index);
                return Object.assign(entry.item, { segment: entry.segment, index: entry.index });
            });
            for (const item of plan.detached) Object.assign(item, { segment: null, index: -1, id: newBlockId(), dirty: true, saving: false, blank: false });
            for (const entry of plan.removed) Object.assign(entry.item, { segment: entry.segment, index: entry.index });
            removed = plan.removed.map((entry) => entry.item);

            // Elements that stay are not moved unless the order changed, so a focused block keeps its caret.
            const wanted = items.map((item) => item.el).filter(Boolean);
            const keep = new Set(wanted);
            for (const child of [...element.childNodes]) if (!keep.has(child)) child.remove();
            let cursor = element.firstChild;
            for (const el of wanted) {
                if (el === cursor) cursor = cursor.nextSibling;
                else element.insertBefore(el, cursor);
            }
            if (current && !items.includes(current)) current = null;
            if (saved && caret()?.item !== saved.item) restoreCaret(saved);
            onState();
            return { conflicts: plan.detached.length };
        },

        /** The patch was not written: what it held is still to be saved. */
        restore(patch) {
            for (const item of patch.edited) {
                item.dirty = true;
                item.saving = false;
            }
            removed = removed.filter((item) => item.segment);
        }
    };
}
