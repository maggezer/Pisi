import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-critical-e2e-'));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');
const persistenceMarker = 'critical restart persistence marker';

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
            if (payload.method === 'Page.javascriptDialogOpening') console.error('[E2E] Unexpected native dialog: ' + payload.params?.message);
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
        let timer;
        try {
            const response = await Promise.race([
                this.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Renderer evaluation timed out: ' + expression.slice(0, 120))), 30000);
                })
            ]);
            if (response.exceptionDetails) {
                throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed');
            }
            return response.result?.value;
        } finally {
            clearTimeout(timer);
        }
    }

    close() {
        this.socket.close();
    }
}

function makeElectronArgs(port) {
    return ['--remote-debugging-port=' + port, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot];
}

async function waitUntil(app, label, probe, timeoutMs = 15000) {
    const started = Date.now();
    let lastValue = null;

    while (Date.now() - started < timeoutMs) {
        if (app.child.exitCode !== null) {
            throw new Error('Electron exited while waiting for ' + label + '.\n' + app.logs);
        }

        try {
            lastValue = await probe();
            if (lastValue) return lastValue;
        } catch {}

        await sleep(120);
    }

    throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue) + '\n' + app.logs);
}

async function launchElectron(port) {
    const app = {
        child: spawn(electronPath, makeElectronArgs(port), {
            cwd: repoRoot,
            env: {
                ...process.env,
                ELECTRON_ENABLE_LOGGING: '1',
                PISI_TEST_USER_DATA: userDataPath
            },
            stdio: ['ignore', 'pipe', 'pipe']
        }),
        cdp: null,
        logs: '',
        port
    };

    const collect = (chunk) => {
        const text = String(chunk || '');
        app.logs += text;
        process.stdout.write(text);
    };
    app.child.stdout?.on('data', collect);
    app.child.stderr?.on('data', collect);

    const page = await waitUntil(
        app,
        'Electron DevTools page',
        async () => {
            try {
                const response = await fetch('http://127.0.0.1:' + port + '/json/list');
                if (!response.ok) return null;
                const pages = await response.json();
                return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
            } catch {
                return null;
            }
        },
        20000
    );

    app.cdp = new CdpClient(page.webSocketDebuggerUrl);
    await app.cdp.open();
    await app.cdp.request('Runtime.enable');
    await app.cdp.request('Page.enable');

    const startup = await waitUntil(
        app,
        'interactive renderer',
        async () => {
            const state = await app.cdp.evaluate(
                '(() => ({ readyState: document.readyState, project: window.currentProjectFolder || null, taskStore: typeof window.refreshPisiFirstClassTaskStore === "function" }))()'
            );
            return state?.readyState === 'complete' && state.project && state.taskStore ? state : null;
        },
        20000
    );

    if (path.resolve(startup.project) !== path.resolve(projectPath)) {
        throw new Error('Critical E2E restored the wrong project: ' + JSON.stringify(startup));
    }

    return app;
}

async function stopElectron(app) {
    if (!app) return;
    try {
        app.cdp?.close();
    } catch {}

    if (app.child.exitCode === null) {
        app.child.kill('SIGTERM');
        for (let index = 0; index < 20 && app.child.exitCode === null; index += 1) {
            await sleep(100);
        }
    }

    if (app.child.exitCode === null) {
        app.child.kill('SIGKILL');
        for (let index = 0; index < 20 && app.child.exitCode === null; index += 1) {
            await sleep(100);
        }
    }
}

async function listProjectFiles() {
    return fs.readdir(projectPath);
}

async function waitForNewProjectFile(app, extension, previousNames) {
    const previous = new Set(previousNames);
    return waitUntil(app, 'new ' + extension + ' file', async () => {
        const names = await listProjectFiles();
        const created = names.find((name) => name.endsWith(extension) && !previous.has(name));
        return created ? path.join(projectPath, created) : null;
    });
}

async function waitForTreePath(app, targetPath) {
    const serializedPath = JSON.stringify(targetPath);
    return waitUntil(app, 'tree item ' + targetPath, async () => {
        return app.cdp.evaluate(
            "(() => Array.from(document.querySelectorAll('.tree-node[data-path]')).some((node) => node.dataset.path === " + serializedPath + '))()'
        );
    });
}

