import * as fs from 'node:fs';
import * as path from 'node:path';
import { modules, registerMainModule } from '../module-registry.js';
import { collectPisiEditorAssetReferences } from './editor-asset-store.js';
import * as crypto from 'node:crypto';
import { copyPisiNoteTasks, makePisiCopyTitle } from './map-node-copy-core.js';
import { readPisiTask } from '../../shared/task-model.mjs';
import { listPisiNoteTaskIds } from '../../shared/task-blocks.mjs';

// "Paste as a copy" for maps (Alt+Mod+V, Mod+D): each source note becomes a new
// note in the target map's folder with a new id, its content, properties and
// sidecar assets, and a "(kopya)" title. Edges among the copied notes are
// recreated between the copies. The ordinary paste never copies notes; it adds
// map references (map.reference.attach.v1).
//
// Each task of a copied note is copied too, with a new id and the copy as its
// place (docs/task-plan.md §3.3, G5): one task is never linked to two notes.
// The copies go into tasks.json through the task service in the same atomic
// command (GV4, GV8).

const domain = modules['main.domainCommandQuery'];
const documentStore = modules['main.documentStore'];
const filesystemCore = modules['main.filesystemCore'];
const mapStore = modules['main.mapStore'];
const mapSemanticOperations = modules['main.mapSemanticOperationHooks'];
const electronIpc = modules['main.electronIpc'];

const PISI_MAP_COPY_LIMIT = 100;

function copyPisiSidecarAssets(sourceSidecar, targetSidecar, content) {
    if (!sourceSidecar || !targetSidecar) return 0;
    let copied = 0;
    for (const reference of collectPisiEditorAssetReferences(content)) {
        const from = path.resolve(sourceSidecar, reference);
        const to = path.resolve(targetSidecar, reference);
        if (path.dirname(path.dirname(from)) !== path.resolve(sourceSidecar) || path.dirname(path.dirname(to)) !== path.resolve(targetSidecar)) continue;
        if (!fs.existsSync(from) || fs.existsSync(to)) continue;
        globalThis.markInternalFileChange?.(path.dirname(to), to);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        globalThis.sealInternalFileChange?.(path.dirname(to), to);
        copied += 1;
    }
    return copied;
}

function duplicatePisiNodeIntoMap(mapPath, sourcePath, layout = {}, taskCopy = { tasksById: new Map(), entries: [], readOnly: false }) {
    const safeSource = electronIpc.assertProjectPath(sourcePath, { type: 'file', extensions: ['.node'] });
    const source = documentStore.ensurePisiFileMetadata(safeSource);
    if (!source.ok) return source;
    const created = documentStore.createNodeUnderMap(mapPath);
    if (!created.ok || !created.node?.fullPath) return created.ok ? { ok: false, error: 'Kopya not oluşturulamadı.' } : created;
    const target = documentStore.ensurePisiFileMetadata(created.node.fullPath);
    if (!target.ok) return target;
    const content = String(source.data.content || '');
    // Tasks cannot be copied while tasks.json cannot be read (GV11): the copy is refused rather than made without them.
    if (taskCopy.readOnly && listPisiNoteTaskIds(content)?.length !== 0) {
        return { ok: false, code: 'TASK_STORE_READ_ONLY', error: 'Görevler okunamadı; görevli not kopyalanamaz.' };
    }
    const assets = copyPisiSidecarAssets(source.sidecarPath, target.sidecarPath, content);
    const copied = copyPisiNoteTasks(content, { tasksById: taskCopy.tasksById, makeTaskId: () => `task_${crypto.randomUUID()}` });
    if (!copied) return { ok: false, code: 'NOTE_UNREADABLE', error: 'Notun içeriği izlenemiyor; kopyalanamadı.' };
    target.data.content = copied.content;
    for (const copy of copied.copies) taskCopy.entries.push({ id: copy.id, noteId: created.node.id, task: copy.task });
    if (source.data.properties && typeof source.data.properties === 'object') target.data.properties = JSON.parse(JSON.stringify(source.data.properties));
    target.data.pisi.updatedAt = new Date().toISOString();
    filesystemCore.writePisiDocument(created.node.fullPath, target.data);
    const renamed = documentStore.renamePisiFile(created.node.fullPath, makePisiCopyTitle(source.metadata?.title || path.basename(safeSource, '.node')));
    const fullPath = renamed.ok ? renamed.fullPath : created.node.fullPath;
    const width = Number(layout.width) || Number(created.node.layout?.width) || 220;
    const height = Number(layout.height) || Number(created.node.layout?.height) || 92;
    const saved = mapStore.saveMapNodeLayout(mapPath, [{ id: created.node.id, x: Number(layout.x) || 0, y: Number(layout.y) || 0, width, height }]);
    if (saved && saved.ok === false) return saved;
    return {
        ok: true,
        id: created.node.id,
        fullPath,
        sourceId: source.metadata?.id || null,
        title: renamed.ok ? renamed.metadata?.title || makePisiCopyTitle(source.metadata?.title) : created.node.metadata?.title,
        assets
    };
}

