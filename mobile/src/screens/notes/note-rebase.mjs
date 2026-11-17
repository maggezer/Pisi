// What becomes of the blocks on screen when the note's file changed under
// them (docs/sync-plan.md S4): the rule, without the DOM. The editor
// (note-editor.mjs) carries it out.
//
// Blocks are matched by their id (`data-pisi-block-id`); a segment without
// one (white space, a comment, an old block) by its HTML and how many times
// that HTML came before. The file's order wins. A block the file did not
// change keeps its element, so the caret in it stays where it is.
//
// No text is lost (SV3): a block with edits that are not saved yet is never
// overwritten. When the file changed or removed that block too, the edit
// stays on screen as a block of its own, after the file's version.

/** Match keys for a row of segments: `id:<blockId>#n` or `html:<html>#n`, `n` counting repeats. */
export function getSegmentKeys(segments) {
    const seen = new Map();
    return segments.map((segment) => {
        const base = segment.kind === 'element' && segment.blockId ? `id:${segment.blockId}` : `html:${segment.html}`;
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return `${base}#${count}`;
    });
}

/**
 * `items` are the editor's blocks in screen order, each `{ segment }`
 * (`segment` null for a block that is not in the file yet); `removed` are the
 * blocks taken out on screen but not yet in the file; `segments` is the new
 * content cut into segments; `isDirty(item)` tells a block with an edit that
 * is not saved yet. Returns:
 * - `order`: what the screen shows, in order: `{ kind: 'keep' | 'update' | 'new', item?, segment, index }`
 *   for the file's segments (`item` is the block that shows it, absent for 'new'), and
 *   `{ kind: 'local', item }` for edits that are not in the file;
 * - `detached`: blocks whose edit is kept although the file changed or removed them;
 * - `removed`: the pending removals that still apply, `{ item, segment, index }`;
 * - `dropped`: blocks to take off the screen.
 */
export function planNoteRebase({ items, removed = [], segments, isDirty = (item) => item.dirty }) {
    const keys = getSegmentKeys(segments);
    const oldKeys = getSegmentKeys(items.filter((item) => item.segment).map((item) => item.segment));
    const byKey = new Map();
    let at = 0;
    for (const item of items) if (item.segment) byKey.set(oldKeys[at++], item);
    const removedKeys = getSegmentKeys(removed.map((item) => item.segment));
    const removedByKey = new Map(removed.map((item, index) => [removedKeys[index], item]));

    const placed = new Map();
    const order = [];
    const detached = [];
    const stillRemoved = [];
    segments.forEach((segment, index) => {
        const key = keys[index];
        const item = byKey.get(key);
        const gone = removedByKey.get(key);
        if (gone) {
            // Removed on screen: it stays removed while the file has not changed it; otherwise the file's version comes back.
            if (gone.segment.html === segment.html) {
                stillRemoved.push({ item: gone, segment, index });
                return;
            }
            order.push({ kind: 'new', segment, index });
            return;
        }
        if (!item) {
            order.push({ kind: 'new', segment, index });
            return;
        }
        byKey.delete(key);
        const entry = { kind: item.segment.html === segment.html ? 'keep' : 'update', item, segment, index };
        if (entry.kind === 'update' && isDirty(item)) {
            // Both sides changed this block: the file's version is shown, the edit follows it as a new block.
            order.push({ kind: 'new', segment, index });
            detached.push(item);
            placed.set(item, order.length);
            order.push({ kind: 'local', item });
            return;
        }
        placed.set(item, order.length);
        order.push(entry);
    });

    const dropped = [];
    for (const item of byKey.values()) {
        if (isDirty(item)) detached.push(item);
        else dropped.push(item);
    }

    // Blocks that are only on screen follow the block they followed before.
    let anchor = -1;
    for (const item of items) {
        if (placed.has(item)) {
            anchor = placed.get(item);
            continue;
        }
        if (item.segment && !detached.includes(item)) continue;
        const at = anchor + 1;
        order.splice(at, 0, { kind: 'local', item });
        for (const [other, position] of placed) if (position >= at) placed.set(other, position + 1);
        placed.set(item, at);
        anchor = at;
    }
    return { order, detached, removed: stillRemoved, dropped };
}