async function clickTreePath(app, targetPath) {
    const serializedPath = JSON.stringify(targetPath);
    const clicked = await app.cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((candidate) => candidate.dataset.path === " +
            serializedPath +
            "); const row = node?.querySelector(':scope > .tree-row'); if (!row) return false; row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); return true; })()"
    );
    if (!clicked) throw new Error('Tree row could not be clicked: ' + targetPath);
}

async function waitForNodeEditor(app, nodePath) {
    await waitUntil(app, 'center node editor ' + nodePath, async () => {
        return app.cdp.evaluate(
            '(() => window.Pisi?.state?.activeTabPath === ' +
                JSON.stringify(nodePath) +
                " && document.getElementById('center-node-editor')?.hidden === false && Boolean(document.getElementById('center-node-editor-content')))()"
        );
    });
}

async function createNode(app) {
    const before = await listProjectFiles();
    const clicked = await app.cdp.evaluate(
        "(() => { const button = document.getElementById('add-node-btn'); if (!button) return false; button.click(); return true; })()"
    );
    if (!clicked) throw new Error('Add Node button is missing.');

    const nodePath = await waitForNewProjectFile(app, '.node', before);
    await waitForTreePath(app, nodePath);
    await clickTreePath(app, nodePath);
    await waitForNodeEditor(app, nodePath);
    return nodePath;
}

async function readNodeContent(nodePath) {
    const raw = await fs.readFile(nodePath, 'utf8');
    return JSON.parse(raw)?.content || '';
}

async function typeAndSaveNode(app, nodePath, marker) {
    await waitForNodeEditor(app, nodePath);

    const focused = await app.cdp.evaluate(
        "(() => { const editor = document.getElementById('center-node-editor-content'); if (!editor) return false; editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return document.activeElement === editor; })()"
    );
    if (!focused) throw new Error('Node editor could not receive focus.');

    await app.cdp.request('Input.insertText', { text: marker });

    await waitUntil(app, 'typed persistence marker', async () => {
        return app.cdp.evaluate("document.getElementById('center-node-editor-content')?.textContent?.includes(" + JSON.stringify(marker) + ') === true');
    });

    const saved = await app.cdp.evaluate(
        "(() => { const editor = document.getElementById('center-node-editor-content'); if (!editor) return false; editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 's', ctrlKey: true })); return true; })()"
    );
    if (!saved) throw new Error('Ctrl+S could not be dispatched.');

    await waitUntil(app, 'node persistence to disk', async () => {
        try {
            return (await readNodeContent(nodePath)).includes(marker);
        } catch {
            return false;
        }
    });
}

async function testTaskProjectionWriteThrough(app) {
    const taskId = 'task_e2e_projection_critical';

    const seeded = await app.cdp.evaluate(`(async () => {
        const project = window.currentProjectFolder;
        const taskId = ${JSON.stringify(taskId)};
        const upsert = await window.pisiProject?.quickAddTask?.(project, {
            op: 'upsert',
            task: {
                id: taskId,
                title: 'Critical projection task',
                status: 'todo',
                priority: 2,
                todoTag: 'todo.2.none',
                manualOrder: 1
            }
        });
        if (!upsert?.ok) return { ok: false, stage: 'upsert', result: upsert };
        const refreshed = await window.refreshPisiFirstClassTaskStore?.();
        const block = window.pisiTagsPanelState?.missionIndex?.find((item) => item?.taskId === taskId);
        const tag = block?.todoTag || Object.keys(block?.todoStates || {})[0] || '';
        if (!refreshed?.ok || !block || !tag) {
            return { ok: false, stage: 'projection-seed', refreshed, block: Boolean(block), tag };
        }
        block.todoStates[tag] = 'doing';
        block.doneFor = [];
        document.dispatchEvent(new CustomEvent('pisi:mission-index-updated', {
            detail: { complete: true, reason: 'status-change' }
        }));
        return { ok: true, tag };
    })()`);

    if (!seeded?.ok) {
        throw new Error('Task projection E2E could not seed status update: ' + JSON.stringify(seeded));
    }

    await waitUntil(app, 'task projection status write-through', async () => {
        const result = await app.cdp.evaluate(`(async () => {
            const listed = await window.pisiProject?.quickAddTask?.(window.currentProjectFolder, { op: 'list' });
            const task = listed?.tasks?.find((item) => item?.id === ${JSON.stringify(taskId)});
            return task?.status === 'doing';
        })()`);
        return result === true;
    });

    const tasksPath = path.join(projectPath, '.pisi', 'tasks.json');
    await waitUntil(app, 'task projection status persisted to disk', async () => {
        try {
            const store = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
            return store.tasks?.find((task) => task.id === taskId)?.status === 'doing';
        } catch {
            return false;
        }
    });

    const completionDispatched = await app.cdp.evaluate(`(() => {
        const taskId = ${JSON.stringify(taskId)};
        const block = window.pisiTagsPanelState?.missionIndex?.find((item) => item?.taskId === taskId);
        const tag = block?.todoTag || Object.keys(block?.todoStates || {})[0] || '';
        if (!block || !tag) return false;
        block.doneFor = [tag];
        document.dispatchEvent(new CustomEvent('pisi:mission-index-updated', {
            detail: { complete: true, reason: 'completion-change' }
        }));
        return true;
    })()`);

    if (!completionDispatched) {
        throw new Error('Task projection E2E could not dispatch completion update.');
    }

    await waitUntil(app, 'task projection completion write-through', async () => {
        const result = await app.cdp.evaluate(`(async () => {
            const listed = await window.pisiProject?.quickAddTask?.(window.currentProjectFolder, { op: 'list' });
            const task = listed?.tasks?.find((item) => item?.id === ${JSON.stringify(taskId)});
            return task?.status === 'done';
        })()`);
        return result === true;
    });

    await waitUntil(app, 'task projection completion persisted to disk', async () => {
        try {
            const store = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
            return store.tasks?.find((task) => task.id === taskId)?.status === 'done';
        } catch {
            return false;
        }
    });
}

