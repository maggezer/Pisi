// Every user-visible text lives in locales/tr.json and locales/eng.json.
// This check fails when the two files' keys differ, a text is empty, the code
// asks for a key that does not exist, or a key is no longer used.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const catalogs = { tr: readJson('locales/tr.json'), eng: readJson('locales/eng.json') };
const errors = [];

const keys = { tr: Object.keys(catalogs.tr), eng: Object.keys(catalogs.eng) };
for (const key of keys.tr) if (!(key in catalogs.eng)) errors.push(`eng.json is missing "${key}"`);
for (const key of keys.eng) if (!(key in catalogs.tr)) errors.push(`tr.json is missing "${key}"`);
if (!errors.length && keys.tr.join('\n') !== keys.eng.join('\n')) errors.push('tr.json and eng.json list their keys in a different order');
for (const [language, catalog] of Object.entries(catalogs)) {
    for (const [key, text] of Object.entries(catalog)) {
        if (typeof text !== 'string' || !text.trim()) errors.push(`${language}.json has no text for "${key}"`);
    }
}

function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(full) : entry.name.endsWith('.mjs') ? [full] : [];
    });
}

// Keys are written as t('a.b') or built as t(`prefix.${value}`).
const used = new Set();
const prefixes = new Set();
for (const file of sourceFiles(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(match[1]);
    for (const match of source.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)) prefixes.add(match[1]);
}
for (const key of used) if (!(key in catalogs.tr)) errors.push(`code uses "${key}", which is not in the catalogs`);
for (const prefix of prefixes)
    if (!keys.tr.some((key) => key.startsWith(prefix))) errors.push(`code builds keys from "${prefix}", but no catalog key starts with it`);
for (const key of keys.tr) {
    if (!used.has(key) && ![...prefixes].some((prefix) => key.startsWith(prefix))) errors.push(`"${key}" is in the catalogs but no code uses it`);
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`i18n: ${keys.tr.length} keys match in tr.json and eng.json.`);
