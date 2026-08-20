'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const reportOnly = process.argv.includes('--report-only');
const errors = [];
const compatibility = new Map();

function listTrackedFiles() {
    try {
        return execFileSync('git', ['ls-files', '-z'], {
            cwd: root,
            encoding: 'utf8'
        }).split('\0').filter(Boolean);
    } catch {
        const ignored = new Set(['.git', 'node_modules', 'dist']);
        const result = [];
        const walk = (directory, relative = '') => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (entry.isDirectory() && ignored.has(entry.name)) continue;
                const childRelative = path.posix.join(relative, entry.name);
                const childPath = path.join(directory, entry.name);
                if (entry.isDirectory()) walk(childPath, childRelative);
                else result.push(childRelative);
            }
        };
        walk(root);
        return result;
    }
}

function isProductionFile(file) {
    return (
        file === 'main.js' ||
        file === 'preload.js' ||
        file === 'index.html' ||
        file === 'style.css' ||
        file === 'package.json' ||
        file === 'package-lock.json' ||
        /^(?:main|renderer|styles|locales)\//.test(file)
    );
}

function isTextFile(file) {
    return /\.(?:c?js|mjs|json|html|css|md|txt|yml|yaml)$/i.test(file);
}

function countCompatibility(label, content, expression) {
    const matches = content.match(expression) || [];
    if (matches.length) {
        compatibility.set(label, (compatibility.get(label) || 0) + matches.length);
    }
    return content.replace(expression, '');
}

function addLegacyNameErrors(file, content) {
    let checked = content;
    checked = countCompatibility('Eski diary klasör işaretçisi (.kedi-diary)', checked, /\.kedi-diary/gi);
    checked = countCompatibility('Eski diary metadata alanı (kedi.diaryDate)', checked, /\bkedi\.diaryDate\b/gi);
    checked = countCompatibility('Eski belge metadata alanı (data.kedi)', checked, /\bdata\.kedi\b/gi);
    checked = countCompatibility('Eski ayar dosyası (kedi-settings.json)', checked, /kedi-settings\.json/gi);
    checked = countCompatibility('Eski proje kilidi (.kedi.lock)', checked, /\.kedi\.lock/gi);
    if (file === 'main/functions/project-integrity-documents.js') {
        checked = countCompatibility(
            'Project Integrity legacy metadata denetimi',
            checked,
            /['"]kedi['"]/gi
        );
    }
    checked = checked.replace(/https?:\/\/github\.com\/maggezer\/Kedi\b/gi, '');

    const lines = checked.split(/\r?\n/);
    lines.forEach((line, index) => {
        if (/kedi/i.test(line)) {
            errors.push(`Eski Kedi adı kaldı: ${file}:${index + 1}: ${line.trim().slice(0, 180)}`);
        }
    });
}

function addAssetReferenceErrors(file, content) {
    const references = new Set();
    for (const match of content.matchAll(/(?:^|["'`(\s])((?:\.\.\/)*assets\/[A-Za-z0-9._/-]+)/g)) {
        const reference = match[1].replace(/[.,;:!?]+$/, '');
        references.add(reference);
    }

    for (const reference of references) {
        const normalized = reference.replace(/^(?:\.\.\/)+/, '');
        const target = path.join(root, normalized);
        if (!fs.existsSync(target)) {
            errors.push(`Eksik asset referansı: ${file} -> ${reference}`);
        }
    }
}

const files = listTrackedFiles();
const productionFiles = files.filter(isProductionFile);

for (const file of productionFiles) {
    if (/kedi/i.test(file)) {
        errors.push(`Eski Kedi adı taşıyan production dosyası: ${file}`);
    }

    if (!isTextFile(file)) continue;
    const absolutePath = path.join(root, file);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');
    addLegacyNameErrors(file, content);
    addAssetReferenceErrors(file, content);
}

const requiredAssets = [
    'assets/pisi.ico',
    'assets/pisi.png',
    'assets/win-min.png',
    'assets/win-max.png',
    'assets/win-close.png'
];
for (const asset of requiredAssets) {
    if (!fs.existsSync(path.join(root, asset))) {
        errors.push(`Zorunlu Pisi asseti bulunamadı: ${asset}`);
    }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'pisi') errors.push('package.json name alanı pisi değil.');
if (packageJson.build?.appId !== 'com.mumin.pisi') errors.push('Electron appId com.mumin.pisi değil.');
if (packageJson.build?.productName !== 'Pisi') errors.push('Electron productName Pisi değil.');
if (packageJson.build?.win?.icon !== 'assets/pisi.ico') errors.push('Windows build ikonu assets/pisi.ico değil.');
if (!Array.isArray(packageJson.build?.files) || !packageJson.build.files.includes('assets/**/*')) {
    errors.push('Electron paketine assets/**/* dahil edilmiyor.');
}

const runtime = fs.readFileSync(path.join(root, 'main', 'runtime.js'), 'utf8');
if (!/path\.join\(app\.getAppPath\(\), ['"]assets['"], ['"]pisi\.ico['"]\)/.test(runtime)) {
    errors.push('Çalışma zamanı ikonu uygulama kökünden app.getAppPath() ile çözülmüyor.');
}
if (/path\.join\(__dirname, ['"]assets['"], ['"]pisi\.ico['"]\)/.test(runtime)) {
    errors.push('Çalışma zamanı ikonu yanlışlıkla main/assets altında aranıyor.');
}

console.log(`Pisi geçiş denetimi: ${productionFiles.length} production dosyası incelendi.`);
if (compatibility.size) {
    console.log('Bilinçli geriye dönük uyumluluk referansları:');
    for (const [label, count] of compatibility) {
        console.log(`- ${label}: ${count}`);
    }
} else {
    console.log('Bilinçli geriye dönük uyumluluk referansı bulunmadı.');
}

if (errors.length) {
    console.error(`Pisi geçiş denetiminde ${errors.length} sorun bulundu:`);
    errors.forEach((error) => console.error(`- ${error}`));
    if (!reportOnly) process.exit(1);
} else {
    console.log('Pisi geçiş denetimi başarılı.');
}