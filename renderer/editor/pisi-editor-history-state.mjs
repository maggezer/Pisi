// Bounded, document-local history. Chromium's native stack cannot include
// Range/DOM mutations, so both native input and structural edits use this stack.
// A snapshot is `{ content, selection, tasks, key }`: `tasks` is the state of
// the note's tasks (docs/task-plan.md G3.6) and `key` tells two steps apart
// (the content alone when there is none).
const keyOf = (snapshot) => snapshot?.key ?? snapshot?.content;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function createEditorHistory(initial, { limit = 100, maxCharacters = 4 * 1024 * 1024 } = {}) {
    let entries = [initial];
    let index = 0;
    let lastKind = '';
    let lastTime = 0;
    const boundary = () => {
        lastKind = '';
    };
    return {
        current: () => entries[index],
        selection(selection) {
            entries[index] = { ...entries[index], selection };
        },
        boundary,
        commit(snapshot, kind = '', time = Date.now()) {
            if (keyOf(snapshot) === keyOf(entries[index])) {
                entries[index] = snapshot;
                return false;
            }
            const merge = kind === 'typing' && lastKind === kind && time - lastTime < 700 && index > 0 && index === entries.length - 1;
            entries = entries.slice(0, index + 1);
            if (merge) entries[index] = snapshot;
            else {
                entries.push(snapshot);
                index += 1;
            }
            lastKind = kind;
            lastTime = time;
            let size = entries.reduce((total, entry) => total + entry.content.length, 0);
            while (entries.length > 1 && (entries.length > limit || size > maxCharacters)) {
                size -= entries.shift().content.length;
                index -= 1;
            }
            return true;
        },
        /**
         * Task changes made outside this note's editing (the panel, sync, another
         * window) become part of every step, so undo never takes them back: each
         * field that differs between the current step and `live` is set to the
         * live value in every step that had the current value.
         */
        adopt(live, makeKey) {
            const current = entries[index].tasks || {};
            const next = live || {};
            const ids = new Set([...Object.keys(current), ...Object.keys(next)]);
            let changed = false;
            for (const id of ids) {
                const before = current[id] ?? null;
                const after = next[id] ?? null;
                if (same(before, after)) continue;
                for (const entry of entries) {
                    const tasks = { ...(entry.tasks || {}) };
                    const mine = tasks[id] ?? null;
                    if (!before || !after) {
                        if (!(id in tasks) && after) continue;
                        if (same(mine, before)) tasks[id] = after;
                    } else if (mine) {
                        const merged = { ...mine };
                        for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
                            if (!same(before[field], after[field]) && same(mine[field], before[field])) merged[field] = after[field];
                        }
                        tasks[id] = merged;
                    } else continue;
                    entry.tasks = tasks;
                    changed = true;
                }
            }
            if (changed && makeKey) for (const entry of entries) entry.key = makeKey(entry);
            return changed;
        },
        step(delta) {
            boundary();
            const next = index + delta;
            if (next < 0 || next >= entries.length) return null;
            index = next;
            return entries[index];
        }
    };
}
