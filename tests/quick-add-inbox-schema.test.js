'use strict';

// pisi-error.md §5c: the Inbox node Quick Add creates carries a `systemRole`
// property, so the project property schema (.pisi/properties.json) must be written
// with it. Runs the real main-process stores and Project Integrity against a
// temporary project folder.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadPisiMainStores } = require('./main-store-harness.cjs');

const modules = loadPisiMainStores();
for (const name of ['task-reference-integrity', 'structured-nodes', 'property-schema-mutations', 'project-integrity']) {
    require(path.join(__dirname, '..', 'main', 'functions', `${name}.js`));
}
const taskCapture = modules['main.taskCapture'];
const schemaStore = modules['main.propertySchemaStore'];
const audit = modules['main.projectIntegrity'].auditPisiProjectIntegrity;

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-inbox-schema-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    return project;
}

function propertyIssues(project) {
    return audit(project)
        .issues.filter((issue) => /property/.test(issue.code))
        .map((issue) => `${issue.code} | ${issue.path}`);
}

function inboxPath(project) {
    return path.join(project, 'Inbox.node');
}

test('Quick Add: boş projede açılan Inbox ile birlikte property şeması da yazılır', (t) => {
    const project = makeProject(t);
    const result = taskCapture.quickAddPisiTask(project, { text: 'İlk görev' });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.inbox, true);

    const read = schemaStore.readPisiPropertySchema(project);
    assert.equal(read.ok && read.exists, true, 'Inbox oluşunca .pisi/properties.json da yazılmalı');
    assert.deepEqual(read.schema.definitions, [{ id: 'systemRole', name: 'Sistem rolü', type: 'text', system: true }]);
    const inbox = JSON.parse(fs.readFileSync(inboxPath(project), 'utf8'));
    assert.deepEqual(inbox.properties.systemRole, { id: 'systemRole', name: 'Sistem rolü', type: 'text', value: 'inbox', system: true });
    assert.deepEqual(propertyIssues(project), []);

    const before = fs.readFileSync(schemaStore.getPisiPropertySchemaPath(project), 'utf8');
    assert.equal(taskCapture.quickAddPisiTask(project, { text: 'İkinci görev' }).ok, true);
    assert.equal(fs.readFileSync(schemaStore.getPisiPropertySchemaPath(project), 'utf8'), before, 'şema değişmiyorsa yeniden yazılmaz');
});

test('Quick Add: şemasız eski Inbox bulunan proje sonraki Quick Add ile onarılır, mevcut tanımlar korunur', (t) => {
    const project = makeProject(t);
    assert.equal(taskCapture.quickAddPisiTask(project, { text: 'Eski görev' }).ok, true);
    // Bring the project to the state older versions left behind: Inbox property, no schema.
    fs.rmSync(schemaStore.getPisiPropertySchemaPath(project));
    assert.deepEqual(propertyIssues(project), ['property-schema-authority-missing | .pisi/properties.json']);

    assert.equal(taskCapture.quickAddPisiTask(project, { text: 'Yeni görev' }).ok, true);
    assert.deepEqual(propertyIssues(project), []);

    // A schema that exists without the Inbox definition gains it and keeps the rest.
    const schemaPath = schemaStore.getPisiPropertySchemaPath(project);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    schema.definitions = [{ id: 'prop_durum', name: 'Durum', type: 'text' }];
    fs.writeFileSync(schemaPath, JSON.stringify(schema));
    assert.equal(taskCapture.quickAddPisiTask(project, { text: 'Üçüncü görev' }).ok, true);
    assert.deepEqual(
        schemaStore.readPisiPropertySchema(project).schema.definitions.map((item) => item.id),
        ['prop_durum', 'systemRole']
    );
});

test('Quick Add: okunamayan property şeması ezilmez, Inbox oluşturulmaz', (t) => {
    const project = makeProject(t);
    const schemaPath = schemaStore.getPisiPropertySchemaPath(project);
    fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
    fs.writeFileSync(schemaPath, '{ bozuk');

    const result = taskCapture.quickAddPisiTask(project, { text: 'Görev' });
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(schemaPath, 'utf8'), '{ bozuk');
    assert.equal(fs.existsSync(inboxPath(project)), false);
});
