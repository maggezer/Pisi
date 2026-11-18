// The attachments of a note on the phone (docs/sync-plan.md S6 step 4): an
// image is shown from the note's sidecar folder; one the phone does not hold
// yet comes down through sync when its block becomes visible; a file block
// downloads its file when tapped and opens it in another app. A downloaded
// attachment is a project file and stays. Without sync (or when the server has
// no such file) the block says the attachment is missing.
//
// `createAttachments({ project, sync, opener })` gives the note screen:
//   status(key)          'local' | 'remote' | 'missing'
//   fetch(key)           download; `{ ok, code }` (OFFLINE while there is no connection)
//   open(key, name)      download when needed, then open; `{ ok, code }` (BLOCKED for executables)
//   onReconnect(listener) a turn went well again: waiting images try once more

// Opening any of these would run code; the desktop only shows them in their folder
// (mirrors main/functions/editor-file-asset-store.js, checked by tests/mobile-attachment-policy.test.mjs).
export const PISI_EXECUTABLE_FILE_EXTENSIONS = new Set(
    (
        'exe msi msix msp appx appxbundle bat cmd com scr pif cpl ps1 psm1 vbs vbe js jse mjs cjs wsf wsh hta jar ' +
        'app command tool sh bash zsh csh fish ksh run bin desktop appimage deb rpm dmg pkg mpkg lnk url reg inf scf gadget ' +
        'py pyw pl rb php apk xpi'
    ).split(' ')
);

/** True when a file of this name is never opened on the phone. */
export function isExecutableFileName(name) {
    const text = String(name || '');
    const dot = text.lastIndexOf('.');
    return dot > 0 && PISI_EXECUTABLE_FILE_EXTENSIONS.has(text.slice(dot + 1).toLowerCase());
}

export function createAttachments({ project, sync = null, opener = null }) {
    const { driver } = project;

    async function status(key) {
        if (!key) return 'missing';
        if (await driver.exists(key)) return 'local';
        return sync && (await sync.hasRemoteAttachment(key)) ? 'remote' : 'missing';
    }

    async function fetch(key) {
        if (!key) return { ok: false, code: 'NOT_FOUND' };
        if (await driver.exists(key)) return { ok: true, code: null };
        if (!sync) return { ok: false, code: 'NOT_FOUND' };
        return sync.fetchAttachment(key);
    }

    return {
        status,
        fetch,
        async open(key, name) {
            if (!opener) return { ok: false, code: 'OPEN_FAILED' };
            if (isExecutableFileName(name) || isExecutableFileName(key)) return { ok: false, code: 'BLOCKED' };
            const fetched = await fetch(key);
            if (!fetched.ok) return fetched;
            return opener.open({ key, name });
        },
        onReconnect(listener) {
            if (!sync) return () => {};
            let last = sync.getStatus();
            return sync.subscribe((event) => {
                if (event.type !== 'status') return;
                const now = sync.getStatus();
                if (last.running && !now.running && now.state === 'idle') listener();
                last = now;
            });
        }
    };
}
