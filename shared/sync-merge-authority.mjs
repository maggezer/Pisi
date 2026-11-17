// Merge of the authority files (docs/sync-plan.md §3.4, rule SV3):
// .pisi/tasks.json, .pisi/relationships.json and .pisi/properties.json. Their
// record lists merge by record id, a record field by field. When both sides
// changed one field differently, the record with the later `updatedAt` wins
// (the remote one when equal); a record one side deleted and the other changed
// stays deleted (deletes only come from the desktop, whose trash keeps it).
// Every value that loses is returned in `conflicts` for the device's conflict
// log. Unknown records, fields and top-level keys are kept (V3).

import {
    PISI_SYNC_ABSENT,
    clonePisiSyncJson,
    isPisiSyncPlainObject,
    laterPisiSyncTimestamp,
    mergePisiSyncJson,
    mergePisiSyncOrder,
    pisiSyncJsonEqual
} from './sync-merge-json.mjs';

export const PISI_SYNC_AUTHORITY_LISTS = Object.freeze({
    '.pisi/tasks.json': 'tasks',
    '.pisi/relationships.json': 'relationships',
    '.pisi/properties.json': 'definitions'
});

const HIERARCHY_TYPE = 'down-hub';
const RELATIONSHIP_TYPES = new Set(['down-hub', 'stream', 'co-level']);

/** The record-list key of an authority path ('tasks', 'relationships', 'definitions'), or null. */
export function getPisiSyncAuthorityListKey(path) {
    return PISI_SYNC_AUTHORITY_LISTS[String(path).normalize('NFC').toLowerCase()] || null;
}

