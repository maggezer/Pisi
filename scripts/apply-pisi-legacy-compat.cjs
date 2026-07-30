'use strict';

const fs = require('fs');

function replaceOnce(source, oldValue, newValue, label) {
    if (!source.includes(oldValue)) {
        throw new Error(`${label} için beklenen kaynak parçası bulunamadı.`);
    }
    return source.replace(oldValue, newValue);
}

const documentPath = 'main/functions/document-store.js';
let documentSource = fs.readFileSync(documentPath, 'utf8');
documentSource = replaceOnce(
    documentSource,
`    const data = readResult.data;

    if (!data.pisi || typeof data.pisi !== 'object') {
        data.pisi = {};
        changed = true;
    }
`,
`    const data = readResult.data;
    const legacyMetadata =
        data.kedi &&
        typeof data.kedi === 'object' &&
        !Array.isArray(data.kedi)
            ? data.kedi
            : null;

    if (!data.pisi || typeof data.pisi !== 'object') {
        data.pisi = legacyMetadata ? { ...legacyMetadata } : {};
        changed = true;
    } else if (legacyMetadata) {
        for (const [key, value] of Object.entries(legacyMetadata)) {
            if (data.pisi[key] === undefined) {
                data.pisi[key] = value;
                changed = true;
            }
        }
    }

    if (legacyMetadata) {
        delete data.kedi;
        changed = true;
    }
`,
    'eski belge metadata migrasyonu'
);
fs.writeFileSync(documentPath, documentSource, 'utf8');

const securityPath = 'main/functions/path-security.js';
let securitySource = fs.readFileSync(securityPath, 'utf8');
securitySource = replaceOnce(
    securitySource,
`function getSettingsPath() {
    return path.join(app.getPath('userData'), 'pisi-settings.json');
}

function readSettings() {
    const settingsPath = getSettingsPath();

    try {
        if (!fs.existsSync(settingsPath)) {
            return {};
        }

        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw || '{}');
    } catch (error) {
        console.error('[PISI] Settings okunamadı:', error);
        return {};
    }
}
`,
`function getSettingsPath() {
    return path.join(app.getPath('userData'), 'pisi-settings.json');
}

function getLegacySettingsPath() {
    return path.join(app.getPath('userData'), 'kedi-settings.json');
}

function readSettings() {
    const settingsPath = getSettingsPath();
    const legacySettingsPath = getLegacySettingsPath();

    try {
        const sourcePath = fs.existsSync(settingsPath)
            ? settingsPath
            : (fs.existsSync(legacySettingsPath) ? legacySettingsPath : null);

        if (!sourcePath) {
            return {};
        }

        const raw = fs.readFileSync(sourcePath, 'utf-8');
        const settings = JSON.parse(raw || '{}');

        if (sourcePath === legacySettingsPath) {
            writeFileAtomic(
                settingsPath,
                JSON.stringify(settings, null, 2),
                { backup: false }
            );
        }

        return settings;
    } catch (error) {
        console.error('[PISI] Settings okunamadı:', error);
        return {};
    }
}
`,
    'eski ayar dosyası migrasyonu'
);
fs.writeFileSync(securityPath, securitySource, 'utf8');

