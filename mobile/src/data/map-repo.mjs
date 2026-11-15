// Maps, read-only (mobile only views them). A `.map` file gives membership,
// each note's layout, the camera and `relationshipViews`; what connects two
// notes comes from `.pisi/relationships.json`, the project-wide authority.
// `map.edges` is not part of the format and is never read.

import { normalizeKey } from './drivers/keys.mjs';
import { readJsonFile } from './json-file.mjs';

export const PISI_RELATIONSHIP_STORE_KEY = '.pisi/relationships.json';

export function createMapRepo({ driver, writer, index }) {
    async function readRelationships() {
        const result = await readJsonFile(driver, PISI_RELATIONSHIP_STORE_KEY);
        if (result.status === 'missing') return { ok: true, relationships: [] };
        if (result.status === 'corrupt' || !Array.isArray(result.data.relationships)) {
            writer.markReadOnly(PISI_RELATIONSHIP_STORE_KEY, result.error || 'relationships is not a list');
            return { ok: false, corrupt: true, relationships: [] };
        }
        return { ok: true, relationships: result.data.relationships.filter((item) => item && typeof item === 'object') };
    }

    return {
        list: () => index.getMaps(),
        readRelationships,

        /**
         * One map: its notes with their layout, and the relationships whose two
         * ends are both on the map, each with the map's own view of it (ports,
         * visual customization) when it has one.
         */
        async read(key) {
            const clean = normalizeKey(key);
            const result = await readJsonFile(driver, clean);
            if (result.status === 'missing') return { ok: false, missing: true, key: clean };
            if (result.status === 'corrupt' || result.data.pisi?.type !== 'map' || !result.data.map || typeof result.data.map !== 'object') {
                writer.markReadOnly(clean, result.error || 'not a map');
                return { ok: false, corrupt: true, key: clean, error: result.error || 'not a map' };
            }
            const map = result.data.map;
            const references = new Map((Array.isArray(map.references) ? map.references : []).filter((item) => item?.id).map((item) => [item.id, item]));
            const nodes = (Array.isArray(map.nodes) ? map.nodes : [])
                .filter((node) => node?.id)
                .map((layout) => {
                    const note = index.findNoteById(layout.id);
                    const referencePath = references.get(layout.id)?.path;
                    return { id: layout.id, layout, title: note?.title ?? '', key: note?.key ?? (referencePath ? String(referencePath) : null) };
                });
            const members = new Set([...nodes.map((node) => node.id), ...references.keys()]);
            const views = new Map((Array.isArray(map.relationshipViews) ? map.relationshipViews : []).map((view) => [view?.relationshipId, view]));
            const store = await readRelationships();
            const relationships = store.relationships
                .filter((relationship) => members.has(relationship.sourceId) && members.has(relationship.targetId))
                .map((relationship) => ({ ...relationship, view: views.get(relationship.id) ?? null }));

            return {
                ok: true,
                key: clean,
                data: result.data,
                nodes,
                relationships,
                relationshipsReadable: store.ok,
                camera: map.camera ?? { x: 0, y: 0, zoom: 1 },
                collapsedHubs: Array.isArray(map.collapsedHubs) ? map.collapsedHubs : []
            };
        }
    };
}
