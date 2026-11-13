'use strict';

// Loads the main-process storage chain (path security → file system → document,
// task, relationship, map and Trash stores) in plain Node, in the same order as
// main.mjs, so behavior tests can run real stores against a temporary project.
// Electron is stubbed; the few runtime.js constants these modules read are
// provided as globals. Not a test file itself (no .test. in the name).

const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const STORE_CHAIN = [
    'path-security',
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
    'source-of-truth',
    // normalizePathForCompare and the project-root helpers live here.
    'electron-ipc'
];

function defineRuntimeGlobal(name, value) {
    if (Object.hasOwn(globalThis, name)) return;
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

function loadPisiMainStores() {
    const { modules } = require('../main/module-registry.js');
    if (modules['main.trashStore']) return modules;

    defineRuntimeGlobal('recentInternalFileChanges', new Map());
    defineRuntimeGlobal('PISI_INTERNAL_CHANGE_TTL_MS', 6000);
    defineRuntimeGlobal('PISI_CONNECTION_KEYS', ['up-hub', 'down-hub', 'co-level', 'upstream', 'downstream']);
    defineRuntimeGlobal('PISI_DIARY_MANAGED_START', '<!--PISI_DIARY_MANAGED_START-->');
    defineRuntimeGlobal('PISI_DIARY_MANAGED_END', '<!--PISI_DIARY_MANAGED_END-->');
    defineRuntimeGlobal('projectWatchers', new Map());
    defineRuntimeGlobal('pendingProjectChangedPaths', new Set());
    // The path guard (assertProjectPath) reads the active project; tests assign it.
    defineRuntimeGlobal('activeProjectFolder', null);

    const electronStub = {
        app: {
            getPath: () => os.tmpdir(),
            getAppPath: () => repoRoot,
            getLocale: () => 'tr',
            getVersion: () => '0.0.0-test',
            isPackaged: false,
            on() {}
        },
        BrowserWindow: class BrowserWindow {
            static getAllWindows() {
                return [];
            }
        },
        dialog: {},
        ipcMain: { handle() {}, on() {}, removeHandler() {} },
        shell: {},
        net: {}
    };
    const originalLoad = Module._load;
    Module._load = function pisiTestElectronStub(request, parent, isMain) {
        if (request === 'electron') return electronStub;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const name of STORE_CHAIN) require(path.join(repoRoot, 'main', 'functions', `${name}.js`));
    } finally {
        Module._load = originalLoad;
    }
    return modules;
}

module.exports = { loadPisiMainStores };
