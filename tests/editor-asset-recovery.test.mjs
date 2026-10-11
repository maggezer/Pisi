import test from 'node:test';
import assert from 'node:assert/strict';
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
