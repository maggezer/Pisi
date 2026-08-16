'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('main/functions/project-integrity.js');
const hardening = read('main/functions/project-integrity-hardening.js');
const domain = read('main/functions/project-integrity-domain.js');
const main = read('main.js');
const preload = read('preload.js');
const renderer = read('renderer/portability/pisi-project-integrity.mjs');
const bootstrap = read('renderer/bootstrap.mjs');
const style = read('style.css');
const css = read('styles/62-project-integrity.css');

test('Project Integrity audits every canonical and recovery authority', () => {
    assert.match(service, /taskStore\.getPisiTaskStorePath/);
    assert.match(service, /relationshipStore\.getPisiRelationshipStorePath/);
    assert.match(service, /auditPisiMaps/);
    assert.match(service, /auditTrashIntegrity/);
    assert.match(service, /auditAtomicMutationIntegrity/);
    assert.match(service, /extractLocalAttachmentCandidates/);
    assert.match(service, /auditPisiNodeProperties/);
});

test('Project Integrity detects identity reference task and hierarchy corruption classes', () => {
    for (const code of [
        'node-duplicate-id',
        'map-duplicate-id',
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
        assert.match(service, new RegExp(code));
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
        const index = service.indexOf(`action: '${action}'`);
        assert.ok(index >= 0, `missing ${action}`);
        const surrounding = service.slice(Math.max(0, index - 180), index + 220);
        assert.doesNotMatch(surrounding, /safety:\s*'safe'/);
    }
});

test('safe repairs are bounded and Project Integrity explains them before mutation', () => {
    for (const action of [
        'normalize-document-metadata',
        'ensure-document-sidecar',
        'normalize-map-operational-state',
        'run-atomic-recovery'
    ]) {
        assert.match(service, new RegExp(action));
    }
    assert.match(renderer, /confirmSafeRepairs/);
    assert.match(renderer, /confirmRepairs/);
    assert.match(renderer, /safe\.slice\(0, 12\)/);
    assert.match(renderer, /pisiConfirm/);
});

test('graph-wide connection cache repair is routed to derived rebuild instead of one-node fix', () => {
    assert.match(hardening, /node-derived-connections-stale/);
    assert.match(hardening, /issue\.repair\.safety = 'review'/);
    assert.match(hardening, /Türetilmiş durumu yeniden oluştur/);
    assert.match(service, /rebuildPisiDerivedIntegrityState/);
    assert.match(service, /Array\.from\(inventory\.nodeById\.keys\(\)\)/);
});

test('derived rebuild explicitly preserves task and relationship authorities', () => {
    assert.match(service, /authorityChanged:\s*false/);
    assert.match(service, /preservedAuthorities:\s*\['\.pisi\/tasks\.json', '\.pisi\/relationships\.json'\]/);
    const rebuildStart = service.indexOf('function rebuildPisiDerivedIntegrityState');
    const rebuildBlock = service.slice(rebuildStart);
    assert.doesNotMatch(rebuildBlock, /writePisiTaskStore/);
    assert.doesNotMatch(rebuildBlock, /writePisiRelationshipStore/);
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
    assert.match(renderer, /runIntegrityTransport\('repair'/);
    assert.match(renderer, /runIntegrityTransport\('rebuild-derived'/);
});

test('Project Integrity domain hooks load after base domain and before atomic hardening', () => {
    const serviceIndex = main.indexOf('./main/functions/project-integrity');
    const hardeningIndex = main.indexOf('./main/functions/project-integrity-hardening');
    const domainIndex = main.indexOf('./main/functions/domain-command-query');
    const integrityDomainIndex = main.indexOf('./main/functions/project-integrity-domain');
    const atomicHardeningIndex = main.indexOf('./main/functions/atomic-domain-hardening');
    assert.ok(hardeningIndex > serviceIndex);
    assert.ok(integrityDomainIndex > domainIndex);
    assert.ok(atomicHardeningIndex > integrityDomainIndex);
});

test('Settings replaces the legacy basic integrity section with expanded report and repair plan', () => {
    assert.match(renderer, /pisi:render-settings-sections/);
    assert.match(renderer, /querySelectorAll\('\.pisi-integrity-settings'\)/);
    assert.match(renderer, /pisi-integrity-expanded/);
    assert.match(renderer, /makeRepairPlan/);
    assert.match(renderer, /report\.authorities/);
    assert.match(renderer, /repairPlan\?\.safe/);
});

test('Project Integrity UI and styles are loaded after portability base panel', () => {
    const baseIndex = bootstrap.indexOf('./portability/pisi-portability-panel.mjs');
    const integrityIndex = bootstrap.indexOf('./portability/pisi-project-integrity.mjs');
    assert.ok(baseIndex >= 0 && integrityIndex > baseIndex);
    assert.match(style, /styles\/62-project-integrity\.css/);
    assert.match(css, /\.pisi-integrity-metrics/);
    assert.match(css, /\.pisi-integrity-issue-row/);
    assert.match(css, /html\[data-theme="light"\]/);
});