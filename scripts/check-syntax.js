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
    'release',
    'android',
    '.gradle',
    'build',
    'test-results',
    'playwright-report'
]);

function collectJavaScriptFiles(directoryPath) {
    const files = [];
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                files.push(...collectJavaScriptFiles(path.join(directoryPath, entry.name)));
            }
            continue;
        }
        if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
            files.push(path.join(directoryPath, entry.name));
        }
    }
    return files;
}

const files = collectJavaScriptFiles(projectRoot).sort();
let failed = false;
for (const filePath of files) {
    const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        process.stderr.write(result.stderr || result.stdout);
    }
}
if (failed) process.exitCode = 1;
else console.log(files.length + ' JavaScript/ES module dosyası sözdizimi kontrolünden geçti.');
