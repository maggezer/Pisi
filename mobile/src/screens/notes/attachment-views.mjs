// Image and file blocks of a note on the phone (docs/sync-plan.md S6 step 4).
// An image the phone holds is shown at once. One it does not hold yet waits
// with a placeholder ("The image comes down once there is a connection") and is
// downloaded once its block is on screen; without a connection it waits for
// the next good sync turn or for "Try again". A file block shows its name and
// size; tapping "Open" downloads the file when needed and opens it in another
// app. Executable kinds are never opened. Nothing here writes the note.
//
// `assets` (from the note screen): `{ keyOf(reference), status(key), fetch(key),
// open(key, name), whenVisible(element, callback), waiting }`; `waiting` is the
// Set of retries the screen runs after the connection is back.

import { formatByteSize } from '../../ui/byte-size.mjs';
import { renderButton } from '../../ui/button.mjs';
import { h } from '../../ui/dom.mjs';
import { isExecutableFileName } from '../../sync/attachments.mjs';

// Codes after which the download is tried again later; anything else is final (SV9).
const RETRYABLE = new Set(['OFFLINE', 'RATE_LIMITED', 'INTERNAL', 'MAINTENANCE', 'DB_UNAVAILABLE', 'NOT_PAIRED']);

/** Runs `callback` once `element` is on screen (at once where IntersectionObserver is missing). */
export function whenVisible(element, callback) {
    const View = element.ownerDocument?.defaultView;
    if (!View?.IntersectionObserver) {
        View?.setTimeout ? View.setTimeout(callback, 0) : callback();
        return () => {};
    }
    const observer = new View.IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        callback();
    });
    observer.observe(element);
    return () => observer.disconnect();
}

/** Fills `frame` with the image of `reference`, downloading it first when the phone does not hold it yet. */
export function mountImage(frame, { t, alt, reference, loadAsset, assets = null }) {
    const key = reference && assets ? assets.keyOf(reference) : null;
    const set = (state, ...children) => {
        frame.dataset.attachment = state;
        frame.replaceChildren(...children.filter(Boolean));
    };
    const showImage = async () => {
        const url = reference ? await loadAsset(reference) : null;
        if (url) set('local', h('img', { src: url, alt, loading: 'lazy', decoding: 'async' }));
        return Boolean(url);
    };
    const missing = () => set('missing', h('p', { class: 'pisi-note-protected-text' }, t('note.imageMissing')));

    async function download() {
        assets.waiting.delete(download);
        set('loading', h('p', { class: 'pisi-note-protected-text', role: 'status' }, t('note.imageLoading')));
        const result = await assets.fetch(key);
        if (result.ok) {
            if (!(await showImage())) missing();
            return;
        }
        if (!RETRYABLE.has(result.code)) return missing();
        assets.waiting.add(download);
        set(
            'waiting',
            h('p', { class: 'pisi-note-protected-text' }, t('note.imageWaiting')),
            renderButton({ label: t('note.attachmentRetry'), variant: 'text', dataset: { action: 'retry-attachment' }, onClick: () => void download() })
        );
    }

    void (async () => {
        if (await showImage()) return;
        if (!key || (await assets.status(key)) !== 'remote') return missing();
        set('waiting', h('p', { class: 'pisi-note-protected-text' }, t('note.imageWaiting')));
        assets.whenVisible(frame, () => void download());
    })();
    return frame;
}

/** The body of a file block's card: its name and size, "Open" and what happened when it was tapped. */
export function renderFileBody({ t, locale, segment, assets = null }) {
    const attributes = segment.attributes || {};
    const name = attributes['data-pisi-file-name'] || '';
    const reference = attributes['data-pisi-file-asset'] || '';
    const size = Number(attributes['data-pisi-file-size']);
    const key = reference && assets ? assets.keyOf(reference) : null;
    const note = h('p', { class: 'pisi-note-file-status', role: 'status' });
    const body = h(
        'div',
        { class: 'pisi-note-file', dataset: { attachment: 'file' } },
        h(
            'p',
            { class: 'pisi-note-protected-text' },
            h('span', { class: 'pisi-note-file-name' }, name || reference),
            Number.isFinite(size) && size > 0 ? h('span', { class: 'pisi-note-file-size' }, ` · ${formatByteSize(size, locale)}`) : null
        )
    );
    if (!key) return body;
    if (isExecutableFileName(name) || isExecutableFileName(reference)) {
        note.textContent = t('note.fileBlocked');
        body.append(note);
        return body;
    }
    const messages = {
        BLOCKED: () => t('note.fileBlocked'),
        NO_APP: () => t('note.fileNoApp'),
        OFFLINE: () => t('note.fileOffline'),
        NOT_FOUND: () => t('note.fileMissing'),
        NOT_PAIRED: () => t('note.fileMissing')
    };
    let busy = false;
    const button = renderButton({
        label: t('note.fileOpen'),
        variant: 'secondary',
        dataset: { action: 'open-file' },
        onClick: async () => {
            if (busy) return;
            busy = true;
            body.dataset.attachment = 'opening';
            if ((await assets.status(key)) !== 'local') note.textContent = t('note.fileDownloading');
            const result = await assets.open(key, name);
            busy = false;
            body.dataset.attachment = result.ok ? 'opened' : 'failed';
            body.dataset.code = result.code || '';
            note.textContent = result.ok ? '' : (messages[result.code]?.() ?? t('note.fileFailed', { code: result.code || '—' }));
        }
    });
    body.append(button, note);
    return body;
}
