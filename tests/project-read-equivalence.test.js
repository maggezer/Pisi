'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// Project Integrity and link renames give the same results whether the project
// is read synchronously (old path) or first by the project read worker (new path).
const originalLoad = Module._load;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-equivalence-user-'));
Module._load = function pisiEquivalenceElectronStub(request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: {
                isPackaged: true,
                getPath: () => userData,
                getAppPath: () => path.resolve(__dirname, '..'),
                setPath() {},
                on() {},
                whenReady: () => new Promise(() => {})
            },
            BrowserWindow: class {},
            Menu: {},
            dialog: {},
            shell: {},
            net: {},
            screen: {},
            nativeImage: {},
            ipcMain: { on() {}, handle() {} }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
// The main.mjs load order up to Project Integrity.
for (const name of [
    'path-security',
    'i18n',
    'filesystem-core',
    'storage',
    'atomic-mutation',
    'atomic-recovery-hardening',
    'document-store',
    'map-store',
    'project-operations',
    'relationship-store',
    'map-semantic-core',
    'map-operational-store',
    'task-capture',
    'task-store',
    'trash-store',
    'task-reference-integrity',
    'source-of-truth',
    'structured-nodes',
    'property-schema-store',
    'property-schema-mutations',
    'sync-project-adapter',
    'project-integrity'
]) {
    require(`../main/functions/${name}`);
}
Module._load = originalLoad;
const { modules } = require('../main/module-registry');
// The fixture script has a top-level await (its CLI), so it is imported, not required.
const loadFixture = () => import('../scripts/generate-project-fixture.mjs');
const wikiStore = require('../main/functions/wiki-link-store.js');

test.after(() => {
    fs.rmSync(userData, { recursive: true, force: true });
    return modules['main.projectRead'].stopPisiReadWorker();
});

function withoutTime(report) {
    return JSON.parse(JSON.stringify(report, (key, value) => (key === 'auditedAt' ? undefined : value)));
}

async function makeProject(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-equivalence-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { generatePisiProjectFixture } = await loadFixture();
    const fixture = await generatePisiProjectFixture(root, { notes: 120, perMap: 40 });
    // Something for the audit to find: a broken note, an orphan sidecar note and a missing attachment.
    fs.writeFileSync(path.join(root, 'Bozuk.node'), '{ bozuk');
    fs.writeFileSync(
        path.join(root, 'Ek.node'),
        JSON.stringify({
            pisi: { version: 1, type: 'node', id: 'node_ek', title: 'Ek', sidecar: 'inv_Ek__node_ek' },
            properties: {},
            content: '<img src="inv_Ek__node_ek/yok.png">'
        })
    );
    return { root, fixture };
}

test('the async Project Integrity report equals the synchronous one', async (t) => {
    const { root } = await makeProject(t);
    const progress = [];
    const sync = modules['main.projectIntegrity'].auditPisiProjectIntegrity(root);
    const async = await modules['main.projectIntegrity'].auditPisiProjectIntegrityAsync(root, { onProgress: (done, total) => progress.push([done, total]) });
    assert.deepEqual(withoutTime(async), withoutTime(sync));
    assert.ok(sync.issues.length > 0, 'the fixture has issues to report');
    assert.ok(modules['main.projectRead'].isPisiReadWorkerActive(), 'the documents were read by the worker');
    const [lastDone, total] = progress.at(-1);
    assert.equal(lastDone, total, 'progress ends at the total');
    assert.ok(total > 100, 'every document is counted');
    assert.ok(progress.length >= 2, 'progress is reported while reading');
});

test('a rename with a prepared candidate list writes exactly what the full scan writes', async (t) => {
    const { root, fixture } = await makeProject(t);
    // Note 1 is linked from note 0 (id link); add a legacy [[…]] mention as well.
    const target = JSON.parse(fs.readFileSync(fixture.notePaths[1], 'utf8'));
    const legacyPath = path.join(root, 'Eski.node');
    fs.writeFileSync(legacyPath, JSON.stringify({ pisi: { id: 'node_legacy', title: 'Eski' }, content: `<p>[[${target.pisi.title}]]</p>` }));
    const rename = { nodeId: target.pisi.id, oldTitle: target.pisi.title, newTitle: 'Yepyeni' };
    const run = (prepared) => {
        const writes = [];
        const result = wikiStore.applyPisiWikiRename(root, rename, { writeDocument: (filePath, data) => writes.push([filePath, data.content]), prepared });
        return { result, writes: writes.sort((a, b) => a[0].localeCompare(b[0])) };
    };
    const full = run(null);
    const scan = await modules['main.projectRead'].runPisiProjectRead('wikiRenameCandidates', { root, options: { nodeId: target.pisi.id } });
    const prepared = run({ titles: scan.titles, candidates: scan.candidates });
    assert.deepEqual(prepared.writes, full.writes);
    assert.deepEqual(prepared.result, full.result);
    assert.equal(full.writes.length, 2, 'the id link and the legacy mention are rewritten');
    assert.ok(scan.candidates.length < fixture.notes / 2, 'only a fraction of the notes is read inside the mutation');
});

test('the async rename impact equals the synchronous impact', async (t) => {
    const { root, fixture } = await makeProject(t);
    const nodePath = fixture.notePaths[11];
    const sync = wikiStore.getPisiWikiRenameImpact(root, nodePath, 'Başka');
    const reader = modules['main.projectRead'];
    const async = await wikiStore.getPisiWikiRenameImpactAsync(root, nodePath, 'Başka', {
        scan: (nodeId) => reader.runPisiProjectRead('wikiRenameCandidates', { root, options: { nodeId } }),
        readCandidates: async (paths) => [...paths].sort().map(wikiStore.readPisiWikiNode).filter(Boolean)
    });
    assert.deepEqual(async, sync);
    assert.equal(sync.notes, 1);
});
