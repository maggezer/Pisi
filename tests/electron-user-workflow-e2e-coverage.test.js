'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Electron E2E suite includes real node and map persistence workflows', () => {
    const packageJson = JSON.parse(read('package.json'));
    const workflow = read('.github/workflows/electron-e2e.yml');
    const scenario = read('scripts/electron-user-workflow-e2e.mjs');

    assert.match(packageJson.scripts['test:e2e'], /electron-smoke-e2e\.mjs/);
    assert.match(packageJson.scripts['test:e2e'], /electron-user-workflow-e2e\.mjs/);
    assert.match(workflow, /npm run test:e2e/);

    for (const marker of [
        "document.getElementById('add-node-btn')",
        "key: 's', ctrlKey: true",
        'Input.insertText',
        'closeTab(cdp, nodePath)',
        "document.getElementById('add-map-btn')",
        "new DragEvent('dragstart'",
        "new DragEvent('drop'",
        "new MouseEvent('mousedown'",
        'persisted map layout after reopen'
    ]) {
        assert.ok(scenario.includes(marker), marker);
    }
});
