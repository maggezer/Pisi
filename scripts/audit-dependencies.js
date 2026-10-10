'use strict';

const fs = require('fs');
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

const KNOWN_DEV_AUDIT_EXCEPTION = Object.freeze({
    advisoryId: 'GHSA-hp3w-g68c-fv3c',
    advisoryUrl: 'https://github.com/advisories/GHSA-hp3w-g68c-fv3c',
    severity: 'moderate',
    expectedModerateFindings: 8,
    packages: Object.freeze({
        'sprintf-js': Object.freeze({ node: 'node_modules/sprintf-js', version: '1.1.3' }),
        roarr: Object.freeze({ node: 'node_modules/roarr', version: '2.15.4' }),
        'global-agent': Object.freeze({ node: 'node_modules/global-agent', version: '3.0.0' }),
        '@electron/get': Object.freeze({ node: 'node_modules/app-builder-lib/node_modules/@electron/get', version: '3.1.0' }),
        'app-builder-lib': Object.freeze({ node: 'node_modules/app-builder-lib', version: '26.15.7' }),
        'dmg-builder': Object.freeze({ node: 'node_modules/dmg-builder', version: '26.15.7' }),
        'electron-builder-squirrel-windows': Object.freeze({ node: 'node_modules/electron-builder-squirrel-windows', version: '26.15.7' }),
        'electron-builder': Object.freeze({ node: 'node_modules/electron-builder', version: '26.15.7' })
    })
});

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

function readPackageLock() {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
}

function validateKnownDevAuditException(report, packageLock = readPackageLock()) {
    assertAuditReportUsable(report);

    const actionable = getActionableVulnerabilities(report);
    const expectedNames = Object.keys(KNOWN_DEV_AUDIT_EXCEPTION.packages).sort();
    const actualNames = actionable.map(([name]) => name).sort();

    if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
        throw new Error('Full audit contains vulnerability packages outside the approved dev-tooling exception: ' + actualNames.join(', '));
    }

    const metadata = report.metadata?.vulnerabilities || {};
    if (
        Number(metadata.moderate || 0) !== KNOWN_DEV_AUDIT_EXCEPTION.expectedModerateFindings ||
        Number(metadata.high || 0) !== 0 ||
        Number(metadata.critical || 0) !== 0
    ) {
        throw new Error(
            'Full audit severity totals drifted from the approved exception: moderate=' +
                Number(metadata.moderate || 0) +
                ', high=' +
                Number(metadata.high || 0) +
                ', critical=' +
                Number(metadata.critical || 0)
        );
    }

    const advisoryUrls = new Set();

    for (const [name, vulnerability] of actionable) {
        if (String(vulnerability.severity || '').toLowerCase() !== KNOWN_DEV_AUDIT_EXCEPTION.severity) {
            throw new Error(name + ' severity is no longer the approved moderate level.');
        }

        const expected = KNOWN_DEV_AUDIT_EXCEPTION.packages[name];
        const actualNodes = Array.isArray(vulnerability.nodes) ? [...vulnerability.nodes].sort() : [];
        if (actualNodes.length !== 1 || actualNodes[0] !== expected.node) {
            throw new Error(name + ' vulnerable node drifted: ' + actualNodes.join(', '));
        }

        const lockEntry = packageLock.packages?.[expected.node];
        if (!lockEntry) throw new Error(name + ' approved vulnerable node is missing from package-lock.json.');
        if (lockEntry.version !== expected.version) {
            throw new Error(name + ' version drifted from ' + expected.version + ' to ' + lockEntry.version + '.');
        }
        if (lockEntry.dev !== true) {
            throw new Error(name + ' is no longer confined to devDependencies.');
        }

        for (const via of vulnerability.via || []) {
            if (typeof via === 'string') {
                if (!KNOWN_DEV_AUDIT_EXCEPTION.packages[via]) {
                    throw new Error(name + ' is affected through an unapproved package: ' + via);
                }
                continue;
            }

            if (!via || typeof via !== 'object') {
                throw new Error(name + ' has an unsupported npm audit via entry.');
            }

            const url = String(via.url || '');
            advisoryUrls.add(url);
            if (url !== KNOWN_DEV_AUDIT_EXCEPTION.advisoryUrl) {
                throw new Error(name + ' includes an unapproved advisory: ' + (url || via.title || 'unknown'));
            }
            if (String(via.severity || '').toLowerCase() !== KNOWN_DEV_AUDIT_EXCEPTION.severity) {
                throw new Error(name + ' advisory severity drifted from moderate.');
            }
        }
    }

    if (advisoryUrls.size !== 1 || !advisoryUrls.has(KNOWN_DEV_AUDIT_EXCEPTION.advisoryUrl)) {
        throw new Error('Approved full-audit exception advisory is missing or ambiguous.');
    }

    return true;
}

function main() {
    const runtime = runNpmAudit(['--omit=dev']);
    validateRuntimeAudit(runtime.report, runtime.status);
    console.log('Runtime dependency audit is clean at ' + AUDIT_LEVEL + '+.');

    const full = runNpmAudit();
    if (full.status === 0 && getActionableVulnerabilities(full.report).length === 0) {
        console.log('Full dependency audit is clean at ' + AUDIT_LEVEL + '+.');
        return;
    }

    validateKnownDevAuditException(full.report);
    console.warn(
        'Accepted temporary dev-tooling audit exception ' +
            KNOWN_DEV_AUDIT_EXCEPTION.advisoryId +
            ': 8 moderate findings remain confined to the pinned electron-builder 26.15.7 toolchain; any advisory, severity, node or version drift fails this gate.'
    );
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
    KNOWN_DEV_AUDIT_EXCEPTION,
    getActionableVulnerabilities,
    isAtOrAboveAuditLevel,
    parseAuditJson,
    validateKnownDevAuditException,
    validateRuntimeAudit
};
