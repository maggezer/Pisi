'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (file) => fs.readFileSync(file, 'utf8');

test('eski belge metadata kimlik ve bağlantıları korunarak Pisi alanına taşınır', () => {
    const source = read('main/functions/document-store.js');
    assert.match(source, /const legacyMetadata =/);
    assert.match(source, /data\.pisi = legacyMetadata \? \{ \.\.\.legacyMetadata \} : \{\}/);
    assert.match(source, /Object\.entries\(legacyMetadata\)/);
    assert.match(source, /delete data\.kedi/);
});

test('eski ayarlar yeni Pisi ayar dosyasına güvenle kopyalanır', () => {
    const source = read('main/functions/path-security.js');
    assert.match(source, /function getLegacySettingsPath\(/);
    assert.match(source, /kedi-settings\.json/);
    assert.match(source, /sourcePath === legacySettingsPath/);
    assert.match(source, /writeFileAtomic\(\s*settingsPath/);
});

test('eski proje kilidi canlı süreç varsa korunur, bayatsa kaldırılır', () => {
    const source = read('main/functions/electron-ipc.js');
    assert.match(source, /function migrateLegacyProjectLock\(/);
    assert.match(source, /\.kedi\.lock/);
    assert.match(source, /function isProjectLockHeldByAnotherProcess\(/);
    assert.match(source, /lockPid === process\.pid/);
    assert.match(source, /isProjectLockHeldByAnotherProcess\(legacyLock\)/);
    assert.match(source, /removeProjectLockFile\(legacyLockPath\)/);
    assert.match(source, /migrateLegacyProjectLock\(folderPath\)/);
});
