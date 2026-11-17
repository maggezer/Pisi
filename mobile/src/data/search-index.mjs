// Search over note titles and text, held in memory. It follows the project
// index, which is built at start and kept current from `fileChanged` events,
// and folds text with the desktop's rule (shared/search-text.mjs), so İ↔i and
// I↔ı match the same way on both. A note's folded text is kept with its
// index entry, so a change folds only the note that changed.

import { normalizePisiSearchText, tokenizePisiSearchQuery } from '../../../shared/search-text.mjs';

export function createSearchIndex({ index }) {
    // The index replaces an entry when its file changes, so an entry seen before is folded already.
    const folded = new WeakMap();

    function fold(note) {
        let entry = folded.get(note);
        if (!entry) {
            entry = { note, title: normalizePisiSearchText(note.title), text: normalizePisiSearchText(note.text) };
            folded.set(note, entry);
        }
        return entry;
    }

    const entries = () => index.getNotes().map(fold);

    return {
        /** Notes that contain every word of the query, title matches first; an empty query matches nothing. */
        query(text) {
            const tokens = tokenizePisiSearchQuery(text);
            if (!tokens.length) return [];
            const inTitle = [];
            const inText = [];
            for (const entry of entries()) {
                if (tokens.every((token) => entry.title.includes(token))) inTitle.push(entry.note);
                else if (tokens.every((token) => entry.title.includes(token) || entry.text.includes(token))) inText.push(entry.note);
            }
            return [...inTitle, ...inText];
        }
    };
}
