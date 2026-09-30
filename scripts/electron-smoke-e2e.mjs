import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9223;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-e2e-'));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.writeFile(
    path.join(userDataPath, 'pisi-settings.json'),
    JSON.stringify({ lastProjectFolder: projectPath }, null, 2),
    'utf8'
);

const args = [
    '--remote-debugging-port=' + port,
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
    repoRoot
];

const child = spawn(electronPath, args, {
    cwd: repoRoot,
    env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        PISI_TEST_USER_DATA: userDataPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
const collect = (chunk) => {
    const text = String(chunk || '');
    logs += text;
    process.stdout.write(text);
};
child.stdout?.on('data', collect);
child.stderr?.on('data', collect);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPage(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (child.exitCode !== null) {
            throw new Error('Electron exited before renderer became available.\n' + logs);
        }
        try {
            const response = await fetch('http://127.0.0.1:' + port + '/json/list');
            if (response.ok) {
                const pages = await response.json();
                const page = pages.find((item) => (
                    item.type === 'page' &&
                    String(item.url || '').startsWith('file:')
                ));
                if (page?.webSocketDebuggerUrl) return page;
            }
        } catch {}
        await sleep(150);
    }
    throw new Error('Timed out waiting for Electron DevTools page.\n' + logs);
}

class CdpClient {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
    }

    async open() {
        if (this.socket.readyState === WebSocket.OPEN) return;
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data));
            if (!payload.id) return;
            const pending = this.pending.get(payload.id);
            if (!pending) return;
            this.pending.delete(payload.id);
            if (payload.error) {
                pending.reject(new Error(payload.error.message));
            } else {
                pending.resolve(payload.result);
            }
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
        const response = await this.request('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (response.exceptionDetails) {
            throw new Error(
                response.exceptionDetails.exception?.description ||
                response.exceptionDetails.text ||
                'Renderer evaluation failed'
            );
        }
        return response.result?.value;
    }

    close() {
        this.socket.close();
    }
}

async function waitForRendererState(cdp, timeoutMs = 15000) {
    const expression = "(() => ({ readyState: document.readyState, currentProjectFolder: window.currentProjectFolder || null, projectModalVisible: document.getElementById('project-modal')?.classList.contains('visible') === true, projectTitle: document.getElementById('project-title')?.textContent || '', tagsBound: document.querySelector('[data-right-tab=\\\"tags\\\"]')?.dataset.bound || null }))()";
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        const state = await cdp.evaluate(expression);
        if (
            state?.readyState === 'complete' &&
            state.currentProjectFolder &&
            state.tagsBound === '1'
        ) {
            return state;
        }
        await sleep(150);
    }
    throw new Error('Renderer startup did not reach interactive state.\n' + logs);
}

