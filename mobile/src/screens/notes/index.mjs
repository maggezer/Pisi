// The Notes tab (docs/mobile-plan.md M7): a search field, the filter (all,
// notes, diary days) and the list, most recently changed first. Like the
// Tasks tab it is built once and updated in place, so the search being typed
// survives the redraws around it. The list draws only the rows on screen.
// A card is plain: title, a line of text, the day it changed (G7, G8).

import { renderButton, renderFab } from '../../ui/button.mjs';
import { renderSegmented } from '../../ui/chip.mjs';
import { formatShortDay } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { renderSearchField, renderTextField } from '../../ui/field.mjs';
import { renderEmptyState } from '../../ui/list.mjs';
import { renderSheet } from '../../ui/overlay.mjs';
import { createVirtualList } from '../../ui/virtual-list.mjs';
import { PISI_DEFAULT_NOTE_FILTER, PISI_NOTE_FILTERS, getNoteDay, getNotePreview, listNotes } from './list-model.mjs';

export const PISI_OVERLAY_NEW_NOTE = 'notes-new';

/**
 * `project` is the data layer (null in a bare shell). The app owns
 * navigation: `onOpenNote({ path, title })` opens a note, `onOpenOverlay` /
 * `onCloseOverlay` the sheet that asks for a new note's title.
 */
