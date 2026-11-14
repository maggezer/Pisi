// Content containers: list row, card and the empty state.

import { h } from './dom.mjs';
import { icon } from './icons.mjs';

/**
 * A full-width row: optional leading element, a title that wraps up to two
 * lines, an optional meta line, and a value and/or trailing element at the
 * end. With `onClick` the whole row is one button.
 */
export function renderListRow({ title, meta = null, value = null, leading = null, trailing = null, chevron = false, dataset = null, onClick = null }) {
    const content = [
        leading ? h('span', { class: 'pisi-row-leading' }, leading) : null,
        h('span', { class: 'pisi-row-text' }, h('span', { class: 'pisi-row-title' }, title), meta ? h('span', { class: 'pisi-row-meta' }, meta) : null),
        value ? h('span', { class: 'pisi-row-value' }, value) : null,
        trailing ? h('span', { class: 'pisi-row-trailing' }, trailing) : null,
        chevron ? icon('chevron-right') : null
    ];
    return onClick
        ? h('button', { type: 'button', class: 'pisi-row pisi-row-action', dataset, onClick }, content)
        : h('div', { class: 'pisi-row', dataset }, content);
}

/** Groups rows in one bordered surface with separators between them. */
export function renderList({ label = null, rows }) {
    return h(
        'ul',
        { class: 'pisi-list', 'aria-label': label },
        rows.map((row) => h('li', { class: 'pisi-list-item' }, row))
    );
}

export function renderCard({ title = null, children = [], dataset = null, onClick = null }) {
    const content = [title ? h('h3', { class: 'pisi-card-title' }, title) : null, children];
    return onClick
        ? h('button', { type: 'button', class: 'pisi-card pisi-card-action', dataset, onClick }, content)
        : h('article', { class: 'pisi-card', dataset }, content);
}

export function renderEmptyState({ icon: iconName = null, title, note = null, action = null }) {
    return h(
        'div',
        { class: 'pisi-empty' },
        iconName ? h('span', { class: 'pisi-empty-icon' }, icon(iconName)) : null,
        h('p', { class: 'pisi-empty-title' }, title),
        note ? h('p', { class: 'pisi-empty-note' }, note) : null,
        action
    );
}
