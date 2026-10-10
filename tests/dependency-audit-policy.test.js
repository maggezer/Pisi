'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const {
    KNOWN_DEV_AUDIT_EXCEPTION,
    validateKnownDevAuditException,
    validateRuntimeAudit
} = require('../scripts/audit-dependencies.js');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function makeKnownExceptionReport() {
    const vulnerabilities = {};
    const viaByPackage = {
        'sprintf-js': [
            {
                url: KNOWN_DEV_AUDIT_EXCEPTION.advisoryUrl,
                severity: 'moderate',
                title: 'sprintf-js vulnerable to denial of service through unbounded precision specifiers'
            }
        ],
        roarr: ['sprintf-js'],
        'global-agent': ['roarr'],
        '@electron/get': ['global-agent'],
        'app-builder-lib': ['@electron/get', 'dmg-builder', 'electron-builder-squirrel-windows'],
        'dmg-builder': ['app-builder-lib'],
        'electron-builder-squirrel-windows': ['app-builder-lib'],
        'electron-builder': ['app-builder-lib', 'dmg-builder']
    };

    for (const [name, expected] of Object.entries(KNOWN_DEV_AUDIT_EXCEPTION.packages)) {
        vulnerabilities[name] = {
            name,
            severity: 'moderate',
            isDirect: name === 'electron-builder',
            via: viaByPackage[name],
            effects: [],
            range: '*',
            nodes: [expected.node],
            fixAvailable: true
        };
    }

    return {
        auditReportVersion: 2,
        vulnerabilities,
        metadata: {
            vulnerabilities: {
                info: 0,
                low: 0,
                moderate: 8,
                high: 0,
                critical: 0,
                total: 8
            }
        }
    };
}

test('dependency audit script requires runtime-clean plus a fail-closed dev exception', () => {
    const packageJson = readJson('package.json');
    assert.equal(packageJson.scripts.audit, 'node scripts/audit-dependencies.js');

    assert.doesNotThrow(() =>
        validateRuntimeAudit(
            {
                vulnerabilities: {},
                metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }
            },
            0
        )
    );

    assert.throws(
        () =>
            validateRuntimeAudit(
                {
                    vulnerabilities: {
                        runtime: {
                            severity: 'moderate',
                            nodes: ['node_modules/runtime']
                        }
                    }
                },
                1
            ),
        /Runtime dependency audit is not clean/
    );
});

test('known sprintf-js advisory is accepted only on the pinned dev-only electron-builder chain', () => {
    const report = makeKnownExceptionReport();
    const packageLock = readJson('package-lock.json');

    assert.doesNotThrow(() => validateKnownDevAuditException(report, packageLock));

    const unexpected = structuredClone(report);
    unexpected.vulnerabilities['sprintf-js'].via[0].url = 'https://github.com/advisories/GHSA-unexpected';
    assert.throws(() => validateKnownDevAuditException(unexpected, packageLock), /unapproved advisory/);

    const runtimeLeak = structuredClone(packageLock);
    runtimeLeak.packages['node_modules/sprintf-js'].dev = false;
    assert.throws(() => validateKnownDevAuditException(report, runtimeLeak), /no longer confined to devDependencies/);

    const versionDrift = structuredClone(packageLock);
    versionDrift.packages['node_modules/roarr'].version = '2.15.5';
    assert.throws(() => validateKnownDevAuditException(report, versionDrift), /version drifted/);
});

test('audit policy pins the exact unpatched advisory instead of suppressing npm audit globally', () => {
    const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const release = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    const script = fs.readFileSync(path.join(root, 'scripts/audit-dependencies.js'), 'utf8');

    assert.match(script, /GHSA-hp3w-g68c-fv3c/);
    assert.match(script, /--omit=dev/);
    assert.match(ci, /npm run audit/);
    assert.match(release, /npm run audit/);
    assert.doesNotMatch(ci, /npm run audit\s*\|\|\s*true/);
    assert.doesNotMatch(release, /npm run audit\s*\|\|\s*true/);
});
