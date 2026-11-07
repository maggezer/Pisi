import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listPisiElectronE2eScripts } from '../scripts/run-electron-e2e.mjs';

test('E2E çalıştırıcısı test:e2e zincirindeki betikleri sırasıyla ve eksiksiz bulur', () => {
    assert.deepEqual(listPisiElectronE2eScripts({ scripts: { 'test:e2e': 'node scripts/a-e2e.mjs && node scripts/b.e2e.mjs' } }), [
        'scripts/a-e2e.mjs',
        'scripts/b.e2e.mjs'
    ]);
    assert.deepEqual(listPisiElectronE2eScripts({}), []);
    const scripts = listPisiElectronE2eScripts(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
    assert.ok(scripts.includes('scripts/electron-sync-reload-e2e.mjs'), 'the pending-save reload scenario runs on every OS');
    for (const script of scripts) assert.ok(fs.existsSync(new URL(`../${script}`, import.meta.url)), script);
});