async function testCompositeDeleteThenTreeDelete(app, kind) {
    const nodePath = await createNode(app);
    const serializedPath = JSON.stringify(nodePath);
    const result = await app.cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const toolbar = document.querySelector('.pisi-editor-toolbar[data-editor-target="center-node-editor-content"]');
        const treeNode = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((candidate) => candidate.dataset.path === ${serializedPath});
        const treeDelete = treeNode?.querySelector('.delete-tree-item-btn');
        if (!editor || !toolbar || !treeDelete) {
            return { ok: false, reason: 'editor, toolbar or tree delete missing' };
        }

        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        let block = null;
        if (${JSON.stringify(kind)} === 'sheet') {
            const trigger = toolbar.querySelector('[data-pisi-table-trigger]');
            if (!trigger) return { ok: false, reason: 'sheet trigger missing' };
            trigger.click();
            block = Array.from(editor.querySelectorAll(':scope > .pisi-sheet-block')).at(-1) || null;
            const remove = block?.querySelector('[data-pisi-sheet-section-delete]');
            if (!block || !remove) return { ok: false, reason: 'sheet block or delete missing' };
            remove.click();
        } else {
            const trigger = toolbar.querySelector('[data-pisi-paint-action="createCanvas"]');
            if (!trigger) return { ok: false, reason: 'canvas trigger missing' };
            trigger.click();
            block = Array.from(editor.querySelectorAll(':scope > .pisi-canvas-block')).at(-1) || null;
            const remove = block?.querySelector('[data-pisi-canvas-section-delete]');
            if (!block || !remove) return { ok: false, reason: 'canvas block or delete missing' };
            remove.click();
        }

        const removed = Boolean(block && !block.isConnected);
        treeDelete.click();
        return { ok: true, removed };
    })()`);

    if (!result?.ok || !result.removed) {
        throw new Error(kind + ' removal could not immediately enter tree-delete flow: ' + JSON.stringify(result));
    }

    await waitUntil(app, kind + ' delete confirmation', async () => {
        return app.cdp.evaluate("Boolean(document.getElementById('pisi-confirm-ok'))");
    });

    const confirmed = await app.cdp.evaluate(
        "(() => { const button = document.getElementById('pisi-confirm-ok'); if (!button) return false; button.click(); return true; })()"
    );
    if (!confirmed) throw new Error(kind + ' tree delete confirmation could not be clicked.');

    await waitUntil(app, kind + ' node moved out of live tree', async () => {
        try {
            await fs.access(nodePath);
            return false;
        } catch {
            return true;
        }
    });

    await waitUntil(app, kind + ' tree item removed', async () => {
        return app.cdp.evaluate(
            "(() => !Array.from(document.querySelectorAll('.tree-node[data-path]')).some((candidate) => candidate.dataset.path === " + serializedPath + '))()'
        );
    });

    const responsive = await app.cdp.evaluate(
        "(() => ({ readyState: document.readyState, addNode: Boolean(document.getElementById('add-node-btn')), bodyConnected: document.body?.isConnected === true }))()"
    );
    if (responsive?.readyState !== 'complete' || !responsive.addNode || !responsive.bodyConnected) {
        throw new Error(kind + ' tree deletion left renderer unresponsive: ' + JSON.stringify(responsive));
    }
}

async function testSortedSheetSelection(app) {
    console.log('[E2E] Sorted Sheet: create node');
    await createNode(app);
    console.log('[E2E] Sorted Sheet: selection and mutations');
    const result = await app.cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        console.log('[E2E] Sorted Sheet: insert');
        insertPisiSheet(editor, 5, 2);
        console.log('[E2E] Sorted Sheet: seed');
        const table = Array.from(editor.querySelectorAll('table[data-pisi-sheet]')).at(-1);
        if (!table) return { ok: false, reason: 'sheet missing' };
        [40,20,50,10,30].forEach((value,row) => setPisiSheetCellSource(table,row,0,{value:String(value)}));
        const database = getPisiSheetDatabase(table);
        setPisiSheetViewSorts(table,[{fieldId:database.fields[0].id,direction:'asc'}]);
        console.log('[E2E] Sorted Sheet: select');
        selectPisiSheetCell(getPisiSheetCell(table,3,0));
        selectPisiSheetCell(getPisiSheetCell(table,4,0),{extend:true});
        const rows = getPisiSelectedSheetPoints(table).map((point)=>point.row);
        if (JSON.stringify(rows)!==JSON.stringify([3,1,4])) return {ok:false,reason:'wrong rows',rows};
        console.log('[E2E] Sorted Sheet: format');
        applyPisiSheetCellFormat(table,'toggleBold');
        const bold = [0,1,2,3,4].filter((row)=>getPisiSheetCellSource(table,row,0).format.fontWeight==='700');
        if (JSON.stringify(bold)!==JSON.stringify([1,3,4])) return {ok:false,reason:'wrong format targets',bold};
        console.log('[E2E] Sorted Sheet: delete');
        deletePisiSheetRows(table);
        const remaining = getPisiSheetDatabase(table).items.map((item)=>item.values[database.fields[0].id]?.value);
        return {ok:JSON.stringify(remaining)===JSON.stringify(['40','50']),remaining};
    })()`);
    if (!result?.ok) throw new Error('Sorted Sheet selection regression: ' + JSON.stringify(result));
    if (!(await app.cdp.evaluate('saveCurrentCenterNodeEditor()'))) throw new Error('Sorted Sheet could not be saved.');
    const reopened = await app.cdp.evaluate(`(async () => {
        const opened = await openCenterNodeEditor(activeCenterNode.item);
        const table = document.querySelector('#center-node-editor-content table[data-pisi-sheet]');
        const database = table && getPisiSheetDatabase(table);
        return opened && !activeCenterNode.assetRecoveryWarning && database?.items.length === 2 &&
            database.items.map((item) => item.values[database.fields[0].id]?.value).join(',') === '40,50';
    })()`);
    if (!reopened) throw new Error('Sorted Sheet selection did not survive save and reopen.');
}

