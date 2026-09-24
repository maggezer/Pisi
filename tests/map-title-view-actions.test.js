'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('title double-click renames and secondary double-click opens compact cards', () => {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/map/pisi-map-workspace.mjs'), 'utf8');
    const fn = source.slice(source.indexOf('function bindMapNodeBoxEvents('), source.indexOf('function bindMapNodeDrag('));
    const elements = new Map();
    const makeElement = () => ({ handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
    for (const name of ['title', 'preview', 'open', 'delete', 'resize']) {
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
    const event = { preventDefault() {}, stopPropagation() {}, target: { closest() { return null; } } };
    elements.get('.map-node-title').handlers.dblclick(event);
    assert.equal(opened, 0);
    assert.equal(renamed, 1);
    box.handlers.keydown({ ...event, target: box, key: 'F2' });
    assert.equal(renamed, 2);
    const right = (time, x = 10, overrides = {}) => box.handlers.mouseup({
        ...event, button: 2, timeStamp: time, clientX: x, clientY: 10, ...overrides
    });
    right(100);
    assert.equal(opened, 0);
    right(300);
    assert.equal(opened, 1);
    right(400);
    assert.equal(opened, 1); // Third click must not open again.
    right(1000); // Too slow.
    assert.equal(opened, 1);
    right(1100, 30); // Too far away.
    assert.equal(opened, 1);
    right(1200, 30, { target: { closest() { return {}; } } }); // Control or editor.
    right(1300, 30);
    assert.equal(opened, 1);
    let prevented = 0;
    box.handlers.contextmenu({ ...event, preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
    canvas.dataset.nodeView = 'full';
    right(1400, 30);
    right(1500, 30);
    assert.equal(opened, 1);
    box.handlers.contextmenu({ ...event, preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
    elements.get('.map-node-title').handlers.dblclick(event);
    assert.equal(renamed, 3);
    elements.get('.map-node-preview').handlers.dblclick(event);
    assert.equal(opened, 2);
    assert.ok(!source.includes('map-node-rename'));
});
