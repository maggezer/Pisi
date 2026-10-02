'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('development and packaged process identities remain stable after the ESM migration', async () => {
    const { getWindowsAppIdentity } = await import('../main/functions/windows-app-identity.js');
    const app = {
        isPackaged: false,
        getAppPath: () => '/Projects/Pisi Notes',
        getPath: () => '/Users/User/AppData/Roaming'
    };

    const identity = getWindowsAppIdentity(app, '/opt/electron/electron');
    assert.match(identity.appId, /^com\.mumin\.pisi\.dev\./);
    assert.equal(identity.appId, getWindowsAppIdentity(app, '/opt/electron/electron').appId);
    assert.equal(identity.relaunchDisplayName, 'Pisi (Development)');

    app.isPackaged = true;
    assert.equal(getWindowsAppIdentity(app, '/opt/Pisi/Pisi').appId, 'com.mumin.pisi');
    assert.equal(getWindowsAppIdentity(app, '/opt/Pisi/Pisi').relaunchDisplayName, 'Pisi');
});

test('Windows development shortcut keeps the generated app identity wired into shell metadata', () => {
    const source = fs.readFileSync(path.join(__dirname, '../main/functions/windows-app-identity.js'), 'utf8');

    assert.match(source, /process\.platform !== 'win32'/);
    assert.match(source, /appUserModelId:\s*identity\.appId/);
    assert.match(source, /shell\.writeShortcutLink/);
    assert.match(source, /Pisi Development/);
});
