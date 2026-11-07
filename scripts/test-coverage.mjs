#!/usr/bin/env node
// npm run test:coverage — runs the unit tests with Node's built-in coverage and
// writes coverage/lcov.info and coverage/summary.md. Report only: the exit code
// is the test result, never a coverage threshold.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatPisiCoverageSummary, parsePisiLcov } from './coverage-summary.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'coverage');
fs.mkdirSync(outDir, { recursive: true });
const lcov = path.join(outDir, 'lcov.info');

const run = spawnSync(
    process.execPath,
    [
        '--test',
        '--experimental-test-coverage',
        '--test-coverage-exclude=tests/**',
        '--test-coverage-exclude=node_modules/**',
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        '--test-reporter=lcov',
        `--test-reporter-destination=${lcov}`
    ],
    { cwd: root, stdio: 'inherit' }
);

if (fs.existsSync(lcov)) {
    const summary = formatPisiCoverageSummary(parsePisiLcov(fs.readFileSync(lcov, 'utf8'), root));
    fs.writeFileSync(path.join(outDir, 'summary.md'), summary, 'utf8');
    process.stdout.write('\n' + summary);
}
process.exit(run.status ?? 1);
