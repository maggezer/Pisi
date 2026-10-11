import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const require = createRequire(import.meta.url);
const { hydratePisiEditorAssets } = require('../main/functions/editor-asset-store.js');

import { getUnresolvedPisiEditorAssets, getPisiEditorAssetRecoveryWarning } from '../renderer/editor/pisi-editor-asset-recovery.mjs';

const paint = 'paint/' + 'a'.repeat(64) + '.png';
const sheet = 'sheet/' + 'b'.repeat(64) + '.json';
const canvas = (extra = '') => '<canvas data-pisi-canvas="true" data-pisi-asset="' + paint + '"' + extra + '></canvas>';
const table = (extra = '') => '<table data-pisi-sheet="true" data-pisi-sheet-asset="' + sheet + '"' + extra + '></table>';

test('missing Paint and Sheet assets are reported without changing references', () => {
    const content = canvas() + table();
    assert.deepEqual(getUnresolvedPisiEditorAssets(content), [paint, sheet]);
    const warning = getPisiEditorAssetRecoveryWarning(content);
    assert.match(warning, /kaydedilmeyecek/);
    assert.ok(warning.includes(paint));
    assert.ok(warning.includes(sheet));
    assert.equal(content, canvas() + table());
});

test('hydrated assets do not generate warnings', () => {
    const content = canvas(' data-image="data:image/png;base64,AAAA"') + table(' data-pisi-sheet-model="{}"');
    assert.deepEqual(getUnresolvedPisiEditorAssets(content), []);
    assert.equal(getPisiEditorAssetRecoveryWarning(content), '');
});

test('missing assets are de-duplicated and unrelated tags are ignored', () => {
    const unrelated = '<canvas data-pisi-asset="' + paint + '"></canvas><table data-pisi-sheet-asset="' + sheet + '"></table>';
    assert.deepEqual(getUnresolvedPisiEditorAssets(canvas() + canvas() + unrelated), [paint]);
});

test('missing sheet remains detectable when other canvas data is hydrated', () => {
    assert.deepEqual(getUnresolvedPisiEditorAssets(canvas(' data-image="data:image/png;base64,AAAA"') + table()), [sheet]);
});

test('missing sidecar files preserve their references and trigger recovery warning', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sidecar-recovery-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const stored = canvas() + table();
    const hydrated = hydratePisiEditorAssets(stored, { sidecarPath: root });
    assert.equal(hydrated, stored);
    assert.deepEqual(getUnresolvedPisiEditorAssets(hydrated), [paint, sheet]);
});

test('corrupted sidecar hashes preserve references and trigger recovery warning', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sidecar-corrupt-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'paint'));
    fs.mkdirSync(path.join(root, 'sheet'));
    fs.writeFileSync(path.join(root, paint), 'not a valid PNG');
    fs.writeFileSync(path.join(root, sheet), '{"databaseId":"invalid"}');
    const stored = canvas() + table();
    const hydrated = hydratePisiEditorAssets(stored, { sidecarPath: root });
    assert.equal(hydrated, stored);
    assert.ok(getPisiEditorAssetRecoveryWarning(hydrated));
});
