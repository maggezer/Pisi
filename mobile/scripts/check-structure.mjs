// Structure rules for mobile/src (docs/mobile-plan.md §3.2):
// - .mjs/.js files stay at or under 600 lines, CSS files at or under 800;
// - only src/platform talks to Capacitor, so the rest runs in tests and in a browser;
// - colours and the font family are defined once, in src/ui/tokens.css (M3, G9):
//   other stylesheets use the tokens, so the contrast test covers every colour.

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
        if (entry.name.endsWith('.css') && relative !== 'src/ui/tokens.css') {
            const rules = source.replace(/\/\*[\s\S]*?\*\//g, '');
            if (/#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/i.test(rules)) errors.push(`${relative} contains a literal colour; use a token from src/ui/tokens.css.`);
            if (/font-family:(?!\s*var\(--pisi-font\))/.test(rules)) errors.push(`${relative} sets its own font family; the app has one, --pisi-font.`);
        }
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
