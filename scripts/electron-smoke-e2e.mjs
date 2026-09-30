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

    const watcherProbe = await cdp.evaluate(`(async () => {
        window.__pisiFsWatchProbeCount = 0;
        window.__pisiFsWatchProbeOff?.();
        window.__pisiFsWatchProbeOff =
            window.pisiProject?.onFileSystemChanged?.(() => {
                window.__pisiFsWatchProbeCount += 1;
            }) || null;

        const created = await window.pisiProject?.createPisiFile?.(
            window.currentProjectFolder,
            '.node'
        );

        return {
            ok: Boolean(created?.ok && created?.fullPath),
            fullPath: created?.fullPath || null
        };
    })()`);

    if (!watcherProbe?.ok || !watcherProbe.fullPath) {
        throw new Error(
            'Internal watcher probe file could not be created: ' +
            JSON.stringify(watcherProbe)
        );
    }

    await sleep(1000);

    const internalWatchCount = await cdp.evaluate(
        'window.__pisiFsWatchProbeCount || 0'
    );
    if (internalWatchCount !== 0) {
        throw new Error(
            'Internal Pisi write leaked as external filesystem refresh: ' +
            internalWatchCount
        );
    }

    await sleep(500);
    const probeText = await fs.readFile(watcherProbe.fullPath, 'utf8');
    await fs.writeFile(
        watcherProbe.fullPath,
        probeText + '\n',
        'utf8'
    );
    await sleep(900);

    const externalWatchCount = await cdp.evaluate(
        'window.__pisiFsWatchProbeCount || 0'
    );
    if (externalWatchCount < 1) {
        throw new Error(
            'External filesystem change was not delivered to renderer.'
        );
    }

    await cdp.evaluate(`(async () => {
        window.__pisiFsWatchProbeOff?.();
        window.__pisiFsWatchProbeOff = null;
        await window.pisiProject?.deletePisiFile?.(
            ${JSON.stringify(watcherProbe.fullPath)}
        );
    })()`);

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
            return {
                ok: false,
                reason: 'center editor or toolbar missing'
            };
        }

        editorWrapper.hidden = false;
        editorWrapper.style.display = 'block';
        editor.innerHTML = '<div><br></div>';

        const tableTrigger = toolbar.querySelector(
            '[data-pisi-table-trigger]'
        );
        const rollupTrigger = toolbar.querySelector(
            '[data-pisi-rollup-trigger]'
        );
        const toolbarSheetActionsAbsent = !toolbar.querySelector(
            '[data-pisi-excel-action]'
        );
        const tableRect = tableTrigger?.getBoundingClientRect();
        const rollupRect = rollupTrigger?.getBoundingClientRect();

        tableTrigger?.click();

        const table = editor.querySelector('table[data-pisi-sheet]');
        const firstCell = table?.querySelector('td[data-cell="A1"]');

        if (!table || !firstCell) {
            return {
                ok: false,
                reason: 'direct Table insert failed',
                toolbarSheetActionsAbsent
            };
        }

        const directTableSize = {
            rows: table.querySelectorAll('tbody tr').length,
            cols: table.querySelectorAll(
                'tbody tr:first-child td'
            ).length
        };
        const initialEditable =
            firstCell.getAttribute('contenteditable');
        const originalRowId = firstCell.dataset.pisiRowId || '';
        const originalColId = firstCell.dataset.pisiColId || '';

        firstCell.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            detail: 1
        }));

        const selectedAfterClick =
            table.querySelectorAll('.pisi-sheet-cell-range').length;
        const selectionLabel = (targetTable) => {
            const focus =
                window.getPisiSheetSelectionFocus?.(targetTable);

            if (!focus) return '';

            return (
                window.pisiColumnName?.(focus.col) +
                String(focus.row + 1)
            );
        };
        const activeAfterClick = selectionLabel(table);

        firstCell.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight'
        }));

        const secondCell = table.querySelector('td[data-cell="B1"]');
        const activeAfterArrow = selectionLabel(table);

        secondCell?.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter'
        }));

        const editableDuringEdit =
            secondCell?.getAttribute('contenteditable') || '';
        const editingClassDuringEdit =
            secondCell?.classList.contains(
                'pisi-sheet-cell-editing'
            ) === true;

        if (secondCell) {
            secondCell.textContent = '42';
            secondCell.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: '42'
            }));
            secondCell.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter'
            }));
        }

        const activeAfterCommit = selectionLabel(table);
        const committedValue =
            table.querySelector('td[data-cell="B1"]')
                ?.textContent?.trim() || '';
        const editableAfterCommit =
            table.querySelector('td[data-cell="B1"]')
                ?.getAttribute('contenteditable') || '';

        const databaseAfterCommit =
            window.getPisiSheetDatabase?.(table) || null;
        const modelValueAfterCommit =
            window.getPisiSheetCellValue?.(table, 'B1')?.value;
        const modelShapeAfterCommit = {
            databaseId: databaseAfterCommit?.databaseId || '',
            fields: databaseAfterCommit?.fields?.length || 0,
            items: databaseAfterCommit?.items?.length || 0,
            views: databaseAfterCommit?.views?.length || 0,
            activeViewId: databaseAfterCommit?.activeViewId || '',
            firstFieldId: databaseAfterCommit?.fields?.[0]?.id || '',
            firstItemId: databaseAfterCommit?.items?.[0]?.id || ''
        };

        const modelCell = table.querySelector('td[data-cell="B1"]');
        if (modelCell) {
            modelCell.textContent = '999';
        }

        const modelValueAfterDomTamper =
            window.getPisiSheetCellValue?.(table, 'B1')?.value;
        window.recalcPisiSheet?.(table);
        const domValueAfterModelRecalc =
            table.querySelector('td[data-cell="B1"]')
                ?.textContent?.trim() || '';
        const serializedDatabase = (() => {
            try {
                return JSON.parse(
                    table.dataset.pisiSheetModel || '{}'
                );
            } catch {
                return {};
            }
        })();

        const firstHeader = table.querySelector(
            'thead th[data-col-header="0"]'
        );
        const headerHeight =
            firstHeader?.getBoundingClientRect().height || 0;
        const bodyHeight =
            firstCell.getBoundingClientRect().height || 0;

        firstHeader?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0
        }));

        const selectedAfterHeaderClick =
            table.querySelectorAll('.pisi-sheet-cell-range').length;
        const activeAfterHeaderClick = selectionLabel(table);
        const columnMenu = document.querySelector(
            '.pisi-sheet-column-menu'
        );
        const columnNameInput = columnMenu?.querySelector(
            '.pisi-sheet-column-name-input'
        );

        if (columnNameInput) {
            columnNameInput.value = 'Project';
            columnNameInput.dispatchEvent(
                new KeyboardEvent('keydown', {
                    bubbles: true,
                    cancelable: true,
                    key: 'Enter'
                })
            );
        }

        const renamedHeader =
            table.querySelector(
                'thead th[data-col-header="0"] .pisi-sheet-col-label'
            )?.textContent?.trim() || '';

        const renamedModelField =
            window.getPisiSheetField?.(table, 0)?.name || '';

        const resizeHeader = table.querySelector(
            'thead th[data-col-header="0"]'
        );
        const firstResizer = resizeHeader?.querySelector(
            '[data-pisi-sheet-col-resizer="0"]'
        );
        const widthBeforeResize =
            resizeHeader?.getBoundingClientRect().width || 0;

        firstResizer?.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            clientX: 120
        }));
        document.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            buttons: 1,
            clientX: 168
        }));
        document.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 168
        }));

        const widthAfterResize =
            resizeHeader?.getBoundingClientRect().width || 0;
        const bodyWidthAfterResize =
            firstCell.getBoundingClientRect().width || 0;

        const modelWidthAfterResize =
            window.getPisiSheetField?.(table, 0)?.width || 0;

        firstCell.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: 120,
            clientY: 120
        }));

        const menu = document.querySelector(
            '.pisi-sheet-context-menu'
        );
        const menuActions = menu
            ? Array.from(
                menu.querySelectorAll(
                    '[data-pisi-sheet-context-action]'
                )
            ).map((button) => (
                button.dataset.pisiSheetContextAction
            ))
            : [];
        const addRow = menu?.querySelector(
            '[data-pisi-sheet-context-action="addRow"]'
        );
        const rowsBefore =
            table.querySelectorAll('tbody tr').length;

        addRow?.click();

        const firstCellAfterAdd =
            table.querySelector('td[data-cell="A1"]');
        const headerAfterAdd = table.querySelector(
            'thead th[data-col-header="0"]'
        );

        const databaseAfterAdd =
            window.getPisiSheetDatabase?.(table) || null;
        const selectionBeforeDomReplace =
            window.getPisiSheetSelection?.(table) || null;
        const groupIdBeforeDomReplace =
            window.getPisiSheetActiveGroupId?.() || '';
        const focusBeforeDomReplace =
            window.getPisiSheetSelectionFocus?.(table) || null;
        const replacement = table.cloneNode(true);

        table.replaceWith(replacement);
        window.hydratePisiSheets?.(editor);

        const selectionAfterDomReplace =
            window.getPisiSheetSelection?.(replacement) || null;
        const groupIdAfterDomReplace =
            window.getPisiSheetActiveGroupId?.() || '';
        const focusAfterDomReplace =
            window.getPisiSheetSelectionFocus?.(replacement) || null;
        const selectedAfterDomReplace =
            replacement.querySelectorAll(
                '.pisi-sheet-cell-range'
            ).length;
        const activeTableAfterDomReplace =
            window.getPisiSheetActiveTable?.(editor) || null;
        const activeTableDatabaseId =
            activeTableAfterDomReplace?.dataset?.pisiDatabaseId || '';

        return {
            ok: true,
            hasTableTrigger: Boolean(tableTrigger),
            hasRollupTrigger: Boolean(rollupTrigger),
            mainButtonsStacked: Boolean(
                tableRect &&
                rollupRect &&
                rollupRect.top > tableRect.top &&
                Math.abs(
                    rollupRect.left - tableRect.left
                ) <= 1
            ),
            toolbarSheetActionsAbsent,
            directTableSize,
            initialEditable,
            originalRowId,
            originalColId,
            selectedAfterClick,
            activeAfterClick,
            activeAfterArrow,
            editableDuringEdit,
            editingClassDuringEdit,
            activeAfterCommit,
            committedValue,
            editableAfterCommit,
            modelValueAfterCommit,
            modelValueAfterDomTamper,
            domValueAfterModelRecalc,
            modelShapeAfterCommit,
            serializedDatabaseVersion:
                serializedDatabase.version || 0,
            serializedDatabaseId:
                serializedDatabase.databaseId || '',
            headerHeight,
            bodyHeight,
            selectedAfterHeaderClick,
            activeAfterHeaderClick,
            columnMenuPresent: Boolean(columnMenu),
            renamedHeader,
            renamedModelField,
            hasColumnResizer: Boolean(firstResizer),
            widthBeforeResize,
            widthAfterResize,
            bodyWidthAfterResize,
            modelWidthAfterResize,
            contextMenuPresent: Boolean(menu),
            contextMenuActions: menuActions,
            contextMenuClosedAfterAction:
                !document.querySelector(
                    '.pisi-sheet-context-menu'
                ),
            rowsBefore,
            rowsAfter:
                table.querySelectorAll('tbody tr').length,
            modelRowsAfterAdd:
                databaseAfterAdd?.items?.length || 0,
            modelFieldsAfterAdd:
                databaseAfterAdd?.fields?.length || 0,
            selectionBeforeDomReplace,
            selectionAfterDomReplace,
            groupIdBeforeDomReplace,
            groupIdAfterDomReplace,
            focusBeforeDomReplace,
            focusAfterDomReplace,
            selectedAfterDomReplace,
            activeTableDatabaseId,
            stableRowIdAfterAdd:
                firstCellAfterAdd?.dataset.pisiRowId || '',
            stableColIdAfterAdd:
                firstCellAfterAdd?.dataset.pisiColId || '',
            renamedHeaderAfterAdd:
                headerAfterAdd?.querySelector(
                    '.pisi-sheet-col-label'
                )?.textContent?.trim() || '',
            widthAfterAdd:
                headerAfterAdd?.getBoundingClientRect().width || 0,
            tablePopoverPresent: Boolean(
                document.querySelector(
                    '.pisi-office-table-popover'
                )
            )
        };
    })()`);

    if (
        !sheetResult?.ok ||
        !sheetResult.hasTableTrigger ||
        !sheetResult.hasRollupTrigger ||
        !sheetResult.mainButtonsStacked ||
        !sheetResult.toolbarSheetActionsAbsent ||
        sheetResult.directTableSize?.rows !== 5 ||
        sheetResult.directTableSize?.cols !== 5 ||
        sheetResult.initialEditable !== 'false' ||
        !sheetResult.originalRowId ||
        !sheetResult.originalColId ||
        sheetResult.selectedAfterClick !== 1 ||
        sheetResult.activeAfterClick !== 'A1' ||
        sheetResult.activeAfterArrow !== 'B1' ||
        sheetResult.editableDuringEdit !== 'plaintext-only' ||
        !sheetResult.editingClassDuringEdit ||
        sheetResult.activeAfterCommit !== 'B2' ||
        sheetResult.committedValue !== '42' ||
        sheetResult.editableAfterCommit !== 'false' ||
        sheetResult.modelValueAfterCommit !== 42 ||
        sheetResult.modelValueAfterDomTamper !== 42 ||
        sheetResult.domValueAfterModelRecalc !== '42' ||
        !sheetResult.modelShapeAfterCommit.databaseId ||
        sheetResult.modelShapeAfterCommit.fields !== 5 ||
        sheetResult.modelShapeAfterCommit.items !== 5 ||
        sheetResult.modelShapeAfterCommit.views !== 1 ||
        !sheetResult.modelShapeAfterCommit.activeViewId ||
        sheetResult.modelShapeAfterCommit.firstFieldId !==
            sheetResult.originalColId ||
        sheetResult.modelShapeAfterCommit.firstItemId !==
            sheetResult.originalRowId ||
        sheetResult.serializedDatabaseVersion !== 1 ||
        sheetResult.serializedDatabaseId !==
            sheetResult.modelShapeAfterCommit.databaseId ||
        sheetResult.headerHeight > sheetResult.bodyHeight ||
        sheetResult.selectedAfterHeaderClick !== 0 ||
        sheetResult.activeAfterHeaderClick !== '' ||
        !sheetResult.columnMenuPresent ||
        sheetResult.renamedHeader !== 'Project' ||
        sheetResult.renamedModelField !== 'Project' ||
        !sheetResult.hasColumnResizer ||
        sheetResult.widthAfterResize <
            sheetResult.widthBeforeResize + 40 ||
        Math.abs(
            sheetResult.bodyWidthAfterResize -
            sheetResult.widthAfterResize
        ) > 2 ||
        Math.abs(
            sheetResult.modelWidthAfterResize -
            sheetResult.widthAfterResize
        ) > 2 ||
        !sheetResult.contextMenuPresent ||
        JSON.stringify(sheetResult.contextMenuActions) !==
            JSON.stringify([
                'addRow',
                'deleteRow',
                'addCol',
                'deleteCol'
            ]) ||
        !sheetResult.contextMenuClosedAfterAction ||
        sheetResult.rowsAfter !== sheetResult.rowsBefore + 1 ||
        sheetResult.modelRowsAfterAdd !== sheetResult.rowsAfter ||
        sheetResult.modelFieldsAfterAdd !== 5 ||
        !sheetResult.selectionBeforeDomReplace ||
        !sheetResult.selectionAfterDomReplace ||
        !sheetResult.groupIdBeforeDomReplace ||
        sheetResult.groupIdAfterDomReplace !==
            sheetResult.groupIdBeforeDomReplace ||
        sheetResult.selectionBeforeDomReplace.groupId !==
            sheetResult.groupIdBeforeDomReplace ||
        sheetResult.selectionAfterDomReplace.groupId !==
            sheetResult.groupIdBeforeDomReplace ||
        sheetResult.focusAfterDomReplace?.rowId !==
            sheetResult.focusBeforeDomReplace?.rowId ||
        sheetResult.focusAfterDomReplace?.colId !==
            sheetResult.focusBeforeDomReplace?.colId ||
        sheetResult.focusAfterDomReplace?.groupId !==
            sheetResult.groupIdBeforeDomReplace ||
        sheetResult.selectedAfterDomReplace < 1 ||
        sheetResult.activeTableDatabaseId !==
            sheetResult.groupIdBeforeDomReplace ||
        sheetResult.stableRowIdAfterAdd !==
            sheetResult.originalRowId ||
        sheetResult.stableColIdAfterAdd !==
            sheetResult.originalColId ||
        sheetResult.renamedHeaderAfterAdd !== 'Project' ||
        Math.abs(
            sheetResult.widthAfterAdd -
            sheetResult.widthAfterResize
        ) > 2 ||
        sheetResult.tablePopoverPresent
    ) {
        throw new Error(
            'Sheet state/edit architecture failed: ' +
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

    console.log('[E2E] Electron startup, watcher filtering, last-project restore, Sheet toolbar and right-panel interaction passed.');
} finally {
    cdp?.close();
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(400);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
}
