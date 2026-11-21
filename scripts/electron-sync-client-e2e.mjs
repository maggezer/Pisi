// Pisi Sync on the desktop, end to end (docs/sync-plan.md S3 step 9, rules SV4, SV5, SV6, SV13).
// A real Electron app and a real PHP test server (scripts/start-sync-test-server.mjs):
//   1. Settings → Senkron opens a space; the project (a copy of tests/fixtures/desktop-project)
//      is uploaded. A second device — the engine of tests/sync-client-device.mjs, as a phone —
//      pairs through the pairing window with the code and the verification number.
//   2. While the user types in an open note, the phone changes another block and a turn runs:
//      that block updates, the typed text stays, the caret stays in its block at its place,
//      the scroll position and the tabs stay, the other block elements are the same DOM
//      nodes, and loadProject is not called (no pisi:project-loaded event).
//   3. Both sides change the same block: one conflict copy appears in the tree and Project
//      Integrity reports no new finding.
//   4. §5d / SV13: a task the phone completed stays completed after the task panel is opened
//      and closed and after its note is edited and saved (notes carry task ids only, G2).
//   5. A repeating task completed on the desktop stays one record and moves on (§3.2.3).
// Needs MariaDB (PISI_SYNC_TEST_DB_*) and PHP; CI runs it from npm run test:sync-server under xvfb.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keepPagePromise } from './e2e-cdp.mjs';
import { startSyncTestServer } from './start-sync-test-server.mjs';
import { claimWithCode, createTestDevice, serverUrlOf } from '../tests/sync-client-device.mjs';

const PISI_E2E_CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9231;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-sync-client-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');
const NOTE = 'Senkron Notu.node';
const NOTE_ID = 'node_5e4c7a10-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const blockId = (index) => `blk_e2e00000-0000-4000-8000-${String(index).padStart(12, '0')}`;

await fs.cp(path.join(repoRoot, 'tests', 'fixtures', 'desktop-project'), projectPath, {
    recursive: true,
    filter: (source) => !source.includes('.pisi-history')
});
for (const folder of JSON.parse(await fs.readFile(path.join(repoRoot, 'tests', 'fixtures', 'desktop-project.directories.json'), 'utf8'))) {
    if (!folder.includes('.pisi-history')) await fs.mkdir(path.join(projectPath, folder), { recursive: true });
}
const paragraphs = Array.from({ length: 14 }, (_value, index) => `Paragraf ${index + 1}: ${'senkron metni '.repeat(40)}`);
await fs.writeFile(
    path.join(projectPath, NOTE),
    JSON.stringify(
        {
            pisi: {
                version: 1,
                type: 'node',
                id: NOTE_ID,
                title: 'Senkron Notu',
                sidecar: `inv_Senkron Notu__${NOTE_ID}`,
                createdAt: '2026-11-17T08:00:00.000Z',
                updatedAt: '2026-11-17T08:00:00.000Z',
                parentMap: 'none'
            },
            content: paragraphs
                .map(
                    (text, index) =>
                        `<div class="pisi-editor-block" data-pisi-block-id="${blockId(index + 1)}" data-pisi-block-type="paragraph" data-pisi-section-level="0">${text}</div>`
                )
                .join('')
        },
        null,
        2
    )
);
await fs.mkdir(path.join(projectPath, `inv_Senkron Notu__${NOTE_ID}`), { recursive: true });
await fs.mkdir(userDataPath, { recursive: true });
await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2));

const server = await startSyncTestServer();
const child = spawn(
    electronPath,
    ['--remote-debugging-port=' + port, ...PISI_E2E_CHROMIUM_FLAGS, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot],
    {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_SYNC_ALLOW_LOOPBACK_HTTP: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
    }
);
let logs = '';
const collect = (chunk) => {
    logs += String(chunk || '');
};
child.stdout?.on('data', collect);
child.stderr?.on('data', collect);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(label, probe, timeoutMs = 20000) {
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
        await sleep(120);
    }
    throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue) + '\n' + logs.slice(-4000));
}

function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
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

