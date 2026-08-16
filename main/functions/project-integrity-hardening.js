'use strict';

const { modules, registerMainModule } = require('../module-registry');

const projectIntegrity = modules['main.projectIntegrity'];

function hardenPisiIntegrityReport(report) {
    if (!report?.ok || !Array.isArray(report.issues)) return report;
    for (const issue of report.issues) {
        if (
            issue.code === 'node-derived-connections-stale' &&
            issue.repair?.action === 'rebuild-node-derived-connections'
        ) {
            issue.repair.safety = 'review';
            issue.repair.description =
                'Bu cache proje çapındaki canonical relationship graphından yeniden hesaplanmalıdır; Settings içindeki “Türetilmiş durumu yeniden oluştur” akışını kullanın.';
        }
    }
    const plan = { safe: [], review: [], manual: [] };
    for (const issue of report.issues) {
        if (!issue.repair) continue;
        plan[issue.repair.safety].push({
            issueId: issue.id,
            code: issue.code,
            path: issue.path,
            entityId: issue.entityId,
            ...issue.repair
        });
    }
    report.repairPlan = plan;
    report.summary.safeRepairs = plan.safe.length;
    report.summary.reviewRepairs = plan.review.length;
    report.summary.manualRepairs = plan.manual.length;
    return report;
}

const originalAudit = projectIntegrity.auditPisiProjectIntegrity.bind(projectIntegrity);
const originalRepair = projectIntegrity.repairPisiProjectIntegrity.bind(projectIntegrity);
const originalRebuild = projectIntegrity.rebuildPisiDerivedIntegrityState.bind(projectIntegrity);

projectIntegrity.auditPisiProjectIntegrity = function hardenedIntegrityAudit(projectFolder) {
    return hardenPisiIntegrityReport(originalAudit(projectFolder));
};

projectIntegrity.repairPisiProjectIntegrity = function hardenedIntegrityRepair(
    projectFolder,
    repairIds = []
) {
    const hardenedBefore = projectIntegrity.auditPisiProjectIntegrity(projectFolder);
    const allowed = new Set(
        (hardenedBefore.repairPlan?.safe || []).map((repair) => repair.id)
    );
    const requested = (Array.isArray(repairIds) ? repairIds : [])
        .map(String)
        .filter((repairId) => allowed.has(repairId));
    const result = originalRepair(projectFolder, requested);
    if (result?.before) result.before = hardenPisiIntegrityReport(result.before);
    if (result?.after) result.after = hardenPisiIntegrityReport(result.after);
    return result;
};

projectIntegrity.rebuildPisiDerivedIntegrityState = function hardenedDerivedRebuild(projectFolder) {
    const result = originalRebuild(projectFolder);
    if (result?.report) result.report = hardenPisiIntegrityReport(result.report);
    return result;
};

const moduleApi = {
    hardenPisiIntegrityReport
};

registerMainModule('main.projectIntegrityHardening', moduleApi);