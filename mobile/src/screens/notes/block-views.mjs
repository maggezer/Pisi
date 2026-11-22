// The blocks of a note that mobile shows but does not edit (docs/mobile-plan.md
// M7, rule V8): a card that names the kind of block and says it is edited on
// the desktop, with what can be shown of it: its text, its image, its file
// name. A version 2 task block (docs/task-plan.md §3.2.1) is a task row and a
// diary's task section (§3.2.2) the rows of its day, both drawn from
// tasks.json. None of this is ever written back; the block's HTML stays as it
// was read. An old task block (todo tag) and the old managed diary section are
// cards like any other block.

import { htmlToText } from '../../../../shared/note-blocks.mjs';
import { parseInlineHtml } from '../../data/note-inline.mjs';
import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { mountImage, renderFileBody } from './attachment-views.mjs';
import { buildInlineDom } from './inline-dom.mjs';

// Block types that have a name of their own on the card; the rest are "block".
const NAMED = new Set(['paragraph', 'bullet', 'number', 'quote', 'code', 'sheet', 'canvas', 'image', 'file', 'rollup', 'task']);
const TEXT_TYPES = new Set(['paragraph', 'bullet', 'number', 'quote', 'code', 'heading4', 'heading5', 'rollup', 'task']);

/** The name a block type has on its card and for screen readers. */
export const getBlockKind = (type) => (/^heading/.test(type) ? 'heading' : NAMED.has(type) ? type : 'unknown');
export const getBlockLabel = (t, type) => t(`note.block.${getBlockKind(type)}`);

function renderCard({ t, type, body = null }) {
    return h(
        'div',
        { class: 'pisi-note-protected', dataset: { protected: type } },
        h('p', { class: 'pisi-note-protected-caption' }, icon('desktop'), h('span', {}, `${getBlockLabel(t, type)} · ${t('note.desktopOnly')}`)),
        body
    );
}

function renderText(segment, document) {
    const body = h('div', { class: 'pisi-note-protected-text', dataset: { type: segment.blockType } });
    if (TEXT_TYPES.has(segment.blockType) || /^heading/.test(segment.blockType)) body.append(buildInlineDom(parseInlineHtml(segment.inner), document));
    else body.textContent = htmlToText(segment.kind === 'element' ? (segment.inner ?? segment.html) : segment.html).trim();
    return body.textContent.trim() ? body : null;
}

/**
 * The element for a protected segment, or null when it shows nothing (white
 * space and comments between blocks).
 * - `loadAsset(reference)` resolves with a URL for an image of the note's sidecar, or null;
 * - `addTask(host, segment)` registers a task block or a diary's task section: the screen fills
 *   `host` from tasks.json and keeps it up to date;
 * - `assets` (attachment-views.mjs) downloads an image or file the phone does not hold yet (S6).
 */
export function renderProtectedBlock(segment, { t, locale = 'tr-TR', document, loadAsset, addTask, assets = null }) {
    if (segment.kind === 'comment') return null;
    if (segment.kind === 'text') return segment.html.trim() ? renderCard({ t, type: 'unknown', body: renderText(segment, document) }) : null;

    const type = segment.blockType;
    if (type === 'divider') return h('hr', { class: 'pisi-note-divider' });
    if (type === 'diary-heading') {
        return h(
            'div',
            { class: 'pisi-note-block pisi-note-static', role: 'heading', 'aria-level': '3', dataset: { type: 'heading3' } },
            htmlToText(segment.inner).trim()
        );
    }
    if ((type === 'task' && segment.taskId) || type === 'diary-tasks') {
        const host = h('div', { class: 'pisi-note-task', dataset: { protected: type } });
        addTask(host, segment);
        return host;
    }
    if (type === 'task' || type === 'diary-managed') return renderCard({ t, type: 'task', body: renderText({ ...segment, blockType: 'task' }, document) });
    if (type === 'image' || type === 'canvas') {
        const frame = h('div', { class: 'pisi-note-image' });
        const alt = /\salt="([^"]*)"/.exec(segment.inner)?.[1] || getBlockLabel(t, type);
        mountImage(frame, { t, alt, reference: segment.asset, loadAsset, assets });
        return renderCard({ t, type, body: frame });
    }
    if (type === 'file') {
        if (!segment.attributes['data-pisi-file-name'] && !segment.attributes['data-pisi-file-asset']) {
            const text = htmlToText(segment.inner).trim();
            return renderCard({ t, type, body: text ? h('p', { class: 'pisi-note-protected-text' }, text) : null });
        }
        return renderCard({ t, type, body: renderFileBody({ t, locale, segment, assets }) });
    }
    if (type === 'sheet') return renderCard({ t, type });
    return renderCard({ t, type, body: renderText(segment, document) });
}
