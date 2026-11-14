// Body of a screen that is not built yet: its icon, its name and a short note.

import { h } from '../ui/dom.mjs';
import { renderEmptyState } from '../ui/list.mjs';

export function renderPlaceholder({ screen, icon, title, note, extra = null }) {
    return h('section', { class: 'pisi-screen', dataset: { screen } }, extra, renderEmptyState({ icon, title, note }));
}
