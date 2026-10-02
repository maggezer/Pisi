import * as path from 'node:path';
import * as crypto from 'node:crypto';

const PISI_INTEGRITY_VERSION = 2;
const PISI_INTEGRITY_SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);
const PISI_INTEGRITY_REPAIR_SAFETY = new Set(['safe', 'review', 'manual']);
const PISI_INTEGRITY_NODE_ID = /^node_[A-Za-z0-9_-]+$/;
const PISI_INTEGRITY_MAP_ID = /^map_[A-Za-z0-9_-]+$/;
const PISI_INTEGRITY_TASK_ID = /^task_[A-Za-z0-9._:-]{4,180}$/;
const PISI_INTEGRITY_RELATIONSHIP_ID = /^edge_[A-Za-z0-9_-]{1,101}$/;

function normalizePisiIntegrityPath(value = '') {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}

function normalizePisiIntegrityComparePath(value = '') {
    const normalized = normalizePisiIntegrityPath(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPisiIntegrityPathInsideProject(projectFolder, targetPath) {
    const root = path.resolve(String(projectFolder || ''));
    const target = path.resolve(String(targetPath || ''));
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function makePisiIntegrityIssueId(parts = []) {
    const key = (Array.isArray(parts) ? parts : [parts]).map((value) => String(value ?? '')).join('\u001f');
    return `integrity_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

function normalizePisiIntegrityRepair(raw = null) {
    if (!raw || typeof raw !== 'object') return null;
    const safety = PISI_INTEGRITY_REPAIR_SAFETY.has(String(raw.safety || '')) ? String(raw.safety) : 'manual';
    const action = String(raw.action || '').trim();
    const description = String(raw.description || '').trim();
    if (!action || !description) return null;
    return {
        id: String(raw.id || makePisiIntegrityIssueId(['repair', action, description])),
        safety,
        action,
        description,
        payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {}
    };
}

function makePisiIntegrityIssue(raw = {}) {
    const severity = PISI_INTEGRITY_SEVERITIES.has(String(raw.severity || '')) ? String(raw.severity) : 'warning';
    const code = String(raw.code || 'unknown').trim() || 'unknown';
    const issuePath = normalizePisiIntegrityPath(raw.path || '');
    const entityId = String(raw.entityId || '');
    const message = String(raw.message || '').trim() || code;
    const repair = normalizePisiIntegrityRepair(raw.repair);
    return {
        id: String(raw.id || makePisiIntegrityIssueId([code, issuePath, entityId, message])),
        severity,
        code,
        domain: String(raw.domain || 'project'),
        path: issuePath,
        entityId: entityId || null,
        message,
        details: raw.details && typeof raw.details === 'object' ? raw.details : {},
        repair
    };
}

function severityRank(value) {
    return (
        {
            critical: 4,
            error: 3,
            warning: 2,
            info: 1
        }[value] || 0
    );
}

function sortPisiIntegrityIssues(issues = []) {
    return [...issues].sort((a, b) => {
        const severity = severityRank(b.severity) - severityRank(a.severity);
        if (severity) return severity;
        const domain = String(a.domain).localeCompare(String(b.domain));
        if (domain) return domain;
        const issuePath = String(a.path).localeCompare(String(b.path));
        if (issuePath) return issuePath;
        return String(a.code).localeCompare(String(b.code));
    });
}

function summarizePisiIntegrityIssues(issues = [], counts = {}) {
    const summary = {
        files: Number(counts.files || 0),
        nodes: Number(counts.nodes || 0),
        maps: Number(counts.maps || 0),
        tasks: Number(counts.tasks || 0),
        relationships: Number(counts.relationships || 0),
        trashItems: Number(counts.trashItems || 0),
        mutationJournals: Number(counts.mutationJournals || 0),
        issues: issues.length,
        critical: 0,
        errors: 0,
        warnings: 0,
        info: 0,
        safeRepairs: 0,
        reviewRepairs: 0,
        manualRepairs: 0
    };
    for (const issue of issues) {
        if (issue.severity === 'critical') summary.critical += 1;
        else if (issue.severity === 'error') summary.errors += 1;
        else if (issue.severity === 'warning') summary.warnings += 1;
        else summary.info += 1;
        if (issue.repair?.safety === 'safe') summary.safeRepairs += 1;
        if (issue.repair?.safety === 'review') summary.reviewRepairs += 1;
        if (issue.repair?.safety === 'manual') summary.manualRepairs += 1;
    }
    return summary;
}

function makePisiIntegrityReport(issues = [], counts = {}, extra = {}) {
    const sorted = sortPisiIntegrityIssues(issues.map(makePisiIntegrityIssue));
    const summary = summarizePisiIntegrityIssues(sorted, counts);
    return {
        ok: true,
        version: PISI_INTEGRITY_VERSION,
        auditedAt: new Date().toISOString(),
        healthy: summary.critical === 0 && summary.errors === 0,
        clean: summary.issues === 0,
        summary,
        issues: sorted,
        ...extra
    };
}

/**
 * @param {any[]} [items]
 * @param {(item: any, index: number) => any} [getValue]
 */
function collectDuplicateValues(items = [], getValue = (item, _index) => item) {
    const seen = new Map();
    const duplicates = [];
    items.forEach((item, index) => {
        const value = getValue(item, index);
        if (!value) return;
        if (seen.has(value)) {
            duplicates.push({
                value,
                firstIndex: seen.get(value),
                index,
                item
            });
        } else {
            seen.set(value, index);
        }
    });
    return duplicates;
}

function validPisiIntegrityId(kind, value) {
    const raw = String(value || '');
    if (kind === 'node') return PISI_INTEGRITY_NODE_ID.test(raw);
    if (kind === 'map') return PISI_INTEGRITY_MAP_ID.test(raw);
    if (kind === 'task') return PISI_INTEGRITY_TASK_ID.test(raw);
    if (kind === 'relationship') return PISI_INTEGRITY_RELATIONSHIP_ID.test(raw);
    return false;
}

export {
    PISI_INTEGRITY_VERSION,
    PISI_INTEGRITY_SEVERITIES,
    PISI_INTEGRITY_REPAIR_SAFETY,
    normalizePisiIntegrityPath,
    normalizePisiIntegrityComparePath,
    isPisiIntegrityPathInsideProject,
    makePisiIntegrityIssueId,
    normalizePisiIntegrityRepair,
    makePisiIntegrityIssue,
    sortPisiIntegrityIssues,
    summarizePisiIntegrityIssues,
    makePisiIntegrityReport,
    collectDuplicateValues,
    validPisiIntegrityId
};
