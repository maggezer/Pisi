'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { TextDecoder } = require('util');

const projectRoot = path.resolve(__dirname, '..');
const ignoredDirectories = new Set([
    '.git',
    'node_modules',
    'dist',
    'coverage',
    'out',
    'release'
]);
const binaryExtensions = new Set([
    '.7z', '.aab', '.apk', '.bmp', '.class', '.dll', '.dylib', '.exe',
    '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.node', '.pdf',
    '.png', '.so', '.tar', '.webp', '.woff', '.woff2', '.zip'
]);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const oldBrandPattern = /kedi/i;

function replaceBrand(value) {
    return String(value)
        .replace(/KEDI/g, 'PISI')
        .replace(/Kedi/g, 'Pisi')
        .replace(/kedi/g, 'pisi');
}

function isIgnored(relativePath) {
    return relativePath
        .split(path.sep)
        .some((part) => ignoredDirectories.has(part));
}

function collectPaths(directoryPath = projectRoot) {
    const paths = [];

    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        const fullPath = path.join(directoryPath, entry.name);
        const relativePath = path.relative(projectRoot, fullPath);

        if (isIgnored(relativePath)) continue;

        paths.push(fullPath);
        if (entry.isDirectory()) {
            paths.push(...collectPaths(fullPath));
        }
    }

    return paths;
}

function readUtf8Text(filePath) {
    if (binaryExtensions.has(path.extname(filePath).toLowerCase())) return null;

    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) return null;

    try {
        return utf8Decoder.decode(buffer);
    } catch {
        return null;
    }
}

function replaceTextContents() {
    let changedFiles = 0;

    for (const filePath of collectPaths().filter((item) => fs.statSync(item).isFile())) {
        const text = readUtf8Text(filePath);
        if (text === null) continue;

        const updated = replaceBrand(text);
        if (updated === text) continue;

        fs.writeFileSync(filePath, Buffer.from(updated, 'utf8'));
        changedFiles += 1;
    }

    return changedFiles;
}

function renamePaths() {
    let renamedPaths = 0;
    const paths = collectPaths().sort((left, right) => {
        return right.split(path.sep).length - left.split(path.sep).length;
    });

    for (const currentPath of paths) {
        if (!fs.existsSync(currentPath)) continue;

        const currentName = path.basename(currentPath);
        const nextName = replaceBrand(currentName);
        if (nextName === currentName) continue;

        const nextPath = path.join(path.dirname(currentPath), nextName);
        if (fs.existsSync(nextPath)) {
            throw new Error(`Yeniden adlandırma çakışması: ${currentPath} -> ${nextPath}`);
        }

        fs.renameSync(currentPath, nextPath);
        renamedPaths += 1;
    }

    return renamedPaths;
}

function findLeftovers() {
    const leftovers = [];

    for (const itemPath of collectPaths()) {
        const relativePath = path.relative(projectRoot, itemPath);
        if (oldBrandPattern.test(relativePath)) {
            leftovers.push(`dosya yolu: ${relativePath}`);
        }

        if (!fs.statSync(itemPath).isFile()) continue;
        const text = readUtf8Text(itemPath);
        if (text !== null && oldBrandPattern.test(text)) {
            leftovers.push(`dosya içeriği: ${relativePath}`);
        }
    }

    return leftovers;
}

function runGit(args, options = {}) {
    const result = spawnSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: options.capture ? 'pipe' : 'inherit'
    });

    if (result.status !== 0) {
        const detail = options.capture
            ? (result.stderr || result.stdout || '').trim()
            : '';
        throw new Error(`git ${args.join(' ')} başarısız oldu${detail ? `: ${detail}` : '.'}`);
    }

    return options.capture ? String(result.stdout || '').trim() : '';
}

function commitAndPush() {
    const branch = runGit(['branch', '--show-current'], { capture: true });
    if (!branch || branch === 'main' || branch === 'master') {
        throw new Error('Otomatik commit ana dalda çalıştırılmaz. Önce refaktör dalına geç.');
    }

    runGit(['add', '-A']);

    const diff = spawnSync('git', ['diff', '--cached', '--quiet'], {
        cwd: projectRoot,
        stdio: 'ignore'
    });
    if (diff.status === 0) {
        console.log('Commit edilecek bir değişiklik bulunamadı.');
        return;
    }

    runGit(['commit', '-m', 'Rename all Kedi internals to Pisi']);
    runGit(['push', '-u', 'origin', branch]);
}

function main() {
    const checkOnly = process.argv.includes('--check');
    const shouldCommit = process.argv.includes('--commit');

    if (!checkOnly) {
        const changedFiles = replaceTextContents();
        const renamedPaths = renamePaths();
        console.log(`${changedFiles} metin dosyası güncellendi, ${renamedPaths} yol yeniden adlandırıldı.`);
    }

    const leftovers = findLeftovers();
    if (leftovers.length) {
        console.error('Dönüştürülmemiş adlar bulundu:');
        leftovers.forEach((item) => console.error(`- ${item}`));
        process.exitCode = 1;
        return;
    }

    console.log('Tüm kod, dosya yolu ve metin kaynakları Pisi adına dönüştürüldü.');

    if (shouldCommit) {
        commitAndPush();
    }
}

try {
    main();
} catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
}