async function waitForPage() {
    return waitUntil('Electron DevTools page', async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const pages = await response.json();
        return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
    });
}

const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(projectPath, ...relative.split('/')), 'utf8'));
const notePath = path.join(projectPath, NOTE);

// The caret, the typed text and the identity of the block elements of the open note.
const editorProbe = `(() => {
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
        dirty: Boolean(window.activeCenterNode?.dirty),
        tabs: (window.Pisi?.state?.openTabs || []).map((tab) => tab.path),
        activeTab: window.Pisi?.state?.activeTabPath || null,
        caret,
        scrollTop: scroller ? scroller.scrollTop : null,
        blocks: Array.from(editor?.children || []).map((block) => ({ id: block.dataset.pisiBlockId || null, mark: block.__pisiE2EMark || null, text: block.textContent })),
        loadCount: window.__pisiE2ELoadCount || 0,
        syncUpdates: window.__pisiE2ESyncUpdates || []
    };
})()`;

async function runAppTurn(cdp) {
    const result = await cdp.evaluate('window.pisiSyncClient.run("manual")');
    assert(result?.ok, 'App sync turn failed', result);
    return result;
}

let cdp;
const phone = createTestDevice(server, { name: 'Pixel E2E' });
try {
    const page = await waitForPage();
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');
    await waitUntil('project opened', () =>
        cdp.evaluate(`document.readyState === 'complete' && window.currentProjectFolder === ${JSON.stringify(projectPath)}`)
    );
    await cdp.evaluate(`(() => {
        window.__pisiE2ELoadCount = 0;
        document.addEventListener('pisi:project-loaded', () => { window.__pisiE2ELoadCount += 1; });
        window.__pisiE2ESyncUpdates = [];
        document.addEventListener('pisi:sync-note-updated', (event) => window.__pisiE2ESyncUpdates.push(event.detail));
        return true;
    })()`);
    const integrityBefore = await cdp.evaluate(`window.pisiDomain.query('integrity.audit.v1', { projectFolder: window.currentProjectFolder })`);
    assert(Array.isArray(integrityBefore?.issues), 'Integrity audit failed', integrityBefore);
    const issueKey = (issue) => [issue.code, issue.path || issue.filePath || '', issue.taskId || issue.id || ''].join('|');
    const issuesBefore = new Set(integrityBefore.issues.map(issueKey));
    assert(issuesBefore.size === 0, 'The fixture project starts without Integrity findings', integrityBefore.issues);

    // 1. Settings → Senkron: open a space; the first turn uploads the project.
    const created = await cdp.evaluate(`(async () => {
        const container = document.createElement('div');
        container.id = 'pisi-e2e-settings';
        document.body.append(container);
        document.dispatchEvent(new CustomEvent('pisi:render-settings-sections', { detail: { container } }));
        const form = await new Promise((resolve) => {
            const started = performance.now();
            const poll = () => {
                const found = container.querySelector('[data-pisi-sync-form="create"]');
                if (found || performance.now() - started > 5000) resolve(found);
                else setTimeout(poll, 50);
            };
            poll();
        });
        if (!form) return { ok: false, reason: 'create form missing', html: container.innerHTML.slice(0, 500) };
        form.querySelector('[data-pisi-sync-field="serverUrl"]').value = ${JSON.stringify(serverUrlOf(server))};
        form.querySelector('[data-pisi-sync-field="setupKey"]').value = ${JSON.stringify(server.setupKey)};
        form.querySelector('[data-pisi-sync-action="create"]').click();
        return { ok: true };
    })()`);
    assert(created?.ok, 'Settings sync form', created);
    const firstRun = await waitUntil('first upload', async () => {
        const status = await cdp.evaluate('window.pisiSyncClient.status()');
        if (status?.configured && status.lastRun?.ok && !status.running) return status;
        const notes = await cdp.evaluate(`document.querySelector('.pisi-notifications')?.textContent || ''`);
        throw new Error(JSON.stringify({ status, notes }));
    });
    assert(firstRun.role === 'admin', 'Desktop must be the admin', firstRun);
    const uploaded = Number(server.sql('SELECT COUNT(*) AS n FROM heads').rows[0].n);
    assert(uploaded >= 10, 'The project must be uploaded', uploaded);

    // The pairing window: code, the phone's claim and the verification number.
    await cdp.evaluate('window.openPisiSyncPairingDialog()');
    const code = await waitUntil('pairing code', () => cdp.evaluate(`document.querySelector('[data-pisi-sync-pairing-code]')?.textContent || null`));
    const qrDrawn = await cdp.evaluate(`Boolean(document.querySelector('[data-pisi-sync-pairing-qr] svg path')?.getAttribute('d'))`);
    assert(qrDrawn, 'Pairing QR must be drawn');
    const claim = await claimWithCode(server, phone, code);
    const shown = await waitUntil('verification number on desktop', () =>
        cdp.evaluate(`(() => {
            const sas = document.querySelector('[data-pisi-sync-pairing-sas]');
            const claim = document.querySelector('[data-pisi-sync-pairing-claim]');
            return sas && !sas.hidden && claim && !claim.hidden && sas.querySelector('strong')?.textContent ? { sas: sas.querySelector('strong')?.textContent, device: document.querySelector('[data-pisi-sync-pairing-device]')?.textContent } : null;
        })()`)
    );
    assert(shown.sas === claim.sas, 'Both screens must show the same verification number', { shown, phone: claim.sas });
    assert(shown.device.includes('Pixel E2E'), 'The phone name must be shown', shown);
    await cdp.evaluate(`document.querySelector('[data-pisi-sync-pairing-accept]').click()`);
    const joined = await claim.finish();
    assert(joined.role === 'member', 'The phone must be a member', joined);
    await cdp.evaluate('window.closePisiSyncPairingDialog()');
    const pulled = await phone.sync();
    assert(pulled.ok, 'Phone first download', pulled);
    assert(phone.read(NOTE) === (await fs.readFile(notePath, 'utf8')), 'The phone must get the note byte for byte');

    // 2. The note is open, the caret in block 3, the user types; the phone changes block 9.
    const opened = await cdp.evaluate(`(async () => {
        await openPisiFileTab({ fullPath: ${JSON.stringify(notePath)}, name: ${JSON.stringify(NOTE)}, fileName: ${JSON.stringify(NOTE)}, isFile: true, type: 'file' });
        return window.activeCenterNode?.path || null;
    })()`);
    assert(opened === notePath, 'Note must open', opened);
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        for (const block of editor.children) block.__pisiE2EMark = block.dataset.pisiBlockId;
        const block = editor.querySelector('[data-pisi-block-id="${blockId(3)}"]');
        editor.focus();
        const text = block.firstChild;
        const range = document.createRange();
        range.setStart(text, 12);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let scroller = editor;
        while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        if (scroller) scroller.scrollTop = 140;
        return true;
    })()`);
    await cdp.request('Input.insertText', { text: 'YAZILAN-1 ' });
    const phoneNote = phone.readJson(NOTE);
    phoneNote.content = phoneNote.content.replace(`${paragraphs[8]}</div>`, `Telefondan değişti: dokuzuncu paragraf</div>`);
    phone.write(NOTE, phoneNote);
    assert((await phone.sync()).ok, 'Phone push');
    const before = await cdp.evaluate(editorProbe);
    // The turn starts while the user keeps typing.
    const turn = cdp.evaluate('window.pisiSyncClient.run("manual")');
    await cdp.request('Input.insertText', { text: 'YAZILAN-2 ' });
    const turnResult = await turn;
    assert(turnResult?.ok, 'App turn while typing', turnResult);
    // A turn that had to defer the dirty note applies it on the next one.
    await waitUntil('remote block applied', async () => {
        const state = await cdp.evaluate(editorProbe);
        if (state.blocks.find((block) => block.id === blockId(9))?.text.includes('Telefondan değişti')) return true;
        await runAppTurn(cdp);
        return false;
    });
    const after = await cdp.evaluate(editorProbe);
    const typedBlock = after.blocks.find((block) => block.id === blockId(3));
    assert(typedBlock.text.slice(12).startsWith('YAZILAN-1 YAZILAN-2 '), 'Typed text must stay where it was typed', typedBlock);
    assert(
        after.caret?.blockId === blockId(3) && after.caret.before === 12 + 'YAZILAN-1 YAZILAN-2 '.length,
        'Caret must stay in its block and place',
        after.caret
    );
    assert(after.scrollTop === before.scrollTop, 'Scroll must stay', { before: before.scrollTop, after: after.scrollTop });
    assert(JSON.stringify(after.tabs) === JSON.stringify(before.tabs) && after.activeTab === before.activeTab, 'Tabs must stay', { before, after });
    for (const block of after.blocks) {
        if (block.id === blockId(9)) assert(block.mark === null, 'The changed block is replaced');
        else assert(block.mark === block.id, 'Unchanged blocks must not be redrawn', block.id);
    }
    assert(after.loadCount === 0, 'loadProject must not run during sync', after.loadCount);
    await waitUntil('typed text saved', async () => (await fs.readFile(notePath, 'utf8')).includes('YAZILAN-2'));
    await runAppTurn(cdp);
    assert((await phone.sync()).ok, 'Phone pull');
    const phoneText = phone.read(NOTE);
    assert(phoneText.includes('YAZILAN-1 YAZILAN-2') && phoneText.includes('Telefondan değişti'), 'Both edits must reach the phone');

    // 3. The same block on both sides: one conflict copy, visible in the tree, no new Integrity finding.
    const conflictNote = phone.readJson(NOTE);
    conflictNote.content = conflictNote.content.replace(paragraphs[0], 'Paragraf 1: telefonun sürümü');
    phone.write(NOTE, conflictNote);
    assert((await phone.sync()).ok, 'Phone push of the conflicting block');
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const block = editor.querySelector('[data-pisi-block-id="${blockId(1)}"]');
        const range = document.createRange();
        range.setStart(block.firstChild, 11);
        range.collapse(true);
        editor.focus();
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    })()`);
    await cdp.request('Input.insertText', { text: ' masaüstünün sürümü ' });
    await cdp.evaluate('window.flushPisiPendingSaves()');
    await runAppTurn(cdp);
    const copies = await waitUntil('conflict copy in the project', async () => {
        const names = (await fs.readdir(projectPath)).filter((name) => name.endsWith('.node') && name.includes('çakışma'));
        return names.length ? names : null;
    });
    assert(copies.length === 1, 'Exactly one conflict copy', copies);
    const copyPath = path.join(projectPath, copies[0]);
    await waitUntil('conflict copy in the tree', () =>
        cdp.evaluate(`Array.from(document.querySelectorAll('.tree-node[data-path]')).some((node) => node.dataset.path === ${JSON.stringify(copyPath)})`)
    );
    const merged = await fs.readFile(notePath, 'utf8');
    const copy = await fs.readFile(copyPath, 'utf8');
    assert(
        (merged + copy).includes('telefonun sürümü') && (merged + copy).includes('masaüstünün sürümü'),
        'Both versions of the block must survive (note or copy)'
    );
    const integrityAfter = await cdp.evaluate(`window.pisiDomain.query('integrity.audit.v1', { projectFolder: window.currentProjectFolder })`);
    const newIssues = integrityAfter.issues.filter((issue) => !issuesBefore.has(issueKey(issue)));
    assert(newIssues.length === 0, 'Sync must not add Project Integrity findings', newIssues);

    // 4. SV13: the phone completes a task whose source is a note block.
    assert((await phone.sync()).ok, 'Phone pull before the task change');
    const tasks = phone.readJson('.pisi/tasks.json');
    const task = tasks.tasks.find((item) => item.title === 'Raporu gönder');
    const TASK_ID = task?.id;
    assert(task && task.status === 'todo', 'Fixture task', task);
    task.status = 'done';
    task.completedAt = '2026-11-17T09:00:00.000Z';
    task.updatedAt = '2026-11-17T09:00:00.000Z';
    phone.write('.pisi/tasks.json', tasks);
    assert((await phone.sync()).ok, 'Phone push of the task');
    await runAppTurn(cdp);
    const statusOnDisk = async () => (await readJson('.pisi/tasks.json')).tasks.find((item) => item.id === TASK_ID)?.status;
    assert((await statusOnDisk()) === 'done', 'The remote completion must be applied');
    // The task panel is closed and opened again (the right panel switches to Tags and back to ToDo).
    await cdp.evaluate(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector('[data-right-tab="tags"]')?.click();
        await wait(300);
        document.querySelector('[data-right-tab="missions"]')?.click();
        await wait(300);
        return Boolean(document.querySelector('#pisi-missions-list'));
    })()`);
    await sleep(1500);
    assert((await statusOnDisk()) === 'done', 'SV13: opening and closing the task panel must not take the remote completion back', await statusOnDisk());
    const sourceNote = path.join(projectPath, 'Proje Planı.node');
    await cdp.evaluate(`(async () => {
        await openPisiFileTab({ fullPath: ${JSON.stringify(sourceNote)}, name: 'Proje Planı.node', fileName: 'Proje Planı.node', isFile: true, type: 'file' });
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    })()`);
    assert((await statusOnDisk()) === 'done', 'SV13: opening the source note must not take the remote completion back', await statusOnDisk());
    await cdp.request('Input.insertText', { text: ' not düzenlendi' });
    await cdp.evaluate('window.flushPisiPendingSaves()');
    await sleep(300);
    assert((await statusOnDisk()) === 'done', 'SV13: saving the source note must not take the remote completion back', await statusOnDisk());
    // The editor's task projection runs after its own delay; give it time to write.
    await sleep(5000);
    assert((await statusOnDisk()) === 'done', 'SV13: the projection must not take the remote completion back', await statusOnDisk());
    await runAppTurn(cdp);
    assert((await phone.sync()).ok, 'Phone pull after the edits');
    assert(phone.readJson('.pisi/tasks.json').tasks.find((item) => item.id === TASK_ID)?.status === 'done', 'The phone must still see the task completed');
    assert((await cdp.evaluate('window.__pisiE2ELoadCount || 0')) === 0, 'loadProject must not run during sync');

    // 5. A repeating task completed on the desktop stays one record: one completion, the next due day (§3.2.3).
    const repeating = (await readJson('.pisi/tasks.json')).tasks.find((item) => item.title === 'Haftalık özet yaz');
    const completed = await cdp.evaluate(`window.runPisiTaskCommand('task.complete.v1', { taskId: ${JSON.stringify(repeating.id)} })`);
    assert(completed?.ok, 'Completing the repeating task', completed);
    const moved = (await readJson('.pisi/tasks.json')).tasks.filter((item) => item.title === 'Haftalık özet yaz');
    assert(moved.length === 1 && moved[0].id === repeating.id, 'A repeating task stays one record', moved);
    assert(moved[0].completions.length === 1 && moved[0].dueDate > repeating.dueDate && moved[0].status === 'todo', 'It moves to its next day', moved[0]);
    await runAppTurn(cdp);
    assert((await phone.sync()).ok, 'Phone pull of the completion');
    const onPhone = phone.readJson('.pisi/tasks.json').tasks.find((item) => item.id === repeating.id);
    assert(onPhone?.completions?.length === 1 && onPhone.dueDate === moved[0].dueDate, 'The phone gets the same record', onPhone);

    // 6. A large upload (S6): Settings shows its progress; "Durdur" stops the turn and pauses
    //    syncing, "Sürdür" goes on where it stopped and every file is sent once.
    const headsBefore = Number(server.sql('SELECT COUNT(*) AS n FROM heads').rows[0].n);
    const seqBefore = Number(server.sql('SELECT COALESCE(MAX(seq), 0) AS n FROM changes').rows[0].n);
    const BULK = 300;
    for (let index = 0; index < BULK; index += 1) {
        const id = `node_b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        const title = `Toplu ${index}`;
        await fs.writeFile(
            path.join(projectPath, `${title}.node`),
            JSON.stringify(
                {
                    pisi: {
                        version: 1,
                        type: 'node',
                        id,
                        title,
                        sidecar: `inv_${title}__${id}`,
                        parentMap: 'none',
                        createdAt: '2026-11-18T08:00:00.000Z',
                        updatedAt: '2026-11-18T08:00:00.000Z'
                    },
                    content: `<div class="pisi-editor-block" data-pisi-block-id="blk_${index}" data-pisi-block-type="paragraph">${'toplu metin '.repeat(200)}</div>`
                },
                null,
                2
            )
        );
        await fs.mkdir(path.join(projectPath, `inv_${title}__${id}`), { recursive: true });
    }
    await waitUntil('previous turn finished', async () => !(await cdp.evaluate('window.pisiSyncClient.status()'))?.running || null);
    await cdp.evaluate(`(() => { window.__pisiE2EBulk = window.pisiSyncClient.run('manual'); return true; })()`);
    const shownProgress = await waitUntil(
        'upload progress in Settings',
        () =>
            cdp.evaluate(`(() => {
                const line = document.querySelector('#pisi-e2e-settings [data-pisi-sync-progress]');
                const stop = document.querySelector('#pisi-e2e-settings [data-pisi-sync-action="cancel"]');
                return line && !line.hidden && /^Yükleniyor: /.test(line.textContent) && stop && !stop.hidden ? line.textContent : null;
            })()`),
        30000
    );
    assert(/^Yükleniyor: [\d.]+ \/ [\d.]+ dosya · /.test(shownProgress), 'Progress counts files and bytes', shownProgress);
    await cdp.evaluate(`document.querySelector('#pisi-e2e-settings [data-pisi-sync-action="cancel"]').click()`);
    const cancelled = await cdp.evaluate('window.__pisiE2EBulk');
    assert(cancelled?.ok === false && cancelled.code === 'CANCELLED', 'The stopped turn ends with CANCELLED', cancelled);
    const paused = await waitUntil('paused status', async () => {
        const status = await cdp.evaluate('window.pisiSyncClient.status()');
        return status?.paused && !status.running ? status : null;
    });
    const headsAfterStop = Number(server.sql('SELECT COUNT(*) AS n FROM heads').rows[0].n);
    assert(headsAfterStop < headsBefore + BULK, 'The stop came before every file was sent', { headsBefore, headsAfterStop });
    // Automatic turns wait while paused.
    const automatic = await cdp.evaluate(`window.pisiDomain.command('sync.run.v1', { reason: 'interval' })`);
    assert(automatic?.code === 'PAUSED', 'An automatic turn waits while paused', automatic);
    assert(paused.lastResult?.code === 'CANCELLED', 'Settings knows the turn was stopped', paused);
    const resumeLabel = await waitUntil('Sürdür button', () =>
        cdp.evaluate(`document.querySelector('#pisi-e2e-settings [data-pisi-sync-action="resume"]')?.textContent || null`)
    );
    assert(resumeLabel === 'Sürdür', 'Paused sync offers "Sürdür"', resumeLabel);
    await cdp.evaluate(`document.querySelector('#pisi-e2e-settings [data-pisi-sync-action="resume"]').click()`);
    await waitUntil(
        'resumed upload finished',
        async () => {
            const status = await cdp.evaluate('window.pisiSyncClient.status()');
            return !status.running &&
                !status.paused &&
                status.lastResult?.ok &&
                Number(server.sql('SELECT COUNT(*) AS n FROM heads').rows[0].n) >= headsBefore + BULK
                ? status
                : null;
        },
        60000
    );
    // Each file went up once: no fid has two changes since the upload began (the app's own small writes may add others).
    const twice = server.sql('SELECT fid, COUNT(*) AS n FROM changes WHERE seq > ? GROUP BY fid HAVING COUNT(*) > 1', [seqBefore]).rows;
    assert(twice.length === 0, 'No file was committed twice', twice);

    console.log(
        '[E2E] Sync client passed: space + pairing, open note kept while typing, conflict copy without Integrity findings, SV13, a repeating task stays one record, progress and stop/resume of a large upload.'
    );
} catch (error) {
    console.error(logs.slice(-6000));
    throw error;
} finally {
    cdp?.close();
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(400);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await server.stop();
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