let cdp;
try {
    const page = await waitForPage();
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');

    const startup = await waitForRendererState(cdp);
    const expectedProject = path.resolve(projectPath);
    const actualProject = path.resolve(startup.currentProjectFolder);

    if (actualProject !== expectedProject) {
        throw new Error(
            'Last project was not restored. Expected ' +
            expectedProject + ' but got ' + actualProject
        );
    }
    if (startup.projectModalVisible) {
        throw new Error('Project chooser stayed visible after restoring the last project.');
    }

    const clickExpression = "(() => { const button = document.querySelector('[data-right-tab=\\\"tags\\\"]'); if (!button) return { ok: false, reason: 'tags button missing' }; button.click(); return { ok: true, buttonActive: button.classList.contains('active'), pageActive: document.getElementById('right-tab-tags')?.classList.contains('active') === true }; })()";
    const clickResult = await cdp.evaluate(clickExpression);

    if (!clickResult?.ok || !clickResult.buttonActive || !clickResult.pageActive) {
        throw new Error(
            'Right-panel interaction failed: ' + JSON.stringify(clickResult)
        );
    }

    const sheetResult = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const toolbar = document.querySelector(
            '.pisi-editor-toolbar[data-editor-target="center-node-editor-content"]'
        );
        const editorWrapper = document.getElementById('center-node-editor');
        if (!editor || !toolbar || !editorWrapper) {
            return { ok: false, reason: 'center editor or toolbar missing' };
        }

        editorWrapper.hidden = false;
        editorWrapper.style.display = 'block';
        editor.innerHTML = '<div><br></div>';

        const tableTrigger = toolbar.querySelector('[data-pisi-table-trigger]');
        const rollupTrigger = toolbar.querySelector('[data-pisi-rollup-trigger]');
        const addRow = toolbar.querySelector(
            '[data-pisi-excel-action="addRow"]'
        );
        const deleteRow = toolbar.querySelector(
            '[data-pisi-excel-action="deleteRow"]'
        );
        const wrap = toolbar.querySelector(
            '[data-pisi-excel-action="toggleWrap"]'
        );
        const inlineTools = toolbar.querySelector('[data-pisi-sheet-tools]');

        window.syncPisiSheetToolbarState?.(toolbar, null);

        const toolbarRect = toolbar.getBoundingClientRect();
        const tableRect = tableTrigger?.getBoundingClientRect();
        const rollupRect = rollupTrigger?.getBoundingClientRect();
        const toolsBeforeRect = inlineTools?.getBoundingClientRect();
        const toolsVisibleBeforeSheet = Boolean(
            toolsBeforeRect &&
            toolsBeforeRect.width > 0 &&
            toolsBeforeRect.height > 0
        );
        const toolsInsideToolbarBeforeSheet = Boolean(
            toolsBeforeRect &&
            toolsBeforeRect.top >= toolbarRect.top &&
            toolsBeforeRect.bottom <= toolbarRect.bottom + 1
        );
        const disabledBeforeSheet = Boolean(
            addRow?.disabled &&
            deleteRow?.disabled &&
            wrap?.disabled
        );

        tableTrigger?.click();

        const table = editor.querySelector('table[data-pisi-sheet]');
        const firstCell = table?.querySelector('td[data-cell="A1"]');
        const directTableSize = table
            ? {
                rows: table.querySelectorAll('tbody tr').length,
                cols: table.querySelectorAll('tbody tr:first-child td').length
            }
            : null;

        if (!table || !firstCell) {
            return {
                ok: false,
                reason: 'direct Table insert failed',
                toolsVisibleBeforeSheet,
                disabledBeforeSheet
            };
        }

        firstCell.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
            buttons: 1
        }));

        const rowsBefore = table.querySelectorAll('tbody tr').length;
        const toolsAfterRect = inlineTools?.getBoundingClientRect();

        addRow?.click();

        return {
            ok: true,
            hasTableTrigger: Boolean(tableTrigger),
            hasRollupTrigger: Boolean(rollupTrigger),
            mainButtonsStacked: Boolean(
                tableRect &&
                rollupRect &&
                rollupRect.top > tableRect.top &&
                Math.abs(rollupRect.left - tableRect.left) <= 1
            ),
            toolsRightOfMainStack: Boolean(
                tableRect &&
                rollupRect &&
                toolsBeforeRect &&
                toolsBeforeRect.left > Math.max(
                    tableRect.right,
                    rollupRect.right
                )
            ),
            hasAddRow: Boolean(addRow),
            hasDeleteRow: Boolean(deleteRow),
            hasWrap: Boolean(wrap),
            toolsVisibleBeforeSheet,
            toolsInsideToolbarBeforeSheet,
            disabledBeforeSheet,
            actionsEnabledWithSheet: Boolean(
                !addRow?.disabled &&
                !deleteRow?.disabled &&
                !wrap?.disabled
            ),
            directTableSize,
            rowsBefore,
            rowsAfter: table.querySelectorAll('tbody tr').length,
            toolsVisibleWithSheet: Boolean(
                toolsAfterRect &&
                toolsAfterRect.width > 0 &&
                toolsAfterRect.height > 0
            ),
            toolsInsideToolbarWithSheet: Boolean(
                toolsAfterRect &&
                toolsAfterRect.top >= toolbarRect.top &&
                toolsAfterRect.bottom <= toolbarRect.bottom + 1
            ),
            tablePopoverPresent: Boolean(
                document.querySelector('.pisi-office-table-popover')
            )
        };
    })()`);

    if (
        !sheetResult?.ok ||
        !sheetResult.hasTableTrigger ||
        !sheetResult.hasRollupTrigger ||
        !sheetResult.mainButtonsStacked ||
        !sheetResult.toolsRightOfMainStack ||
        !sheetResult.hasAddRow ||
        !sheetResult.hasDeleteRow ||
        !sheetResult.hasWrap ||
        !sheetResult.toolsVisibleBeforeSheet ||
        !sheetResult.toolsInsideToolbarBeforeSheet ||
        !sheetResult.disabledBeforeSheet ||
        !sheetResult.actionsEnabledWithSheet ||
        sheetResult.directTableSize?.rows !== 5 ||
        sheetResult.directTableSize?.cols !== 5 ||
        !sheetResult.toolsVisibleWithSheet ||
        !sheetResult.toolsInsideToolbarWithSheet ||
        sheetResult.tablePopoverPresent ||
        sheetResult.rowsAfter !== sheetResult.rowsBefore + 1
    ) {
        throw new Error(
            'Sheet toolbar interaction failed: ' +
            JSON.stringify(sheetResult)
        );
    }

    await sleep(300);

    const fatalPatterns = [
        /Uncaught Error:/i,
        /ReferenceError:/i,
        /TypeError:/i,
        /SyntaxError:/i,
        /ERR_MODULE_NOT_FOUND/i,
        /Renderer process crashed/i
    ];
    const fatal = fatalPatterns.find((pattern) => pattern.test(logs));
    if (fatal) {
        throw new Error('Renderer log contains fatal error matching ' + fatal + '\n' + logs);
    }
    if (!logs.includes('[PISI] Temiz arayüz yüklendi.')) {
        throw new Error('Renderer startup marker was not observed.\n' + logs);
    }

    console.log('[E2E] Electron startup, last-project restore, Sheet toolbar and right-panel interaction passed.');
} finally {
    cdp?.close();
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(400);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
}
