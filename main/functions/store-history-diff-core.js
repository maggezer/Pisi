// What restoring a store version would change, compared with the current
// state: records that come back, records that go away, records that differ.
// Tasks and relationships are compared by id; maps by note card, layout and
// connection view. No Electron; unit-tested.

const PISI_STORE_DIFF_ITEM_LIMIT = 200;

function byId(list) {
    const map = new Map();
    for (const item of Array.isArray(list) ? list : []) {
        if (item && typeof item === 'object' && item.id !== undefined && item.id !== null) map.set(String(item.id), item);
    }
    return map;
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .filter((key) => key !== 'updatedAt')
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

/** @returns {any} */
function compareRecords(currentList, versionList, label) {
    const current = byId(currentList);
    const version = byId(versionList);
    const items = [];
    let restored = 0;
    let removed = 0;
    let changed = 0;
    for (const [id, record] of version) {
        if (!current.has(id)) {
            restored += 1;
            items.push({ id, change: 'restored', label: label(record) });
        } else if (stable(current.get(id)) !== stable(record)) {
            changed += 1;
            items.push({ id, change: 'changed', label: label(record) });
        }
    }
    for (const [id, record] of current) {
        if (!version.has(id)) {
            removed += 1;
            items.push({ id, change: 'removed', label: label(record) });
        }
    }
    return {
        restored,
        removed,
        changed,
        total: version.size,
        items: items.slice(0, PISI_STORE_DIFF_ITEM_LIMIT),
        truncated: items.length > PISI_STORE_DIFF_ITEM_LIMIT
    };
}

/**
 * @param {'tasks'|'relationships'|'map'|string} kind
 * @param {any} currentData the store as it is now (parsed)
 * @param {any} versionData the stored version (parsed)
 * @returns {{ restored: number, removed: number, changed: number, total: number, items: Array<{ id: string, change: 'restored'|'removed'|'changed', label: string }>, truncated: boolean, moved?: number, views?: number }}
 */
export function diffPisiStoreVersion(kind, currentData, versionData) {
    if (kind === 'tasks') return compareRecords(currentData?.tasks, versionData?.tasks, (task) => String(task.title || task.id));
    if (kind === 'relationships') {
        return compareRecords(currentData?.relationships, versionData?.relationships, (edge) => `${edge.sourceId} → ${edge.targetId} (${edge.type || ''})`);
    }
    if (kind === 'map') {
        const result = compareRecords(currentData?.map?.nodes, versionData?.map?.nodes, (node) => String(node.title || node.id));
        // A changed card is a moved or resized one: report it as layout.
        result.moved = result.changed;
        const views = (map) =>
            new Map((Array.isArray(map?.relationshipViews) ? map.relationshipViews : []).map((view) => [String(view.relationshipId), stable(view)]));
        const currentViews = views(currentData?.map);
        const versionViews = views(versionData?.map);
        let viewChanges = 0;
        for (const [id, view] of versionViews) if (currentViews.get(id) !== view) viewChanges += 1;
        for (const id of currentViews.keys()) if (!versionViews.has(id)) viewChanges += 1;
        result.views = viewChanges;
        return result;
    }
    const same = stable(currentData) === stable(versionData);
    return { restored: 0, removed: 0, changed: same ? 0 : 1, total: 1, items: [], truncated: false };
}
