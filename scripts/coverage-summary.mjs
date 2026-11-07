#!/usr/bin/env node
// Turns an lcov file (from `npm run test:coverage`) into a short Markdown
// summary: totals and one row per source folder. Report only, no threshold.
// Usage: node scripts/coverage-summary.mjs [coverage/lcov.info] [--out coverage/summary.md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ratio = (hit, found) => (found ? (100 * hit) / found : 100);
const percent = (hit, found) => `${ratio(hit, found).toFixed(1)}% (${hit}/${found})`;

/** Parses lcov text into per-file line/branch/function counts. */
export function parsePisiLcov(text, root = '') {
    const files = [];
    let current = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith('SF:')) {
            let file = line.slice(3);
            if (root && path.isAbsolute(file)) file = path.relative(root, file);
            current = { file: file.split(path.sep).join('/'), lines: [0, 0], branches: [0, 0], functions: [0, 0] };
            continue;
        }
        if (!current) continue;
        const [key, value] = line.split(':');
        const count = Number(value) || 0;
        if (key === 'LF') current.lines[1] = count;
        else if (key === 'LH') current.lines[0] = count;
        else if (key === 'BRF') current.branches[1] = count;
        else if (key === 'BRH') current.branches[0] = count;
        else if (key === 'FNF') current.functions[1] = count;
        else if (key === 'FNH') current.functions[0] = count;
        else if (line === 'end_of_record') {
            files.push(current);
            current = null;
        }
    }
    return files;
}

function add(target, file) {
    for (const key of ['lines', 'branches', 'functions']) {
        target[key][0] += file[key][0];
        target[key][1] += file[key][1];
    }
    target.files += 1;
}

/** The folder a file is reported under: the first two path segments ("main/functions", "renderer/editor"). */
export function getPisiCoverageGroup(file) {
    const parts = String(file).split('/');
    return parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length === 2 ? parts[0] : '.';
}

/** Markdown summary of parsed lcov files. */
export function formatPisiCoverageSummary(files, options = {}) {
    const empty = () => ({ files: 0, lines: [0, 0], branches: [0, 0], functions: [0, 0] });
    const total = empty();
    const groups = new Map();
    for (const file of files) {
        add(total, file);
        const name = getPisiCoverageGroup(file.file);
        if (!groups.has(name)) groups.set(name, empty());
        add(groups.get(name), file);
    }
    const row = (name, item) => `| ${name} | ${item.files} | ${percent(...item.lines)} | ${percent(...item.branches)} | ${percent(...item.functions)} |`;
    const lowest = files
        .filter((file) => file.lines[1] >= 20)
        .sort((a, b) => ratio(...a.lines) - ratio(...b.lines))
        .slice(0, Number(options.lowest ?? 10));
    return [
        `## ${options.title || 'Test kapsamı (yalnız rapor)'}`,
        '',
        `Satır: **${percent(...total.lines)}** · Dal: **${percent(...total.branches)}** · Fonksiyon: **${percent(...total.functions)}** · ${total.files} dosya`,
        '',
        '| Klasör | Dosya | Satır | Dal | Fonksiyon |',
        '| --- | ---: | ---: | ---: | ---: |',
        ...[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => row(name, item)),
        '',
        ...(lowest.length ? ['<details><summary>En düşük satır kapsamlı dosyalar</summary>', '', '| Dosya | Satır |', '| --- | ---: |'] : []),
        ...lowest.map((file) => `| ${file.file} | ${percent(...file.lines)} |`),
        ...(lowest.length ? ['', '</details>'] : []),
        '',
        'Yalnız birim testleri (`npm run test:coverage`) ölçülür; Electron E2E kapsamı dahil değildir. Eşik yoktur.',
        ''
    ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : '';
    const input = args[0] || 'coverage/lcov.info';
    const summary = formatPisiCoverageSummary(parsePisiLcov(fs.readFileSync(input, 'utf8'), process.cwd()));
    if (out) fs.writeFileSync(out, summary, 'utf8');
    process.stdout.write(summary);
}
