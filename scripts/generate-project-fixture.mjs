import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { PISI_DIARY_MARKER_FILE, PISI_DIARY_MARKER_TEXT, getPisiDiaryNodeKey, makePisiDiaryDocumentData } from '../shared/diary-rules.mjs';
import { formatPisiDocumentId, formatPisiTaskId } from '../shared/ids.mjs';
import { formatPisiTodoTag, normalizePisiTask, normalizePisiTaskRecord } from '../shared/task-model.mjs';
import { makePisiTaskBlockHtml } from '../shared/task-blocks.mjs';
import { groupPisiTasksByDay, replacePisiDiaryTaskSection } from '../shared/task-diary.mjs';

// Writes a synthetic Pisi project for main-process performance measurements:
// `notes` notes spread over maps of `perMap` notes. Every map owns a sidecar
// folder (nd_…) holding its notes, every note has its own sidecar folder
// (inv_…), and every tenth note links to the next one with an id link. The
// project also has the .pisi folders a used project has (trash, mutations,
// history), so the watcher sees a realistic tree. Files follow
// pisi-definition.md, so the app opens them without migrating anything.
// With `relationships: true` the notes of every map also form a hierarchy
// (each note under the one `floor((i - 1) / 4)` places before it on its map)
// stored in .pisi/relationships.json, with a view of each relationship on the
// map; the mobile map viewer's performance test draws such a map.
// With `tasks: n` the project also has n tasks in .pisi/tasks.json around the
// day `today` (default 2026-11-14): twelve on that day, the rest spread over
// the two years around it, every fifth done and every third with a time. With
// `diaryDays: n` it has a diary entry for each of the n days up to `today`.
// Task and diary records are made by the shared rules the desktop and the
// mobile app write them with (shared/task-model.mjs, shared/diary-rules.mjs);
// the mobile large-project test (mobile/e2e/large-project.spec.mjs) uses them.
// With `taskModel: 2` the n tasks are version 2 records (docs/task-plan.md
// §3.1; the mobile large-project test uses it since G8, the default stays
// version 1 for the older desktop and sync measurements): every
// fourth lives in its due day's diary, the others in a note, whose content
// carries their task blocks (§3.2.1); every tenth repeats daily and was done on
// the days before `today`. Every day a task is on gets its diary with the task
// section the rule gives (§3.2.2, GV15), so the project has no Integrity
// finding. `heavyNoteTasks: m` puts m more tasks into the first note (the
// measurement of a note with many task blocks, G7).
// With `images: n` (and `imageBytes`, about 700 KB by default) n notes, spread
// over the project, carry an image block whose PNG lies in the note's sidecar
// under its content's SHA-256 (pisi-definition.md); the pixels are noise, so the
// PNG does not compress and the project has the size the sync measurement of
// docs/sync-plan.md S6 asks for (tests/sync-server-contract-transfer.test.mjs).
//
// CLI: node scripts/generate-project-fixture.mjs <projectFolder> [notes=1000] [perMap=250] [relationships=0] [tasks=0] [diaryDays=0] [images=0] [taskModel=1] [heavyNoteTasks=0]

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

/** `YYYY-MM-DD` `offset` days from `isoDate`, counted on the calendar (no time zone involved). */
function shiftDay(isoDate, offset) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function makeTasks(count, today) {
    const now = new Date(STAMP);
    return Array.from({ length: count }, (_value, index) => {
        const dueDate = index < 12 ? today : shiftDay(today, (index % 700) - 350 || 1);
        const priority = (index % 5) + 1;
        const done = index >= 12 && index % 5 === 4;
        return normalizePisiTaskRecord(
            {
                id: formatPisiTaskId(uuid(`project-task-${index}`)),
                title: `Görev ${index + 1}`,
                status: done ? 'done' : 'todo',
                priority,
                dueDate,
                scheduledAt: index % 3 === 0 ? `${dueDate}T${String(8 + (index % 10)).padStart(2, '0')}:00` : dueDate,
                manualOrder: index,
                todoTag: formatPisiTodoTag(priority, dueDate),
                completedAt: done ? STAMP : null
            },
            null,
            { now, makeUuid: () => uuid(`project-task-fallback-${index}`), normalizeStoredPath: (value) => value }
        );
    });
}

