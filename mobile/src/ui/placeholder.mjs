// Body of a screen that is not built yet: its name and a short note.

import { h } from './dom.mjs';

export function renderPlaceholder({ screen, title, note, extra = null }) {
    return h(
        'section',
        { class: 'pisi-screen', dataset: { screen } },
        h('h2', { class: 'pisi-screen-title' }, title),
        extra,
        h('p', { class: 'pisi-screen-note' }, note)
    );
}
