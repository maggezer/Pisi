'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const errors = [];

function listTrackedFiles() {
    return execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        encoding: 'utf8'
    }).split('\0').filter(Boolean);
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

function addBrandingErrors(file, content) {
    const checked = content.replace(
        /https?:\/\/github\.com\/maggezer\/Kedi\b/gi,
        ''
    );
    checked.split(/\r?\n/).forEach((line, index) => {
        if (/kedi/i.test(line)) {
            errors.push(
                `Eski Kedi adı kaldı: ${file}:${index + 1}: ${line.trim().slice(0, 180)}`
            );
        }
    });
}

function addAssetReferenceErrors(file, content) {
    const references = new Set();
    for (const match of content.matchAll(
        /(?:^|["'`(\s])((?:\.\.\/)*assets\/[A-Za-z0-9._/-]+)/g
    )) {
        references.add(match[1].replace(/[.,;:!?]+$/, ''));
    }

    for (const reference of references) {
        const normalized = reference.replace(/^(?:\.\.\/)+/, '');
        if (!fs.existsSync(path.join(root, normalized))) {
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
    addBrandingErrors(file, content);
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

const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);
if (packageJson.name !== 'pisi') {
    errors.push('package.json name alanı pisi değil.');
}
if (packageJson.build?.appId !== 'com.mumin.pisi') {
    errors.push('Electron appId com.mumin.pisi değil.');
}
if (packageJson.build?.productName !== 'Pisi') {
    errors.push('Electron productName Pisi değil.');
}
if (packageJson.build?.win?.icon !== 'assets/pisi.ico') {
    errors.push('Windows build ikonu assets/pisi.ico değil.');
}

console.log(
    `Pisi branding denetimi: ${productionFiles.length} production dosyası incelendi.`
);

if (errors.length) {
    console.error(`Pisi branding denetiminde ${errors.length} sorun bulundu:`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
}

console.log('Pisi branding denetimi başarılı.');
