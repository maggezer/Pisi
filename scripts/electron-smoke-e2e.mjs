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
            table.querySelectorAll('.pisi-sheet-cell-selected').length;
        const pointLabel = (point) => {
            if (!point) return '';

            return (
                window.pisiColumnName?.(point.col) +
                String(point.row + 1)
            );
        };
        const selectionFocusLabel = (targetTable) => {
            return pointLabel(
                window.getPisiSheetSelectionFocus?.(
                    targetTable
                )
            );
        };
        const activeCellLabel = (targetTable) => {
            return pointLabel(
                window.getPisiSheetActivePoint?.(
                    targetTable
                )
            );
        };
        const activeAfterClick = activeCellLabel(table);

        const activeCountAfterClick =
            table.querySelectorAll(
                '.pisi-sheet-cell-active'
            ).length;
        const browserFocusStayedOffCell =
            document.activeElement !== firstCell;

        document.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight'
        }));

        const secondCell = table.querySelector('td[data-cell="B1"]');
        const activeAfterArrow = activeCellLabel(table);

        document.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight',
            shiftKey: true
        }));

        const activeAfterRangeExtend = activeCellLabel(table);
        const selectedAfterRangeExtend =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;
        const activeCountAfterRangeExtend =
            table.querySelectorAll(
                '.pisi-sheet-cell-active'
            ).length;

        secondCell?.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            detail: 1
        }));
        document.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            button: 0
        }));

        document.dispatchEvent(new KeyboardEvent('keydown', {
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

        const activeAfterCommit = activeCellLabel(table);
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

        const firstRowHeader = table.querySelector(
            'tbody th[data-row-header="0"]'
        );
        const rowHeaderWidth =
            firstRowHeader?.getBoundingClientRect().width || 0;
        const rowHeaderHeight =
            firstRowHeader?.getBoundingClientRect().height || 0;
        const defaultDataWidth =
            firstCell.getBoundingClientRect().width || 0;

        const formulaInput = toolbar.querySelector(
            '[data-pisi-excel-formula]'
        );
        if (formulaInput) {
            formulaInput.value = '=SUM(';
            formulaInput.dispatchEvent(
                new Event('input', { bubbles: true })
            );
            formulaInput.focus();
            formulaInput.setSelectionRange(
                formulaInput.value.length,
                formulaInput.value.length
            );
        }

        const formulaStartCell = table.querySelector(
            'td[data-cell="A1"]'
        );
        const formulaEndCell = table.querySelector(
            'td[data-cell="C2"]'
        );

        formulaStartCell?.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1
            })
        );
        formulaEndCell?.dispatchEvent(
            new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                buttons: 1
            })
        );
        document.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            button: 0
        }));

        const formulaReferenceValue =
            formulaInput?.value || '';
        const formulaReferenceFocusRetained =
            document.activeElement === formulaInput;
        const formulaReferenceSessionActive =
            window.isPisiSheetFormulaInputActive?.(table) === true;
        const formulaSelectedCount =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;
        const formulaActiveCount =
            table.querySelectorAll(
                '.pisi-sheet-cell-active'
            ).length;
        const formulaActiveLabel = activeCellLabel(table);
        const formulaFocusLabel = selectionFocusLabel(table);

        formulaInput?.blur();
        window.clearPisiSheetFormulaInputSession?.(
            formulaInput
        );

        window.setPisiSheetCellSource?.(
            table,
            3,
            1,
            {
                value: '5',
                formula: null
            }
        );
        window.setPisiSheetCellSource?.(
            table,
            3,
            2,
            {
                value: '6',
                formula: null
            }
        );
        window.recalcPisiSheet?.(table);

        const inCellEditCell = table.querySelector(
            'td[data-cell="A2"]'
        );
        const inCellReferenceCell = table.querySelector(
            'td[data-cell="B4"]'
        );

        inCellEditCell?.dispatchEvent(
            new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                button: 0,
                detail: 2
            })
        );

        if (inCellEditCell) {
            inCellEditCell.textContent = '2+';

            const editRange = document.createRange();
            const editSelection = window.getSelection?.();
            const textNode =
                inCellEditCell.firstChild ||
                inCellEditCell.appendChild(
                    document.createTextNode('2+')
                );

            editRange.setStart(
                textNode,
                textNode.textContent.length
            );
            editRange.collapse(true);
            editSelection?.removeAllRanges();
            editSelection?.addRange(editRange);

            inCellEditCell.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: '+'
                })
            );
        }

        const inCellActiveBeforeReference =
            activeCellLabel(table);

        inCellReferenceCell?.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1
            })
        );
        document.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 0
            })
        );

        const inCellTextAfterReference =
            inCellEditCell?.textContent || '';
        const inCellStillEditing =
            inCellEditCell?.classList.contains(
                'pisi-sheet-cell-editing'
            ) === true;
        const inCellActiveAfterReference =
            activeCellLabel(table);
        const inCellReferenceFocus =
            selectionFocusLabel(table);
        const inCellSelectedCount =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;
        const inCellActiveCount =
            table.querySelectorAll(
                '.pisi-sheet-cell-active'
            ).length;
        const inCellBrowserFocusRetained =
            document.activeElement === inCellEditCell;

        inCellEditCell?.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowRight'
            })
        );

        const inCellTextAfterArrowReference =
            inCellEditCell?.textContent || '';
        const inCellActiveAfterArrowReference =
            activeCellLabel(table);
        const inCellFocusAfterArrowReference =
            selectionFocusLabel(table);
        const inCellSelectedAfterArrowReference =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;
        const inCellFocusRetainedAfterArrowReference =
            document.activeElement === inCellEditCell;

        inCellEditCell?.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter'
            })
        );

        const inCellFormulaSource =
            window.getPisiSheetCellSource?.(
                table,
                1,
                0
            )?.formula || '';
        const inCellFormulaValue =
            window.getPisiSheetCellValue?.(
                table,
                'A2'
            )?.value;
        const inCellRenderedValue =
            table.querySelector(
                'td[data-cell="A2"]'
            )?.textContent?.trim() || '';
        const inCellFormulaModeCleared =
            !table.classList.contains(
                'pisi-sheet-formula-reference-mode'
            );

        window.setPisiSheetCellSource?.(
            table,
            4,
            0,
            {
                value: '10',
                formula: null
            }
        );
        window.setPisiSheetCellSource?.(
            table,
            4,
            1,
            {
                value: '',
                formula: '2+A5'
            }
        );
        window.recalcPisiSheet?.(table);

        const persistenceFormulaBeforeSave =
            window.getPisiSheetCellSource?.(
                table,
                4,
                1
            )?.formula || '';
        const persistenceValueBeforeSave =
            window.getPisiSheetCellValue?.(
                table,
                'B5'
            )?.value;
        const persistenceRenderedBeforeSave =
            table.querySelector(
                'td[data-cell="B5"]'
            )?.textContent?.trim() || '';

        const sanitizedSheetHtml =
            window.sanitizePisiEditorHtml?.(
                table.outerHTML
            ) || '';
        const persistenceHost =
            document.createElement('div');
        persistenceHost.innerHTML =
            sanitizedSheetHtml;
        const reopenedPersistenceTable =
            persistenceHost.querySelector(
                'table[data-pisi-sheet]'
            );

        const persistenceModelAttributeSurvived =
            Boolean(
                reopenedPersistenceTable?.dataset
                    ?.pisiSheetModel
            );
        const persistenceDatabaseIdSurvived =
            Boolean(
                reopenedPersistenceTable?.dataset
                    ?.pisiDatabaseId
            );

        if (reopenedPersistenceTable) {
            window.hydratePisiSheetDatabase?.(
                reopenedPersistenceTable
            );
            window.renderPisiSheetDatabase?.(
                reopenedPersistenceTable
            );
            window.recalcPisiSheet?.(
                reopenedPersistenceTable
            );
        }

        const persistenceFormulaAfterReopen =
            reopenedPersistenceTable
                ? window.getPisiSheetCellSource?.(
                    reopenedPersistenceTable,
                    4,
                    1
                )?.formula || ''
                : '';
        const persistenceValueAfterReopen =
            reopenedPersistenceTable
                ? window.getPisiSheetCellValue?.(
                    reopenedPersistenceTable,
                    'B5'
                )?.value
                : null;
        const persistenceRenderedAfterReopen =
            reopenedPersistenceTable
                ?.querySelector(
                    'td[data-cell="B5"]'
                )
                ?.textContent?.trim() || '';

        const allCellsNonEditableBeforeStage4 =
            Array.from(
                table.querySelectorAll('tbody td[data-cell]')
            ).every((cell) => (
                cell.getAttribute('contenteditable') === 'false'
            ));

        const stage4Cell = table.querySelector(
            'td[data-cell="D3"]'
        );

        stage4Cell?.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1,
                detail: 1
            })
        );
        document.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 0
            })
        );

        const stage4SingleClickEditable =
            stage4Cell?.getAttribute('contenteditable') || '';
        const stage4SingleClickActive =
            activeCellLabel(table);
        const stage4SingleClickNoBrowserFocus =
            document.activeElement !== stage4Cell;

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: '9'
            })
        );

        const stage4TypingEditable =
            stage4Cell?.getAttribute('contenteditable') || '';
        const stage4TypingText =
            stage4Cell?.textContent || '';
        const stage4TypingActive =
            activeCellLabel(table);
        const stage4TypingHasBrowserFocus =
            document.activeElement === stage4Cell;

        stage4Cell?.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Escape'
            })
        );

        const stage4EscapeEditable =
            stage4Cell?.getAttribute('contenteditable') || '';
        const stage4EscapeText =
            stage4Cell?.textContent || '';
        const stage4EscapeModelValue =
            window.getPisiSheetCellSource?.(
                table,
                2,
                3
            )?.value || '';
        const stage4EscapeActive =
            activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter'
            })
        );

        const stage4EnterEditable =
            stage4Cell?.getAttribute('contenteditable') || '';
        const stage4EnterHasBrowserFocus =
            document.activeElement === stage4Cell;

        if (stage4Cell) {
            stage4Cell.textContent = '8';
            stage4Cell.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: '8'
                })
            );
            stage4Cell.dispatchEvent(
                new KeyboardEvent('keydown', {
                    bubbles: true,
                    cancelable: true,
                    key: 'Enter'
                })
            );
        }

        const stage4CommittedValue =
            window.getPisiSheetCellValue?.(
                table,
                'D3'
            )?.value;
        const stage4ActiveAfterEnter =
            activeCellLabel(table);

        window.setPisiSheetCellSource?.(
            table,
            3,
            3,
            {
                value: '5',
                formula: null
            }
        );
        window.recalcPisiSheet?.(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Delete'
            })
        );

        const stage4DeleteModelValue =
            window.getPisiSheetCellSource?.(
                table,
                3,
                3
            )?.value || '';
        const stage4DeleteRenderedValue =
            table.querySelector(
                'td[data-cell="D4"]'
            )?.textContent?.trim() || '';

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowLeft'
            })
        );

        const stage4ActiveAfterArrow =
            activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowLeft',
                shiftKey: true
            })
        );

        const stage4ActiveAfterShiftArrow =
            activeCellLabel(table);
        const stage4SelectedAfterShiftArrow =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Tab'
            })
        );

        const stage4ActiveAfterTab =
            activeCellLabel(table);
        const stage4SelectedAfterTab =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;

        const originalScrollIntoView =
            Element.prototype.scrollIntoView;
        const stage5VisibilityEvents = [];

        Element.prototype.scrollIntoView = function (options) {
            if (this.matches?.('td[data-cell]')) {
                stage5VisibilityEvents.push({
                    cell: this.dataset.cell || '',
                    block: options?.block || '',
                    inline: options?.inline || ''
                });
            }

            if (originalScrollIntoView) {
                return originalScrollIntoView.call(
                    this,
                    options
                );
            }
        };

        const stage6MouseAnchor = table.querySelector(
            'td[data-cell="A1"]'
        );
        const stage6MouseFocus = table.querySelector(
            'td[data-cell="C3"]'
        );

        stage6MouseAnchor?.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1
            })
        );
        stage6MouseFocus?.dispatchEvent(
            new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                buttons: 1
            })
        );
        document.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 0
            })
        );

        const stage6MouseSelection =
            window.getPisiSheetSelection?.(table) || null;
        const stage6MouseAnchorLabel =
            pointLabel(stage6MouseSelection?.anchor);
        const stage6MouseFocusLabel =
            pointLabel(stage6MouseSelection?.focus);
        const stage6MouseActiveLabel =
            pointLabel(stage6MouseSelection?.active);
        const stage6MouseSelectedCount =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowRight',
                shiftKey: true
            })
        );

        const stage6MixedSelection =
            window.getPisiSheetSelection?.(table) || null;
        const stage6MixedAnchorLabel =
            pointLabel(stage6MixedSelection?.anchor);
        const stage6MixedFocusLabel =
            pointLabel(stage6MixedSelection?.focus);
        const stage6MixedActiveLabel =
            pointLabel(stage6MixedSelection?.active);
        const stage6MixedSelectedCount =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowUp'
            })
        );
        const stage5AfterUp = activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowRight'
            })
        );
        const stage5AfterRight = activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowDown'
            })
        );
        const stage5AfterDown = activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowLeft'
            })
        );
        const stage5AfterLeft = activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowUp'
            })
        );
        const stage5AfterSecondUp = activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Tab'
            })
        );
        const stage5AfterTab = activeCellLabel(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Tab',
                shiftKey: true
            })
        );
        const stage5AfterShiftTab = activeCellLabel(table);

        window.setPisiSheetCellSource?.(
            table,
            1,
            3,
            {
                value: '6',
                formula: null
            }
        );
        window.recalcPisiSheet?.(table);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Backspace'
            })
        );

        const stage5BackspaceModelValue =
            window.getPisiSheetCellSource?.(
                table,
                1,
                3
            )?.value || '';
        const stage5BackspaceRenderedValue =
            table.querySelector(
                'td[data-cell="D2"]'
            )?.textContent?.trim() || '';

        const stage5VisibilityCells =
            stage5VisibilityEvents.map(
                (entry) => entry.cell
            );
        const stage5VisibilityAllNearest =
            stage5VisibilityEvents.every(
                (entry) => (
                    entry.block === 'nearest' &&
                    entry.inline === 'nearest'
                )
            );

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Escape'
            })
        );

        const stage5EscapeClearedSelection =
            window.getPisiSheetSelection?.(table) === null;
        const stage5EscapeClearedActive =
            activeCellLabel(table) === '';

        Element.prototype.scrollIntoView =
            originalScrollIntoView;

        const stage7CellA1 = table.querySelector(
            'td[data-cell="A1"]'
        );
        const stage7RowHeader = table.querySelector(
            'tbody th[data-row-header="0"]'
        );

        stage7CellA1?.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1
            })
        );
        document.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 0
            })
        );

        const stage7CellStateBeforeRow =
            window.getPisiSheetSelectionState?.(table) || null;

        stage7RowHeader?.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1
            })
        );
        document.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 0
            })
        );

        const stage7CellStateAfterRow =
            window.getPisiSheetSelectionState?.(table) || null;
        const stage7RowState =
            window.getPisiSheetHeaderSelection?.(table) || null;
        const stage7SelectedRowHeaders =
            table.querySelectorAll(
                'tbody th.pisi-sheet-header-selected'
            ).length;

        const stage7CellB2 = table.querySelector(
            'td[data-cell="B2"]'
        );
        stage7CellB2?.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1
            })
        );
        document.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 0
            })
        );

        const stage7HeaderStateAfterCell =
            window.getPisiSheetHeaderSelection?.(table) || null;
        const stage7CellStateAfterCell =
            window.getPisiSheetSelectionState?.(table) || null;

        const propertyHeader = table.querySelector(
            'thead th[data-col-header="0"]'
        );
        const propertyLabel = propertyHeader?.querySelector(
            '.pisi-sheet-col-label'
        );

        propertyHeader?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0
        }));

        propertyHeader?.dispatchEvent(
            new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                button: 0,
                detail: 2
            })
        );

        const selectedAfterHeaderClick =
            table.querySelectorAll(
                '.pisi-sheet-cell-selected'
            ).length;
        const activeAfterHeaderClick = activeCellLabel(table);
        const stage8HeaderSelectionAfterOpen =
            window.getPisiSheetHeaderSelection?.(table) || null;
        let columnMenu = document.querySelector(
            '.pisi-sheet-column-menu'
        );
        const stage8InlineEditorPresent = Boolean(
            table.querySelector(
                '.pisi-sheet-col-editor, ' +
                '[contenteditable="true"].pisi-sheet-col-label'
            )
        );
        const stage8HeaderContentEditable =
            propertyHeader?.getAttribute(
                'contenteditable'
            ) || '';
        const stage8LabelContentEditable =
            propertyLabel?.getAttribute(
                'contenteditable'
            ) || '';

        const columnNameInput = columnMenu?.querySelector(
            '.pisi-sheet-column-name-input'
        );
        const descriptionInput = columnMenu?.querySelector(
            '.pisi-sheet-column-description-input'
        );
        const typeSelect = columnMenu?.querySelector(
            '.pisi-sheet-column-select'
        );
        const wrapInput = columnMenu?.querySelector(
            '.pisi-sheet-column-property-row input[type="checkbox"]'
        );
        const propertyCheckboxes = columnMenu
            ? Array.from(
                columnMenu.querySelectorAll(
                    '.pisi-sheet-column-property-row ' +
                    'input[type="checkbox"]'
                )
            )
            : [];
        const pinInput = propertyCheckboxes[1] || null;
        const widthInput = columnMenu?.querySelector(
            '.pisi-sheet-column-width-input'
        );
        const autoFitAction = columnMenu?.querySelector(
            '[data-pisi-sheet-column-action="autoFit"]'
        );
        const hideAction = columnMenu?.querySelector(
            '[data-pisi-sheet-column-action="hide"]'
        );
        const deleteColumnAction = columnMenu?.querySelector(
            '[data-pisi-sheet-column-action="delete"]'
        );

        if (columnNameInput) {
            columnNameInput.value = 'Project';
            columnNameInput.dispatchEvent(
                new Event('change', {
                    bubbles: true
                })
            );
        }

        if (descriptionInput) {
            descriptionInput.value = 'Project identifier';
            descriptionInput.dispatchEvent(
                new Event('change', {
                    bubbles: true
                })
            );
        }

        if (typeSelect) {
            typeSelect.value = 'number';
            typeSelect.dispatchEvent(
                new Event('change', {
                    bubbles: true
                })
            );
        }

        if (wrapInput) {
            wrapInput.checked = true;
            wrapInput.dispatchEvent(
                new Event('change', {
                    bubbles: true
                })
            );
        }

        if (pinInput) {
            pinInput.checked = true;
            pinInput.dispatchEvent(
                new Event('change', {
                    bubbles: true
                })
            );
        }

        if (widthInput) {
            widthInput.value = '142';
            widthInput.dispatchEvent(
                new Event('change', {
                    bubbles: true
                })
            );
        }

        const stage8FieldAfterProperties = {
            ...(window.getPisiSheetField?.(table, 0) || {})
        };
        const stage8PinnedHeader = table.querySelector(
            'thead th[data-col-header="0"].pisi-sheet-column-pinned'
        );


        hideAction?.click();

        const stage8HiddenHeader = table.querySelector(
            'thead th[data-col-header="0"]'
        );
        const stage8HiddenAfterAction =
            stage8HiddenHeader?.hidden === true;

        const secondHeaderForUnhide = table.querySelector(
            'thead th[data-col-header="1"]'
        );
        secondHeaderForUnhide?.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0
            })
        );

        columnMenu = document.querySelector(
            '.pisi-sheet-column-menu'
        );
        const showHiddenButton = columnMenu
            ? Array.from(
                columnMenu.querySelectorAll(
                    '[data-pisi-sheet-show-field-id]'
                )
            ).find((button) => (
                button.textContent.includes('Project')
            ))
            : null;

        showHiddenButton?.click();

        const stage8RestoredHeader = table.querySelector(
            'thead th[data-col-header="0"]'
        );
        const stage8HiddenRestored =
            stage8RestoredHeader?.hidden === false;
        const stage8RestoredWrapCell = table.querySelector(
            'tbody td[data-col="0"]'
        );
        const stage8WrappedWhiteSpace =
            stage8RestoredWrapCell
                ? getComputedStyle(
                    stage8RestoredWrapCell
                ).whiteSpace
                : '';
        const stage8DeleteActionPresent =
            Boolean(deleteColumnAction);
        const stage8AutoFitActionPresent =
            Boolean(autoFitAction);

        const renamedHeader =
            table.querySelector(
                'thead th[data-col-header="0"] ' +
                '.pisi-sheet-col-label'
            )?.textContent?.trim() || '';

        const renamedModelField =
            window.getPisiSheetField?.(table, 0)?.name || '';

        const resizeHeader = table.querySelector(
            'thead th[data-col-header="0"]'
        );
        const firstResizer = resizeHeader?.querySelector(
            '[data-pisi-sheet-col-resizer="0"]'
        );

        window.setPisiSheetCellSource?.(
            table,
            0,
            0,
            {
                value: 'A considerably longer Project value',
                formula: null
            }
        );
        window.recalcPisiSheet?.(table);

        firstResizer?.dispatchEvent(
            new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                button: 0,
                detail: 2
            })
        );

        const widthAfterAutoFit =
            resizeHeader?.getBoundingClientRect().width || 0;
        const modelWidthAfterAutoFit =
            window.getPisiSheetField?.(table, 0)?.width || 0;

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
            clientX: 122
        }));
        document.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 122
        }));

        const widthAfterSnapAttempt =
            resizeHeader?.getBoundingClientRect().width || 0;

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
        const resizeBodyCell = table.querySelector(
            'td[data-cell="A1"]'
        );
        const bodyWidthAfterResize =
            resizeBodyCell?.getBoundingClientRect().width || 0;

        const modelWidthAfterResize =
            window.getPisiSheetField?.(table, 0)?.width || 0;

        window.updatePisiSheetField?.(
            table,
            1,
            { pin: true }
        );
        window.renderPisiSheetDatabase?.(table);
        window.recalcPisiSheet?.(table);

        const stage10Block = table.closest(
            '.pisi-sheet-block'
        );
        if (stage10Block) {
            stage10Block.style.width = '260px';
        }

        const stage10PinnedHeader0 = table.querySelector(
            'thead th[data-col-header="0"]'
        );
        const stage10PinnedHeader1 = table.querySelector(
            'thead th[data-col-header="1"]'
        );
        const stage10PinnedPosition0 =
            stage10PinnedHeader0
                ? getComputedStyle(
                    stage10PinnedHeader0
                ).position
                : '';
        const stage10PinnedPosition1 =
            stage10PinnedHeader1
                ? getComputedStyle(
                    stage10PinnedHeader1
                ).position
                : '';
        const stage10PinnedLeft0 =
            stage10PinnedHeader0?.style.left || '';
        const stage10PinnedLeft1 =
            stage10PinnedHeader1?.style.left || '';
        const stage10BeforeScrollLeft =
            stage10PinnedHeader0
                ?.getBoundingClientRect().left || 0;
        const stage10Scrollable = Boolean(
            stage10Block &&
            stage10Block.scrollWidth >
                stage10Block.clientWidth
        );

        if (stage10Block) {
            stage10Block.scrollLeft = 180;
        }

        const stage10AfterScrollLeft =
            stage10PinnedHeader0
                ?.getBoundingClientRect().left || 0;
        const stage10LastPinnedCount =
            table.querySelectorAll(
                'thead .pisi-sheet-column-pinned-last'
            ).length;

        const stage12Database =
            window.getPisiSheetDatabase?.(table) || null;
        const stage12MainViewId =
            stage12Database?.activeViewId || '';
        const stage12TechnicalView =
            window.clonePisiSheetTableView?.(
                table,
                'Technical View'
            ) || null;

        if (stage12TechnicalView) {
            window.activatePisiSheetView?.(
                table,
                stage12TechnicalView.id
            );
            window.setPisiSheetFieldHidden?.(
                table,
                2,
                true
            );
            window.renderPisiSheetDatabase?.(table);
            window.recalcPisiSheet?.(table);
        }

        const stage12TechnicalHidden =
            window.getPisiSheetTableView?.(
                window.getPisiSheetDatabase?.(table)
            )?.hiddenFieldIds?.length || 0;

        window.activatePisiSheetView?.(
            table,
            stage12MainViewId
        );

        const stage12MainHidden =
            window.getPisiSheetTableView?.(
                window.getPisiSheetDatabase?.(table)
            )?.hiddenFieldIds?.length || 0;

        if (stage12TechnicalView) {
            window.activatePisiSheetView?.(
                table,
                stage12TechnicalView.id
            );
        }

        const stage12TechnicalHiddenAfterReturn =
            window.getPisiSheetTableView?.(
                window.getPisiSheetDatabase?.(table)
            )?.hiddenFieldIds?.length || 0;

        window.activatePisiSheetView?.(
            table,
            stage12MainViewId
        );

        const stage13DatabaseBefore =
            window.getPisiSheetDatabase?.(table) || null;
        const stage13ViewBefore =
            window.getPisiSheetTableView?.(
                stage13DatabaseBefore
            ) || null;
        const stage13OrderBefore = [
            ...(stage13ViewBefore?.fieldOrder || [])
        ];
        const stage13OriginalFirstFieldId =
            stage13OrderBefore[0] || '';
        const stage13FormulaFieldId =
            stage13OrderBefore[4] || '';

        window.setPisiSheetCellSource?.(
            table,
            0,
            0,
            { value: '10', formula: null }
        );
        window.setPisiSheetCellSource?.(
            table,
            0,
            1,
            { value: '20', formula: null }
        );
        window.setPisiSheetCellSource?.(
            table,
            0,
            4,
            {
                value: '',
                formula: '=SUM(A1:B1)'
            }
        );
        window.recalcPisiSheet?.(table);

        const stage13FormulaValueBefore =
            table.querySelector(
                'td[data-cell="E1"]'
            )?.textContent?.trim() || '';

        const stage13MoveResult =
            window.movePisiSheetColumn?.(
                table,
                0,
                2,
                { select: false }
            ) || null;
        const stage13DatabaseAfter =
            window.getPisiSheetDatabase?.(table) || null;
        const stage13ViewAfter =
            window.getPisiSheetTableView?.(
                stage13DatabaseAfter
            ) || null;
        const stage13OrderAfter = [
            ...(stage13ViewAfter?.fieldOrder || [])
        ];
        const stage13MovedIndex =
            stage13OrderAfter.indexOf(
                stage13OriginalFirstFieldId
            );
        const stage13FormulaIndex =
            stage13OrderAfter.indexOf(
                stage13FormulaFieldId
            );
        const stage13FormulaSource =
            window.getPisiSheetCellSource?.(
                table,
                0,
                stage13FormulaIndex
            )?.formula || '';
        const stage13FormulaValueAfter =
            table.querySelector(
                'tbody td[data-col="' +
                stage13FormulaIndex +
                '"]'
            )?.textContent?.trim() || '';
        const stage13MovedData =
            stage13DatabaseAfter
                ?.items?.[0]
                ?.values?.[stage13OriginalFirstFieldId]
                ?.value ?? '';
        const stage13MovedHeader =
            table.querySelector(
                'thead th[data-pisi-col-id="' +
                stage13OriginalFirstFieldId +
                '"]'
            );
        const stage13MovedHeaderLabel =
            stage13MovedHeader
                ?.querySelector(
                    '.pisi-sheet-col-label'
                )
                ?.textContent?.trim() || '';
        const stage13MovedHeaderPinned =
            stage13MovedHeader
                ?.classList.contains(
                    'pisi-sheet-column-pinned'
                ) || false;
        const stage13NewFirstFieldId =
            stage13OrderAfter[0] || '';

        const currentFirstCell = table.querySelector(
            'td[data-cell="A1"]'
        );

        currentFirstCell?.dispatchEvent(new MouseEvent('contextmenu', {
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
            'thead th[data-pisi-col-id="' +
            stage13OriginalFirstFieldId +
            '"]'
        );

        const databaseAfterAdd =
            window.getPisiSheetDatabase?.(table) || null;
        const widthAfterAddBeforeDomReplace =
            headerAfterAdd?.getBoundingClientRect().width || 0;
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
                '.pisi-sheet-cell-selected'
            ).length;
        const activeTableAfterDomReplace =
            window.getPisiSheetActiveTable?.(editor) || null;
        const activeTableDatabaseId =
            activeTableAfterDomReplace?.dataset?.pisiDatabaseId || '';
        const widthAfterDomReplace =
            replacement.querySelector(
                'thead th[data-pisi-col-id="' +
                stage13OriginalFirstFieldId +
                '"]'
            )?.getBoundingClientRect().width || 0;

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
            activeCountAfterClick,
            browserFocusStayedOffCell,
            activeAfterArrow,
            activeAfterRangeExtend,
            selectedAfterRangeExtend,
            activeCountAfterRangeExtend,
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
            rowHeaderWidth,
            rowHeaderHeight,
            defaultDataWidth,
            formulaReferenceValue,
            formulaReferenceFocusRetained,
            formulaReferenceSessionActive,
            formulaSelectedCount,
            formulaActiveCount,
            formulaActiveLabel,
            formulaFocusLabel,
            inCellActiveBeforeReference,
            inCellTextAfterReference,
            inCellStillEditing,
            inCellActiveAfterReference,
            inCellReferenceFocus,
            inCellSelectedCount,
            inCellActiveCount,
            inCellBrowserFocusRetained,
            inCellTextAfterArrowReference,
            inCellActiveAfterArrowReference,
            inCellFocusAfterArrowReference,
            inCellSelectedAfterArrowReference,
            inCellFocusRetainedAfterArrowReference,
            inCellFormulaSource,
            inCellFormulaValue,
            inCellRenderedValue,
            inCellFormulaModeCleared,
            persistenceFormulaBeforeSave,
            persistenceValueBeforeSave,
            persistenceRenderedBeforeSave,
            persistenceModelAttributeSurvived,
            persistenceDatabaseIdSurvived,
            persistenceFormulaAfterReopen,
            persistenceValueAfterReopen,
            persistenceRenderedAfterReopen,
            allCellsNonEditableBeforeStage4,
            stage4SingleClickEditable,
            stage4SingleClickActive,
            stage4SingleClickNoBrowserFocus,
            stage4TypingEditable,
            stage4TypingText,
            stage4TypingActive,
            stage4TypingHasBrowserFocus,
            stage4EscapeEditable,
            stage4EscapeText,
            stage4EscapeModelValue,
            stage4EscapeActive,
            stage4EnterEditable,
            stage4EnterHasBrowserFocus,
            stage4CommittedValue,
            stage4ActiveAfterEnter,
            stage4DeleteModelValue,
            stage4DeleteRenderedValue,
            stage4ActiveAfterArrow,
            stage4ActiveAfterShiftArrow,
            stage4SelectedAfterShiftArrow,
            stage4ActiveAfterTab,
            stage4SelectedAfterTab,
            stage6MouseAnchorLabel,
            stage6MouseFocusLabel,
            stage6MouseActiveLabel,
            stage6MouseSelectedCount,
            stage6MixedAnchorLabel,
            stage6MixedFocusLabel,
            stage6MixedActiveLabel,
            stage6MixedSelectedCount,
            stage5AfterUp,
            stage5AfterRight,
            stage5AfterDown,
            stage5AfterLeft,
            stage5AfterSecondUp,
            stage5AfterTab,
            stage5AfterShiftTab,
            stage5BackspaceModelValue,
            stage5BackspaceRenderedValue,
            stage5VisibilityCells,
            stage5VisibilityAllNearest,
            stage5EscapeClearedSelection,
            stage5EscapeClearedActive,
            stage7CellStateBeforeRow,
            stage7CellStateAfterRow,
            stage7RowState,
            stage7SelectedRowHeaders,
            stage7HeaderStateAfterCell,
            stage7CellStateAfterCell,
            selectedAfterHeaderClick,
            activeAfterHeaderClick,
            stage8HeaderSelectionAfterOpen,
            stage8InlineEditorPresent,
            stage8HeaderContentEditable,
            stage8LabelContentEditable,
            columnMenuPresent: Boolean(columnMenu),
            stage8FieldAfterProperties,
            stage8PinnedHeaderPresent: Boolean(stage8PinnedHeader),
            stage8WrappedWhiteSpace,
            stage8HiddenAfterAction,
            stage8HiddenRestored,
            stage8DeleteActionPresent,
            stage8AutoFitActionPresent,
            renamedHeader,
            renamedModelField,
            hasColumnResizer: Boolean(firstResizer),
            widthAfterAutoFit,
            modelWidthAfterAutoFit,
            widthAfterSnapAttempt,
            widthBeforeResize,
            widthAfterResize,
            bodyWidthAfterResize,
            modelWidthAfterResize,
            stage10PinnedPosition0,
            stage10PinnedPosition1,
            stage10PinnedLeft0,
            stage10PinnedLeft1,
            stage10BeforeScrollLeft,
            stage10AfterScrollLeft,
            stage10Scrollable,
            stage10LastPinnedCount,
            stage12MainViewId,
            stage12TechnicalViewId:
                stage12TechnicalView?.id || '',
            stage12TechnicalHidden,
            stage12MainHidden,
            stage12TechnicalHiddenAfterReturn,
            stage13OrderBefore,
            stage13OrderAfter,
            stage13OriginalFirstFieldId,
            stage13FormulaFieldId,
            stage13MoveTo:
                stage13MoveResult?.toIndex ?? -1,
            stage13MovedIndex,
            stage13FormulaValueBefore,
            stage13FormulaSource,
            stage13FormulaValueAfter,
            stage13MovedData,
            stage13MovedHeaderLabel,
            stage13MovedHeaderPinned,
            stage13NewFirstFieldId,
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
                widthAfterAddBeforeDomReplace,
            widthAfterDomReplace,
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
        sheetResult.activeCountAfterClick !== 1 ||
        !sheetResult.browserFocusStayedOffCell ||
        sheetResult.activeAfterArrow !== 'B1' ||
        sheetResult.activeAfterRangeExtend !== 'C1' ||
        sheetResult.selectedAfterRangeExtend !== 2 ||
        sheetResult.activeCountAfterRangeExtend !== 1 ||
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
        sheetResult.rowHeaderWidth > 40 ||
        sheetResult.rowHeaderHeight > 30 ||
        sheetResult.defaultDataWidth < 90 ||
        sheetResult.formulaReferenceValue !== '=SUM(A1:C2' ||
        !sheetResult.formulaReferenceSessionActive ||
        sheetResult.formulaSelectedCount !== 6 ||
        sheetResult.formulaActiveCount !== 1 ||
        sheetResult.formulaActiveLabel !== 'B2' ||
        sheetResult.formulaFocusLabel !== 'C2' ||
        sheetResult.inCellActiveBeforeReference !== 'A2' ||
        sheetResult.inCellTextAfterReference !== '2+B4' ||
        !sheetResult.inCellStillEditing ||
        sheetResult.inCellActiveAfterReference !== 'A2' ||
        sheetResult.inCellReferenceFocus !== 'B4' ||
        sheetResult.inCellSelectedCount !== 1 ||
        sheetResult.inCellActiveCount !== 1 ||
        !sheetResult.inCellBrowserFocusRetained ||
        sheetResult.inCellTextAfterArrowReference !== '2+C4' ||
        sheetResult.inCellActiveAfterArrowReference !== 'A2' ||
        sheetResult.inCellFocusAfterArrowReference !== 'C4' ||
        sheetResult.inCellSelectedAfterArrowReference !== 1 ||
        !sheetResult.inCellFocusRetainedAfterArrowReference ||
        sheetResult.inCellFormulaSource !== '2+C4' ||
        sheetResult.inCellFormulaValue !== 8 ||
        sheetResult.inCellRenderedValue !== '8' ||
        !sheetResult.inCellFormulaModeCleared ||
        sheetResult.persistenceFormulaBeforeSave !== '2+A5' ||
        sheetResult.persistenceValueBeforeSave !== 12 ||
        sheetResult.persistenceRenderedBeforeSave !== '12' ||
        !sheetResult.persistenceModelAttributeSurvived ||
        !sheetResult.persistenceDatabaseIdSurvived ||
        sheetResult.persistenceFormulaAfterReopen !== '2+A5' ||
        sheetResult.persistenceValueAfterReopen !== 12 ||
        sheetResult.persistenceRenderedAfterReopen !== '12' ||
        !sheetResult.allCellsNonEditableBeforeStage4 ||
        sheetResult.stage4SingleClickEditable !== 'false' ||
        sheetResult.stage4SingleClickActive !== 'D3' ||
        !sheetResult.stage4SingleClickNoBrowserFocus ||
        sheetResult.stage4TypingEditable !== 'plaintext-only' ||
        sheetResult.stage4TypingText !== '9' ||
        sheetResult.stage4TypingActive !== 'D3' ||
        !sheetResult.stage4TypingHasBrowserFocus ||
        sheetResult.stage4EscapeEditable !== 'false' ||
        sheetResult.stage4EscapeText !== '' ||
        sheetResult.stage4EscapeModelValue !== '' ||
        sheetResult.stage4EscapeActive !== 'D3' ||
        sheetResult.stage4EnterEditable !== 'plaintext-only' ||
        !sheetResult.stage4EnterHasBrowserFocus ||
        sheetResult.stage4CommittedValue !== 8 ||
        sheetResult.stage4ActiveAfterEnter !== 'D4' ||
        sheetResult.stage4DeleteModelValue !== '' ||
        sheetResult.stage4DeleteRenderedValue !== '' ||
        sheetResult.stage4ActiveAfterArrow !== 'C4' ||
        sheetResult.stage4ActiveAfterShiftArrow !== 'B4' ||
        sheetResult.stage4SelectedAfterShiftArrow !== 2 ||
        sheetResult.stage4ActiveAfterTab !== 'C4' ||
        sheetResult.stage4SelectedAfterTab !== 1 ||
        sheetResult.stage6MouseAnchorLabel !== 'A1' ||
        sheetResult.stage6MouseFocusLabel !== 'C3' ||
        sheetResult.stage6MouseActiveLabel !== 'C3' ||
        sheetResult.stage6MouseSelectedCount !== 9 ||
        sheetResult.stage6MixedAnchorLabel !== 'A1' ||
        sheetResult.stage6MixedFocusLabel !== 'D3' ||
        sheetResult.stage6MixedActiveLabel !== 'D3' ||
        sheetResult.stage6MixedSelectedCount !== 12 ||
        sheetResult.stage5AfterUp !== 'D2' ||
        sheetResult.stage5AfterRight !== 'E2' ||
        sheetResult.stage5AfterDown !== 'E3' ||
        sheetResult.stage5AfterLeft !== 'D3' ||
        sheetResult.stage5AfterSecondUp !== 'D2' ||
        sheetResult.stage5AfterTab !== 'E2' ||
        sheetResult.stage5AfterShiftTab !== 'D2' ||
        sheetResult.stage5BackspaceModelValue !== '' ||
        sheetResult.stage5BackspaceRenderedValue !== '' ||
        JSON.stringify(sheetResult.stage5VisibilityCells) !==
            JSON.stringify([
                'C3',
                'D3',
                'D2',
                'E2',
                'E3',
                'D3',
                'D2',
                'E2',
                'D2'
            ]) ||
        !sheetResult.stage5VisibilityAllNearest ||
        !sheetResult.stage5EscapeClearedSelection ||
        !sheetResult.stage5EscapeClearedActive ||
        sheetResult.stage7CellStateBeforeRow?.mode !== 'cell' ||
        sheetResult.stage7CellStateAfterRow !== null ||
        sheetResult.stage7RowState?.mode !== 'row' ||
        sheetResult.stage7SelectedRowHeaders !== 1 ||
        sheetResult.stage7HeaderStateAfterCell !== null ||
        sheetResult.stage7CellStateAfterCell?.mode !== 'cell' ||
        sheetResult.selectedAfterHeaderClick !== 0 ||
        sheetResult.activeAfterHeaderClick !== '' ||
        sheetResult.stage8HeaderSelectionAfterOpen !== null ||
        sheetResult.stage8InlineEditorPresent ||
        sheetResult.stage8HeaderContentEditable !== '' ||
        sheetResult.stage8LabelContentEditable !== '' ||
        !sheetResult.columnMenuPresent ||
        sheetResult.stage8FieldAfterProperties?.name !== 'Project' ||
        sheetResult.stage8FieldAfterProperties?.description !==
            'Project identifier' ||
        sheetResult.stage8FieldAfterProperties?.type !== 'number' ||
        sheetResult.stage8FieldAfterProperties?.wrap !== true ||
        sheetResult.stage8FieldAfterProperties?.pin !== true ||
        sheetResult.stage8FieldAfterProperties?.width !== 142 ||
        !sheetResult.stage8PinnedHeaderPresent ||
        ![
            'normal',
            'pre-wrap',
            'break-spaces'
        ].includes(sheetResult.stage8WrappedWhiteSpace) ||
        !sheetResult.stage8HiddenAfterAction ||
        !sheetResult.stage8HiddenRestored ||
        !sheetResult.stage8DeleteActionPresent ||
        !sheetResult.stage8AutoFitActionPresent ||
        sheetResult.renamedHeader !== 'Project' ||
        sheetResult.renamedModelField !== 'Project' ||
        !sheetResult.hasColumnResizer ||
        sheetResult.widthAfterAutoFit < 64 ||
        sheetResult.widthAfterAutoFit > 480 ||
        Math.abs(
            sheetResult.modelWidthAfterAutoFit -
            sheetResult.widthAfterAutoFit
        ) > 2 ||
        Math.abs(
            sheetResult.widthAfterSnapAttempt -
            sheetResult.widthAfterAutoFit
        ) > 2 ||
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
        sheetResult.stage10PinnedPosition0 !== 'sticky' ||
        sheetResult.stage10PinnedPosition1 !== 'sticky' ||
        sheetResult.stage10PinnedLeft0 !== '36px' ||
        Number.parseFloat(
            sheetResult.stage10PinnedLeft1
        ) <= 36 ||
        !sheetResult.stage10Scrollable ||
        Math.abs(
            sheetResult.stage10AfterScrollLeft -
            sheetResult.stage10BeforeScrollLeft
        ) > 2 ||
        sheetResult.stage10LastPinnedCount !== 1 ||
        !sheetResult.stage12MainViewId ||
        !sheetResult.stage12TechnicalViewId ||
        sheetResult.stage12TechnicalHidden !== 1 ||
        sheetResult.stage12MainHidden !== 0 ||
        sheetResult.stage12TechnicalHiddenAfterReturn !== 1 ||
        sheetResult.stage13OrderBefore?.length !== 5 ||
        sheetResult.stage13OrderAfter?.length !== 5 ||
        sheetResult.stage13MoveTo !== 2 ||
        sheetResult.stage13MovedIndex !== 2 ||
        sheetResult.stage13OrderAfter?.[0] !==
            sheetResult.stage13OrderBefore?.[1] ||
        sheetResult.stage13OrderAfter?.[2] !==
            sheetResult.stage13OriginalFirstFieldId ||
        String(sheetResult.stage13MovedData) !== '10' ||
        sheetResult.stage13MovedHeaderLabel !== 'Project' ||
        !sheetResult.stage13MovedHeaderPinned ||
        sheetResult.stage13FormulaValueBefore !== '30' ||
        sheetResult.stage13FormulaSource !==
            '=SUM(A1:A1,C1:C1)' ||
        sheetResult.stage13FormulaValueAfter !== '30' ||
        !sheetResult.stage13NewFirstFieldId ||
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
            sheetResult.stage13NewFirstFieldId ||
        sheetResult.renamedHeaderAfterAdd !== 'Project' ||
        Math.abs(
            sheetResult.widthAfterAdd -
            sheetResult.widthAfterResize
        ) > 2 ||
        Math.abs(
            sheetResult.widthAfterDomReplace -
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
