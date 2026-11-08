import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A background or occluded test window must still run timers, animation frames and
// layout at full speed (Windows CI runners keep the window behind other desktops).
const PISI_E2E_CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

// Find and replace in a note end to end: Mod+F counts matches (also one split
// across formatting, not inside a [[link]]), Turkish case rules, Enter steps,
// Esc keeps the match selected, whole word, Mod+H → Replace all writes the note
// to disk with ids and the link intact and no find markers, Mod+Z restores it
// in one step, and Mod+F inside a Sheet cell goes to the Sheet search.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9238;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-find-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child = null;
let logs = '';

function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

async function waitUntil(label, probe, timeoutMs = 15000) {
    const started = Date.now();
    let lastValue = null;
    while (Date.now() - started < timeoutMs) {
        if (child?.exitCode !== null) throw new Error('Electron exited while waiting for ' + label + '.\n' + logs);
        try {
            lastValue = await probe();
            if (lastValue) return lastValue;
        } catch (error) {
            lastValue = String(error?.message || error);
        }
        await sleep(120);
    }
    throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue) + '\n' + logs);
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
            const pending = payload.id ? this.pending.get(payload.id) : null;
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
        const response = await this.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed');
        }
        return response.result?.value;
    }

    close() {
        this.socket.close();
    }
}

async function launch() {
    const args = [
        '--remote-debugging-port=' + port,
        ...PISI_E2E_CHROMIUM_FLAGS,
        ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
        repoRoot
    ];
    child = spawn(electronPath, args, {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const collect = (chunk) => {
        const text = String(chunk || '');
        logs += text;
        process.stdout.write(text);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const page = await waitUntil('Electron DevTools page', async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const pages = response.ok ? await response.json() : [];
        return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
    });
    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');
    await waitUntil('project restored', () =>
        cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(projectPath))
    );
    return cdp;
}

async function stop(cdp) {
    cdp?.close();
    if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await waitUntil('Electron exit', async () => child.exitCode !== null, 8000).catch(() => child.kill('SIGKILL'));
    }
}

async function createNode(cdp) {
    const before = new Set(await fs.readdir(projectPath));
    assert(await cdp.evaluate("(() => { const b = document.getElementById('add-node-btn'); b?.click(); return Boolean(b); })()"), 'Add Node button is missing');
    const nodePath = await waitUntil('new node file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.node') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    await waitForTreeItem(cdp, nodePath);
    return nodePath;
}

async function waitForTreeItem(cdp, nodePath) {
    await waitUntil('tree item ' + nodePath, () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === " + JSON.stringify(nodePath) + ')')
    );
}

async function openNode(cdp, nodePath) {
    const serialized = JSON.stringify(nodePath);
    await cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            serialized +
            "); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()"
    );
    await waitUntil('editor for ' + nodePath, () =>
        cdp.evaluate('window.activeCenterNode?.path === ' + serialized + " && document.getElementById('center-node-editor')?.hidden === false")
    );
}

const content =
    '<div class="pisi-editor-block" data-pisi-block-id="blk_find_a" data-pisi-block-type="paragraph">Rapor hazır. <strong>Ra</strong>por tamam.</div>' +
    '<div class="pisi-editor-block" data-pisi-block-id="blk_find_b" data-pisi-block-type="paragraph">İSTANBUL raporu ve <a class="pisi-wiki-link" data-pisi-node-id="node_findlink1" data-pisi-node-title="Rapor" contenteditable="false">Rapor</a></div>';

const findState = `(() => {
    const bar = document.querySelector('.pisi-find-bar');
    return {
        open: Boolean(bar && !bar.hidden),
        counter: bar?.querySelector('[data-pisi-find-counter]')?.textContent || '',
        focus: document.activeElement?.dataset?.pisiFindInput !== undefined ? 'find' : document.activeElement?.dataset?.pisiFindReplaceInput !== undefined ? 'replace' : document.activeElement?.id || document.activeElement?.tagName,
        text: document.getElementById('center-node-editor-content').innerText,
        selection: String(window.getSelection())
    };
})()`;

async function key(cdp, keyName, code, keyCode, modifiers = 0) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}

async function setQuery(cdp, text) {
    await cdp.evaluate("(() => { const input = document.querySelector('[data-pisi-find-input]'); input.focus(); input.select(); })()");
    await cdp.request('Input.insertText', { text });
}

async function readNode(nodePath) {
    return JSON.parse(await fs.readFile(nodePath, 'utf8'));
}

