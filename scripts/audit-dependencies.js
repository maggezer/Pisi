'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const AUDIT_LEVEL = 'moderate';
const SEVERITY_ORDER = new Map([
    ['info', 0],
    ['low', 1],
    ['moderate', 2],
    ['high', 3],
    ['critical', 4]
]);

function isAtOrAboveAuditLevel(severity, auditLevel = AUDIT_LEVEL) {
    return (SEVERITY_ORDER.get(String(severity || '').toLowerCase()) ?? -1) >= (SEVERITY_ORDER.get(auditLevel) ?? 2);
}

function parseAuditJson(stdout) {
    const source = String(stdout || '').trim();
    if (!source) throw new Error('npm audit returned no JSON output.');
    try {
        return JSON.parse(source);
    } catch (error) {
        throw new Error('npm audit returned invalid JSON: ' + error.message);
    }
}

function runNpmAudit(extraArgs = []) {
    const npmExecPath = process.env.npm_execpath;
    const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = npmExecPath
        ? [npmExecPath, 'audit', '--json', '--audit-level=' + AUDIT_LEVEL, ...extraArgs]
        : ['audit', '--json', '--audit-level=' + AUDIT_LEVEL, ...extraArgs];

    const result = spawnSync(command, args, {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024
    });

    if (result.error) throw result.error;

    return {
        status: result.status === null ? 1 : result.status,
        report: parseAuditJson(result.stdout),
        stderr: String(result.stderr || '').trim()
    };
}

function getActionableVulnerabilities(report) {
    return Object.entries(report?.vulnerabilities || {}).filter(([, vulnerability]) => isAtOrAboveAuditLevel(vulnerability?.severity));
}

function assertAuditReportUsable(report) {
    if (!report || typeof report !== 'object') throw new Error('npm audit report is missing.');
    if (report.error) {
        const message = typeof report.error === 'string' ? report.error : report.error.summary || report.error.message || JSON.stringify(report.error);
        throw new Error('npm audit failed to produce a vulnerability report: ' + message);
    }
    if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
        throw new Error('npm audit report has no vulnerabilities object.');
    }
}

function validateRuntimeAudit(report, status = 0) {
    assertAuditReportUsable(report);
    const actionable = getActionableVulnerabilities(report);
    if (status !== 0 || actionable.length > 0) {
        const names = actionable.map(([name]) => name);
        throw new Error('Runtime dependency audit is not clean at ' + AUDIT_LEVEL + '+: ' + (names.join(', ') || 'npm audit exit ' + status));
    }
    return true;
}

function validateFullAudit(report, status = 0) {
    assertAuditReportUsable(report);
    const actionable = getActionableVulnerabilities(report);
    if (status !== 0 || actionable.length > 0) {
        const names = actionable.map(([name]) => name);
        throw new Error('Full dependency audit is not clean at ' + AUDIT_LEVEL + '+: ' + (names.join(', ') || 'npm audit exit ' + status));
    }
    return true;
}

function main() {
    const runtime = runNpmAudit(['--omit=dev']);
    validateRuntimeAudit(runtime.report, runtime.status);
    console.log('Runtime dependency audit is clean at ' + AUDIT_LEVEL + '+.');

    const full = runNpmAudit();
    validateFullAudit(full.report, full.status);
    console.log('Full dependency audit is clean at ' + AUDIT_LEVEL + '+.');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error('[PISI audit] ' + error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    AUDIT_LEVEL,
    getActionableVulnerabilities,
    isAtOrAboveAuditLevel,
    parseAuditJson,
    validateFullAudit,
    validateRuntimeAudit
};
