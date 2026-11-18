// The phone opens a note's file attachment only when the desktop would
// (docs/sync-plan.md S6 step 4): the executable kinds the desktop only shows in
// their folder are the same list on the phone (mobile/src/sync/attachments.mjs)
// and in the Android plugin's rules (OpenFile.java, checked by its JUnit test).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PISI_EXECUTABLE_FILE_EXTENSIONS as DESKTOP } from '../main/functions/editor-file-asset-store.js';
import { isPisiExecutableFileExtension } from '../renderer/editor/pisi-editor-file-policy.mjs';
import { PISI_EXECUTABLE_FILE_EXTENSIONS as PHONE, isExecutableFileName } from '../mobile/src/sync/attachments.mjs';

test('telefonun açmadığı dosya türleri masaüstünün yalnız klasörde gösterdikleriyle aynı', () => {
    assert.deepEqual([...PHONE].sort(), [...DESKTOP].sort());
    for (const ext of DESKTOP) {
        assert.equal(isPisiExecutableFileExtension(ext), true, ext);
        assert.equal(isExecutableFileName(`dosya.${ext.toUpperCase()}`), true, ext);
    }
    for (const name of ['Rapor.pdf', 'tablo.xlsx', 'ses.mp3', 'arşiv.zip', 'adsız']) assert.equal(isExecutableFileName(name), false, name);
});