const ipcPath = 'main/functions/electron-ipc.js';
let ipcSource = fs.readFileSync(ipcPath, 'utf8');
ipcSource = replaceOnce(
    ipcSource,
`function acquireProjectLock(folderPath) {
    const lockPath = path.join(folderPath, '.pisi.lock');

    try {
`,
`function migrateLegacyProjectLock(folderPath) {
    const legacyLockPath = path.join(folderPath, '.kedi.lock');
    if (!fs.existsSync(legacyLockPath)) return { ok: true };

    let legacyLock = null;
    try {
        legacyLock = JSON.parse(fs.readFileSync(legacyLockPath, 'utf-8'));
    } catch {}

    if (legacyLock?.pid && isProcessAlive(Number(legacyLock.pid))) {
        return {
            ok: false,
            error: \`Bu proje eski uygulamanın çalışan bir süreci tarafından kullanılıyor (PID \${legacyLock.pid}).\`
        };
    }

    markInternalFileChange(legacyLockPath);
    fs.unlinkSync(legacyLockPath);
    sealInternalFileChange(legacyLockPath);
    return { ok: true };
}

function acquireProjectLock(folderPath) {
    const lockPath = path.join(folderPath, '.pisi.lock');

    try {
        const legacyLockResult = migrateLegacyProjectLock(folderPath);
        if (!legacyLockResult.ok) return legacyLockResult;

`,
    'eski proje kilidi migrasyonu'
);
fs.writeFileSync(ipcPath, ipcSource, 'utf8');

const auditPath = 'scripts/check-pisi-migration.js';
let auditSource = fs.readFileSync(auditPath, 'utf8');
auditSource = replaceOnce(
    auditSource,
`    checked = countCompatibility('Eski diary klasör işaretçisi (.kedi-diary)', checked, /\\.kedi-diary/gi);
    checked = countCompatibility('Eski diary metadata alanı (kedi.diaryDate)', checked, /\\bkedi\\.diaryDate\\b/gi);
`,
`    checked = countCompatibility('Eski diary klasör işaretçisi (.kedi-diary)', checked, /\\.kedi-diary/gi);
    checked = countCompatibility('Eski diary metadata alanı (kedi.diaryDate)', checked, /\\bkedi\\.diaryDate\\b/gi);
    checked = countCompatibility('Eski belge metadata alanı (data.kedi)', checked, /\\bdata\\.kedi\\b/gi);
    checked = countCompatibility('Eski ayar dosyası (kedi-settings.json)', checked, /kedi-settings\\.json/gi);
    checked = countCompatibility('Eski proje kilidi (.kedi.lock)', checked, /\\.kedi\\.lock/gi);
`,
    'geçiş denetimi uyumluluk istisnaları'
);
fs.writeFileSync(auditPath, auditSource, 'utf8');

const testPath = 'tests/pisi-legacy-migration.test.js';
const testSource = `'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (file) => fs.readFileSync(file, 'utf8');

test('eski belge metadata kimlik ve bağlantıları korunarak Pisi alanına taşınır', () => {
    const source = read('main/functions/document-store.js');
    assert.match(source, /const legacyMetadata =/);
    assert.match(source, /data\\.pisi = legacyMetadata \\? \\{ \\.\\.\\.legacyMetadata \\} : \\{\\}/);
    assert.match(source, /Object\\.entries\\(legacyMetadata\\)/);
    assert.match(source, /delete data\\.kedi/);
});

test('eski ayarlar yeni Pisi ayar dosyasına güvenle kopyalanır', () => {
    const source = read('main/functions/path-security.js');
    assert.match(source, /function getLegacySettingsPath\\(/);
    assert.match(source, /kedi-settings\\.json/);
    assert.match(source, /sourcePath === legacySettingsPath/);
    assert.match(source, /writeFileAtomic\\(\\s*settingsPath/);
});

test('eski proje kilidi canlı süreç varsa korunur, bayatsa kaldırılır', () => {
    const source = read('main/functions/electron-ipc.js');
    assert.match(source, /function migrateLegacyProjectLock\\(/);
    assert.match(source, /\\.kedi\\.lock/);
    assert.match(source, /isProcessAlive\\(Number\\(legacyLock\\.pid\\)\\)/);
    assert.match(source, /fs\\.unlinkSync\\(legacyLockPath\\)/);
    assert.match(source, /migrateLegacyProjectLock\\(folderPath\\)/);
});
`;
fs.writeFileSync(testPath, testSource, 'utf8');

console.log('Eski Kedi verileri için Pisi uyumluluk düzeltmeleri uygulandı.');
