const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { auditAttachments } = require('../main/functions/project-integrity-documents');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-integrity-assets-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const paint = `paint/${'a'.repeat(64)}.png`;
    const sheet = `sheet/${'b'.repeat(64)}.json`;
    const sidecarPath = path.join(root, 'Note - node_test.pisi-node');
    fs.mkdirSync(sidecarPath);
    const doc = {
        type: 'node',
        filePath: path.join(root, 'Note.node'),
        storedPath: 'Note.node',
        metadata: { id: 'node_test' },
        sidecarPath,
        data: {
            content:
                `<canvas data-pisi-canvas="1" data-pisi-asset="${paint}"></canvas>` + `<table data-pisi-sheet="1" data-pisi-sheet-asset='${sheet}'></table>`
        }
    };
    const write = (base, reference) => {
        const target = path.join(base, reference);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'asset');
    };
    const audit = () => {
        const context = { issues: [] };
        auditAttachments(root, context, doc);
        return context.issues;
    };
    return { root, paint, sheet, doc, write, audit };
}

test('integrity reports missing Canvas and Sheet assets once per reference without changing content', (t) => {
    const f = fixture(t);
    f.doc.data.content += f.doc.data.content;
    const before = JSON.stringify(f.doc);
    const issues = f.audit();
    assert.equal(issues.length, 2);
    for (const reference of [f.paint, f.sheet]) {
        const issue = issues.find((item) => item.message.includes(reference));
        assert.ok(issue);
        assert.equal(issue.code, 'attachment-target-missing');
        assert.equal(issue.path, 'Note.node');
        assert.equal(issue.entityId, 'node_test');
        assert.equal(issue.repair.safety, 'manual');
    }
    assert.equal(JSON.stringify(f.doc), before);
});

test('integrity accepts existing sidecar assets and preserves ordinary attachment checks', (t) => {
    const f = fixture(t);
    f.write(f.doc.sidecarPath, f.paint);
    f.write(f.doc.sidecarPath, f.sheet);
    f.write(f.root, 'direct.pdf');
    f.write(f.doc.sidecarPath, 'attached.txt');
    f.doc.data.content +=
        '<a href="direct.pdf">file</a><a href="attached.txt">file</a>' + '<img src="https://example.com/remote.png"><img src="data:image/png;base64,abc">';
    assert.deepEqual(f.audit(), []);
    f.doc.data.content += '<img src="missing.png">';
    assert.equal(f.audit().length, 1);
    assert.match(f.audit()[0].message, /missing.png/);
});

test('editor assets must be files in their owning sidecar, even if same paths exist beside the node', (t) => {
    const f = fixture(t);
    f.write(f.root, f.paint);
    f.write(f.root, f.sheet);
    assert.equal(f.audit().length, 2);
    fs.mkdirSync(path.join(f.doc.sidecarPath, f.paint), { recursive: true });
    assert.equal(f.audit().length, 2, 'directory is not an asset file');
    f.doc.sidecarPath = null;
    assert.equal(f.audit().length, 2, 'missing sidecar cannot fall back to document directory');
});
