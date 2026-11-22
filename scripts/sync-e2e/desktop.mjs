// The desktop of scripts/sync-e2e-matrix.mjs: the real Pisi app in Electron, driven
// through the Chrome DevTools Protocol like the other scripts/electron-*-e2e.mjs.
// The sync client inside it talks to the fault proxy as a loopback server
// (PISI_SYNC_ALLOW_LOOPBACK_HTTP=1, unpackaged app only).

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { keepPagePromise } from '../e2e-cdp.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
        });
    });
}

class CdpClient {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
    }
    async open() {
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data));
            const pending = payload.id && this.pending.get(payload.id);
            if (!pending) return;
            this.pending.delete(payload.id);
            if (payload.error) pending.reject(new Error(payload.error.message));
            else pending.resolve(payload.result);
        });
    }
    request(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async evaluate(expression) {
        const response = await this.request('Runtime.evaluate', { expression: keepPagePromise(expression), awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'evaluate failed');
        return response.result?.value;
    }
    close() {
        this.socket.close();
    }
}

/** The caret, the text and the identity of the block elements of the open note. */
const EDITOR_PROBE = `(() => {
    const editor = document.getElementById('center-node-editor-content');
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    let caret = null;
    if (range && editor?.contains(range.startContainer)) {
        const block = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest('.pisi-editor-block');
        const prefix = document.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(range.startContainer, range.startOffset);
        caret = { blockId: block?.dataset.pisiBlockId || null, before: prefix.toString().length, collapsed: range.collapsed };
    }
    let scroller = editor;
    while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    return {
        centerPath: window.activeCenterNode?.path || null,
        tabs: (window.Pisi?.state?.openTabs || []).map((tab) => tab.path),
        activeTab: window.Pisi?.state?.activeTabPath || null,
        caret,
        scrollTop: scroller ? scroller.scrollTop : null,
        blocks: Array.from(editor?.children || []).map((block) => ({ id: block.dataset.pisiBlockId || null, mark: block.__pisiE2EMark || null, text: block.textContent })),
        loadCount: window.__pisiE2ELoadCount || 0
    };
})()`;

/**
 * Starts the app on `projectPath` with its own user data folder. `env` is added to the
 * app's environment (the matrix passes the time zone).
 */
export async function startDesktop({ projectPath, userDataPath, env = {} }) {
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2));
    const port = await freePort();
    const electronPath = /** @type {string} */ (require('electron'));
    const child = spawn(
        electronPath,
        ['--remote-debugging-port=' + port, ...CHROMIUM_FLAGS, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot],
        {
            cwd: repoRoot,
            env: { ...process.env, ...env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_SYNC_ALLOW_LOOPBACK_HTTP: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );
    let logs = '';
    const collect = (chunk) => {
        logs += String(chunk || '');
        if (logs.length > 200000) logs = logs.slice(-100000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    async function waitUntil(label, probe, timeoutMs = 30000) {
        const started = Date.now();
        let lastValue = null;
        while (Date.now() - started < timeoutMs) {
            if (child.exitCode !== null) throw new Error('Electron exited while waiting for ' + label + '.\n' + logs.slice(-4000));
            try {
                lastValue = await probe();
                if (lastValue) return lastValue;
            } catch (error) {
                lastValue = String(error?.message || error);
            }
            await sleep(150);
        }
        throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue));
    }

    const page = await waitUntil('Electron DevTools page', async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const pages = await response.json();
        return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
    });
    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');
    await waitUntil('project opened', () =>
        cdp.evaluate(`document.readyState === 'complete' && window.currentProjectFolder === ${JSON.stringify(projectPath)}`)
    );
    await cdp.evaluate(`(() => {
        window.__pisiE2ELoadCount = 0;
        document.addEventListener('pisi:project-loaded', () => { window.__pisiE2ELoadCount += 1; });
        return true;
    })()`);

    const evaluate = (expression) => cdp.evaluate(expression);
    const abs = (key) => path.join(projectPath, ...key.split('/'));
    const desktop = {
        projectPath,
        waitUntil,
        evaluate,
        insertText: (text) => cdp.request('Input.insertText', { text }),
        logs: () => logs,
        abs,
        read: (key) => fs.readFile(abs(key), 'utf8'),
        readJson: async (key) => JSON.parse(await fs.readFile(abs(key), 'utf8')),
        exists: (key) =>
            fs
                .access(abs(key))
                .then(() => true)
                .catch(() => false),
        /**
         * Every file of the project as `key → Buffer`, the paths the sync never sends left out by `filter`.
         * @param {(key: string) => boolean} [filter]
         */
        async files(filter = () => true) {
            const out = new Map();
            const walk = async (folder) => {
                for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
                    const full = path.join(folder, entry.name);
                    const key = path.relative(projectPath, full).split(path.sep).join('/');
                    if (entry.isDirectory()) await walk(full);
                    else if (filter(key)) out.set(key, await fs.readFile(full));
                }
            };
            await walk(projectPath);
            return out;
        },
        status: () => evaluate('window.pisiSyncClient.status()'),
        /** "Şimdi eşitle": one turn after any running one; resolves with the turn's result. */
        async sync() {
            await waitUntil('previous turn finished', async () => !(await evaluate('window.pisiSyncClient.status()'))?.running || null, 120000);
            return evaluate('window.pisiSyncClient.run("manual")');
        },
        async syncOk(label) {
            const result = await desktop.sync();
            assert(result?.ok, `${label}: masaüstü turu`, result);
            return result;
        },
        integrity: () => evaluate(`window.pisiDomain.query('integrity.audit.v1', { projectFolder: window.currentProjectFolder })`),
        loadCount: () => evaluate('window.__pisiE2ELoadCount || 0'),
        editorProbe: () => evaluate(EDITOR_PROBE),
        /** Settings → Senkron in a container of its own, kept in the page for later steps. */
        async openSettings() {
            return evaluate(`(async () => {
                let container = document.getElementById('pisi-e2e-settings');
                if (container) container.remove();
                container = document.createElement('div');
                container.id = 'pisi-e2e-settings';
                document.body.append(container);
                document.dispatchEvent(new CustomEvent('pisi:render-settings-sections', { detail: { container } }));
                return true;
            })()`);
        },
        async createSpace(serverUrl, setupKey) {
            await desktop.openSettings();
            const created = await waitUntil('create form', () =>
                evaluate(`(() => {
                    const form = document.querySelector('#pisi-e2e-settings [data-pisi-sync-form="create"]');
                    if (!form) return null;
                    form.querySelector('[data-pisi-sync-field="serverUrl"]').value = ${JSON.stringify(serverUrl)};
                    form.querySelector('[data-pisi-sync-field="setupKey"]').value = ${JSON.stringify(setupKey)};
                    form.querySelector('[data-pisi-sync-action="create"]').click();
                    return true;
                })()`)
            );
            assert(created, 'Alan açma formu');
            return waitUntil(
                'first upload',
                async () => {
                    const status = await desktop.status();
                    return status?.configured && status.lastRun?.ok && !status.running ? status : null;
                },
                120000
            );
        },
        async openNote(key) {
            const fullPath = abs(key);
            const name = path.basename(fullPath);
            const opened = await evaluate(`(async () => {
                await openPisiFileTab({ fullPath: ${JSON.stringify(fullPath)}, name: ${JSON.stringify(name)}, fileName: ${JSON.stringify(name)}, isFile: true, type: 'file' });
                return window.activeCenterNode?.path || null;
            })()`);
            assert(opened === fullPath, 'Not açılmalı', { key, opened });
            await waitUntil('editor content', () => evaluate(`document.getElementById('center-node-editor-content')?.children.length > 0`));
        },
        /** Puts the caret in block `blockId` of the open note, at `offset` (or its end), and types `text`. */
        async typeInBlock(blockId, text, offset = null) {
            const placed = await evaluate(`(() => {
                const editor = document.getElementById('center-node-editor-content');
                const block = editor?.querySelector('[data-pisi-block-id="${blockId}"]');
                if (!block) return false;
                editor.focus();
                const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
                let node = walker.nextNode();
                let last = node;
                const range = document.createRange();
                if (${offset === null ? 'true' : 'false'}) {
                    while (node) { last = node; node = walker.nextNode(); }
                    if (last) range.setStart(last, last.length); else range.setStart(block, block.childNodes.length);
                } else {
                    range.setStart(node, Math.min(${Number(offset)}, node.length));
                }
                range.collapse(true);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                return true;
            })()`);
            assert(placed, 'İmleç bloğa konamadı', blockId);
            await cdp.request('Input.insertText', { text });
        },
        /** Types `text` at the very end of the open note. */
        async typeAtEditorEnd(text) {
            await evaluate(`(() => {
                const editor = document.getElementById('center-node-editor-content');
                editor.focus();
                // The last block the user can write in: a diary's last block is its task section
                // (contenteditable=false, generated from tasks.json; docs/task-plan.md G3), which
                // never takes typed text.
                const blocks = [...editor.children].filter((block) => block.getAttribute('contenteditable') !== 'false');
                const range = document.createRange();
                range.selectNodeContents(blocks.at(-1) || editor);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                return true;
            })()`);
            await cdp.request('Input.insertText', { text });
        },
        /** Pastes a generated PNG at the end of the open note, as a screenshot from the clipboard would be. */
        pasteImage: () =>
            evaluate(`(async () => {
                const editor = document.getElementById('center-node-editor-content');
                editor.focus();
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
                const canvas = document.createElement('canvas');
                canvas.width = 96;
                canvas.height = 64;
                const context = canvas.getContext('2d');
                context.fillStyle = '#e89b42';
                context.fillRect(0, 0, 96, 64);
                context.fillStyle = '#1e88e5';
                context.fillRect(12, 12, 40, 30);
                const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                const data = new DataTransfer();
                data.items.add(new File([blob], 'ekran.png', { type: 'image/png' }));
                const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
                editor.dispatchEvent(event);
                return event.defaultPrevented;
            })()`),
        flush: () => evaluate('window.flushPisiPendingSaves()'),
        async stop() {
            cdp.close();
            if (child.exitCode === null) {
                child.kill('SIGTERM');
                await sleep(500);
                if (child.exitCode === null) child.kill('SIGKILL');
            }
        }
    };
    return desktop;
}
