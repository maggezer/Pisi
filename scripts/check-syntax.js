'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const ignoredDirectories = new Set([
    '.git',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'release'
]);

function collectJavaScriptFiles(directoryPath) {
    const files = [];

    for (const entry of fs.readdirSync(directoryPath, {
        withFileTypes: true
    })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                files.push(
                    ...collectJavaScriptFiles(
                        path.join(directoryPath, entry.name)
                    )
                );
            }
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(directoryPath, entry.name));
        }
    }

    return files;
}

const files = collectJavaScriptFiles(projectRoot).sort();
const classicRendererFiles = [
    'app.js',
    'renderer/pisi-tree.js',
    'renderer/pisi-map-workspace.js',
    'renderer/pisi-tags.js',
    'renderer/pisi-calendar.js',
    'renderer/pisi-node-modal.js',
    'renderer/pisi-map-connections.js'
].map((filePath) => path.join(projectRoot, filePath));
let failed = false;

for (const filePath of files) {
    const result = spawnSync(process.execPath, ['--check', filePath], {
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        failed = true;
        process.stderr.write(result.stderr || result.stdout);
    }
}

const combinedRendererSource = classicRendererFiles
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n;\n');
const combinedResult = spawnSync(process.execPath, ['--check', '-'], {
    encoding: 'utf8',
    input: combinedRendererSource
});

if (combinedResult.status !== 0) {
    failed = true;
    process.stderr.write(
        'Klasik renderer scriptleri ortak global scope içinde çakışıyor:\n'
    );
    process.stderr.write(combinedResult.stderr || combinedResult.stdout);
}

if (failed) {
    process.exitCode = 1;
} else {
    console.log(
        `${files.length} JavaScript dosyası ve ortak renderer scope'u sözdizimi kontrolünden geçti.`
    );
}
