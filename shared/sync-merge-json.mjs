// Three-way JSON merge of the sync core (docs/sync-plan.md §3.4). Inputs are
// the base (last synced), local (on disk) and remote (server head) values;
// the result is deterministic. Objects merge by key, arrays of records with a
// unique id merge by id, chosen arrays of scalars merge as sets, and a value
// both sides changed differently is a conflict that `resolve` settles
// (remote by default) and that is reported, so nothing is dropped silently.

export const PISI_SYNC_ABSENT = Object.freeze({ absent: true });

/** JSON text with object keys sorted: equal values give equal text (moved from main/functions/sync-core.js). */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    const keys = Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** Whether two JSON values (or PISI_SYNC_ABSENT) are the same, ignoring key order. */
export function pisiSyncJsonEqual(left, right) {
    if (left === PISI_SYNC_ABSENT || right === PISI_SYNC_ABSENT) return left === right;
    return stableStringify(left) === stableStringify(right);
}

export function clonePisiSyncJson(value) {
    return value === undefined || value === PISI_SYNC_ABSENT ? value : JSON.parse(JSON.stringify(value));
}

/** How a desktop file is written (pisi-definition.md): two-space JSON without a trailing newline. */
export function serializePisiSyncJson(value) {
    return JSON.stringify(value, null, 2);
}

export function isPisiSyncPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value !== PISI_SYNC_ABSENT;
}

const isoOf = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : '');

/** The later of two ISO timestamps (the remote one when equal or unreadable). */
export function laterPisiSyncTimestamp(local, remote) {
    return isoOf(local) > isoOf(remote) ? local : remote;
}

