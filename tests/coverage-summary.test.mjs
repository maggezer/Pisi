import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { formatPisiCoverageSummary, getPisiCoverageGroup, parsePisiLcov } from '../scripts/coverage-summary.mjs';

const root = path.resolve('/repo');
const lcov = [
    `SF:${path.join(root, 'main', 'functions', 'a.js')}`,
    'FNF:4',
    'FNH:2',
    'BRF:10',
    'BRH:5',
    'LF:100',
    'LH:50',
    'end_of_record',
    `SF:${path.join(root, 'renderer', 'editor', 'b.mjs')}`,
    'FNF:1',
    'FNH:1',
    'LF:40',
    'LH:40',
    'end_of_record'
].join('\r\n');

test('lcov dosyası satır, dal ve fonksiyon sayılarıyla okunur; CRLF ve mutlak yollar da çalışır', () => {
    const files = parsePisiLcov(lcov, root);
    assert.deepEqual(
        files.map((file) => file.file),
        ['main/functions/a.js', 'renderer/editor/b.mjs']
    );
    assert.deepEqual(files[0], { file: 'main/functions/a.js', lines: [50, 100], branches: [5, 10], functions: [2, 4] });
    assert.deepEqual(files[1].branches, [0, 0]);
});

test('kapsam özeti klasöre göre gruplanır ve toplamı yazar', () => {
    assert.equal(getPisiCoverageGroup('main/functions/a.js'), 'main/functions');
    assert.equal(getPisiCoverageGroup('preload.js'), '.');
    const summary = formatPisiCoverageSummary(parsePisiLcov(lcov, root));
    assert.match(summary, /Satır: \*\*64\.3% \(90\/140\)\*\*/);
    assert.match(summary, /\| main\/functions \| 1 \| 50\.0% \(50\/100\) \|/);
    assert.match(summary, /\| renderer\/editor \| 1 \| 100\.0% \(40\/40\) \| 100\.0% \(0\/0\) \|/);
    assert.match(summary, /main\/functions\/a\.js \| 50\.0%/);
    assert.match(summary, /Eşik yoktur/);
});
