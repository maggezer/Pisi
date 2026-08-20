'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'main/functions/path-security.js'),
    'utf8'
);

test('Windows rename retries transient permission and busy errors', () => {
    assert.match(source, /PISI_WINDOWS_RENAME_RETRY_CODES[\s\S]*?'EPERM'[\s\S]*?'EACCES'[\s\S]*?'EBUSY'/);
    assert.match(source, /PISI_WINDOWS_RENAME_MAX_ATTEMPTS\s*=\s*8/);
    assert.match(source, /function waitForPisiWindowsRenameRetry/);
    assert.match(source, /relaxPisiWindowsRenamePermissions\(oldPath\)/);
    assert.match(source, /PISI_WINDOWS_RENAME_RETRY_DELAY_MS \* \(attempt \+ 1\)/);
});

test('rename treats already-achieved destination state as success', () => {
    assert.match(
        source,
        /if \(!sourceExists && destinationExists\) \{[\s\S]*?sealInternalFileChange\(oldPath, newPath\);[\s\S]*?return;/
    );
});

test('rename seals watcher state both on success and terminal failure', () => {
    const renameStart = source.indexOf('function renamePathInternal');
    const settingsStart = source.indexOf('function getSettingsPath', renameStart);
    const renameBlock = source.slice(renameStart, settingsStart);

    assert.match(renameBlock, /fs\.renameSync\(oldPath, newPath\)/);
    assert.ok((renameBlock.match(/sealInternalFileChange\(oldPath, newPath\)/g) || []).length >= 3);
    assert.match(renameBlock, /throw error/);
});
