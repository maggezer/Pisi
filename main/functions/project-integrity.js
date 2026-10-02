'use strict';

const path = require('path');
const { registerMainModule } = require('../module-registry');
const shared = require('./project-integrity-shared');
const documents = require('./project-integrity-documents');
const authorities = require('./project-integrity-authorities');
const properties = require('./project-integrity-properties');
const recovery = require('./project-integrity-recovery');
const repairs = require('./project-integrity-repairs');

function auditPisiProjectIntegrity(projectFolder) {
    const projectRoot = path.resolve(projectFolder);
    const context = { issues: [] };
    const inventory = documents.collectDocumentInventory(projectRoot, context);
    const tasks = authorities.auditTasks(projectRoot, context);
    const relationships = authorities.auditRelationships(projectRoot, context, inventory);
    const propertySchema = properties.auditPisiPropertySchema(projectRoot, context, inventory);

    for (const doc of inventory.docs) {
        documents.auditNodeProperties(context, doc);
        documents.auditAttachments(projectRoot, context, doc);
    }
    documents.auditMaps(projectRoot, context, inventory, relationships.byId);
    documents.auditNodeParentMap(context, inventory);
    documents.auditDerivedConnections(context, inventory, relationships.relationships);

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
    repairPisiProjectIntegrity,
    rebuildPisiDerivedIntegrityState,
    makeRepairPlan: shared.makeRepairPlan
};

registerMainModule('main.projectIntegrity', moduleApi);
