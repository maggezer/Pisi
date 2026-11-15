// Search over note titles and text, held in memory. It follows the project
// index, which is built at start and kept current from `fileChanged` events,
// and folds text with the desktop's rule (shared/search-text.mjs), so İ↔i and
// I↔ı match the same way on both.

import { normalizePisiSearchText, tokenizePisiSearchQuery } from '../../../shared/search-text.mjs';

export function createSearchIndex({ index }) {
    let folded = null;
    index.subscribe(() => {
        folded = null;
    });

    function entries() {
        folded ??= index.getNotes().map((note) => ({ note, title: normalizePisiSearchText(note.title), text: normalizePisiSearchText(note.text) }));
        return folded;
    }

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