function recordIds(list) {
    if (list === PISI_SYNC_ABSENT) return [];
    if (!Array.isArray(list)) return null;
    const ids = [];
    const seen = new Set();
    for (const record of list) {
        const id = isPisiSyncPlainObject(record) ? record.id : undefined;
        if (typeof id !== 'string' || !id || seen.has(id)) return null;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

const read = (object, key) => (isPisiSyncPlainObject(object) && Object.hasOwn(object, key) ? object[key] : PISI_SYNC_ABSENT);

/** Field-level merge of one record present on both sides (base may be absent). */
function mergeRecord(id, base, local, remote, conflicts) {
    const keys = mergePisiSyncOrder(Object.keys(local), Object.keys(remote), new Set([...Object.keys(local), ...Object.keys(remote)]));
    const localWinsTies = laterPisiSyncTimestamp(local.updatedAt, remote.updatedAt) === local.updatedAt && local.updatedAt !== remote.updatedAt;
    const out = {};
    for (const key of keys) {
        const [b, l, r] = [read(base, key), read(local, key), read(remote, key)];
        let value;
        if (pisiSyncJsonEqual(l, r) || pisiSyncJsonEqual(r, b)) value = l;
        else if (pisiSyncJsonEqual(l, b)) value = r;
        else if (key === 'updatedAt') value = laterPisiSyncTimestamp(l, r);
        else {
            value = localWinsTies ? l : r;
            conflicts.push({
                recordId: id,
                field: key,
                kind: 'field',
                winner: localWinsTies ? 'local' : 'remote',
                base: clonePisiSyncJson(b),
                lost: clonePisiSyncJson(localWinsTies ? r : l)
            });
        }
        if (value !== PISI_SYNC_ABSENT) out[key] = clonePisiSyncJson(value);
    }
    return out;
}

function mergeRecords(base, local, remote, conflicts) {
    const [baseIds, localIds, remoteIds] = [recordIds(base), recordIds(local), recordIds(remote)];
    if (!baseIds || !localIds || !remoteIds) return null;
    const byId = (list) => new Map((list === PISI_SYNC_ABSENT ? [] : list).map((record) => [record.id, record]));
    const [b, l, r] = [byId(base), byId(local), byId(remote)];
    const merged = new Map();
    for (const id of new Set([...remoteIds, ...localIds, ...baseIds])) {
        const [baseRecord, localRecord, remoteRecord] = [b.get(id), l.get(id), r.get(id)];
        if (localRecord && remoteRecord) {
            merged.set(id, mergeRecord(id, baseRecord ?? PISI_SYNC_ABSENT, localRecord, remoteRecord, conflicts));
            continue;
        }
        const survivor = localRecord || remoteRecord;
        if (!survivor) continue;
        if (!baseRecord) {
            merged.set(id, clonePisiSyncJson(survivor));
        } else if (!pisiSyncJsonEqual(survivor, baseRecord)) {
            // Deleted on one side, changed on the other: the delete wins and is logged.
            conflicts.push({
                recordId: id,
                field: null,
                kind: 'deleted-changed',
                winner: localRecord ? 'remote' : 'local',
                base: clonePisiSyncJson(baseRecord),
                lost: clonePisiSyncJson(survivor)
            });
        }
    }
    return mergePisiSyncOrder(localIds, remoteIds, new Set(merged.keys())).map((id) => merged.get(id));
}

/**
 * Merges one authority file. `path` picks the record list; base is null for
 * a file both sides created. Returns `{ value, conflicts }`. When a side's
 * list is not a list of records with unique ids it is not merged record by
 * record: the remote list is kept and that is reported as a conflict.
 */
export function mergePisiSyncAuthority(path, base, local, remote) {
    const listKey = getPisiSyncAuthorityListKey(path);
    if (!listKey) throw new TypeError(`Otorite dosyası değil: ${path}`);
    const conflicts = [];
    const baseValue = base === null || base === undefined ? PISI_SYNC_ABSENT : base;
    const top = mergePisiSyncJson(baseValue, withoutKey(local, listKey), withoutKey(remote, listKey), {
        resolve: (key, values) => (key === 'updatedAt' && laterPisiSyncTimestamp(values.local, values.remote) === values.local ? 'local' : 'remote')
    });
    for (const conflict of top.conflicts) {
        if (conflict.path !== 'updatedAt')
            conflicts.push({
                recordId: null,
                field: conflict.path,
                kind: 'file',
                winner: conflict.kept,
                base: conflict.base,
                lost: conflict[conflict.kept === 'local' ? 'remote' : 'local']
            });
    }
    const value = isPisiSyncPlainObject(top.value) ? top.value : {};

    const lists = [read(baseValue, listKey), read(local, listKey), read(remote, listKey)];
    let records = mergeRecords(lists[0], lists[1], lists[2], conflicts);
    if (!records) {
        records = clonePisiSyncJson(lists[2] === PISI_SYNC_ABSENT ? lists[1] : lists[2]);
        if (!pisiSyncJsonEqual(lists[1], lists[2]))
            conflicts.push({ recordId: null, field: listKey, kind: 'unmergeable', winner: 'remote', base: null, lost: clonePisiSyncJson(lists[1]) });
    } else if (listKey === 'relationships') {
        records = enforcePisiSyncRelationshipRules(records, lists[2] === PISI_SYNC_ABSENT ? [] : lists[2], conflicts);
    }

    // The list keeps its place among the top-level keys of the remote (or local) file.
    const ordered = {};
    const template = isPisiSyncPlainObject(remote) ? remote : local;
    let placed = false;
    for (const key of Object.keys(template)) {
        if (key === listKey) {
            ordered[key] = records;
            placed = true;
        } else if (Object.hasOwn(value, key)) ordered[key] = value[key];
    }
    for (const key of Object.keys(value)) if (!Object.hasOwn(ordered, key)) ordered[key] = value[key];
    if (!placed && records !== PISI_SYNC_ABSENT && records !== undefined) ordered[listKey] = records;
    return { value: ordered, conflicts };
}

function withoutKey(value, key) {
    if (!isPisiSyncPlainObject(value)) return value === null || value === undefined ? PISI_SYNC_ABSENT : value;
    const copy = { ...value };
    delete copy[key];
    return copy;
}

// ---- Relationship rules ----------------------------------------------------
// The same rules as the desktop (main/functions/filesystem-core.js
// normalizeMapEdge/isHierarchyEdge/getPisiEdgeSemanticKey/wouldCreatePisiHierarchyCycle
// and Project Integrity): no link to itself, one semantic relationship per
// key, one hierarchy parent per node and no hierarchy cycle.
// tests/shared-sync-merge.test.mjs checks they agree with the desktop code.

/** Whether a relationship record is a hierarchy (parent → child) link. */
export function isPisiSyncHierarchyRelationship(relationship) {
    return relationship?.type === HIERARCHY_TYPE && relationship?.sourceRole === 'down-hub' && relationship?.targetRole === 'up-hub';
}

/** Semantic key of a relationship, as the desktop computes it; '' for one the desktop would not read. */
export function getPisiSyncRelationshipSemanticKey(relationship) {
    const sourceId = String(relationship?.sourceId || '');
    const targetId = String(relationship?.targetId || '');
    const type = String(relationship?.type || '');
    const nodeId = /^node_[A-Za-z0-9_-]+$/;
    if (!nodeId.test(sourceId) || !nodeId.test(targetId) || sourceId === targetId || !RELATIONSHIP_TYPES.has(type)) return '';
    if (type === 'co-level') return `co-level:${[sourceId, targetId].sort().join(':')}`;
    if (type === 'stream') return ['stream', sourceId, targetId, 'downstream', 'upstream'].join(':');
    return ['down-hub', sourceId, targetId, 'down-hub', 'up-hub'].join(':');
}

function wouldCreateCycle(parentByChild, parentId, childId) {
    let current = parentId;
    const visited = new Set();
    while (current && !visited.has(current)) {
        if (current === childId) return true;
        visited.add(current);
        current = parentByChild.get(current) || null;
    }
    return false;
}

/** Why `relationship` cannot join `state`, or '' when it can. */
function relationshipViolation(state, relationship) {
    const key = getPisiSyncRelationshipSemanticKey(relationship);
    if (!key) return 'invalid';
    const holder = state.keys.get(key);
    if (holder && holder !== relationship.id) return 'semantic-duplicate';
    if (isPisiSyncHierarchyRelationship(relationship)) {
        const parent = state.parents.get(relationship.targetId);
        if (parent && parent !== relationship.sourceId) return 'second-parent';
        if (!parent && wouldCreateCycle(state.parents, relationship.sourceId, relationship.targetId)) return 'hierarchy-cycle';
    }
    return '';
}

function admit(state, relationship) {
    const key = getPisiSyncRelationshipSemanticKey(relationship);
    if (key) state.keys.set(key, relationship.id);
    if (isPisiSyncHierarchyRelationship(relationship) && !state.parents.has(relationship.targetId))
        state.parents.set(relationship.targetId, relationship.sourceId);
}

/**
 * Keeps the merged relationships within the desktop's rules. The records that
 * are exactly the remote ones are taken first; a record that carries a local
 * change and breaks a rule is put back to its remote version (or left out when
 * the remote side does not have it), and that is logged.
 */
export function enforcePisiSyncRelationshipRules(records, remoteRecords, conflicts = []) {
    const remoteById = new Map(remoteRecords.filter((record) => isPisiSyncPlainObject(record)).map((record) => [record.id, record]));
    const fromRemote = (record) => remoteById.has(record.id) && pisiSyncJsonEqual(remoteById.get(record.id), record);
    const state = { keys: new Map(), parents: new Map() };
    for (const record of records) if (fromRemote(record)) admit(state, record);
    const out = [];
    for (const record of records) {
        if (fromRemote(record)) {
            out.push(record);
            continue;
        }
        const reason = relationshipViolation(state, record);
        if (!reason) {
            admit(state, record);
            out.push(record);
            continue;
        }
        const fallback = remoteById.get(record.id);
        conflicts.push({ recordId: record.id, field: null, kind: 'relationship-rule', reason, winner: 'remote', base: null, lost: clonePisiSyncJson(record) });
        if (fallback && !relationshipViolation(state, fallback)) {
            admit(state, fallback);
            out.push(clonePisiSyncJson(fallback));
        }
    }
    return out;
}
