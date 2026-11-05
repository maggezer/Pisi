import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// External links end to end. shell.openExternal is captured in test mode
// (PISI_TEST_CAPTURE_EXTERNAL=1) into the test user-data folder, so the test
// sees exactly which URLs main would hand to the operating system.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9228;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-links-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');
const capturePath = path.join(userDataPath, 'pisi-external-links.log');

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let logs = '';

function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

const child = spawn(electronPath, ['--remote-debugging-port=' + port, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_TEST_CAPTURE_EXTERNAL: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
});
const collect = (chunk) => {
    const text = String(chunk || '');
    logs += text;
    process.stdout.write(text);
};
child.stdout?.on('data', collect);
child.stderr?.on('data', collect);

async function waitUntil(label, probe, timeoutMs = 15000) {
    const started = Date.now();
    let lastValue = null;
    while (Date.now() - started < timeoutMs) {
        if (child.exitCode !== null) throw new Error('Electron exited while waiting for ' + label + '.\n' + logs);
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
}

async function readCaptured() {
    return fs
        .readFile(capturePath, 'utf8')
        .then((text) => text.split('\n').filter(Boolean))
        .catch(() => []);
}

const CTRL = 2;
const SHIFT = 8;

async function key(cdp, name, code, keyCode, modifiers = 0, text) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
}