/**
 * Version 2 tasks (§3.1) around `today`: the same days, priorities and done
 * share as the version 1 tasks; every fourth lives in its due day's diary,
 * the others in the notes `noteIds` (the first `heavy` extra ones in the
 * first note); every tenth repeats daily and has been done on the three days
 * before `today`.
 */
function makeTasksV2(count, heavy, today, noteIds) {
    const tasks = [];
    for (let index = 0; index < count + heavy; index += 1) {
        const extra = index >= count;
        const dueDate = extra ? shiftDay(today, (index % 30) - 10) : index < 12 ? today : shiftDay(today, (index % 700) - 350 || 1);
        const repeat = !extra && index % 10 === 3;
        const done = !repeat && index >= 12 && index % 5 === 4;
        const inDiary = !extra && index % 4 === 1;
        const place = inDiary ? { diaryDate: dueDate } : { noteId: extra ? noteIds[0] : noteIds[(index * 7) % noteIds.length] };
        const created = new Date(Date.parse(STAMP) + index * 1000);
        const due = repeat ? today : dueDate;
        const completions = repeat
            ? [3, 2, 1].map((back) => ({ date: shiftDay(today, -back), dueDate: shiftDay(today, -back), at: `${shiftDay(today, -back)}T07:30:00.000Z` }))
            : [];
        const normalized = normalizePisiTask(
            {
                id: formatPisiTaskId(uuid(`project-task-${index}`)),
                title: `Görev ${index + 1}`,
                status: done ? 'done' : 'todo',
                priority: (index % 5) + 1,
                dueDate: due,
                dueTime: index % 3 === 0 ? `${String(8 + (index % 10)).padStart(2, '0')}:00` : null,
                repeat: repeat ? 'daily' : 'none',
                completions,
                manualOrder: index,
                ...place
            },
            null,
            { now: created, makeUuid: () => uuid(`project-task-fallback-${index}`) }
        );
        if (!normalized.ok) throw new Error(`Görev ${index} üretilemedi: ${JSON.stringify(normalized.errors)}`);
        const task = normalized.task;
        if (done) Object.assign(task, { completedAt: STAMP, completedOn: STAMP.slice(0, 10) });
        tasks.push(task);
    }
    return tasks;
}

/** Writes the diary of every day in `days` (a paragraph for `withText` days) with the task section of `byDay`. */
async function writeDiaryV2(projectFolder, days, withText, byDay) {
    await fs.mkdir(path.join(projectFolder, 'diary'), { recursive: true });
    await fs.writeFile(path.join(projectFolder, 'diary', PISI_DIARY_MARKER_FILE), PISI_DIARY_MARKER_TEXT, 'utf8');
    for (const [position, isoDate] of [...days].sort().entries()) {
        const data = makePisiDiaryDocumentData({ isoDate, id: formatPisiDocumentId('.node', uuid(`project-diary-${isoDate}`)), now: STAMP });
        const text = withText.has(isoDate)
            ? `<div class="pisi-editor-block" data-pisi-block-id="blk_diary_${position}" data-pisi-block-type="paragraph">${isoDate} günlüğü: yürüyüş, okuma ve toplantı.</div>`
            : '';
        data.content = replacePisiDiaryTaskSection(text, isoDate, byDay.get(isoDate) || []) ?? text;
        await writeJson(path.join(projectFolder, ...getPisiDiaryNodeKey(isoDate).split('/')), data);
    }
}