async function testRapidNodeNavigation(app) {
    const firstPath = await createNode(app);
    await typeAndSaveNode(app, firstPath, 'NAVIGATION_FIRST');
    const lastPath = await createNode(app);
    await typeAndSaveNode(app, lastPath, 'NAVIGATION_LAST');
    await app.cdp.evaluate('saveCurrentCenterNodeEditor()');
    const result = await app.cdp.evaluate(`(async () => {
        await Promise.all([activatePisiOpenTab(${JSON.stringify(firstPath)}), activatePisiOpenTab(${JSON.stringify(lastPath)})]);
        return { path: activeCenterNode?.path, tab: window.Pisi.state.activeTabPath, content: document.getElementById('center-node-editor-content')?.textContent };
    })()`);
    if (
        result?.path !== lastPath ||
        result?.tab !== lastPath ||
        !result?.content?.includes('NAVIGATION_LAST') ||
        result?.content?.includes('NAVIGATION_FIRST')
    ) {
        throw new Error('Rapid navigation replaced the latest document: ' + JSON.stringify(result));
    }
    await app.cdp.evaluate('saveCurrentCenterNodeEditor()');
    if (!(await readNodeContent(firstPath)).includes('NAVIGATION_FIRST') || !(await readNodeContent(lastPath)).includes('NAVIGATION_LAST')) {
        throw new Error('Rapid navigation changed the wrong document on disk.');
    }
}

