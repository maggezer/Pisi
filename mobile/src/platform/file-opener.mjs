// Opens a note's file attachment in the phone's default app (docs/sync-plan.md
// S6 step 4): the repo's own plugin (android/…/PisiFilesPlugin.java) copies the
// file under its block name to the cache and hands it over through the app's
// FileProvider. In a browser (vite dev, E2E) nothing opens: the requests are
// kept in `opened`, so tests can see them.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { PISI_PROJECT_ROOT } from './capacitor-fs-driver.mjs';

const PisiFiles = registerPlugin('PisiFiles');
const CODES = new Set(['NOT_FOUND', 'BLOCKED', 'NO_APP', 'OPEN_FAILED']);

/** `{ open({ key, name }) → { ok, code } }`; `key` is the attachment's project key. */
export function createFileOpener({ native = Capacitor.isNativePlatform() } = {}) {
    if (native) {
        return {
            async open({ key, name }) {
                try {
                    await PisiFiles.openFile({ path: `${PISI_PROJECT_ROOT}/${key}`, name: String(name || '') });
                    return { ok: true, code: null };
                } catch (error) {
                    return { ok: false, code: CODES.has(error?.code) ? error.code : 'OPEN_FAILED' };
                }
            }
        };
    }
    const opened = [];
    return {
        opened,
        async open({ key, name }) {
            opened.push({ key, name: String(name || '') });
            return { ok: true, code: null };
        }
    };
}