async function click(cdp, selector, modifiers = 0) {
    const point = await cdp.evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + Math.min(6, r.width / 2), y: r.top + r.height / 2 }; })()`
    );
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, modifiers });
    await cdp.request('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1, modifiers });
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1, modifiers });
}

function selectWord(word) {
    return `(() => {
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const index = node.nodeValue.indexOf(${JSON.stringify(word)});
            if (index < 0 || node.parentElement.closest('a')) continue;
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + ${JSON.stringify(word)}.length);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            return true;
        }
        return false;
    })()`;
}

const windowLocation = 'location.href';
let cdp = null;
try {
    const page = await waitUntil('Electron DevTools page', async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const pages = response.ok ? await response.json() : [];
        return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
    });
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');
    // Real mouse clicks are used below; the first-run tutorial overlay would intercept them.
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
    await waitUntil('project restored', () =>
        cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(projectPath))
    );
    const appUrl = await cdp.evaluate(windowLocation);
    assert(appUrl.endsWith('/index.html'), 'App must start on index.html', appUrl);

    const before = new Set(await fs.readdir(projectPath));
    await cdp.evaluate("document.getElementById('add-node-btn').click()");
    const nodePath = await waitUntil('new node', async () => {
        const name = (await fs.readdir(projectPath)).find((entry) => entry.endsWith('.node') && !before.has(entry));
        return name ? path.join(projectPath, name) : null;
    });
    await waitUntil('tree item', () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === " + JSON.stringify(nodePath) + ')')
    );
    await cdp.evaluate(
        "Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            JSON.stringify(nodePath) +
            ").querySelector(':scope > .tree-row').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }))"
    );
    await waitUntil('editor open', () => cdp.evaluate('window.activeCenterNode?.path === ' + JSON.stringify(nodePath)));
    await cdp.evaluate(
        "(() => { const e = document.getElementById('center-node-editor-content'); e.focus(); const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()"
    );
    await cdp.request('Input.insertText', { text: 'Pisi sitesi ve kötü bağlantı' });

    // 1. Mod+Shift+K on a selection opens the link editor; a bare host gets https://.
    assert(await cdp.evaluate(selectWord('Pisi')), 'Word must be selectable');
    await key(cdp, 'K', 'KeyK', 75, CTRL | SHIFT);
    await waitUntil('link editor open', () => cdp.evaluate("document.querySelector('.pisi-link-editor')?.hidden === false"));
    await cdp.request('Input.insertText', { text: 'ornek.com/pisi' });
    await key(cdp, 'Enter', 'Enter', 13);
    const href = await waitUntil('link created', () => cdp.evaluate("document.querySelector('#center-node-editor-content a[href]')?.getAttribute('href')"));
    assert(href === 'https://ornek.com/pisi', 'Bare host must be stored with https://', href);
    assert((await cdp.evaluate("document.querySelector('#center-node-editor-content a[href]').textContent")) === 'Pisi', 'Link must wrap the selection');

    // 2. javascript: is refused in the editor and nothing is linked.
    assert(await cdp.evaluate(selectWord('kötü')), 'Second word must be selectable');
    await key(cdp, 'K', 'KeyK', 75, CTRL | SHIFT);
    await waitUntil('link editor reopened', () => cdp.evaluate("document.querySelector('.pisi-link-editor')?.hidden === false"));
    await cdp.request('Input.insertText', { text: 'javascript:alert(1)' });
    await key(cdp, 'Enter', 'Enter', 13);
    const refusal = await waitUntil('javascript: refused', () => cdp.evaluate("document.querySelector('.pisi-link-editor-error')?.textContent || null"));
    assert(/http, https/.test(refusal), 'Refusal must name the allowed schemes', refusal);
    await key(cdp, 'Escape', 'Escape', 27);
    assert(
        !(await cdp.evaluate("Array.from(document.querySelectorAll('#center-node-editor-content a')).some((a) => a.textContent === 'kötü')")),
        'Refused URL must not create a link'
    );

    // 2b. The toolbar button keeps the editor selection and links it.
    assert(await cdp.evaluate(selectWord('sitesi')), 'Toolbar target word must be selectable');
    await click(cdp, '.pisi-editor-toolbar[data-editor-target="center-node-editor-content"] [data-pisi-link-trigger]');
    await waitUntil('link editor from toolbar', () => cdp.evaluate("document.querySelector('.pisi-link-editor')?.hidden === false"));
    assert(await cdp.evaluate("document.querySelector('[data-pisi-link-text]').closest('label').hidden"), 'Text field is hidden when text is selected');
    await cdp.request('Input.insertText', { text: 'https://example.org/toolbar' });
    await key(cdp, 'Enter', 'Enter', 13);
    await waitUntil('toolbar link created', () =>
        cdp.evaluate(
            "Array.from(document.querySelectorAll('#center-node-editor-content a[href]')).some((a) => a.textContent === 'sitesi' && a.getAttribute('href') === 'https://example.org/toolbar')"
        )
    );

    // 2c. /link at a collapsed caret asks for the link text too.
    await cdp.evaluate(
        "(() => { const e = document.getElementById('center-node-editor-content'); e.focus(); const r = document.createRange(); r.selectNodeContents(e.lastElementChild); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()"
    );
    await cdp.request('Input.insertText', { text: ' /link' });
    await waitUntil('slash menu shows /link', () =>
        cdp.evaluate("Boolean(window.pisiUnifiedCommandState?.active && document.getElementById('pisi-tag-menu')?.textContent.includes('Web bağlantısı ekle'))")
    );
    await key(cdp, 'Enter', 'Enter', 13);
    await waitUntil('link editor from slash', () => cdp.evaluate("document.querySelector('.pisi-link-editor')?.hidden === false"));
    assert(!(await cdp.evaluate("document.querySelector('[data-pisi-link-text]').closest('label').hidden")), 'Text field is shown at a collapsed caret');
    await cdp.request('Input.insertText', { text: 'kisi@example.org' });
    await cdp.evaluate("document.querySelector('[data-pisi-link-text]').value = 'E-posta'");
    await key(cdp, 'Enter', 'Enter', 13);
    await waitUntil('slash link created', () =>
        cdp.evaluate(
            "Array.from(document.querySelectorAll('#center-node-editor-content a[href]')).some((a) => a.textContent === 'E-posta' && a.getAttribute('href') === 'mailto:kisi@example.org')"
        )
    );
    assert(!(await cdp.evaluate("document.getElementById('center-node-editor-content').textContent.includes('/link')")), 'The /link token must be removed');

    // 3. Hovering shows the target and the Ctrl+click hint.
    const anchorSelector = '#center-node-editor-content a[href="https://ornek.com/pisi"]';
    const anchorPoint = await cdp.evaluate(
        `(() => { const r = document.querySelector('${anchorSelector}').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; })()`
    );
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: anchorPoint.x, y: anchorPoint.y });
    const tooltip = await waitUntil('link tooltip', () =>
        cdp.evaluate("(() => { const t = document.querySelector('.pisi-link-tooltip'); return t && !t.hidden ? t.textContent : null; })()")
    );
    assert(tooltip.includes('https://ornek.com/pisi') && tooltip.includes('Ctrl+'), 'Tooltip must show URL and Ctrl+click hint', tooltip);

    // 4. A plain click only places the caret; Ctrl+click opens exactly the stored URL.
    await click(cdp, anchorSelector);
    await sleep(500);
    assert((await readCaptured()).length === 0, 'Plain click in the editor must not open the link', await readCaptured());
    await click(cdp, anchorSelector, CTRL);
    await waitUntil('Ctrl+click captured', async () => (await readCaptured()).length === 1);
    assert((await readCaptured())[0] === 'https://ornek.com/pisi', 'Ctrl+click must send the stored URL', await readCaptured());
    assert((await cdp.evaluate(windowLocation)) === appUrl, 'The window must not navigate on Ctrl+click');

    // 5. window.open and in-page navigation never move the app window.
    await cdp.evaluate("window.open('https://example.org/popup', '_blank')");
    await cdp.evaluate("window.open('file:///etc/passwd', '_blank')");
    await waitUntil('window.open captured', async () => (await readCaptured()).includes('https://example.org/popup'));
    await cdp.evaluate("location.assign('https://example.org/navigate')");
    await waitUntil('navigation captured', async () => (await readCaptured()).includes('https://example.org/navigate'));
    await sleep(300);
    assert((await cdp.evaluate(windowLocation)) === appUrl, 'The app window must stay on index.html');
    assert(!(await readCaptured()).some((url) => url.startsWith('file:')), 'file: URLs must never be opened', await readCaptured());

    // 6. In a read-only surface a plain click opens the link.
    await cdp.evaluate(
        "(() => { const view = document.createElement('div'); view.id = 'pisi-e2e-readonly'; view.style.cssText = 'position:fixed;top:40px;left:40px;z-index:99999;padding:8px;background:#fff'; view.innerHTML = '<a href=\"https://example.org/readonly\">readonly</a>'; document.body.appendChild(view); })()"
    );
    await click(cdp, '#pisi-e2e-readonly a');
    await waitUntil('read-only plain click captured', async () => (await readCaptured()).includes('https://example.org/readonly'));
    await cdp.evaluate("document.getElementById('pisi-e2e-readonly').remove()");

    // 7. The link is saved with the note.
    await waitUntil('link persisted', async () => JSON.parse(await fs.readFile(nodePath, 'utf8')).content?.includes('href="https://ornek.com/pisi"'));

    console.log(
        '[E2E] External links passed: Mod+Shift+K, toolbar and /link editors, scheme refusal, hover hint, Ctrl+click open, window guards and read-only click.'
    );
} finally {
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(400);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
