import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { readPisiJsonFiles, scanPisiWikiRenameCandidates, walkPisiProjectFiles } from '../main/functions/project-read-core.js';
import { listPisiWikiNodeFiles } from '../main/functions/wiki-link-store.js';
import { generatePisiProjectFixture } from '../scripts/generate-project-fixture.mjs';

// The synchronous walkers the async reads replace, loaded with a stubbed electron.
const originalLoad = Module._load;
Module._load = function pisiReadTestElectronStub(request, parent, isMain) {
    if (request === 'electron')
        return { app: { isPackaged: true, getPath: () => os.tmpdir() }, BrowserWindow: class {}, dialog: {}, ipcMain: { on() {}, handle() {} } };
    return originalLoad.call(this, request, parent, isMain);
};
const integrityShared = await import('../main/functions/project-integrity-shared.js');
Module._load = originalLoad;

function makeProject(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-read-core-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (relative, value) => {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
    };
    write('A.node', { pisi: { id: 'node_a', title: 'A' }, content: '<p>[[B]]</p>' });
    write('nd_Harita__map_1/B.node', { pisi: { id: 'node_b', title: 'B' }, content: '<p>düz metin</p>' });
    write('nd_Harita__map_1/C.node', { pisi: { id: 'node_c', title: 'C' }, content: '<a class="pisi-wiki-link" data-pisi-node-id="node_b">B</a>' });
    write('Harita.map', { pisi: { id: 'map_1', title: 'Harita' }, map: {} });
    write('Kullanıcı/trash/Normal.node', { pisi: { id: 'node_n', title: 'Normal' }, content: '' });
    write('.pisi/trash/items/x/Old.node', { pisi: { id: 'node_old', title: 'Old' }, content: '' });
    write('.pisi-history/n/Hist.node', { pisi: { id: 'node_h', title: 'H' }, content: '' });
    write('.pisi-delete-1/Gone.node', { pisi: { id: 'node_g', title: 'G' }, content: '' });
    write('.git/X.node', '{}');
    write('Bozuk.node', '{ bozuk');
    return root;
}

function walkPisiFilesSync(root) {
    // Mirror of portability.walkPisiFiles (the export walker).
    const files = [];
    const skip = new Set(['.pisi', '.pisi-history', '.git', 'node_modules']);
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink?.()) continue;
            const name = entry.name.toLowerCase();
            if (entry.isDirectory() && (skip.has(name) || name.startsWith('.pisi-delete-') || name.startsWith('.pisi-transaction-'))) continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(fullPath);
            else if (/\.(?:node|map)$/i.test(entry.name)) files.push(fullPath);
        }
    };
    visit(root);
    return files;
}

test('the async walk returns the same files, in the same order, as each synchronous walker', async (t) => {
    const root = makeProject(t);
    const integrity = await walkPisiProjectFiles(root, { order: 'bfs', skipDirs: [...integrityShared.PISI_INTEGRITY_SKIP_DIRS], limit: 50000 });
    assert.deepEqual(integrity, integrityShared.walkProjectDocuments(root), 'Project Integrity walker');
    const exported = await walkPisiProjectFiles(root, {
        order: 'dfs',
        skipDirs: ['.pisi', '.pisi-history', '.git', 'node_modules'],
        skipDirPrefixes: ['.pisi-delete-', '.pisi-transaction-'],
        caseInsensitive: true
    });
    assert.deepEqual(exported, walkPisiFilesSync(root), 'export walker');
    assert.ok(
        exported.some((file) => file.endsWith(path.join('Kullanıcı', 'trash', 'Normal.node'))),
        'a user folder named trash is still exported'
    );
    const wiki = await walkPisiProjectFiles(root, { order: 'dfs', skipHidden: true, pattern: '\\.node$' });
    assert.deepEqual([...wiki].sort(), listPisiWikiNodeFiles(root), 'link walker');
});

test('JSON reads keep order and report missing and broken files like the synchronous reader', async (t) => {
    const root = makeProject(t);
    const paths = [path.join(root, 'A.node'), path.join(root, 'Yok.node'), path.join(root, 'Bozuk.node')];
    const [ok, missing, broken] = await readPisiJsonFiles(paths, { raw: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.pisi.id, 'node_a');
    assert.equal(typeof ok.raw, 'string');
    assert.deepEqual({ ok: missing.ok, missing: missing.missing }, { ok: false, missing: true });
    assert.equal(broken.ok, false);
    assert.match(broken.error, /JSON/);
    const sync = integrityShared.readJson(paths[2]);
    assert.equal(sync.ok, false);
});

test('rename candidates are every note that can hold a link, plus every title', async (t) => {
    const root = makeProject(t);
    const scan = await scanPisiWikiRenameCandidates(root, { nodeId: 'node_b' });
    const names = scan.candidates.map((file) => path.basename(file)).sort();
    // B holds its own id; a superset is fine because each candidate is re-read and checked.
    assert.deepEqual(names, ['A.node', 'B.node', 'C.node'], 'the id link, the legacy [[…]] text and the note itself');
    const other = await scanPisiWikiRenameCandidates(root, { nodeId: 'node_zzz' });
    assert.deepEqual(
        other.candidates.map((file) => path.basename(file)),
        ['A.node'],
        'plain notes without the id are skipped'
    );
    assert.deepEqual(scan.titles.map((entry) => entry.title).sort(), ['A', 'B', 'C', 'Normal']);
});

test('on a generated project the async walk matches the integrity walker', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-read-fixture-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    await generatePisiProjectFixture(root, { notes: 300, perMap: 100 });
    const files = await walkPisiProjectFiles(root, { order: 'bfs', skipDirs: [...integrityShared.PISI_INTEGRITY_SKIP_DIRS], limit: 50000 });
    assert.equal(files.length, 303);
    assert.deepEqual(files, integrityShared.walkProjectDocuments(root));
});
