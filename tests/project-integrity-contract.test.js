'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('main/functions/project-integrity.js');
const portability = read('main/functions/portability.js');
const mainManifest = JSON.parse(read('main/module-manifest.json'));
const shared = read('main/functions/project-integrity-shared.js');
const documents = read('main/functions/project-integrity-documents.js');
const authorities = read('main/functions/project-integrity-authorities.js');
const recovery = read('main/functions/project-integrity-recovery.js');
const repairs = read('main/functions/project-integrity-repairs.js');
const domain = read('main/functions/project-integrity-domain.mjs');
const main = read('main.mjs');
const preload = read('preload.js');
const renderer = read('renderer/portability/pisi-project-integrity.mjs');
const bootstrap = read('renderer/bootstrap.mjs');
const style = read('style.css');
const css = read('styles/62-project-integrity.css');
const auditSources = [service, shared, documents, authorities, recovery].join('\n');

test('Project Integrity exclusively owns the public audit binding', () => {
    const owners = mainManifest.filter((entry) => entry.bindings.includes('auditPisiProjectIntegrity')).map((entry) => entry.module);

    assert.deepEqual(owners, ['main.projectIntegrity']);
    assert.match(service, /function auditPisiProjectIntegrity\(/);
    assert.doesNotMatch(portability, /\bauditPisiProjectIntegrity\b/);
});

test('Project Integrity audits every canonical and recovery authority', () => {
    assert.match(authorities, /taskStore\.getPisiTaskStorePath/);
    assert.match(authorities, /relationshipStore\.getPisiRelationshipStorePath/);
    assert.match(documents, /auditMaps/);
    assert.match(recovery, /auditTrash/);
    assert.match(recovery, /auditAtomic/);
    assert.match(shared, /extractLocalAttachmentCandidates/);
    assert.match(documents, /auditNodeProperties/);
});

test('Project Integrity detects identity reference task and hierarchy corruption classes', () => {
    assert.match(documents, /const type = .*'node'.*'map'/);
    assert.match(documents, /code: `\$\{type\}-duplicate-id`/);
    for (const code of [
        'task-duplicate-id',
        'task-source-node-missing',
        'task-dependency-missing',
        'relationship-duplicate-id',
        'relationship-endpoint-missing',
        'relationship-semantic-duplicate',
        'relationship-second-parent',
        'relationship-hierarchy-cycle',
        'map-reference-broken',
        'map-layout-orphan',
        'map-relationship-view-orphan',
        'node-parent-map-mismatch',
        'attachment-target-missing',
        'trash-payload-missing',
        'atomic-rollback-failed'
    ]) {
        assert.match(auditSources, new RegExp(code));
    }
});

test('ambiguous identity and semantic repairs are never classified as safe', () => {
    for (const action of [
        'resolve-duplicate-id',
        'recover-task-id',
        'resolve-duplicate-task-id',
        'repair-task-source',
        'recover-relationship-id',
        'merge-semantic-duplicates',
        'resolve-second-parent',
        'resolve-hierarchy-cycle'
    ]) {
        const index = auditSources.indexOf(`action: '${action}'`);
        assert.ok(index >= 0, `missing ${action}`);
        const surrounding = auditSources.slice(Math.max(0, index - 180), index + 220);
        assert.doesNotMatch(surrounding, /safety:\s*'safe'/);
    }
});

test('safe repairs are bounded and explained before mutation', () => {
    for (const action of ['normalize-document-metadata', 'ensure-document-sidecar', 'normalize-map-operational-state']) {
        assert.match(auditSources + repairs, new RegExp(action));
    }
    assert.doesNotMatch(repairs, /run-atomic-recovery/);
    assert.match(renderer, /confirmSafeRepairs/);
    assert.match(renderer, /confirmRepairs/);
    assert.match(renderer, /safe\s*\.slice\(0,\s*12\)/);
    assert.match(renderer, /pisiConfirm/);
});

test('atomic journal findings do not trigger nested recovery inside integrity repair', () => {
    assert.match(recovery, /atomic-recovery-pending/);
    assert.match(recovery, /safety: 'review'/);
    assert.match(recovery, /startup\/domain recovery gate/);
    assert.doesNotMatch(repairs, /recoverPisiAtomicMutations/);
});

test('graph-wide connection cache repair is review-only and routed to derived rebuild', () => {
    assert.match(documents, /node-derived-connections-stale/);
    assert.match(documents, /safety:\s*'review'[\s\S]*?action:\s*'rebuild-derived-state'/);
    assert.match(repairs, /rebuildDerivedState/);
    assert.match(repairs, /Array\.from\(inventory\.nodeById\.keys\(\)\)/);
});

test('derived rebuild explicitly preserves task and relationship authorities', () => {
    assert.match(repairs, /authorityChanged:\s*false/);
    assert.match(repairs, /preservedAuthorities:\s*\['\.pisi\/tasks\.json', '\.pisi\/relationships\.json'\]/);
    assert.doesNotMatch(repairs, /writePisiTaskStore/);
    assert.doesNotMatch(repairs, /writePisiRelationshipStore/);
});

test('repair and derived rebuild commands join atomic mutation queue', () => {
    assert.match(domain, /registerPisiDomainQuery\('integrity\.audit\.v1'/);
    assert.match(domain, /registerPisiDomainCommand\('integrity\.repair\.v1'/);
    assert.match(domain, /registerPisiDomainCommand\('integrity\.rebuild-derived\.v1'/);
    assert.match(domain, /PISI_ATOMIC_DOMAIN_COMMANDS\.add\('integrity\.repair\.v1'\)/);
    assert.match(domain, /PISI_ATOMIC_DOMAIN_COMMANDS\.add\('integrity\.rebuild-derived\.v1'\)/);
});

test('existing preload audit bridge remains bounded and transports explicit integrity actions', () => {
    assert.match(preload, /auditIntegrity:\s*\(projectFolder\).*project:audit-integrity/);
    assert.doesNotMatch(preload, /repairIntegrity:/);
    assert.doesNotMatch(preload, /rebuildIntegrityDerived:/);
    assert.match(domain, /normalizeIntegrityTransportRequest/);
    assert.match(domain, /\['audit', 'repair', 'rebuild-derived'\]/);
    assert.match(renderer, /runIntegrityTransport\(\s*'repair'/);
    assert.match(renderer, /runIntegrityTransport\(\s*'rebuild-derived'/);
});

test('Project Integrity orchestrator stays thin and composes bounded audit modules', () => {
    assert.match(service, /project-integrity-documents/);
    assert.match(service, /project-integrity-authorities/);
    assert.match(service, /project-integrity-recovery/);
    assert.match(service, /project-integrity-repairs/);
    assert.ok(service.split(/\r?\n/).length < 300);
});

test('Project Integrity domain hooks load after base domain and before atomic hardening', () => {
    const serviceIndex = main.indexOf('./main/functions/project-integrity');
    const domainIndex = main.indexOf('./main/functions/domain-command-query');
    const integrityDomainIndex = main.indexOf('./main/functions/project-integrity-domain');
    const atomicHardeningIndex = main.indexOf('./main/functions/atomic-domain-hardening');
    assert.ok(serviceIndex >= 0);
    assert.ok(integrityDomainIndex > domainIndex);
    assert.ok(atomicHardeningIndex > integrityDomainIndex);
});

test('Settings replaces legacy basic integrity section with expanded report and repair plan', () => {
    assert.match(renderer, /pisi:render-settings-sections/);
    assert.match(renderer, /querySelectorAll\('\.pisi-integrity-settings'\)/);
    assert.match(renderer, /pisi-integrity-expanded/);
    assert.match(renderer, /makeRepairPlan/);
    assert.match(renderer, /report\.authorities/);
    assert.match(renderer, /repairPlan\?\.safe/);
});

test('Project Integrity UI and styles load after portability base panel', () => {
    const baseIndex = bootstrap.indexOf('./portability/pisi-portability-panel.mjs');
    const integrityIndex = bootstrap.indexOf('./portability/pisi-project-integrity.mjs');
    assert.ok(baseIndex >= 0 && integrityIndex > baseIndex);
    assert.match(style, /styles\/62-project-integrity\.css/);
    assert.match(css, /\.pisi-integrity-metrics/);
    assert.match(css, /\.pisi-integrity-issue-row/);
    assert.match(css, /html\[data-theme=["\']light["\']\]/);
});
