'use strict';

const fs = require('fs');
const path = require('path');
const integrityCore = require('./project-integrity-core');

const PISI_INTEGRITY_SKIP_DIRS = new Set(['.git', 'node_modules', '.pisi', '.pisi-history']);
const PISI_LOCAL_ATTACHMENT_EXT = /\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|csv|txt|zip|json)$/i;

function relativePath(projectFolder, targetPath) {
    return integrityCore.normalizePisiIntegrityPath(path.relative(path.resolve(projectFolder), path.resolve(targetPath)));
}

function absolutePath(projectFolder, storedPath) {
    const target = path.resolve(projectFolder, ...integrityCore.normalizePisiIntegrityPath(storedPath).split('/').filter(Boolean));
    if (!integrityCore.isPisiIntegrityPathInsideProject(projectFolder, target)) {
        throw new Error('Integrity yolu proje dışına çıkamaz.');
    }
    return target;
}

function readJson(filePath) {
    if (!fs.existsSync(filePath)) {
        return { ok: false, missing: true, error: 'Dosya bulunamadı.' };
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return { ok: true, raw, data: JSON.parse(raw) };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function walkProjectDocuments(projectFolder) {
    const files = [];
    const queue = [path.resolve(projectFolder)];
    while (queue.length) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink?.()) continue;
            if (entry.isDirectory() && PISI_INTEGRITY_SKIP_DIRS.has(entry.name)) continue;
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
            } else if (entry.isFile() && /\.(?:node|map)$/i.test(entry.name)) {
                files.push(fullPath);
                if (files.length >= 50000) return files;
            }
        }
    }
    return files;
}

function pushIssue(context, raw) {
    const issue = integrityCore.makePisiIntegrityIssue(raw);
    context.issues.push(issue);
    return issue;
}

function setRepair(issue, safety, action, description, payload = {}) {
    issue.repair = integrityCore.normalizePisiIntegrityRepair({
        id: integrityCore.makePisiIntegrityIssueId(['repair', issue.code, issue.path, issue.entityId || '', action]),
        safety,
        action,
        description,
        payload
    });
    return issue;
}

function issue(context, raw, repair = null) {
    const result = pushIssue(context, raw);
    if (repair) {
        setRepair(result, repair.safety, repair.action, repair.description, repair.payload || {});
    }
    return result;
}

function extractLocalAttachmentCandidates(content = '') {
    const result = [];
    const regexp = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let match = null;
    while ((match = regexp.exec(String(content || '')))) {
        const value = String(match[1] || '').trim();
        if (!value || /^(?:https?:|data:|blob:|mailto:|#)/i.test(value)) continue;
        if (!PISI_LOCAL_ATTACHMENT_EXT.test(value)) continue;
        result.push(value.replace(/^file:\/\//i, ''));
    }
    return Array.from(new Set(result)).slice(0, 500);
}

function makeRepairPlan(issues = []) {
    const plan = { safe: [], review: [], manual: [] };
    for (const item of issues) {
        if (!item.repair) continue;
        plan[item.repair.safety].push({
            issueId: item.id,
            code: item.code,
            path: item.path,
            entityId: item.entityId,
            ...item.repair
        });
    }
    return plan;
}

module.exports = {
    integrityCore,
    relativePath,
    absolutePath,
    readJson,
    walkProjectDocuments,
    pushIssue,
    setRepair,
    issue,
    extractLocalAttachmentCandidates,
    makeRepairPlan
};