const CTRL = 2;
const SHIFT = 8;

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("(localStorage.setItem('pisi.tutorial.v1.completed', '1'), window.finishPisiTutorial?.(true))");
    const nodePath = await createNode(cdp);
    await openNode(cdp, nodePath);
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, ${JSON.stringify(content)});
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
        window.resetPisiEditorHistory?.(editor);
        editor.focus();
    })()`);
    await waitUntil('content saved', async () => (await readNode(nodePath)).content?.includes('blk_find_b'));

    // 1. Mod+F opens the bar; matches include the split one, not the [[link]].
    await key(cdp, 'f', 'KeyF', 70, CTRL);
    await waitUntil('find bar open', () => cdp.evaluate(findState).then((state) => state.open && state.focus === 'find'));
    await setQuery(cdp, 'rapor');
    const counted = await waitUntil('three matches', () => cdp.evaluate(findState).then((state) => (state.counter === '1/3' ? state : null)));
    assert(counted, 'Rapor, <strong>Ra</strong>por and raporu match; the link does not');
    assert(
        await cdp.evaluate("CSS.highlights.has('pisi-find-match') && CSS.highlights.get('pisi-find-match').size === 3"),
        'Matches are painted as highlights'
    );
    await key(cdp, 'Enter', 'Enter', 13);
    await waitUntil('second match', () => cdp.evaluate(findState).then((state) => state.counter === '2/3'));
    await key(cdp, 'Enter', 'Enter', 13, SHIFT);
    await waitUntil('back to first', () => cdp.evaluate(findState).then((state) => state.counter === '1/3'));

    // Turkish case rules and whole word.
    await setQuery(cdp, 'istanbul');
    await waitUntil('İSTANBUL found', () => cdp.evaluate(findState).then((state) => state.counter === '1/1'));
    await setQuery(cdp, 'rapor');
    await cdp.evaluate(`document.querySelector('[data-pisi-find-action="word"]').click()`);
    await waitUntil('whole word drops raporu', () => cdp.evaluate(findState).then((state) => state.counter === '1/2'));
    await cdp.evaluate(`document.querySelector('[data-pisi-find-action="word"]').click()`);
    await waitUntil('three again', () => cdp.evaluate(findState).then((state) => state.counter === '1/3'));

    // 2. Esc closes the bar and leaves the current match selected.
    await cdp.evaluate("document.querySelector('[data-pisi-find-input]').focus()");
    await key(cdp, 'Escape', 'Escape', 27);
    const closed = await waitUntil('bar closed', () => cdp.evaluate(findState).then((state) => (!state.open ? state : null)));
    assert(closed.selection === 'Rapor' && closed.focus === 'center-node-editor-content', 'The match stays selected in the note', closed);
    assert(!(await cdp.evaluate("CSS.highlights.has('pisi-find-match')")), 'Highlights are cleared');

    // 3. Mod+H → Replace all.
    await key(cdp, 'h', 'KeyH', 72, CTRL);
    await waitUntil('replace row open', () => cdp.evaluate(findState).then((state) => state.open && state.focus === 'replace'));
    await cdp.request('Input.insertText', { text: 'Belge' });
    await cdp.evaluate(`document.querySelector('[data-pisi-find-action="replace-all"]').click()`);
    const replaced = await waitUntil('replaced in the editor', () => cdp.evaluate(findState).then((state) => (state.counter === '0/0' ? state : null)));
    assert(/Belge hazır\. Belge tamam\./.test(replaced.text) && /Belgeu ve Rapor/.test(replaced.text), 'Text replaced, link title untouched', replaced.text);
    const saved = await waitUntil('replacement on disk', async () => {
        const html = (await readNode(nodePath)).content || '';
        return html.includes('Belge hazır') ? html : null;
    });
    assert(saved.includes('blk_find_a') && saved.includes('blk_find_b'), 'Block ids are kept', saved);
    assert(saved.includes('data-pisi-node-id="node_findlink1"') && />Rapor<\/a>/.test(saved), 'The [[link]] keeps its id and title', saved);
    assert(!/pisi-find|highlight/i.test(saved), 'No find markers in the saved HTML', saved);

    // 4. Mod+Z restores everything in one step.
    await key(cdp, 'Escape', 'Escape', 27);
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await key(cdp, 'z', 'KeyZ', 90, CTRL);
    await waitUntil('undo in the editor', () =>
        cdp.evaluate(findState).then((state) => /Rapor hazır\. Rapor tamam\./.test(state.text) && /raporu/.test(state.text))
    );
    await waitUntil('undo on disk', async () => {
        const html = (await readNode(nodePath)).content || '';
        return html.includes('Rapor hazır') && !html.includes('Belge');
    });

    // 5. Mod+F in a Sheet cell goes to the Sheet's own search.
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.querySelector('[data-editor-target="center-node-editor-content"] [data-pisi-table-trigger]').click();
    })()`);
    await waitUntil('sheet inserted', () =>
        cdp.evaluate(
            "Boolean(document.querySelector('#center-node-editor-content .pisi-sheet-block td, #center-node-editor-content table[data-pisi-sheet] td'))"
        )
    );
    await cdp.evaluate(
        `(() => { const cell = document.querySelector('#center-node-editor-content table[data-pisi-sheet] td'); cell.focus(); cell.click(); })()`
    );
    await key(cdp, 'f', 'KeyF', 70, CTRL);
    const sheetFocus = await waitUntil('sheet search focused', () =>
        cdp.evaluate(
            "document.activeElement?.hasAttribute?.('data-pisi-sheet-search-input') ? true : document.activeElement?.className || document.activeElement?.tagName"
        )
    );
    assert(sheetFocus === true, 'Mod+F in a Sheet cell focuses the Sheet search', sheetFocus);
    assert(!(await cdp.evaluate(findState)).open, 'The note find bar stays closed');

    console.log(
        '[E2E] Find and replace passed: count with split match and skipped link, Turkish case, Enter/Shift+Enter, whole word, Esc keeps selection, replace all on disk with ids intact, one-step undo, Sheet hand-off.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