/** A PNG of about `bytes` bytes: noise pixels (seeded, so runs repeat), stored without compression. */
function makeNoisePng(seed, bytes) {
    const width = 512;
    const height = Math.max(1, Math.ceil(bytes / (width * 3 + 1)));
    const raw = Buffer.alloc(height * (width * 3 + 1));
    let state = (seed * 2654435761) >>> 0 || 1;
    for (let row = 0; row < height; row += 1) {
        const start = row * (width * 3 + 1);
        raw[start] = 0;
        for (let at = start + 1; at < start + width * 3 + 1; at += 1) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            raw[at] = state & 0xff;
        }
    }
    const chunk = (type, data) => {
        const head = Buffer.alloc(4);
        head.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(body) >>> 0);
        return Buffer.concat([head, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/** Writes the image of note `index` into its sidecar; returns the image block for its content. */
async function writeNoteImage(sidecarFolder, index, bytes) {
    const png = makeNoisePng(index + 1, bytes);
    const reference = `image/${crypto.createHash('sha256').update(png).digest('hex')}.png`;
    await fs.mkdir(path.join(sidecarFolder, 'image'), { recursive: true });
    await fs.writeFile(path.join(sidecarFolder, ...reference.split('/')), png);
    return {
        size: png.length,
        html: `<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="blk_${index}_img" data-pisi-block-type="image" contenteditable="false"><img data-pisi-image-asset="${reference}" alt="Görsel ${index + 1}"></div>`
    };
}

async function writeDiary(projectFolder, days, today) {
    await fs.mkdir(path.join(projectFolder, 'diary'), { recursive: true });
    await fs.writeFile(path.join(projectFolder, 'diary', PISI_DIARY_MARKER_FILE), PISI_DIARY_MARKER_TEXT, 'utf8');
    for (let offset = 0; offset < days; offset += 1) {
        const isoDate = shiftDay(today, -offset);
        const data = makePisiDiaryDocumentData({ isoDate, id: formatPisiDocumentId('.node', uuid(`project-diary-${isoDate}`)), now: STAMP });
        data.content = `<div class="pisi-editor-block" data-pisi-block-id="blk_diary_${offset}" data-pisi-block-type="paragraph">${isoDate} günlüğü: yürüyüş, okuma ve toplantı.</div>`;
        await writeJson(path.join(projectFolder, ...getPisiDiaryNodeKey(isoDate).split('/')), data);
    }
}

/**
 * @param {string} projectFolder
 * @param {{ notes?: number, perMap?: number, relationships?: boolean, tasks?: number, diaryDays?: number, today?: string, images?: number, imageBytes?: number, taskModel?: number, heavyNoteTasks?: number }} [options]
 * @returns {Promise<{ notes: number, maps: number, relationships: number, tasks: number, taskModel: number, diaryDays: number, diaries: number, images: number, imageBytes: number, directories: number, files: number, notePaths: string[] }>}
 */
export async function generatePisiProjectFixture(projectFolder, options = {}) {
    const total = Math.max(1, Number(options.notes) || 1000);
    const perMap = Math.max(1, Number(options.perMap) || 250);
    const mapCount = Math.ceil(total / perMap);
    let directories = 0;
    let files = 0;
    const notePaths = [];
    const relationships = [];
    const imageCount = Math.min(total, Math.max(0, Number(options.images) || 0));
    const imageStep = imageCount ? Math.floor(total / imageCount) : 0;
    const imageSize = Math.max(1024, Number(options.imageBytes) || 700 * 1024);
    let images = 0;
    let imageBytes = 0;
    for (const folder of ['.pisi/trash/items', '.pisi/mutations', '.pisi-history']) {
        await fs.mkdir(path.join(projectFolder, folder), { recursive: true });
        directories += 1;
    }
    const ids = Array.from({ length: total }, (_value, index) => `node_${uuid(`project-node-${index}`)}`);
    const today = options.today || '2026-11-14';
    const taskCount = Math.max(0, Number(options.tasks) || 0);
    const taskModel = Number(options.taskModel) === 2 ? 2 : 1;
    const heavyNoteTasks = taskModel === 2 ? Math.max(0, Number(options.heavyNoteTasks) || 0) : 0;
    const tasksV2 = taskModel === 2 && taskCount + heavyNoteTasks ? makeTasksV2(taskCount, heavyNoteTasks, today, ids) : [];
    const noteTaskIds = new Map();
    for (const task of tasksV2) {
        if (!task.noteId) continue;
        if (!noteTaskIds.has(task.noteId)) noteTaskIds.set(task.noteId, []);
        noteTaskIds.get(task.noteId).push(task.id);
    }
    const titles = Array.from({ length: total }, (_value, index) => `Not ${String(index + 1).padStart(5, '0')}`);
    for (let mapIndex = 0; mapIndex < mapCount; mapIndex += 1) {
        const mapId = `map_${uuid(`project-map-${mapIndex}`)}`;
        const mapTitle = `Harita ${String(mapIndex + 1).padStart(3, '0')}`;
        const mapSidecar = `nd_${mapTitle}__${mapId}`;
        const mapFolder = path.join(projectFolder, mapSidecar);
        await fs.mkdir(mapFolder, { recursive: true });
        directories += 1;
        const nodes = [];
        const relationshipViews = [];
        const start = mapIndex * perMap;
        const end = Math.min(total, start + perMap);
        for (let index = start; index < end; index += 1) {
            const nodeSidecar = `inv_${titles[index]}__${ids[index]}`;
            const notePath = path.join(mapFolder, `${titles[index]}.node`);
            const linked = index % 10 === 0 && index + 1 < total;
            let content = noteContent(index, linked ? ids[index + 1] : '', linked ? titles[index + 1] : '');
            for (const [position, taskId] of (noteTaskIds.get(ids[index]) || []).entries()) {
                content += makePisiTaskBlockHtml({ blockId: `blk_${index}_t${position}`, taskId });
            }
            if (imageStep && index % imageStep === 0 && images < imageCount) {
                const image = await writeNoteImage(path.join(mapFolder, nodeSidecar), index, imageSize);
                content += image.html;
                images += 1;
                imageBytes += image.size;
                files += 1;
            }
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
                content
            });
            await fs.mkdir(path.join(mapFolder, nodeSidecar), { recursive: true });
            notePaths.push(notePath);
            files += 1;
            directories += 1;
            const local = index - start;
            nodes.push({ id: ids[index], x: (local % 25) * 260, y: Math.floor(local / 25) * 150, width: 220, height: 92 });
            if (options.relationships && local > 0) {
                const id = `edge_${uuid(`project-edge-${index}`)}`;
                const sourceId = ids[start + Math.floor((local - 1) / 4)];
                relationships.push({
                    id,
                    sourceId,
                    targetId: ids[index],
                    type: 'down-hub',
                    sourceRole: 'down-hub',
                    targetRole: 'up-hub',
                    direction: 'directed',
                    createdAt: STAMP,
                    updatedAt: STAMP
                });
                relationshipViews.push({ relationshipId: id, sourcePort: 'bottom', targetPort: 'top' });
            }
        }
        await writeJson(path.join(projectFolder, `${mapTitle}.map`), {
            pisi: { version: 1, type: 'map', id: mapId, title: mapTitle, sidecar: mapSidecar, createdAt: STAMP, updatedAt: STAMP },
            map: { nodes, references: [], relationshipViews, relationshipViewVersion: 1, camera: { x: 0, y: 0, zoom: 1 }, collapsedHubs: [] }
        });
        files += 1;
    }
    await writeJson(path.join(projectFolder, '.pisi', 'relationships.json'), { version: 1, relationships });
    const diaryDays = Math.max(0, Number(options.diaryDays) || 0);
    let diaries = diaryDays;
    if (taskModel === 2) {
        if (tasksV2.length) {
            await writeJson(path.join(projectFolder, '.pisi', 'tasks.json'), { version: 2, updatedAt: STAMP, tasks: tasksV2 });
            files += 1;
        }
        const byDay = groupPisiTasksByDay(tasksV2);
        const withText = new Set(Array.from({ length: diaryDays }, (_value, offset) => shiftDay(today, -offset)));
        const days = new Set([...withText, ...byDay.keys()]);
        diaries = days.size;
        if (days.size) {
            await writeDiaryV2(projectFolder, days, withText, byDay);
            files += days.size + 1;
            directories += 1;
        }
    } else {
        if (taskCount) {
            await writeJson(path.join(projectFolder, '.pisi', 'tasks.json'), { version: 1, updatedAt: STAMP, tasks: makeTasks(taskCount, today) });
            files += 1;
        }
        if (diaryDays) {
            await writeDiary(projectFolder, diaryDays, today);
            files += diaryDays + 1;
            directories += 1;
        }
    }
    return {
        notes: total,
        maps: mapCount,
        relationships: relationships.length,
        tasks: taskModel === 2 ? tasksV2.length : taskCount,
        taskModel,
        diaryDays,
        diaries,
        images,
        imageBytes,
        directories,
        files,
        notePaths
    };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const projectFolder = path.resolve(process.argv[2] || 'pisi-project-fixture');
    const result = await generatePisiProjectFixture(projectFolder, {
        notes: Number(process.argv[3]) || 1000,
        perMap: Number(process.argv[4]) || 250,
        relationships: process.argv[5] === '1',
        tasks: Number(process.argv[6]) || 0,
        diaryDays: Number(process.argv[7]) || 0,
        images: Number(process.argv[8]) || 0,
        taskModel: Number(process.argv[9]) || 1,
        heavyNoteTasks: Number(process.argv[10]) || 0
    });
    console.log(JSON.stringify({ ...result, notePaths: undefined }, null, 2));
}
