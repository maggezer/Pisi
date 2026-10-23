// Bounded, document-local history. Chromium's native stack cannot include
// Range/DOM mutations, so both native input and structural edits use this stack.
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
            if (snapshot.content === entries[index].content) {
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
        step(delta) {
            boundary();
            const next = index + delta;
            if (next < 0 || next >= entries.length) return null;
            index = next;
            return entries[index];
        }
    };
}
