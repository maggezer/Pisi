'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('development process, window and shortcut share a separate stable Windows identity', () => {
    const source = fs.readFileSync(path.join(__dirname, '../main/functions/windows-app-identity.js'), 'utf8');
    const output = { exports: {} };
    vm.runInNewContext(source, {
        module: output, console, process: { platform: 'win32', execPath: 'C:\\Electron\\electron.exe' },
        require(name) {
            if (name === 'path') return path.win32;
            if (name === 'fs') return { mkdirSync() {}, existsSync: () => false };
            return require(name);
        }
    });
    const { getWindowsAppIdentity, ensureWindowsDevShortcut } = output.exports;
    const app = {
        isPackaged: false, getAppPath: () => 'C:\\Projects\\Pisi Notes',
        getPath: () => 'C:\\Users\\User\\AppData\\Roaming'
    };
    let written;
    const shell = { writeShortcutLink(file, operation, options) { written = { file, operation, options }; return true; } };
    const identity = getWindowsAppIdentity(app);
    assert.match(identity.appId, /^com\.mumin\.pisi\.dev\./);
    assert.equal(identity.appId, getWindowsAppIdentity(app).appId);
    ensureWindowsDevShortcut(app, shell);
    assert.equal(written.options.appUserModelId, identity.appId);
    assert.equal(written.options.icon, identity.appIconPath);
    assert.equal(written.options.args, '"' + app.getAppPath() + '"');
    assert.equal(identity.relaunchCommand, '"' + written.options.target + '" ' + written.options.args);
    assert.match(written.file, /Start Menu\\Programs\\Pisi Development/);
    app.isPackaged = true;
    written = null;
    ensureWindowsDevShortcut(app, shell);
    assert.equal(written, null);
    assert.equal(getWindowsAppIdentity(app).appId, 'com.mumin.pisi');
});
