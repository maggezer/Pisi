#!/usr/bin/env node
// Runs the Electron E2E scripts listed in package.json "test:e2e" one after
// another. Unlike the npm chain it does not stop at the first failure: every
// script runs, a summary is printed (and appended to GITHUB_STEP_SUMMARY in CI),
// and the exit code is 1 if any script failed. Used for the Windows/macOS legs.
// Usage: node scripts/run-electron-e2e.mjs [name-filter ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The script paths of the "test:e2e" chain, in order. */
export function listPisiElectronE2eScripts(packageJson) {
    return String(packageJson?.scripts?.['test:e2e'] || '').match(/scripts\/[\w.-]+\.mjs/g) || [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const filters = process.argv.slice(2);
    const scripts = listPisiElectronE2eScripts(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))).filter(
        (script) => !filters.length || filters.some((filter) => script.includes(filter))
    );
    const results = [];
    for (const script of scripts) {
        const started = Date.now();
        console.log(`\n::group::${script}`);
        const run = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit', env: process.env });
        console.log('::endgroup::');
        const ok = run.status === 0;
        results.push({ script, ok, seconds: ((Date.now() - started) / 1000).toFixed(1), status: run.status ?? run.signal });
        console.log(`${ok ? 'PASS' : 'FAIL'} ${script} (${results.at(-1).seconds} s)`);
    }
    const failed = results.filter((result) => !result.ok);
    const summary = [
        `## Electron E2E (${process.platform})`,
        '',
        '| Betik | Sonuç | Süre |',
        '| --- | --- | ---: |',
        ...results.map((result) => `| ${result.script} | ${result.ok ? '✅' : `❌ (${result.status})`} | ${result.seconds} s |`),
        '',
        failed.length ? `${failed.length} / ${results.length} betik başarısız.` : `${results.length} betiğin hepsi geçti.`,
        ''
    ].join('\n');
    console.log('\n' + summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    process.exit(failed.length ? 1 : 0);
}
