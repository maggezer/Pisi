// The diary part of the Pisi tab: the day's text, edited in place. It is
// built once and then only updated, so the caret and the keyboard stay where
// they are while the rest of the screen changes.

import { h } from '../../ui/dom.mjs';

export function createDiarySection({ t, onInput }) {
    const textarea = h('textarea', {
        id: 'pisi-diary-text',
        class: 'pisi-diary-text',
        rows: 3,
        placeholder: t('pisi.diaryPlaceholder'),
        'aria-labelledby': 'pisi-diary-title',
        'aria-describedby': 'pisi-diary-note',
        autocapitalize: 'sentences',
        enterkeyhint: 'enter',
        dataset: { diary: 'text' }
    });
    const note = h('p', { class: 'pisi-diary-note', id: 'pisi-diary-note', hidden: true });
    const element = h(
        'section',
        { class: 'pisi-home-section pisi-diary', 'aria-labelledby': 'pisi-diary-title' },
        h('h2', { class: 'pisi-home-heading', id: 'pisi-diary-title' }, t('pisi.diary')),
        textarea,
        note
    );

    // Grows with the text; three lines is the smallest (the rows attribute and the CSS minimum).
    function fit() {
        textarea.style.height = 'auto';
        if (textarea.scrollHeight) textarea.style.height = `${textarea.scrollHeight}px`;
    }

    textarea.addEventListener('input', () => {
        fit();
        onInput(textarea.value);
    });

    return {
        element,
        textarea,
        fit,
        /**
         * Shows a day. Until it has been read (`loaded`) and when its file cannot be written the text is locked.
         * `deferred`: a change from another device waits until the text typed here is saved.
         */
        show({ text, loaded, readOnly, otherBlocks, deferred = false }) {
            if (textarea.value !== text) {
                // A day changed from outside while the field has the focus: the caret stays where it was, as far as the text allows.
                const focused = textarea.ownerDocument.activeElement === textarea;
                const { selectionStart, selectionEnd } = textarea;
                textarea.value = text;
                if (focused) textarea.setSelectionRange(Math.min(selectionStart, text.length), Math.min(selectionEnd, text.length));
            }
            textarea.readOnly = !loaded || readOnly;
            textarea.setAttribute('aria-busy', loaded ? 'false' : 'true');
            const message = readOnly
                ? t('pisi.diaryReadOnly')
                : deferred
                  ? t('pisi.diaryExternalDeferred')
                  : otherBlocks
                    ? otherBlocks === 1
                        ? t('pisi.diaryOtherBlock', { count: otherBlocks })
                        : t('pisi.diaryOtherBlocks', { count: otherBlocks })
                    : '';
            note.textContent = message;
            note.hidden = !message;
            note.classList.toggle('pisi-diary-note-error', Boolean(readOnly));
            fit();
        }
    };
}
