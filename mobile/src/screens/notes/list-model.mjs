// What the Notes tab lists (docs/mobile-plan.md M7): the notes of the project
// index, narrowed by a filter and by a search. Without a search the order is
// the index's: most recently changed first. A search keeps the search index's
// order: title matches first.

export const PISI_NOTE_FILTERS = Object.freeze(['all', 'notes', 'diary']);
export const PISI_DEFAULT_NOTE_FILTER = 'all';

const KIND_OF_FILTER = Object.freeze({ notes: 'note', diary: 'diary' });

/**
 * `notes` are index entries (`project.notes.list()`); `search(text)` is the
 * search index's query. A blank query lists everything the filter lets through.
 */
export function listNotes({ notes, filter = PISI_DEFAULT_NOTE_FILTER, query = '', search }) {
    const found = String(query).trim() ? search(query) : notes;
    const kind = KIND_OF_FILTER[filter];
    return kind ? found.filter((note) => note.kind === kind) : found;
}

/** The local calendar day (`YYYY-MM-DD`) of a note's `updatedAt`, or null when it has none. */
export function getNoteDay(note) {
    const date = new Date(note?.updatedAt || '');
    if (Number.isNaN(date.getTime())) return null;
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A note's preview on one line: the blocks of the note are apart, never run together (G7). */
export const getNotePreview = (note) => String(note?.preview ?? '').replace(/\s*\n\s*/g, ' ');