async function testHistoryRestoreRefresh(app, kind) {
    const nodePath = await createNode(app);
    const original = 'RESTORE_ORIGINAL_' + kind;
    const newer = 'RESTORE_NEWER_' + kind;
    await typeAndSaveNode(app, nodePath, original);
    await typeAndSaveNode(app, nodePath, newer);
    // Drain the Ctrl+S completion before opening the real History dialog.
    await app.cdp.evaluate('saveCurrentCenterNodeEditor()');
    await app.cdp.evaluate('openPisiHistoryDialog()');
    const clicked = await app.cdp.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll(${JSON.stringify(kind === 'history' ? '.pisi-history-row' : '.pisi-backup-row')}));
        const row = ${kind === 'history' ? `rows.find((item) => item.textContent.includes(${JSON.stringify(original)}) && !item.textContent.includes(${JSON.stringify(newer)}))` : 'rows[0]'};
        const restore = row?.querySelector('.pisi-danger-outline-button');
        if (!restore) return false;
        restore.click();
        document.getElementById('pisi-confirm-ok')?.click();
        return true;
    })()`);
    if (!clicked) {
        const state = await app.cdp.evaluate(
            `(async () => ({ body: document.querySelector('.pisi-portability-dialog-body')?.textContent, activePath: activeCenterNode?.path, history: await window.pisiProject.listNodeHistory(${JSON.stringify(nodePath)}) }))()`
        );
        throw new Error(kind + ' restore button not found: ' + JSON.stringify(state));
    }
    await waitUntil(app, kind + ' restore replaces the live editor', async () => {
        return app.cdp.evaluate(`(() => {
            const text = document.getElementById('center-node-editor-content')?.textContent || '';
            return text.includes(${JSON.stringify(original)}) && !text.includes(${JSON.stringify(newer)}) && activeCenterNode?.dirty === false;
        })()`);
    });
    await waitUntil(app, kind + ' dialog refresh finished', () =>
        app.cdp.evaluate("document.querySelector('.pisi-portability-dialog-body')?.hasAttribute('aria-busy') === false")
    );
    await app.cdp.evaluate("document.querySelector('.pisi-portability-dialog-close')?.click()");
    const saved = await app.cdp.evaluate('saveCurrentCenterNodeEditor()');
    if (!saved) throw new Error(kind + ' restored editor could not be saved.');
    const content = await readNodeContent(nodePath);
    if (!content.includes(original) || content.includes(newer)) throw new Error(kind + ' restore was overwritten by stale editor content.');
}

async function testRecoveryDepartureAndClose(app) {
    const brokenPath = await createNode(app);
    await app.cdp.evaluate('saveCurrentCenterNodeEditor()');
    const healthyPath = await createNode(app);
    await app.cdp.evaluate('saveCurrentCenterNodeEditor()');
    const data = JSON.parse(await fs.readFile(brokenPath, 'utf8'));
    data.content =
        '<div class="pisi-sheet-block" data-pisi-sheet-block="1"><table data-pisi-sheet="1" data-pisi-sheet-asset="sheet/' +
        'a'.repeat(64) +
        '.json"></table></div>';
    const original = JSON.stringify(data);
    await fs.writeFile(brokenPath, original, 'utf8');
    const opened = await app.cdp.evaluate(`(async () => {
        const opened = await activatePisiOpenTab(${JSON.stringify(brokenPath)});
        const editor = document.getElementById('center-node-editor-content');
        return opened && Boolean(activeCenterNode.assetRecoveryWarning) && editor.inert &&
            document.getElementById('center-node-editor-title').readOnly && Boolean(document.querySelector('.pisi-editor-recovery-notice'));
    })()`);
    if (!opened) throw new Error('Damaged note did not open read-only with a recovery notice.');
    if (!(await app.cdp.evaluate('flushPisiPendingSaves()'))) throw new Error('Unchanged recovery note blocked close flush.');
    const left = await app.cdp.evaluate(`activatePisiOpenTab(${JSON.stringify(healthyPath)})`);
    const editable = await app.cdp.evaluate(
        "!document.getElementById('center-node-editor-content').inert && !document.getElementById('center-node-editor-title').readOnly && !document.querySelector('.pisi-editor-recovery-notice')"
    );
    if (!left || !editable) throw new Error('Recovery note blocked navigation or left healthy editor locked.');
    await app.cdp.evaluate(`activatePisiOpenTab(${JSON.stringify(brokenPath)})`);
    if (!(await app.cdp.evaluate(`closePisiOpenTab(${JSON.stringify(brokenPath)})`))) throw new Error('Recovery tab could not close.');
    await app.cdp.evaluate(`openPisiFileTab({fullPath:${JSON.stringify(brokenPath)},name:'recovery.node'})`);
    const modalClosed = await app.cdp.evaluate(`(async () => {
        const box = document.createElement('div');
        box.dataset.nodePath = ${JSON.stringify(brokenPath)};
        if (!(await openNodeModalFromBox(box))) return false;
        if (!document.getElementById('node-modal-content').inert) return false;
        await runPisiCommand('pisi.save');
        return (await closeNodeModalAndSave()) && !activeModalNode;
    })()`);
    if (!modalClosed) throw new Error('Recovery modal could not close safely.');
    if ((await fs.readFile(brokenPath, 'utf8')) !== original) throw new Error('Recovery UI overwrote the damaged document.');
    await app.cdp.evaluate('window.electronWindow.close(); true');
    const deadline = Date.now() + 10000;
    while (app.child.exitCode === null && Date.now() < deadline) await sleep(100);
    if (app.child.exitCode === null || app.child.exitCode !== 0) throw new Error('Normal application close failed with an unchanged recovery note.');
    if ((await fs.readFile(brokenPath, 'utf8')) !== original) throw new Error('Application close overwrote the damaged document.');
}

function assertNoFatalRendererLog(app) {
    const fatalPatterns = [/Uncaught Error:/i, /ReferenceError:/i, /TypeError:/i, /SyntaxError:/i, /ERR_MODULE_NOT_FOUND/i, /Renderer process crashed/i];
    const fatal = fatalPatterns.find((pattern) => pattern.test(app.logs));
    if (fatal) {
        throw new Error('Renderer log contains fatal error matching ' + fatal + '\n' + app.logs);
    }
}

let firstApp = null;
let secondApp = null;

try {
    firstApp = await launchElectron(9225);

    await testTaskProjectionWriteThrough(firstApp);
    await testSortedSheetSelection(firstApp);
    await testRapidNodeNavigation(firstApp);
    await testHistoryRestoreRefresh(firstApp, 'history');
    await testHistoryRestoreRefresh(firstApp, 'backup');
    await testCompositeDeleteThenTreeDelete(firstApp, 'sheet');
    await testCompositeDeleteThenTreeDelete(firstApp, 'canvas');

    const persistentNodePath = await createNode(firstApp);
    await typeAndSaveNode(firstApp, persistentNodePath, persistenceMarker);
    assertNoFatalRendererLog(firstApp);

    await stopElectron(firstApp);
    firstApp = null;

    const diskContentAfterExit = await readNodeContent(persistentNodePath);
    if (!diskContentAfterExit.includes(persistenceMarker)) {
        throw new Error('Saved node content disappeared after full Electron exit.');
    }

    secondApp = await launchElectron(9226);
    await waitForTreePath(secondApp, persistentNodePath);
    await clickTreePath(secondApp, persistentNodePath);
    await waitForNodeEditor(secondApp, persistentNodePath);

    await waitUntil(secondApp, 'node content restored after full app restart', async () => {
        return secondApp.cdp.evaluate(
            "document.getElementById('center-node-editor-content')?.textContent?.includes(" + JSON.stringify(persistenceMarker) + ') === true'
        );
    });

    await testRecoveryDepartureAndClose(secondApp);
    assertNoFatalRendererLog(secondApp);
    console.log(
        '[E2E] Critical regressions passed: recovery navigation and normal close, history/backup restore refresh, task projection write-through, Sheet/Canvas delete-to-tree-delete race, and full restart persistence.'
    );
} finally {
    await stopElectron(firstApp);
    await stopElectron(secondApp);
    await fs.rm(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200
    });
}
