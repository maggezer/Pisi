// Developer menu only: a small map for the sample project, so the Maps tab
// can be tried on a phone before real projects can be transferred. Mobile
// never changes a map; this writes a new one in the desktop's format, the way
// the desktop lays out a map made from scratch: a `.map` file, its `nd_…`
// folder with the notes on it, and the relationships appended to
// `.pisi/relationships.json` (read right before the write, nothing else in it
// is touched, V5). Every relationship has a view on the map.

import { makePisiDocumentData } from '../../../shared/document-model.mjs';
import { formatPisiBlockId, formatPisiDocumentId } from '../../../shared/ids.mjs';
import { joinKey } from './drivers/keys.mjs';
import { parseJsonText, serializeDocument } from './json-file.mjs';
import { PISI_RELATIONSHIP_STORE_KEY } from './map-repo.mjs';
import { makeBlockHtml, textToBlockHtml } from './note-patch.mjs';

export const PISI_SAMPLE_MAP_TITLE = 'Örnek Harita';

// Title, text and world position of each note; the first is the root.
const NOTES = [
    ['Pisi Mobil', 'Haritanın kökü.', 400, 60],
    ['Görevler', 'Bugün, yaklaşan ve gelen kutusu.', 100, 280],
    ['Notlar', 'Blok düzeyinde düzenleme.', 400, 280],
    ['Takvim', 'Görev ve günlük noktaları.', 700, 280],
    ['Haritalar', 'Yalnız görüntüleme.', 400, 500],
    ['Aktarım', 'Sonraki plan.', 1000, 500]
];
// [source, target, type, sourcePort, targetPort]
const LINKS = [
    [0, 1, 'down-hub', 'bottom', 'top'],
    [0, 2, 'down-hub', 'bottom', 'top'],
    [0, 3, 'down-hub', 'bottom', 'top'],
    [2, 4, 'down-hub', 'bottom', 'top'],
    [1, 2, 'co-level', 'right', 'left'],
    [3, 5, 'stream', 'right', 'top']
];

const roles = (type) => (type === 'co-level' ? ['co-level', 'co-level'] : type === 'stream' ? ['downstream', 'upstream'] : ['down-hub', 'up-hub']);

/** Adds the sample map unless the project already has a map of that title. Returns whether it was added. */
export async function addSampleMap(project, { now, makeUuid }) {
    await project.index.build();
    if (project.index.getMaps().some((map) => map.title === PISI_SAMPLE_MAP_TITLE)) return false;
    const stamp = now().toISOString();
    const mapId = formatPisiDocumentId('.map', makeUuid());
    const mapData = makePisiDocumentData({ ext: '.map', title: PISI_SAMPLE_MAP_TITLE, id: mapId, now: stamp });
    const notes = NOTES.map(([title, text, x, y]) => ({ id: formatPisiDocumentId('.node', makeUuid()), title, text, x, y }));
    const relationships = LINKS.map(([source, target, type, sourcePort, targetPort]) => {
        const [sourceRole, targetRole] = roles(type);
        return {
            record: {
                id: `edge_${makeUuid()}`,
                sourceId: notes[source].id,
                targetId: notes[target].id,
                type,
                sourceRole,
                targetRole,
                direction: type === 'co-level' ? 'undirected' : 'directed',
                createdAt: stamp,
                updatedAt: stamp
            },
            sourcePort,
            targetPort
        };
    });
    mapData.map.nodes = notes.map(({ id, x, y }) => ({ id, x, y, width: 220, height: 92 }));
    mapData.map.relationshipViews = relationships.map(({ record, sourcePort, targetPort }) => ({ relationshipId: record.id, sourcePort, targetPort }));

    // The relationships first: a map whose relationships are missing would draw nothing, the other way round is harmless.
    await project.writer.update(PISI_RELATIONSHIP_STORE_KEY, (current) => {
        const parsed = parseJsonText(current);
        if (parsed.status === 'corrupt' || (parsed.status === 'ok' && !Array.isArray(parsed.data.relationships))) {
            throw new Error('relationships.json cannot be read; the sample map is not added');
        }
        const store = parsed.status === 'ok' ? parsed.data : { version: 1, relationships: [] };
        store.relationships = [...store.relationships, ...relationships.map(({ record }) => record)];
        return serializeDocument(store);
    });
    const folder = mapData.pisi.sidecar;
    await project.writer.run(async (tx) => {
        await tx.mkdir(folder);
        for (const note of notes) {
            const data = makePisiDocumentData({ ext: '.node', title: note.title, id: note.id, parentMap: mapId, now: stamp });
            data.content = makeBlockHtml('paragraph', formatPisiBlockId(makeUuid()), textToBlockHtml(note.text));
            await tx.write(joinKey(folder, `${note.title}.node`), serializeDocument(data));
            await tx.mkdir(joinKey(folder, data.pisi.sidecar));
        }
        await tx.write(`${PISI_SAMPLE_MAP_TITLE}.map`, serializeDocument(mapData));
    });
    return true;
}