/**
 * payload: { mapPath, nodes: [{ sourcePath, layout: { x, y, width, height } }],
 *            edges: [{ sourceIndex, targetIndex, type, sourcePort, targetPort, customization }],
 *            openPaths: the documents open in the editor (an open diary a copied task joins is left to the editor, GV9) }
 */
function duplicatePisiMapNodes(payload = {}) {
    const mapPath = electronIpc.assertProjectPath(payload.mapPath, { type: 'file', extensions: ['.map'] });
    const requested = Array.isArray(payload.nodes) ? payload.nodes : [];
    if (!requested.length || requested.length > PISI_MAP_COPY_LIMIT) {
        return { ok: false, code: 'INVALID_COPY', error: `Tek seferde 1 ile ${PISI_MAP_COPY_LIMIT} not kopyalanabilir.` };
    }
    const nodes = [];
    const projectFolder = globalThis.activeProjectFolder;
    const taskState = modules['main.taskStore'].readPisiTaskStoreState(projectFolder, { fresh: true });
    const taskCopy = {
        tasksById: new Map(
            taskState.tasks
                .map(readPisiTask)
                .filter(Boolean)
                .map((task) => [task.id, task])
        ),
        entries: [],
        readOnly: taskState.readOnly === true
    };
    for (const item of requested) {
        const copied = duplicatePisiNodeIntoMap(mapPath, item?.sourcePath, item?.layout || {}, taskCopy);
        // Failing here rolls back the whole atomic command.
        if (!copied.ok) return copied;
        nodes.push(copied);
    }
    let copiedTasks = 0;
    let deferred = null;
    if (taskCopy.entries.length) {
        const added = modules['main.taskService'].addPisiNoteTasks(projectFolder, taskCopy.entries, { openPaths: payload.openPaths });
        if (!added.ok) return added;
        copiedTasks = added.tasks.length;
        deferred = added.deferred;
    }
    const edges = [];
    for (const edge of Array.isArray(payload.edges) ? payload.edges : []) {
        const source = nodes[Number(edge?.sourceIndex)];
        const target = nodes[Number(edge?.targetIndex)];
        if (!source || !target || source === target) continue;
        const saved = mapSemanticOperations.upsertPisiMapSemanticConnection(mapPath, {
            sourceId: source.id,
            targetId: target.id,
            type: edge.type,
            sourcePort: edge.sourcePort,
            targetPort: edge.targetPort,
            sourceRole: edge.sourceRole,
            targetRole: edge.targetRole,
            ...(edge.customization ? { customization: edge.customization } : {}),
            confirmSecondParentAsStream: true
        });
        if (!saved.ok) return saved;
        const createdEdge = (saved.edges || []).find((item) => item.sourceId === source.id && item.targetId === target.id);
        if (createdEdge) edges.push(createdEdge);
    }
    const projection = mapSemanticOperations.getPisiMapSemanticProjection(mapPath);
    return { ok: true, nodes, edges, allEdges: projection.ok ? projection.edges : [], tasks: copiedTasks, deferred };
}

function installPisiMapNodeCopyContracts() {
    domain.registerPisiDomainCommand('map.nodes.duplicate.v1', duplicatePisiMapNodes);
    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add('map.nodes.duplicate.v1');
}

const moduleApi = {
    duplicatePisiMapNodes,
    installPisiMapNodeCopyContracts
};

registerMainModule('main.mapNodeCopy', moduleApi);
installPisiMapNodeCopyContracts();