/** Ids of an array whose items are all objects with a unique non-empty string `key`; null otherwise. */
function idsOf(array, key) {
    if (array === PISI_SYNC_ABSENT || array === undefined) return [];
    if (!Array.isArray(array)) return null;
    const ids = [];
    const seen = new Set();
    for (const item of array) {
        const id = isPisiSyncPlainObject(item) ? item[key] : undefined;
        if (typeof id !== 'string' || !id || seen.has(id)) return null;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

/**
 * Order of a merged list: the remote order, then every kept id that only the
 * local side has, right after its nearest kept predecessor on the local side
 * (or first when it has none).
 */
export function mergePisiSyncOrder(localIds, remoteIds, keep) {
    const order = remoteIds.filter((id) => keep.has(id));
    const placed = new Set(order);
    localIds.forEach((id, index) => {
        if (placed.has(id) || !keep.has(id)) return;
        let anchor = -1;
        for (let back = index - 1; back >= 0; back -= 1) {
            const position = order.indexOf(localIds[back]);
            if (position >= 0) {
                anchor = position;
                break;
            }
        }
        order.splice(anchor + 1, 0, id);
        placed.add(id);
    });
    return order;
}

/**
 * Merges three JSON values. Missing values are PISI_SYNC_ABSENT (a missing
 * base means both sides are new). Options:
 * - `idKeyFor(path)`: id field for the array at `path` (e.g. 'map.nodes'), or null;
 * - `setArray(path)`: true for arrays of scalars merged as sets;
 * - `deleteWins(path)`: for an id-array item one side deleted and the other changed;
 * - `resolve(path, { base, local, remote })`: 'local' or 'remote' for a value both changed.
 * `path` names object keys joined by '.', array items as '[]'.
 * Returns `{ value, conflicts }`; each conflict is `{ path, base, local, remote, kept }`.
 */
export function mergePisiSyncJson(base, local, remote, options = {}) {
    const conflicts = [];
    const value = mergeValue(base === undefined ? PISI_SYNC_ABSENT : base, local, remote, '', '', options, conflicts);
    return { value, conflicts };
}

function mergeValue(base, local, remote, path, label, options, conflicts) {
    if (pisiSyncJsonEqual(local, remote)) return clonePisiSyncJson(local);
    if (pisiSyncJsonEqual(local, base)) return clonePisiSyncJson(remote);
    if (pisiSyncJsonEqual(remote, base)) return clonePisiSyncJson(local);

    const baseUsable = base === PISI_SYNC_ABSENT || isPisiSyncPlainObject(base);
    if (isPisiSyncPlainObject(local) && isPisiSyncPlainObject(remote) && baseUsable) {
        return mergeObject(base, local, remote, path, label, options, conflicts);
    }
    if (Array.isArray(local) && Array.isArray(remote) && (base === PISI_SYNC_ABSENT || Array.isArray(base))) {
        const idKey = options.idKeyFor?.(path) || null;
        if (idKey) {
            const merged = mergeIdArray(base, local, remote, idKey, path, label, options, conflicts);
            if (merged) return merged;
        } else if (options.setArray?.(path)) {
            return mergeSetArray(base, local, remote);
        }
    }

    const kept = options.resolve?.(path, { base, local, remote }) === 'local' ? 'local' : 'remote';
    conflicts.push({ path: label, base: clonePisiSyncJson(base), local: clonePisiSyncJson(local), remote: clonePisiSyncJson(remote), kept });
    return clonePisiSyncJson(kept === 'local' ? local : remote);
}

function mergeObject(base, local, remote, path, label, options, conflicts) {
    const out = {};
    const keys = mergePisiSyncOrder(Object.keys(local), Object.keys(remote), new Set([...Object.keys(local), ...Object.keys(remote)]));
    const read = (object, key) => (isPisiSyncPlainObject(object) && Object.hasOwn(object, key) ? object[key] : PISI_SYNC_ABSENT);
    for (const key of keys) {
        const childPath = path ? `${path}.${key}` : key;
        const childLabel = label ? `${label}.${key}` : key;
        const merged = mergeValue(read(base, key), read(local, key), read(remote, key), childPath, childLabel, options, conflicts);
        if (merged !== PISI_SYNC_ABSENT) out[key] = merged;
    }
    return out;
}

function mergeIdArray(base, local, remote, idKey, path, label, options, conflicts) {
    const baseIds = idsOf(base, idKey);
    const localIds = idsOf(local, idKey);
    const remoteIds = idsOf(remote, idKey);
    if (!baseIds || !localIds || !remoteIds) return null;
    const byId = (array) => new Map((array === PISI_SYNC_ABSENT ? [] : array).map((item) => [item[idKey], item]));
    const [b, l, r] = [byId(base), byId(local), byId(remote)];
    const merged = new Map();
    const itemPath = `${path}[]`;
    for (const id of new Set([...remoteIds, ...localIds, ...baseIds])) {
        const baseItem = b.has(id) ? b.get(id) : PISI_SYNC_ABSENT;
        const localItem = l.has(id) ? l.get(id) : PISI_SYNC_ABSENT;
        const remoteItem = r.has(id) ? r.get(id) : PISI_SYNC_ABSENT;
        const itemLabel = `${label}[${id}]`;
        const deletedOne = (localItem === PISI_SYNC_ABSENT) !== (remoteItem === PISI_SYNC_ABSENT) && baseItem !== PISI_SYNC_ABSENT;
        const survivor = localItem === PISI_SYNC_ABSENT ? remoteItem : localItem;
        if (deletedOne && !pisiSyncJsonEqual(survivor, baseItem)) {
            // One side deleted the record, the other changed it.
            const deleted = options.deleteWins?.(path) === true;
            conflicts.push({
                path: itemLabel,
                base: clonePisiSyncJson(baseItem),
                local: clonePisiSyncJson(localItem),
                remote: clonePisiSyncJson(remoteItem),
                kept: deleted ? 'delete' : 'change'
            });
            if (!deleted) merged.set(id, clonePisiSyncJson(survivor));
            continue;
        }
        const value = mergeValue(baseItem, localItem, remoteItem, itemPath, itemLabel, options, conflicts);
        if (value !== PISI_SYNC_ABSENT) merged.set(id, value);
    }
    return mergePisiSyncOrder(localIds, remoteIds, new Set(merged.keys())).map((id) => merged.get(id));
}

function mergeSetArray(base, local, remote) {
    const key = (item) => stableStringify(item);
    const baseKeys = new Set((base === PISI_SYNC_ABSENT ? [] : base).map(key));
    const localKeys = new Set(local.map(key));
    const out = [];
    const seen = new Set();
    const push = (item) => {
        const itemKey = key(item);
        if (seen.has(itemKey)) return;
        seen.add(itemKey);
        out.push(clonePisiSyncJson(item));
    };
    for (const item of remote) if (localKeys.has(key(item)) || !baseKeys.has(key(item))) push(item);
    for (const item of local) if (!baseKeys.has(key(item))) push(item);
    return out;
}

const MAP_ID_KEYS = Object.freeze({ 'map.nodes': 'id', 'map.references': 'id', 'map.relationshipViews': 'relationshipId' });

/**
 * Merge of a `.map` (§3.4): nodes and references by `id`, relationship views
 * by `relationshipId`, collapsed hubs as a set; a scalar both desktops changed
 * (camera, a layout coordinate) takes the remote value; `pisi.updatedAt` is the later one.
 */
export function mergePisiSyncMap(base, local, remote) {
    return mergePisiSyncJson(base, local, remote, {
        idKeyFor: (path) => MAP_ID_KEYS[path] || null,
        setArray: (path) => path === 'map.collapsedHubs',
        deleteWins: () => true,
        resolve: (path, values) => (path === 'pisi.updatedAt' && laterPisiSyncTimestamp(values.local, values.remote) === values.local ? 'local' : 'remote')
    });
}

/**
 * Merge of any other project JSON (`.pisi-views.json`, `.pisi/*.json`):
 * arrays of records with a unique `id` merge by id, a change beats a delete,
 * `updatedAt` keys take the later time and other conflicts the remote value.
 */
export function mergePisiSyncGenericJson(base, local, remote) {
    const sides = [base, local, remote];
    return mergePisiSyncJson(base, local, remote, {
        idKeyFor: (path) => (!path.includes('[]') && sides.every((side) => idsOf(readPath(side, path), 'id')) ? 'id' : null),
        deleteWins: () => false,
        resolve: (path, values) =>
            /(?:^|\.)updatedAt$/.test(path) && laterPisiSyncTimestamp(values.local, values.remote) === values.local ? 'local' : 'remote'
    });
}

function readPath(value, path) {
    let current = value;
    for (const key of path.split('.')) {
        if (!isPisiSyncPlainObject(current) || !Object.hasOwn(current, key)) return PISI_SYNC_ABSENT;
        current = current[key];
    }
    return current;
}
