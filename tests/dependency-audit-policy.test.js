'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { validateFullAudit, validateRuntimeAudit } = require('../scripts/audit-dependencies.js');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

const cleanReport = {
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }
};

function makeReport(severity) {
    return {
        vulnerabilities: {
            minimatch: {
                severity,
                nodes: ['node_modules/minimatch']
            }
        }
    };
}

test('dependency audit script requires a clean runtime audit', () => {
    const packageJson = readJson('package.json');
    assert.equal(packageJson.scripts.audit, 'node scripts/audit-dependencies.js');

    assert.doesNotThrow(() => validateRuntimeAudit(cleanReport, 0));
    assert.throws(() => validateRuntimeAudit(makeReport('moderate'), 1), /Runtime dependency audit is not clean/);
    assert.throws(() => validateRuntimeAudit(cleanReport, 1), /npm audit exit 1/);
});

test('full dependency audit fails closed on any moderate+ finding without exceptions', () => {
    assert.doesNotThrow(() => validateFullAudit(cleanReport, 0));
    assert.doesNotThrow(() => validateFullAudit(makeReport('low'), 0));
    for (const severity of ['moderate', 'high', 'critical']) {
        assert.throws(() => validateFullAudit(makeReport(severity), 1), /Full dependency audit is not clean at moderate\+: minimatch/);
    }
    assert.throws(() => validateFullAudit({ error: { summary: 'offline' } }, 1), /failed to produce a vulnerability report/);
});

test('audit policy runs in CI and release without suppressing npm audit', () => {
    const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const release = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    const script = fs.readFileSync(path.join(root, 'scripts/audit-dependencies.js'), 'utf8');

    assert.match(script, /--omit=dev/);
    assert.doesNotMatch(script, /KNOWN_DEV_AUDIT_EXCEPTION/);
    assert.match(ci, /npm run audit/);
    assert.match(release, /npm run audit/);
    assert.doesNotMatch(ci, /npm run audit\s*\|\|\s*true/);
    assert.doesNotMatch(release, /npm run audit\s*\|\|\s*true/);
});

test('vulnerable minimatch 7.x-11.0.0 is overridden to a patched release', () => {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    assert.equal(packageJson.overrides?.['minimatch@>=7.0.0 <11.0.1'], '^11.0.4');

    for (const [node, entry] of Object.entries(packageLock.packages)) {
        if (!/(^|\/)node_modules\/minimatch$/.test(node)) continue;
        const [major, minor, patch] = entry.version.split('.').map(Number);
        const vulnerable = major >= 7 && (major < 11 || (major === 11 && minor === 0 && patch < 1));
        assert.equal(vulnerable, false, node + '@' + entry.version);
    }
});
