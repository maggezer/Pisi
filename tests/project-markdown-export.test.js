'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');
const source = fs.readFileSync(path.join(__dirname, '../main/functions/portability.js'), 'utf8');

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-markdown-export-'));
    const project = path.join(root, 'project');
    const output = path.join(root, 'output');
    fs.mkdirSync(project);
    fs.mkdirSync(output);
    const opened = [];
    const context = {
        fs,
        path,
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [output] }) },
        getPisiDocument: (file) => {
            opened.push(path.relative(project, file).split(path.sep).join('/'));
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            return { ok: true, metadata: data.pisi, data };
        }
    };
    vm.createContext(context);
    const names = [
        'pisiSafeTimestamp',
        'walkPisiFiles',
        'getPisiPortableRelativePath',
        'pisiPropertiesFrontmatter',
        'stripPisiUnsafeExportHtml',
        'stripPisiTaskMetadataHtml',
        'decodePisiHtmlEntities',
        'escapePisiPortableHtml',
        'pisiHtmlToPlainText',
        'pisiHtmlToMarkdown',
        'pisiGetExportSheetRows',
        'pisiExportSheetTableToPlainText',
        'pisiExportSheetTableToMarkdown',
        'pisiTransformSheetTablesForExport',
        'pisiTransformPaintCanvases',
        'pisiTransformImageBlocks',
        'pisiLinkPaintImagesForMarkdown',
        'exportPisiProjectMarkdown'
    ];
    vm.runInContext(names.map((name) => (source.includes('async function ' + name + '(') ? 'async ' : '') + extractFunction(source, name)).join('\n'), context);
    const write = (relative, marker = relative) => {
        const target = path.join(project, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(
            target,
            JSON.stringify({
                pisi: { type: relative.endsWith('.map') ? 'map' : 'node', title: marker },
                content: '<p>' + marker + '</p>',
                map: { title: marker },
                properties: {}
            })
        );
        return target;
    };
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { context, project, output, opened, write };
}
function outputFiles(directory) {
    return fs
        .readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
        .sort();
}
test('project export includes live notes and maps but never reads trash, sync-trash, history or staged deletion payloads', async (t) => {
    const h = setup(t);
    h.write('active.node', 'ACTIVE');
    h.write('nested/map.map', 'ACTIVE MAP');
    h.write('nested/deep/note.node', 'NESTED');
    for (const directory of [
        '.pisi/trash/items/deleted/payload',
        '.pisi/sync-trash/stamp',
        '.pisi/mutations/snapshot',
        '.pisi-history/version',
        'nested/.pisi/trash/items/deleted',
        '.pisi-delete-staged',
        'nested/.pisi-transaction-staged',
        '.PISI/trash'
    ]) {
        h.write(directory + '/deleted.node', 'DELETED SECRET');
        h.write(directory + '/deleted.map', 'DELETED SECRET');
    }
    const result = await h.context.exportPisiProjectMarkdown(h.project);
    assert.equal(result.ok, true);
    assert.equal(result.exported, 3);
    assert.deepEqual(h.opened.sort(), ['active.node', 'nested/deep/note.node', 'nested/map.map']);
    assert.deepEqual(outputFiles(result.destination), ['active.md', 'nested/deep/note.md', 'nested/map.map.json']);
    assert.equal(fs.readFileSync(path.join(result.destination, 'active.md'), 'utf8'), 'ACTIVE');
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.destination, 'nested/map.map.json'), 'utf8')).title, 'ACTIVE MAP');
});
test('ordinary user folders named trash, history and similar names are still exported', async (t) => {
    const h = setup(t);
    for (const directory of ['trash', 'history', 'pisi', '.pisi-notes', '.personal']) h.write(directory + '/live.node', 'LIVE');
    const result = await h.context.exportPisiProjectMarkdown(h.project);
    assert.equal(result.exported, 5);
    assert.deepEqual(outputFiles(result.destination), ['.personal/live.md', '.pisi-notes/live.md', 'history/live.md', 'pisi/live.md', 'trash/live.md']);
});
test('a note moved into trash disappears from export and returns after restoration', async (t) => {
    const h = setup(t);
    const active = h.write('note.node', 'RESTORED');
    const deleted = path.join(h.project, '.pisi/trash/items/item/payload/note.node');
    fs.mkdirSync(path.dirname(deleted), { recursive: true });
    fs.renameSync(active, deleted);
    const removed = await h.context.exportPisiProjectMarkdown(h.project);
    assert.equal(removed.exported, 0);
    assert.deepEqual(outputFiles(removed.destination), []);
    fs.renameSync(deleted, active);
    const restored = await h.context.exportPisiProjectMarkdown(h.project);
    assert.equal(restored.exported, 1);
    assert.equal(fs.readFileSync(path.join(restored.destination, 'note.md'), 'utf8'), 'RESTORED');
});
test('cancelled export creates no output and reads no documents', async (t) => {
    const h = setup(t);
    h.write('live.node');
    h.context.dialog.showOpenDialog = async () => ({ canceled: true });
    const result = await h.context.exportPisiProjectMarkdown(h.project);
    assert.equal(result.canceled, true);
    assert.deepEqual(fs.readdirSync(h.output), []);
    assert.deepEqual(h.opened, []);
});
