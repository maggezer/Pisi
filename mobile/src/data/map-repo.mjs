// Maps, read-only (mobile only views them). A `.map` file gives the layout of
// its notes, its standalone references, the camera, the collapsed hubs and
// `relationshipViews`; its members are the notes in its `nd_…` sidecar folder
// plus those references; what connects two notes comes from
// `.pisi/relationships.json`, the project-wide authority. The rules are the
// desktop's (map-model.mjs). Nothing here writes: a note without a stored
// layout gets the desktop's default slot in memory only.

import { getPisiSidecarName, getPisiVisibleTitleFromBaseName } from '../../../shared/document-naming.mjs';
import { normalizePisiId } from '../../../shared/ids.mjs';
import { collectPisiCollapsedHubCounts, collectPisiCollapsedHubNodeIds, isPisiMapEdgeHiddenByCollapsedHub } from '../../../shared/map-view.mjs';
import { baseName, joinKey, normalizeKey, parentKey } from './drivers/keys.mjs';
import { readJsonFile } from './json-file.mjs';
import { collectMapMembers, normalizeRelationshipCollection, projectMapEdges } from './map-model.mjs';

export const PISI_RELATIONSHIP_STORE_KEY = '.pisi/relationships.json';
const MAP_EXT = '.map';

/** The title the desktop shows for a map: its file name without `.map` (and without an id suffix). */
export function getMapTitleFromKey(key, id) {
    const name = baseName(key);
    return getPisiVisibleTitleFromBaseName(name.endsWith(MAP_EXT) ? name.slice(0, -MAP_EXT.length) : name, id);
}

export function createMapRepo({ driver, writer, index }) {
    async function readRelationships() {
        const result = await readJsonFile(driver, PISI_RELATIONSHIP_STORE_KEY);
        if (result.status === 'missing') return { ok: true, relationships: [] };
        if (result.status === 'corrupt' || !Array.isArray(result.data.relationships)) {
            writer.markReadOnly(PISI_RELATIONSHIP_STORE_KEY, result.error || 'relationships is not a list');
            return { ok: false, corrupt: true, relationships: [] };
        }
        return { ok: true, relationships: normalizeRelationshipCollection(result.data.relationships) };
    }

    /**
     * The map's sidecar folder: the one its title and id name, else the one
     * folder of the same place whose name ends with its id (the desktop's
     * lookup). `exists(folder)` tells whether the named folder is there even
     * when it holds no note. Two folders for one id make the map unreadable.
     */
    async function findSidecarFolder(key, id, exists) {
        const folder = parentKey(key);
        const wanted = getPisiSidecarName(getMapTitleFromKey(key, id), MAP_EXT, id);
        if (!wanted) return { ok: true, folder: null };
        const wantedKey = joinKey(folder, wanted);
        if (await exists(wantedKey)) return { ok: true, folder: wantedKey };
        const matches = new Set();
        for (const note of index.getNotes()) {
            const noteFolder = parentKey(note.key);
            const name = baseName(noteFolder);
            if (noteFolder && parentKey(noteFolder) === folder && name.startsWith('nd_') && name.endsWith(`__${id}`)) matches.add(noteFolder);
        }
        if (matches.size > 1) return { ok: false, folder: null };
        return { ok: true, folder: matches.size ? [...matches][0] : null };
    }

    const notesIn = (folder) =>
        folder
            ? index
                  .getNotes()
                  .filter((note) => parentKey(note.key) === folder && normalizePisiId(note.id, '.node'))
                  .map((note) => ({ id: note.id, key: note.key, fileName: baseName(note.key), title: note.title, preview: note.preview }))
            : [];

    function resolveReference(reference) {
        let key;
        try {
            key = normalizeKey(reference.path);
        } catch {
            return null;
        }
        if (!key.toLowerCase().endsWith('.node')) return null;
        const note = index.getNote(key);
        return note ? { id: note.id, key: note.key, fileName: baseName(note.key), title: note.title, preview: note.preview } : null;
    }

    async function members(entry, map, exists) {
        const sidecar = await findSidecarFolder(entry.key, entry.id, exists);
        if (!sidecar.ok) return { ok: false, members: [] };
        return collectMapMembers(map, notesIn(sidecar.folder), resolveReference);
    }

    return {
        readRelationships,

        /**
         * Maps by title, each with the number of notes on it as the desktop
         * counts them (sidecar notes and references). Needs a built index.
         */
        async list() {
            const listed = [];
            const folderHasNotes = (folder) => index.getNotes().some((note) => parentKey(note.key) === folder);
            for (const entry of index.getMaps()) {
                const result = await members(entry, { nodes: [], references: entry.references }, async (folder) => folderHasNotes(folder));
                listed.push({
                    id: entry.id,
                    title: getMapTitleFromKey(entry.key, entry.id),
                    key: entry.key,
                    updatedAt: entry.updatedAt,
                    nodeCount: result.members.length
                });
            }
            return listed.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
        },

        /**
         * One map: its notes with their layouts, and the connections it
         * draws. `nodes[].hidden` and `edges[].hidden` mark what a collapsed
         * hub hides; `hubCounts` says how many notes each collapsed note hides.
         */
        async read(key) {
            const clean = normalizeKey(key);
            const result = await readJsonFile(driver, clean);
            if (result.status === 'missing') return { ok: false, missing: true, key: clean };
            const id = normalizePisiId(result.data?.pisi?.id, MAP_EXT);
            if (result.status === 'corrupt' || result.data.pisi?.type !== 'map' || !id || !result.data.map || typeof result.data.map !== 'object') {
                writer.markReadOnly(clean, result.error || 'not a map');
                return { ok: false, corrupt: true, key: clean, error: result.error || 'not a map' };
            }
            await index.build();
            const map = result.data.map;
            const collected = await members({ key: clean, id }, map, (folder) => driver.exists(folder));
            if (!collected.ok) return { ok: false, corrupt: true, key: clean, error: 'duplicate note on map' };

            const store = await readRelationships();
            const memberIds = new Set(collected.members.map((note) => note.id));
            const edges = projectMapEdges(store.relationships, memberIds, map.relationshipViews);
            const collapsedHubs = (Array.isArray(map.collapsedHubs) ? map.collapsedHubs : []).map(String);
            const hiddenIds = collectPisiCollapsedHubNodeIds(edges, collapsedHubs);
            const hubCounts = new Map();
            for (const [hubKey, count] of collectPisiCollapsedHubCounts(edges, collapsedHubs)) {
                const nodeId = hubKey.split('::')[0];
                if (count && memberIds.has(nodeId)) hubCounts.set(nodeId, (hubCounts.get(nodeId) ?? 0) + count);
            }

            return {
                ok: true,
                key: clean,
                id,
                title: getMapTitleFromKey(clean, id),
                nodes: collected.members.map((note) => ({ ...note, hidden: hiddenIds.has(note.id) })),
                edges: edges.map((edge) => ({ ...edge, hidden: isPisiMapEdgeHiddenByCollapsedHub(edge, hiddenIds, collapsedHubs) })),
                hubCounts,
                collapsedHubs,
                relationshipsReadable: store.ok
            };
        }
    };
}
