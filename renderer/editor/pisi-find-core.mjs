// Pure matching rules for find and replace in a note. No DOM; unit-tested.
//
// The editor hands over "groups": one group per block, each an array of the
// texts of that block's editable text nodes in document order. A match may
// span several text nodes of one block (e.g. "<b>Ra</b>por") but never two
// blocks. Offsets are positions in the group's joined text.
//
// Case-insensitive matching folds one character at a time with Turkish rules
// (İ↔i, I↔ı; "i" does not match "I"), keeping every position in place.

const PISI_FIND_WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Folds one character with Turkish case rules without changing its length. */
export function foldPisiFindChar(char) {
    const turkish = char.toLocaleLowerCase('tr-TR');
    if (turkish.length === char.length) return turkish;
    const plain = char.toLowerCase();
    return plain.length === char.length ? plain : char;
}

export function foldPisiFindText(text, caseSensitive = false) {
    const value = String(text ?? '');
    if (caseSensitive) return value;
    let folded = '';
    for (const char of value) folded += foldPisiFindChar(char);
    return folded;
}

function isPisiFindWordChar(char) {
    return Boolean(char) && PISI_FIND_WORD_CHAR.test(char);
}

/**
 * @param {string[][]} groups texts of the editable text nodes, one array per block
 * @param {string} query
 * @param {{ caseSensitive?: boolean, wholeWord?: boolean }} [options]
 * @returns {{ group: number, start: number, end: number }[]} non-overlapping matches in order
 */
export function findPisiTextMatches(groups, query, options = {}) {
    const needle = foldPisiFindText(query, options.caseSensitive);
    if (!needle) return [];
    const matches = [];
    (groups || []).forEach((texts, group) => {
        const joined = (texts || []).join('');
        const haystack = foldPisiFindText(joined, options.caseSensitive);
        let from = 0;
        while (from <= haystack.length - needle.length) {
            const start = haystack.indexOf(needle, from);
            if (start < 0) break;
            const end = start + needle.length;
            if (options.wholeWord && (isPisiFindWordChar(joined[start - 1]) || isPisiFindWordChar(joined[end]))) {
                from = start + 1;
                continue;
            }
            matches.push({ group, start, end });
            from = end;
        }
    });
    return matches;
}

/** Maps a group offset to { node, offset } (the node index inside the group). */
export function locatePisiFindOffset(texts, offset, preferNext = false) {
    let remaining = offset;
    for (let node = 0; node < texts.length; node += 1) {
        const length = texts[node].length;
        if (remaining < length || (remaining === length && !preferNext)) return { node, offset: remaining };
        remaining -= length;
    }
    const last = Math.max(0, texts.length - 1);
    return { node: last, offset: texts[last]?.length || 0 };
}

/**
 * New texts for every text node of every group after replacing `matches`.
 * The replacement goes into the node where a match starts; the rest of a
 * match spanning several nodes is removed from the following nodes, so their
 * formatting and the nodes themselves stay.
 * @param {string[][]} groups
 * @param {{ group: number, start: number, end: number }[]} matches
 * @param {string} replacement
 * @returns {string[][]}
 */
export function applyPisiReplacements(groups, matches, replacement) {
    const result = (groups || []).map((texts) => [...texts]);
    const byGroup = new Map();
    for (const match of matches) {
        if (!byGroup.has(match.group)) byGroup.set(match.group, []);
        byGroup.get(match.group).push(match);
    }
    for (const [group, list] of byGroup) {
        const original = groups[group];
        const starts = [];
        let position = 0;
        for (const text of original) {
            starts.push(position);
            position += text.length;
        }
        const pieces = original.map(() => []);
        const cursor = original.map(() => 0);
        // Walk matches from first to last, copying unmatched text per node.
        for (const match of [...list].sort((a, b) => a.start - b.start)) {
            const first = locatePisiFindOffset(original, match.start, true);
            const last = locatePisiFindOffset(original, match.end, false);
            for (let node = 0; node < original.length; node += 1) {
                const nodeStart = starts[node];
                const nodeEnd = nodeStart + original[node].length;
                const cutStart = Math.max(match.start, nodeStart);
                const cutEnd = Math.min(match.end, nodeEnd);
                if (cutStart > cutEnd || (cutStart === cutEnd && node !== first.node)) continue;
                pieces[node].push(original[node].slice(cursor[node], cutStart - nodeStart));
                if (node === first.node) pieces[node].push(String(replacement ?? ''));
                cursor[node] = cutEnd - nodeStart;
                if (node === last.node) break;
            }
        }
        result[group] = original.map((text, node) => pieces[node].join('') + text.slice(cursor[node]));
    }
    return result;
}
