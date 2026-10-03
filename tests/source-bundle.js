'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function collect(directory, extension) {
    const files = [];
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collect(relative, extension));
        else if (entry.name.endsWith(extension)) files.push(relative);
    }
    return files.sort();
}

function readMany(files) {
    return files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n\n');
}

function readMainSource() {
    return readMany(collect('main/functions', '.js'));
}

function readRendererSource() {
    return readMany(collect('renderer', '.mjs'));
}

function readCssSection(bundle, sectionName) {
    const source = fs.readFileSync(path.join(root, bundle), 'utf8');
    const marker = `/* ===== Source: styles/${sectionName} ===== */`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Missing CSS section: ${bundle} -> ${sectionName}`);
    const end = source.indexOf('/* ===== Source:', start + marker.length);
    return source.slice(start + marker.length, end < 0 ? source.length : end);
}

module.exports = { collect, readMainSource, readRendererSource, readMany, readCssSection };