export function createNotesScreen({ project = null, snackbar, onOpenNote, onOpenOverlay, onCloseOverlay, onError = () => {} }) {
    const element = h('section', { class: 'pisi-screen pisi-notes', dataset: { screen: 'notes' } });
    const state = { filter: PISI_DEFAULT_NOTE_FILTER, query: '' };
    let context = null;
    let parts = null;
    let dirty = true;
    let newSheet = null;
    let creating = false;

    function renderCard(note) {
        const { t, locale, today } = context;
        const day = getNoteDay(note);
        const preview = getNotePreview(note);
        return h(
            'button',
            {
                type: 'button',
                class: 'pisi-note-card',
                dataset: { note: note.key, kind: note.kind },
                onClick: () => onOpenNote({ path: note.key, title: note.title })
            },
            h('span', { class: 'pisi-note-card-title' }, note.title || t('notes.untitled')),
            h('span', { class: `pisi-note-card-preview${preview ? '' : ' pisi-note-card-empty'}` }, preview || t('notes.emptyNote')),
            h(
                'span',
                { class: 'pisi-note-card-meta' },
                note.kind === 'diary' ? h('span', { class: 'pisi-note-card-kind' }, t('notes.kind.diary')) : null,
                day ? h('span', {}, formatShortDay(day, locale, today)) : null
            )
        );
    }

    function build() {
        const { t } = context;
        const search = renderSearchField({
            id: 'pisi-notes-search',
            label: t('notes.search'),
            placeholder: t('notes.search'),
            value: state.query,
            clearLabel: t('notes.clearSearch'),
            onInput(value) {
                state.query = value;
                draw();
                parts.scroller?.scrollTo?.({ top: 0 });
            }
        });
        const filterHost = h('div', { class: 'pisi-notes-filter' });
        const list = createVirtualList({ label: t('tab.notes'), renderRow: renderCard });
        const empty = h('div', { class: 'pisi-notes-empty', dataset: { notes: 'empty' }, hidden: true });
        parts?.list.destroy();
        parts = { search, filterHost, list, empty, scroller: parts?.scroller ?? null };
        element.replaceChildren(h('div', { class: 'pisi-notes-top' }, search, filterHost), list.element, empty);
    }

    function drawFilter() {
        const { t } = context;
        parts.filterHost.replaceChildren(
            renderSegmented({
                label: t('notes.filter'),
                options: PISI_NOTE_FILTERS.map((value) => ({ value, label: t(`notes.filter.${value}`) })),
                selected: state.filter,
                onSelect(value) {
                    state.filter = value;
                    draw();
                    parts.scroller?.scrollTo?.({ top: 0 });
                    parts.filterHost.querySelector('[aria-checked="true"]')?.focus();
                }
            })
        );
    }

    function draw() {
        const { t } = context;
        dirty = false;
        drawFilter();
        const notes = project ? listNotes({ notes: project.notes.list(), filter: state.filter, query: state.query, search: project.search.query }) : [];
        parts.list.setItems(notes);
        parts.list.element.hidden = !notes.length;
        parts.empty.hidden = Boolean(notes.length);
        if (!notes.length) {
            const searching = Boolean(state.query.trim());
            parts.empty.replaceChildren(
                renderEmptyState({
                    icon: searching ? 'search' : 'notes',
                    title: searching ? t('notes.noResults') : t(`notes.empty.${state.filter}`),
                    note: searching || state.filter === 'diary' ? null : t('notes.emptyNoteHint')
                })
            );
        }
    }

    const stop = project?.index.subscribe(() => {
        // Off screen nothing is drawn; the list is brought up to date when the tab is opened again.
        if (context && element.isConnected) draw();
        else dirty = true;
    });

    async function createNote(title) {
        if (creating || !title.trim()) return;
        creating = true;
        try {
            const result = await project.notes.create({ title });
            if (!result.ok) return;
            onCloseOverlay();
            onOpenNote({ path: result.key, title: result.data.pisi.title });
        } catch (error) {
            onError(error);
            snackbar.show({ message: context.t('notes.createFailed') });
        } finally {
            creating = false;
        }
    }

    function renderNewSheet() {
        const { t } = context;
        if (newSheet?.t === t) return newSheet.element;
        let title = '';
        const submit = renderButton({
            label: t('notes.create'),
            variant: 'primary',
            block: true,
            disabled: true,
            dataset: { action: 'create-note' },
            onClick: () => createNote(title)
        });
        const field = renderTextField({
            id: 'pisi-new-note-title',
            label: t('notes.titleLabel'),
            hint: t('notes.titleHint'),
            onInput(value) {
                title = value;
                submit.disabled = !value.trim();
            }
        });
        const input = field.querySelector('input');
        input.dataset.autofocus = '';
        input.setAttribute('enterkeyhint', 'done');
        input.setAttribute('maxlength', '120');
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void createNote(title);
        });
        const sheet = renderSheet({
            id: PISI_OVERLAY_NEW_NOTE,
            title: t('notes.new'),
            closeLabel: t('action.close'),
            onClose: onCloseOverlay,
            children: h('div', { class: 'pisi-sheet-form' }, field, submit)
        });
        newSheet = { t, element: sheet };
        return sheet;
    }

    return {
        element,

        /** Draws the screen for `{ t, locale, today }`. Only what changed is touched. */
        update(next) {
            const rebuilt = !context || context.t !== next.t;
            const todayChanged = !context || context.today !== next.today;
            context = next;
            if (rebuilt) build();
            if (rebuilt || todayChanged || dirty) draw();
        },

        /** The screen is in the document again, inside `scroller`: the list can measure itself. */
        attach(scroller) {
            parts.scroller = scroller;
            parts.list.attach(scroller);
        },

        /** The floating "new note" button; null when there is no project to write to. */
        renderFab() {
            if (!project || !context) return null;
            return renderFab({
                icon: 'plus',
                label: context.t('notes.new'),
                extended: true,
                dataset: { action: 'new-note' },
                onClick: () => onOpenOverlay(PISI_OVERLAY_NEW_NOTE)
            });
        },

        /** The sheet for one of this screen's overlay ids, or null when the id is not ours. */
        renderOverlay(id) {
            if (id !== PISI_OVERLAY_NEW_NOTE || !context) {
                newSheet = null;
                return null;
            }
            return renderNewSheet();
        },

        /** Selector of the control that opened an overlay of this screen; focus returns to it. */
        getOverlayOpener: (id) => (id === PISI_OVERLAY_NEW_NOTE ? '[data-action="new-note"]' : null),

        destroy() {
            stop?.();
            parts?.list.destroy();
        }
    };
}
