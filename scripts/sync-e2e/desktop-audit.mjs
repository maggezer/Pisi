// The desktop's own Project Integrity audit, run in Node on any folder (the phone's
// copy of the project in scripts/sync-e2e-matrix.mjs). The desktop main modules are
// loaded for real, in the order main.mjs loads them; only Electron itself is stubbed.
// Same loader as tests/sync-initial-transfer.test.mjs.

import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let audit = null;
// `Module._load` is internal: typed loosely, as in the tests that stub Electron the same way.
const Loader = /** @type {any} */ (Module);

function load() {
    const originalLoad = Loader._load;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-matrix-audit-'));
    process.on('exit', () => fs.rmSync(userData, { recursive: true, force: true }));
    const quiet = () => new Proxy(function () {}, { get: (_target, name) => (name === 'then' ? undefined : quiet()), apply: () => undefined });
    const electronStub = {
        app: new Proxy(
            {},
            {
                get(_target, name) {
                    if (name === 'isPackaged') return false;
                    if (name === 'getPath' || name === 'getAppPath') return () => userData;
                    if (name === 'getName') return () => 'Pisi';
                    if (name === 'getVersion') return () => '0.0.0';
                    if (name === 'getLocale') return () => 'tr';
                    if (name === 'whenReady') return () => new Promise(() => {});
                    return quiet();
                }
            }
        ),
        BrowserWindow: class BrowserWindow {
            static getAllWindows() {
                return [];
            }
        },
        ipcMain: quiet(),
        Menu: quiet(),
        nativeImage: quiet(),
        dialog: quiet(),
        shell: quiet(),
        net: { fetch: async () => ({ ok: false, status: 500 }) }
    };
    Loader._load = function pisiMatrixElectronStub(request, parent, isMain) {
        if (request === 'electron') return electronStub;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const name of [
            'path-security',
            'logger',
            'i18n',
            'filesystem-core',
            'storage',
            'atomic-mutation',
            'atomic-recovery-hardening',
            'document-store',
            'map-store',
            'project-operations',
            'relationship-store',
            'map-semantic-core',
            'map-operational-store',
            'task-capture',
            'task-store',
            'trash-store',
            'task-reference-integrity',
            'source-of-truth',
            'structured-nodes',
            'property-schema-store',
            'property-schema-mutations',
            'project-integrity'
        ]) {
            require(`../../main/functions/${name}.js`);
        }
        require('../../main/runtime.js');
    } finally {
        Loader._load = originalLoad;
    }
    const { modules } = require('../../main/module-registry.js');
    return modules['main.projectIntegrity'].auditPisiProjectIntegrity;
}

/** `{ issues }` of the desktop's Project Integrity audit of `folder`. */
export function auditProjectFolder(folder) {
    audit ??= load();
    return audit(folder);
}
