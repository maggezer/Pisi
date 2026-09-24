'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('compact title opens modal while rename button and F2 edit the title', () => {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/map/pisi-map-workspace.mjs'), 'utf8');
    const fn = source.slice(source.indexOf('function bindMapNodeBoxEvents('), source.indexOf('function bindMapNodeDrag('));
    const elements = new Map();
    const makeElement = () => ({ handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
    for (const name of ['title', 'preview', 'open', 'delete', 'rename', 'resize']) {
        elements.set('.map-node-' + name, makeElement());
    }
    const box = Object.assign(makeElement(), { querySelector: selector => elements.get(selector) });
    const canvas = { dataset: { nodeView: 'title' } };
    let opened = 0;
    let renamed = 0;
    vm.runInNewContext(fn + '\nbindMapNodeBoxEvents(box, {});', {
        box, document: { getElementById: () => canvas },
        bindMapNodeDrag() {}, bindMapNodeResize() {}, bindMapPortEvents() {},
        openNodeModalFromBox() { opened++; },
        startMapNodeTitleEdit() { renamed++; }
    });
    const event = { preventDefault() {}, stopPropagation() {} };
    elements.get('.map-node-title').handlers.dblclick(event);
    assert.equal(opened, 1);
    assert.equal(renamed, 0);
    elements.get('.map-node-rename').handlers.click(event);
    box.handlers.keydown({ ...event, target: box, key: 'F2' });
    assert.equal(renamed, 2);
    canvas.dataset.nodeView = 'full';
    elements.get('.map-node-title').handlers.dblclick(event);
    assert.equal(renamed, 3);
    assert.equal(opened, 1);
});
