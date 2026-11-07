import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Writes a synthetic Pisi project for main-process performance measurements:
// `notes` notes spread over maps of `perMap` notes. Every map owns a sidecar
// folder (nd_…) holding its notes, every note has its own sidecar folder
// (inv_…), and every tenth note links to the next one with an id link. The
// project also has the .pisi folders a used project has (trash, mutations,
// history), so the watcher sees a realistic tree. Files follow
// pisi-definition.md, so the app opens them without migrating anything.
//
// CLI: node scripts/generate-project-fixture.mjs <projectFolder> [notes=1000] [perMap=250]

function uuid(seed) {
    // Deterministic ids keep runs comparable.
    const hex = crypto.createHash('sha256').update(String(seed)).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const STAMP = '2026-11-07T00:00:00.000Z';

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function noteContent(index, nextId, nextTitle) {
    const blocks = [
        `<div class="pisi-editor-block" data-pisi-block-id="blk_${index}_a" data-pisi-block-type="paragraph">Not ${index + 1}: proje planı, toplantı notları ve kararlar. Çalışma kapsamı ve takvim.</div>`,
        `<div class="pisi-editor-block" data-pisi-block-id="blk_${index}_b" data-pisi-block-type="paragraph">İkinci paragraf: <strong>önemli</strong> ayrıntılar, #etiket${index % 20} ve açıklamalar.</div>`
    ];
    if (nextId) {
        blocks.push(
            `<div class="pisi-editor-block" data-pisi-block-id="blk_${index}_c" data-pisi-block-type="paragraph">Bağlantı: <a class="pisi-wiki-link" data-pisi-node-id="${nextId}" data-pisi-node-title="${nextTitle}" contenteditable="false">${nextTitle}</a></div>`
        );
    }
    return blocks.join('');
}

/**
 * @param {string} projectFolder
 * @param {{ notes?: number, perMap?: number }} [options]
 * @returns {Promise<{ notes: number, maps: number, directories: number, files: number, notePaths: string[] }>}
 */
export async function generatePisiProjectFixture(projectFolder, options = {}) {
    const total = Math.max(1, Number(options.notes) || 1000);
    const perMap = Math.max(1, Number(options.perMap) || 250);
    const mapCount = Math.ceil(total / perMap);
    let directories = 0;
    let files = 0;
    const notePaths = [];
    for (const folder of ['.pisi/trash/items', '.pisi/mutations', '.pisi-history']) {
        await fs.mkdir(path.join(projectFolder, folder), { recursive: true });
        directories += 1;
    }
    const ids = Array.from({ length: total }, (_value, index) => `node_${uuid(`project-node-${index}`)}`);
    const titles = Array.from({ length: total }, (_value, index) => `Not ${String(index + 1).padStart(5, '0')}`);
    for (let mapIndex = 0; mapIndex < mapCount; mapIndex += 1) {
        const mapId = `map_${uuid(`project-map-${mapIndex}`)}`;
        const mapTitle = `Harita ${String(mapIndex + 1).padStart(3, '0')}`;
        const mapSidecar = `nd_${mapTitle}__${mapId}`;
        const mapFolder = path.join(projectFolder, mapSidecar);
        await fs.mkdir(mapFolder, { recursive: true });
        directories += 1;
        const nodes = [];
        const start = mapIndex * perMap;
        const end = Math.min(total, start + perMap);
        for (let index = start; index < end; index += 1) {
            const nodeSidecar = `inv_${titles[index]}__${ids[index]}`;
            const notePath = path.join(mapFolder, `${titles[index]}.node`);
            const linked = index % 10 === 0 && index + 1 < total;
            await writeJson(notePath, {
                pisi: {
                    version: 1,
                    type: 'node',
                    id: ids[index],
                    title: titles[index],
                    sidecar: nodeSidecar,
                    createdAt: STAMP,
                    updatedAt: STAMP,
                    parentMap: mapId
                },
                properties: {},
                content: noteContent(index, linked ? ids[index + 1] : '', linked ? titles[index + 1] : '')
            });
            await fs.mkdir(path.join(mapFolder, nodeSidecar), { recursive: true });
            notePaths.push(notePath);
            files += 1;
            directories += 1;
            const local = index - start;
            nodes.push({ id: ids[index], x: (local % 25) * 260, y: Math.floor(local / 25) * 150, width: 220, height: 92 });
        }
        await writeJson(path.join(projectFolder, `${mapTitle}.map`), {
            pisi: { version: 1, type: 'map', id: mapId, title: mapTitle, sidecar: mapSidecar, createdAt: STAMP, updatedAt: STAMP },
            map: { nodes, references: [], relationshipViews: [], relationshipViewVersion: 1, camera: { x: 0, y: 0, zoom: 1 }, collapsedHubs: [] }
        });
        files += 1;
    }
    await writeJson(path.join(projectFolder, '.pisi', 'relationships.json'), { version: 1, relationships: [] });
    return { notes: total, maps: mapCount, directories, files, notePaths };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const projectFolder = path.resolve(process.argv[2] || 'pisi-project-fixture');
    const result = await generatePisiProjectFixture(projectFolder, { notes: Number(process.argv[3]) || 1000, perMap: Number(process.argv[4]) || 250 });
    console.log(JSON.stringify({ ...result, notePaths: undefined }, null, 2));
}
