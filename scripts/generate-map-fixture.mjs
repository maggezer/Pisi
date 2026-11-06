import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Writes a synthetic Pisi project for map performance measurements: one map
// per requested size, each owning its nodes (map sidecar folder), laid out on a
// grid, connected as a tree (down-hub, N-1 edges) plus one stream edge per five
// nodes, all with relationship views. Files follow pisi-definition.md, so the
// app opens them without migrating anything.
//
// CLI: node scripts/generate-map-fixture.mjs <projectFolder> [200,1000,5000]

const GRID_COLUMNS = 50;
const GRID_X = 260;
const GRID_Y = 150;

function uuid(seed) {
    // Deterministic ids keep runs comparable.
    const hex = crypto.createHash('sha256').update(String(seed)).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function stamp() {
    return '2026-11-06T00:00:00.000Z';
}

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/**
 * @param {string} projectFolder
 * @param {number[]} sizes
 * @returns {Promise<{ maps: { size: number, mapPath: string, nodes: number, edges: number }[] }>}
 */
export async function generatePisiMapFixture(projectFolder, sizes = [200, 1000, 5000]) {
    await fs.mkdir(path.join(projectFolder, '.pisi'), { recursive: true });
    const relationships = [];
    const maps = [];
    for (const size of sizes) {
        const mapId = `map_${uuid(`map-${size}`)}`;
        const mapTitle = `Perf ${size}`;
        const mapSidecar = `nd_${mapTitle}__${mapId}`;
        const mapPath = path.join(projectFolder, `${mapTitle}.map`);
        const nodes = [];
        const views = [];
        for (let index = 0; index < size; index += 1) {
            const nodeId = `node_${uuid(`node-${size}-${index}`)}`;
            const title = `Düğüm ${index + 1}`;
            const nodeSidecar = `inv_${title}__${nodeId}`;
            const nodeFolder = path.join(projectFolder, mapSidecar);
            await writeJson(path.join(nodeFolder, `${title}.node`), {
                pisi: { version: 1, type: 'node', id: nodeId, title, sidecar: nodeSidecar, createdAt: stamp(), updatedAt: stamp(), parentMap: mapId },
                properties: {},
                content: `<div class="pisi-editor-block" data-pisi-block-id="blk_${index}">Örnek içerik ${index + 1}</div>`
            });
            await fs.mkdir(path.join(nodeFolder, nodeSidecar), { recursive: true });
            nodes.push({ id: nodeId, x: (index % GRID_COLUMNS) * GRID_X, y: Math.floor(index / GRID_COLUMNS) * GRID_Y, width: 220, height: 92 });
        }
        const addEdge = (source, target, type, ports) => {
            const id = `edge_${uuid(`edge-${size}-${source}-${target}-${type}`)}`;
            const roles = type === 'stream' ? ['downstream', 'upstream'] : ['down-hub', 'up-hub'];
            relationships.push({
                id,
                sourceId: nodes[source].id,
                targetId: nodes[target].id,
                type,
                sourceRole: roles[0],
                targetRole: roles[1],
                direction: 'directed',
                createdAt: stamp(),
                updatedAt: stamp()
            });
            views.push({ relationshipId: id, sourcePort: ports[0], targetPort: ports[1] });
        };
        // A tree: node i's parent is the node in the row above, or the previous one in row 0.
        for (let index = 1; index < size; index += 1) {
            const parent = index >= GRID_COLUMNS ? index - GRID_COLUMNS : index - 1;
            addEdge(parent, index, 'down-hub', index >= GRID_COLUMNS ? ['bottom', 'top'] : ['right', 'left']);
        }
        for (let index = 0; index + 1 < size; index += 5) addEdge(index, index + 1, 'stream', ['right', 'left']);
        await fs.mkdir(path.join(projectFolder, mapSidecar), { recursive: true });
        await writeJson(mapPath, {
            pisi: { version: 1, type: 'map', id: mapId, title: mapTitle, sidecar: mapSidecar, createdAt: stamp(), updatedAt: stamp() },
            map: { nodes, references: [], relationshipViews: views, relationshipViewVersion: 1, camera: { x: 0, y: 0, zoom: 1 }, collapsedHubs: [] }
        });
        maps.push({ size, mapPath, nodes: size, edges: views.length });
    }
    await writeJson(path.join(projectFolder, '.pisi', 'relationships.json'), { version: 1, relationships });
    return { maps };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const projectFolder = path.resolve(process.argv[2] || 'pisi-map-fixture');
    const sizes = String(process.argv[3] || '200,1000,5000')
        .split(',')
        .map(Number)
        .filter((value) => value > 0);
    const result = await generatePisiMapFixture(projectFolder, sizes);
    console.log(JSON.stringify(result, null, 2));
}
