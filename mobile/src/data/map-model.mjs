// What a map shows, worked out from the files the way the desktop works it out
// when it opens a map, but without writing anything (mobile only views maps):
//
// - members: the notes in the map's `nd_…` sidecar folder, ordered by file
//   name, then the valid `map.references` (main/functions/map-store.js
//   listNodesForMap, structured-nodes.js collectPisiMapReferenceNodes);
// - each member's layout from `map.nodes`, or the desktop's default grid slot
//   when it has none, clamped to the desktop's ranges (normalizePisiNodeLayout);
// - relationships from `.pisi/relationships.json`, cleaned with the desktop's
//   collection rules (relationship-store.js normalizeRelationshipCollection);
// - a relationship is drawn only when both ends are members and the map has a
//   `relationshipViews` entry for it (map-semantic-core.js
//   projectPisiRelationshipsForMap). `map.edges` is not part of the format.
//
// The desktop keeps these rules in its main process, next to the code that
// writes the files; tests/mobile-desktop-compat.test.mjs runs both on the same
// maps and checks that they agree.

import { normalizePisiId } from '../../../shared/ids.mjs';
import { isPisiHierarchyEdge } from '../../../shared/map-view.mjs';

const PORTS = new Set(['top', 'right', 'bottom', 'left']);
const TYPES = new Set(['down-hub', 'stream', 'co-level']);
const EDGE_ID = /^edge_[A-Za-z0-9_-]{1,101}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// The desktop reads at most this many references of a map.
export const PISI_MAP_REFERENCE_LIMIT = 5000;

function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

const normalizeColor = (value) => {
    const color = String(value || '').trim();
    return HEX_COLOR.test(color) ? color.toLowerCase() : null;
};

/** The desktop places a note that has no layout yet in a grid of four columns. */
export function getDefaultMapNodeLayout(index) {
    const col = index % 4;
    const row = Math.floor(index / 4);
    return { x: 80 + col * 240, y: 80 + row * 150, width: 220, height: 92 };
}

export function normalizeMapNodeLayout(layout = {}, fallback = {}) {
    return {
        x: clampNumber(layout?.x, fallback.x ?? 80, -1000000, 1000000),
        y: clampNumber(layout?.y, fallback.y ?? 80, -1000000, 1000000),
        width: clampNumber(layout?.width, fallback.width ?? 220, 150, 4000),
        height: clampNumber(layout?.height, fallback.height ?? 92, 74, 4000)
    };
}

/** Card and title colours a note can have on one map; anything else is dropped. */
export function normalizeMapNodeCustomization(customization = {}) {
    const result = {};
    const cardColor = normalizeColor(customization?.cardColor);
    const titleColor = normalizeColor(customization?.titleColor);
    if (cardColor) result.cardColor = cardColor;
    if (titleColor) result.titleColor = titleColor;
    return result;
}

export function normalizeMapCamera(camera = {}) {
    return {
        x: clampNumber(camera?.x, 0, -1000000, 1000000),
        y: clampNumber(camera?.y, 0, -1000000, 1000000),
        zoom: clampNumber(camera?.zoom, 1, 0.1, 3)
    };
}

// ----- relationships -----

/**
 * A relationship as the desktop reads it: both ends valid note ids and
 * different, a known type, roles that follow from the type. An id that is not
 * an `edge_…` id becomes null: the desktop gives such a record a new random id
 * on every read, so no map can have a view of it and it is never drawn.
 */
export function normalizeRelationship(raw) {
    const sourceId = normalizePisiId(raw?.sourceId, '.node');
    const targetId = normalizePisiId(raw?.targetId, '.node');
    const type = String(raw?.type || '');
    if (!sourceId || !targetId || sourceId === targetId || !TYPES.has(type)) return null;
    const roles = type === 'co-level' ? ['co-level', 'co-level'] : type === 'stream' ? ['downstream', 'upstream'] : ['down-hub', 'up-hub'];
    const relationship = {
        id: EDGE_ID.test(String(raw.id || '')) ? String(raw.id) : null,
        sourceId,
        targetId,
        type,
        sourceRole: roles[0],
        targetRole: roles[1]
    };
    const label = String(raw.label || '')
        .trim()
        .slice(0, 500);
    if (label) relationship.label = label;
    return relationship;
}

function semanticKey(relationship) {
    if (relationship.type === 'co-level') {
        const pair = [relationship.sourceId, relationship.targetId].sort();
        return `co-level:${pair[0]}:${pair[1]}`;
    }
    return [relationship.type, relationship.sourceId, relationship.targetId, relationship.sourceRole, relationship.targetRole].join(':');
}

function wouldCreateHierarchyCycle(parentByChild, parentId, childId) {
    let current = parentId;
    const visited = new Set();
    while (current && !visited.has(current)) {
        if (current === childId) return true;
        visited.add(current);
        current = parentByChild.get(current) || null;
    }
    return false;
}

const asStream = (relationship) => ({ ...relationship, type: 'stream', sourceRole: 'downstream', targetRole: 'upstream' });

