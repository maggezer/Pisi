'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Dependencies and Work Badges default off and remember explicit toggles', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const defaults = read('renderer/map/pisi-map-overlay-visibility-defaults.mjs');

    assert.match(bootstrap, /pisi-map-overlay-visibility-defaults\.mjs/);
    assert.match(defaults, /stateKey:\s*'showTaskDependencies'/);
    assert.match(defaults, /stateKey:\s*'showWorkBadges'/);
    assert.match(defaults, /if \(!value\) return false;/);
    assert.match(defaults, /return \['1', 'true', 'on', 'visible'\]\.includes\(value\)/);
    assert.match(defaults, /capturePisiMindMapOverlayPreference/);
    assert.match(defaults, /setPisiStoredOverlayVisibility/);
    assert.match(defaults, /attributeFilter:\s*\['aria-pressed'\]/);
});

test('Property Badges default off but remain user-toggleable', () => {
    const badges = read('renderer/map/pisi-map-property-badges-toggle.mjs');

    assert.match(badges, /if \(!value\) return false;/);
    assert.match(badges, /return \['1', 'true', 'on', 'visible'\]\.includes\(value\)/);
    assert.match(badges, /setPisiPropertyBadgesVisible\(!getPisiPropertyBadgesVisible\(\)\)/);
});

test('Dim Filtered is pinned top-right and Reset stays below at the right edge', () => {
    const css = read('styles/115-mindmap-actions-single-row.css');
    const panel = read('renderer/map/pisi-map-right-panel.mjs');

    assert.match(css, /#pisi-map-dim-filtered\.pisi-mindmap-icon-button\s*\{[^}]*margin-left:\s*auto;/s);
    assert.match(css, /#pisi-map-operational-reset\s*\{[^}]*justify-self:\s*end;/s);

    const primaryStart = panel.indexOf('const mindMapPrimaryActionIds');
    const primaryEnd = panel.indexOf('const mindMapFilterControlIds', primaryStart);
    const primaryBlock = panel.slice(primaryStart, primaryEnd);
    assert.match(primaryBlock, /'pisi-map-dim-filtered'/);
    assert.doesNotMatch(primaryBlock, /'pisi-map-operational-reset'/);

    const layoutStart = panel.indexOf('function ensureMindMapLayoutRow');
    const layoutEnd = panel.indexOf('function enhanceMindMapToolbar', layoutStart);
    const layoutBlock = panel.slice(layoutStart, layoutEnd);
    assert.match(layoutBlock, /'pisi-map-operational-reset'/);
});
