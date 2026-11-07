import * as path from 'node:path';
import { modules, registerMainModule } from '../module-registry.js';
import * as shared from './project-integrity-shared.js';
import * as documents from './project-integrity-documents.js';
import * as authorities from './project-integrity-authorities.js';
import * as properties from './project-integrity-properties.js';
import * as recovery from './project-integrity-recovery.js';
import * as repairs from './project-integrity-repairs.js';
import './project-read-client.js';

/**
 * The audit as a sequence of steps. Each `yield` marks a point where the async
 * variant gives the event loop a turn; the synchronous variant runs straight
 * through. Both produce the same report.
 */
function* runPisiIntegrityAudit(projectFolder, prefetched = null) {
    const projectRoot = path.resolve(projectFolder);
    const context = { issues: [] };
    const inventory = documents.collectDocumentInventory(projectRoot, context, prefetched);
    yield;
    const tasks = authorities.auditTasks(projectRoot, context);
    const relationships = authorities.auditRelationships(projectRoot, context, inventory);
    const propertySchema = properties.auditPisiPropertySchema(projectRoot, context, inventory);
    yield;

    for (const [index, doc] of inventory.docs.entries()) {
        documents.auditNodeProperties(context, doc);
        documents.auditAttachments(projectRoot, context, doc);
        if (index % 500 === 499) yield;
    }
    // Maps one at a time (same order as auditMaps over the whole inventory).
    for (const doc of inventory.docs) {
        if (doc.type !== 'map') continue;
        documents.auditMaps(projectRoot, context, { ...inventory, docs: [doc] }, relationships.byId);
        yield;
    }
    documents.auditNodeParentMap(context, inventory);

    const trashItems = recovery.auditTrash(projectRoot, context);
    const mutationJournals = recovery.auditAtomic(projectRoot, context);
    /** @type {any} */
    const report = shared.integrityCore.makePisiIntegrityReport(context.issues, {
        files: inventory.files.length,
        nodes: inventory.nodeById.size,
        maps: inventory.mapById.size,
        tasks: tasks.tasks.length,
        relationships: relationships.relationships.length,
        propertyDefinitions: propertySchema.definitions.length,
        trashItems,
        mutationJournals
    });
    report.repairPlan = shared.makeRepairPlan(report.issues);
    report.authorities = {
        tasks: '.pisi/tasks.json',
        relationships: '.pisi/relationships.json',
        properties: '.pisi/properties.json',
        mapState: '*.map',
        trash: '.pisi/trash/items',
        mutations: '.pisi/mutations'
    };
    return report;
}

function auditPisiProjectIntegrity(projectFolder, prefetched = null) {
    const steps = runPisiIntegrityAudit(projectFolder, prefetched);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}

/**
 * The same report as auditPisiProjectIntegrity, with the document walk and the
 * reading/parsing of every note and map done by the project read worker first,
 * and the checks giving the event loop a turn between steps.
 * `onProgress(done, total)` reports the documents read.
 */
async function auditPisiProjectIntegrityAsync(projectFolder, options = {}) {
    const projectRoot = path.resolve(projectFolder);
    const reader = modules['main.projectRead'];
    if (!reader) return auditPisiProjectIntegrity(projectRoot);
    const files = await reader.runPisiProjectRead('walk', {
        root: projectRoot,
        options: { order: 'bfs', skipDirs: [...shared.PISI_INTEGRITY_SKIP_DIRS], limit: 50000 }
    });
    options.onProgress?.(0, files.length);
    const read = await reader.readPisiJsonFilesBatched(files, { onProgress: options.onProgress, sidecars: true });
    const steps = runPisiIntegrityAudit(projectRoot, { files, documents: read });
    let step = steps.next();
    while (!step.done) {
        await new Promise((resolve) => globalThis.setImmediate(resolve));
        step = steps.next();
    }
    return step.value;
}

function repairPisiProjectIntegrity(projectFolder, repairIds = []) {
    const before = auditPisiProjectIntegrity(projectFolder);
    const requested = new Set((Array.isArray(repairIds) ? repairIds : []).map(String));
    const safe = before.repairPlan?.safe || [];
    const selected = requested.size ? safe.filter((repair) => requested.has(repair.id)) : safe;

    if (!selected.length) {
        return {
            ok: true,
            applied: 0,
            results: [],
            before,
            after: before
        };
    }

    const results = [];
    for (const repair of selected) {
        const result = repairs.applySafeRepair(projectFolder, repair);
        results.push({
            repairId: repair.id,
            action: repair.action,
            result
        });
        if (!result?.ok) {
            return {
                ok: false,
                code: 'INTEGRITY_REPAIR_FAILED',
                error: result?.error || `Repair başarısız: ${repair.action}`,
                applied: results.filter((item) => item.result?.ok).length,
                results
            };
        }
    }

    return {
        ok: true,
        applied: results.length,
        results,
        before,
        after: auditPisiProjectIntegrity(projectFolder)
    };
}

function rebuildPisiDerivedIntegrityState(projectFolder) {
    return repairs.rebuildDerivedState(projectFolder, auditPisiProjectIntegrity);
}

const moduleApi = {
    PISI_INTEGRITY_VERSION: shared.integrityCore.PISI_INTEGRITY_VERSION,
    walkIntegrityProjectDocuments: shared.walkProjectDocuments,
    extractLocalAttachmentCandidates: shared.extractLocalAttachmentCandidates,
    collectPisiDocumentInventory: documents.collectDocumentInventory,
    auditPisiProjectIntegrity,
    auditPisiProjectIntegrityAsync,
    repairPisiProjectIntegrity,
    rebuildPisiDerivedIntegrityState,
    makeRepairPlan: shared.makeRepairPlan
};

registerMainModule('main.projectIntegrity', moduleApi);