/**
 * The relationship store as the desktop reads it: invalid records and
 * repeated ids or meanings are skipped, and a second hierarchy parent or a
 * hierarchy cycle is read as a stream relationship.
 */
export function normalizeRelationshipCollection(rawRelationships = []) {
    const relationships = [];
    const seenIds = new Set();
    const seenKeys = new Set();
    const parentByChild = new Map();
    for (const raw of Array.isArray(rawRelationships) ? rawRelationships : []) {
        let relationship = normalizeRelationship(raw);
        if (!relationship) continue;
        if (relationship.id && seenIds.has(relationship.id)) continue;
        if (isPisiHierarchyEdge(relationship)) {
            const existingParent = parentByChild.get(relationship.targetId);
            if (existingParent && existingParent !== relationship.sourceId) relationship = asStream(relationship);
            else if (!existingParent && wouldCreateHierarchyCycle(parentByChild, relationship.sourceId, relationship.targetId))
                relationship = asStream(relationship);
            else if (!existingParent) parentByChild.set(relationship.targetId, relationship.sourceId);
        }
        const key = semanticKey(relationship);
        if (seenKeys.has(key)) continue;
        if (relationship.id) seenIds.add(relationship.id);
        seenKeys.add(key);
        relationships.push(relationship);
    }
    return relationships;
}

/** A map's presentation of a relationship: ports and an optional colour, nothing semantic. */
export function normalizeRelationshipView(raw) {
    const relationshipId = String(raw?.relationshipId || '');
    if (!EDGE_ID.test(relationshipId)) return null;
    const view = {
        relationshipId,
        sourcePort: PORTS.has(raw.sourcePort) ? raw.sourcePort : 'bottom',
        targetPort: PORTS.has(raw.targetPort) ? raw.targetPort : 'top'
    };
    const color = normalizeColor(raw.customization?.color);
    if (color) view.customization = { color };
    return view;
}

export function normalizeRelationshipViews(rawViews = []) {
    const views = new Map();
    for (const raw of Array.isArray(rawViews) ? rawViews : []) {
        const view = normalizeRelationshipView(raw);
        if (view && !views.has(view.relationshipId)) views.set(view.relationshipId, view);
    }
    return views;
}

/**
 * The connections a map draws: relationships between two of its members that
 * the map has a view of, in the order of the relationship store, each with the
 * view's ports and colour.
 */
export function projectMapEdges(relationships, memberIds, rawViews) {
    const members = memberIds instanceof Set ? memberIds : new Set(memberIds);
    const views = normalizeRelationshipViews(rawViews);
    const edges = [];
    for (const relationship of relationships) {
        if (!relationship.id || !members.has(relationship.sourceId) || !members.has(relationship.targetId)) continue;
        const view = views.get(relationship.id);
        if (!view) continue;
        const edge = { ...relationship, sourcePort: view.sourcePort, targetPort: view.targetPort };
        if (view.customization) edge.customization = view.customization;
        edges.push(edge);
    }
    return edges;
}

// ----- members -----

/** `map.references` the desktop would follow: a note id and a project-relative `.node` path. */
export function readMapReferences(map) {
    const references = Array.isArray(map?.references) ? map.references : [];
    return references.slice(0, PISI_MAP_REFERENCE_LIMIT).filter((item) => item && typeof item === 'object' && item.id && item.path);
}

/**
 * The members of a map with their layouts. `sidecarNotes` are the notes in the
 * map's sidecar folder as `{ id, fileName, ... }`; `resolveReference(ref)`
 * returns the note a reference points to (or null). Notes are returned in the
 * desktop's order, which also decides the default slot of a note without a
 * layout. A second note with an id already on the map makes the whole map
 * unreadable, as on the desktop.
 */
export function collectMapMembers(map, sidecarNotes, resolveReference) {
    const layouts = new Map((Array.isArray(map?.nodes) ? map.nodes : []).filter((item) => item?.id).map((item) => [item.id, item]));
    const seen = new Set();
    const members = [];
    const add = (note, isReference) => {
        const index = members.length;
        const fallback = getDefaultMapNodeLayout(index);
        const stored = layouts.get(note.id);
        members.push({
            ...note,
            layout: normalizeMapNodeLayout(stored ?? fallback, fallback),
            customization: normalizeMapNodeCustomization(stored?.customization),
            isReference
        });
    };
    const ordered = [...sidecarNotes].sort((a, b) => a.fileName.localeCompare(b.fileName, 'tr'));
    for (const note of ordered) {
        if (seen.has(note.id)) return { ok: false, duplicateId: note.id, members: [] };
        seen.add(note.id);
        add(note, false);
    }
    for (const reference of readMapReferences(map)) {
        if (seen.has(reference.id)) continue;
        const note = resolveReference(reference);
        if (!note || note.id !== reference.id) continue;
        seen.add(reference.id);
        add(note, true);
    }
    return { ok: true, members };
}
