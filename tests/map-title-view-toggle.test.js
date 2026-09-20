'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('title toggle defaults to full, stays pressed, redraws edges and restores preference', () => {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/map/pisi-map-right-panel.mjs'), 'utf8');
    const code = source.slice(source.indexOf('const titleViewStorageKey'), source.indexOf('let mindMapPanelObserver'));
    const saved = new Map();
    function boot() {
        const elements = new Map([['map-canvas', { dataset: {} }]]);
        let redraws = 0;
        const context = vm.createContext({
            localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
            document: {
                getElementById: id => elements.get(id),
                createElement: () => ({
                    dataset: {}, attributes: {}, listeners: {},
                    setAttribute(key, value) { this.attributes[key] = value; },
                    addEventListener(key, callback) { this.listeners[key] = callback; }
                })
            },
            window: { scheduleDrawMapConnections() { redraws++; } },
            t: () => 'Titles only'
        });
        vm.runInContext(code, context);
        const button = vm.runInContext('ensureMindMapTitleButton()', context);
        elements.set(button.id, button);
        vm.runInContext('syncMindMapTitleView()', context);
        return { button, canvas: elements.get('map-canvas'), redraws: () => redraws };
    }
    const first = boot();
    assert.equal(first.canvas.dataset.nodeView, 'full');
    assert.equal(first.button.attributes['aria-pressed'], 'false');
    first.button.listeners.click();
    assert.equal(first.canvas.dataset.nodeView, 'title');
    assert.equal(first.button.attributes['aria-pressed'], 'true');
    assert.equal(first.redraws(), 1);
    const reopened = boot();
    assert.equal(reopened.canvas.dataset.nodeView, 'title');
    reopened.button.listeners.click();
    assert.equal(reopened.canvas.dataset.nodeView, 'full');
    assert.equal(reopened.button.attributes['aria-pressed'], 'false');
});
