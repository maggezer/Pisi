import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Inventory of tests that read repository source and assert on its text
// (docs/test-strategy.md). For each test file: whether it reads source, which
// helpers it uses, how many regex assertions it makes on source and its test
// titles. `--json` prints JSON; the default is a Markdown table.

const root = path.resolve(import.meta.dirname, '..');
const SOURCE_PATH =
    /['"`](?:\.\.\/)?(?:main|renderer|styles|locales|scripts|\.github|docs)\/[^'"`]+['"`]|['"`](?:\.\.\/)?(?:preload\.js|index\.html|style\.css|main\.mjs|package\.json)['"`]/;
const HELPERS = ['readMainSource', 'readRendererSource', 'readCssSection', 'extractFunction', 'readRendererBundle', 'readMainBundle'];

export function inventoryPisiSourceTests(directory = path.join(root, 'tests')) {
    const rows = [];
    for (const name of fs.readdirSync(directory).sort()) {
        if (!/\.test\.(?:m?js)$/.test(name)) continue;
        const text = fs.readFileSync(path.join(directory, name), 'utf8');
        const helpers = HELPERS.filter((helper) => text.includes(helper));
        // Source paths outside import/require lines: files the test reads as text.
        // A read call whose argument names a repository source file (not an import).
        const readLines = text.split('\n').filter((line) => /(?:readFileSync|\bread\w*)\(/.test(line) && !/^\s*import\b|\brequire\(|\bimport\(/.test(line));
        const readsSource = helpers.length > 0 || readLines.some((line) => SOURCE_PATH.test(line));
        if (!readsSource) continue;
        const regexAsserts = (text.match(/assert\.(?:match|doesNotMatch)\(/g) || []).length;
        const includesAsserts = (text.match(/\.includes\(['"`]/g) || []).length;
        const tests = [...text.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) => match[2]);
        const importsModules = /from ['"]\.\.\/(?:main|renderer)\/|require\(['"]\.\.\/main\//.test(text);
        rows.push({ file: name, helpers, regexAsserts, includesAsserts, tests, importsModules });
    }
    return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const rows = inventoryPisiSourceTests();
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(rows, null, 2));
    } else {
        console.log('| Dosya | Yardımcılar | Regex | Test sayısı | Modül de import ediyor |');
        console.log('| --- | --- | ---: | ---: | --- |');
        for (const row of rows)
            console.log(
                `| ${row.file} | ${row.helpers.join(', ') || '—'} | ${row.regexAsserts} | ${row.tests.length} | ${row.importsModules ? 'evet' : 'hayır'} |`
            );
        console.error(`${rows.length} test files read source.`);
    }
}
