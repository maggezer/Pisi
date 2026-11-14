// Structure rules for mobile/src (docs/mobile-plan.md §3.2):
// - .mjs/.js files stay at or under 600 lines, CSS files at or under 800;
// - only src/platform talks to Capacitor, so the rest runs in tests and in a browser.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const errors = [];
let count = 0;

function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            walk(full);
            continue;
        }
        const relative = path.relative(root, full).split(path.sep).join('/');
        const limit = /\.(mjs|js)$/.test(entry.name) ? 600 : entry.name.endsWith('.css') ? 800 : 0;
        if (!limit) continue;
        count += 1;
        const source = fs.readFileSync(full, 'utf8');
        const lines = source.split(/\r?\n/).length;
        if (lines > limit) errors.push(`${relative} has ${lines} lines; the limit is ${limit}. Split it.`);
        if (/\.(mjs|js)$/.test(entry.name) && !relative.startsWith('src/platform/') && /from\s+['"]@capacitor\/|import\(\s*['"]@capacitor\//.test(source)) {
            errors.push(`${relative} imports @capacitor/*; only src/platform may do that.`);
        }
    }
}

walk(path.join(root, 'src'));
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`structure: ${count} source files within limits; Capacitor is used only in src/platform.`);
