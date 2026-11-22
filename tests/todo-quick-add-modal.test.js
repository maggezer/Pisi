'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Quick Add's behaviour (form, target, date, repeat, reminder) is tested by
// tests/task-panel-core.test.mjs and scripts/electron-tasks-panel-e2e.mjs (G4);
// the shortcut page's key display stays here.

test('kısayol sayfası Ctrl ve ⌘ biçimini kayıtlı komut kısayolundan üretir', () => {
    const commands = read('renderer/core/pisi-command-registry.mjs');

    assert.match(commands, /function formatPisiShortcutForDisplay/);
    assert.match(commands, /\? '⌘' : 'Ctrl'/);
    assert.match(commands, /formatPisiShortcutForDisplay\([\s\S]*getPisiCommandShortcut\(command\)/);
});
