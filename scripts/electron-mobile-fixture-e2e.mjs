import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keepPagePromise } from './e2e-cdp.mjs';

// Builds the small desktop project the mobile compatibility test starts from
// (tests/mobile-desktop-compat.test.mjs, docs/mobile-plan.md M4). Everything in
// it is created by the real desktop app, driven over CDP: the editor writes the
// Sheet, Paint, image and file blocks, Quick Add writes the task blocks, and
// the domain commands write the tasks, the relationship, the map and the diary.
// Nothing is hand-written HTML or JSON.
//
//   xvfb-run -a node scripts/electron-mobile-fixture-e2e.mjs            # build and check only
//   xvfb-run -a node scripts/electron-mobile-fixture-e2e.mjs --write    # also replace tests/fixtures/desktop-project
//
// Ids and timestamps are new on every run, so `--write` produces a different
// (equivalent) fixture each time. Regenerate it only when the desktop format changes.

const PISI_E2E_CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const fixtureTarget = path.join(repoRoot, 'tests', 'fixtures', 'desktop-project');
const port = 9241;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-mobile-fixture-')));
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
        const response = await this.request('Runtime.evaluate', { expression: keepPagePromise(expression), awaitPromise: true, returnByValue: true });
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
        logs += String(chunk || '');
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

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

async function waitForTreeItem(cdp, itemPath) {
    await waitUntil('tree item ' + itemPath, () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === " + JSON.stringify(itemPath) + ')')
    );
}

async function clickTreeItem(cdp, itemPath) {
    await cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            JSON.stringify(itemPath) +
            "); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()"
    );
}

/** Creates a document with the toolbar button and gives it its title through the rename command. */
async function createDocument(cdp, buttonId, ext, title) {
    const before = new Set(await fs.readdir(projectPath));
    assert(await cdp.evaluate(`(() => { const b = document.getElementById(${JSON.stringify(buttonId)}); b?.click(); return Boolean(b); })()`), buttonId);
    const created = await waitUntil('new ' + ext + ' file', async () => {
        const name = (await fs.readdir(projectPath)).find((entry) => entry.endsWith(ext) && !before.has(entry));
        return name ? path.join(projectPath, name) : null;
    });
    await waitForTreeItem(cdp, created);
    const renamed = await cdp.evaluate(`window.pisiProject.renamePisiFile(${JSON.stringify(created)}, ${JSON.stringify(title)})`);
    assert(renamed?.ok, 'rename ' + title, renamed);
    await cdp.evaluate('window.refreshCurrentProjectTree?.()');
    const finalPath = path.join(projectPath, title + ext);
    await waitUntil('renamed file ' + title, () =>
        fs
            .access(finalPath)
            .then(() => true)
            .catch(() => false)
    );
    await waitForTreeItem(cdp, finalPath);
    return finalPath;
}

async function openNode(cdp, nodePath) {
    await clickTreeItem(cdp, nodePath);
    await waitUntil('editor for ' + nodePath, () =>
        cdp.evaluate('window.activeCenterNode?.path === ' + JSON.stringify(nodePath) + " && document.getElementById('center-node-editor')?.hidden === false")
    );
}

const focusEditorEnd = `(() => {
    const editor = document.getElementById('center-node-editor-content');
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    return document.activeElement === editor;
})()`;

async function pressEnter(cdp) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

/** Types paragraphs at the end of the open note, the way a user does. */
async function typeParagraphs(cdp, paragraphs) {
    assert(await cdp.evaluate(focusEditorEnd), 'editor focus');
    for (const [index, text] of paragraphs.entries()) {
        // The desktop rule: the first Enter is a soft line, the second one starts a new paragraph.
        if (index > 0) {
            await pressEnter(cdp);
            await pressEnter(cdp);
        }
        await cdp.request('Input.insertText', { text });
    }
    await waitUntil('typed text', () =>
        cdp.evaluate("document.getElementById('center-node-editor-content').textContent.includes(" + JSON.stringify(paragraphs.at(-1)) + ')')
    );
}

async function saveEditor(cdp, nodePath, marker) {
    assert(await cdp.evaluate('saveCurrentCenterNodeEditor()'), 'save ' + nodePath);
    await waitUntil('saved ' + nodePath, async () => (await readJson(nodePath)).content?.includes(marker));
}

const generatedPng = `async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 40;
    const context = canvas.getContext('2d');
    context.fillStyle = '#1e88e5';
    context.fillRect(0, 0, 64, 40);
    context.fillStyle = '#ffffff';
    context.fillRect(8, 8, 20, 20);
    return new File([await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))], 'ekran.png', { type: 'image/png' });
}`;

async function listEmptyDirectories(root, folder = '') {
    const entries = await fs.readdir(path.join(root, folder), { withFileTypes: true });
    if (!entries.length) return folder ? [folder] : [];
    const found = [];
    for (const entry of entries) {
        if (entry.isDirectory()) found.push(...(await listEmptyDirectories(root, folder ? `${folder}/${entry.name}` : entry.name)));
    }
    return found;
}

async function copyProject(source, target) {
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(source, target, {
        recursive: true,
        // Locks, backups and temporary files belong to the running app, not to the project's data.
        filter: (entry) => !/(?:^|[\\/])(?:\.pisi\.lock|[^\\/]*\.pisi-backup|[^\\/]*\.tmp)$/.test(entry)
    });
    // Git does not keep empty folders (note sidecars without assets, .pisi/mutations),
    // so they are listed next to the fixture and the test recreates them.
    const empty = (await listEmptyDirectories(target)).sort();
    await fs.writeFile(`${target}.directories.json`, JSON.stringify(empty, null, 4) + '\n', 'utf8');
}

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("(localStorage.setItem('pisi.tutorial.v1.completed', '1'), window.finishPisiTutorial?.(true))");
    const project = JSON.stringify(projectPath);

    // 1. A note with text, a Sheet, a Paint canvas, an image and a file attachment.
    const meetingPath = await createDocument(cdp, 'add-node-btn', '.node', 'Toplantı Notları');
    await openNode(cdp, meetingPath);
    await typeParagraphs(cdp, ['Gündem: mobil veri katmanı', 'Kararlar bu paragrafta toplanır.']);
    const sheet = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        insertPisiSheet(editor, 3, 2);
        const table = Array.from(editor.querySelectorAll('table[data-pisi-sheet]')).at(-1);
        if (!table) return null;
        [['Kalem', 'Tutar'], ['Sunucu', '120'], ['Alan adı', '45']].forEach((row, r) => row.forEach((value, c) => setPisiSheetCellSource(table, r, c, { value })));
        persistPisiSheetDatabase(table);
        renderPisiSheetDatabase(table);
        return getPisiSheetDatabase(table).items.length;
    })()`);
    assert(sheet === 3, 'Sheet block', sheet);
    const painted = await cdp.evaluate(`(() => {
        ${focusEditorEnd};
        const editor = document.getElementById('center-node-editor-content');
        insertPisiCanvas(editor, 240, 160);
        const canvas = Array.from(editor.querySelectorAll('canvas[data-pisi-canvas]')).at(-1);
        if (!canvas) return false;
        const context = canvas.getContext('2d');
        context.fillStyle = '#c2410c';
        context.fillRect(20, 20, 120, 80);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    })()`);
    assert(painted, 'Paint block');
    const pasted = await cdp.evaluate(`(async () => {
        ${focusEditorEnd};
        const editor = document.getElementById('center-node-editor-content');
        const data = new DataTransfer();
        data.items.add(await (${generatedPng})());
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
        return event.defaultPrevented;
    })()`);
    assert(pasted, 'image paste');
    await waitUntil('image block', () =>
        cdp.evaluate(
            "(() => { const img = document.querySelector('#center-node-editor-content .pisi-image-block img'); return Boolean(img?.getAttribute('data-pisi-image-asset') && img.complete); })()"
        )
    );
    const dropped = await cdp.evaluate(`(async () => {
        ${focusEditorEnd};
        const editor = document.getElementById('center-node-editor-content');
        const data = new DataTransfer();
        data.items.add(new File([new TextEncoder().encode('%PDF-1.4 Pisi rapor')], 'Rapor Özet.pdf', { type: 'application/pdf' }));
        const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
        editor.lastElementChild.dispatchEvent(event);
        return event.defaultPrevented;
    })()`);
    assert(dropped, 'file drop');
    await waitUntil('file block', () =>
        cdp.evaluate("document.querySelector('#center-node-editor-content .pisi-file-block')?.dataset.pisiFileState === 'ready'")
    );
    await saveEditor(cdp, meetingPath, 'data-pisi-file-asset');
    const meeting = await readJson(meetingPath);
    for (const marker of ['data-pisi-sheet-asset="sheet/', 'data-pisi-asset="paint/', 'data-pisi-image-asset="image/', 'data-pisi-file-asset="file/']) {
        assert(meeting.content.includes(marker), 'saved note must reference ' + marker, meeting.content);
    }
    assert(!/data:image|blob:|data-pisi-sheet-model/.test(meeting.content), 'saved note must not embed heavy data', meeting.content);

    // 2. A plain note that links to the first one.
    const planPath = await createDocument(cdp, 'add-node-btn', '.node', 'Proje Planı');
    await openNode(cdp, planPath);
    await typeParagraphs(cdp, ['Proje planının ilk paragrafı.', 'İkinci paragraf: takvim ve kapsam.', 'Üçüncü paragraf: riskler.']);
    await saveEditor(cdp, planPath, 'riskler');
    const planBlocks = (await readJson(planPath)).content.match(/data-pisi-block-type="paragraph"/g) || [];
    assert(planBlocks.length === 3, 'each typed paragraph must be its own block', planBlocks.length);

    // 3. Tasks. Quick Add writes task blocks into the inbox note; one task has no source note.
    const captures = [
        { text: 'Raporu gönder', priority: 2, scheduledAt: '2026-11-14T10:00' },
        { text: 'Haftalık özet yaz', priority: 3, scheduledAt: '2026-11-13', repeat: 'weekly' },
        { text: 'Sunucu faturasını öde', priority: 4, scheduledAt: '2026-11-20', reminderAt: '2026-11-19T09:00' },
        { text: 'Okuma listesini düzenle', priority: 5 }
    ];
    for (const capture of captures) {
        // The same steps as the Quick Add form (renderer/productivity/pisi-quick-capture.mjs).
        const added = await cdp.evaluate(`(async () => {
            const result = await window.Pisi.modules['domain.client'].command('task.capture.v1', { projectFolder: ${project}, task: ${JSON.stringify(capture)} });
            invalidatePisiSearchIndex();
            await ensurePisiSearchIndex({ force: true });
            await window.refreshPisiMissionIndex?.({ force: true, reason: 'quick-add' });
            return result;
        })()`);
        assert(added?.ok && added.task?.taskId, 'quick add ' + capture.text, added);
    }
    const sourceless = await cdp.evaluate(
        `window.pisiProject.quickAddTask(${project}, { op: 'upsert', task: { title: 'Egzersiz', priority: 3, dueDate: '2026-11-14', todoTag: 'todo.3.14-11-2026', repeat: 'daily' } })`
    );
    assert(sourceless?.ok, 'sourceless task', sourceless);
    const finished = await cdp.evaluate(
        `window.pisiProject.quickAddTask(${project}, { op: 'upsert', task: { title: 'Toplantı odasını ayır', priority: 3, dueDate: '2026-11-12', todoTag: 'todo.3.12-11-2026', status: 'done' } })`
    );
    assert(finished?.ok, 'done task', finished);

    // 4. A map with two child notes and one relationship between them.
    const mapPath = await createDocument(cdp, 'add-map-btn', '.map', 'Yol Haritası');
    const children = [];
    for (let index = 0; index < 2; index += 1) {
        const child = await cdp.evaluate(`window.pisiProject.createNodeUnderMap(${JSON.stringify(mapPath)})`);
        assert(child?.ok, 'map child node', child);
        children.push(child);
    }
    const mapNodes = (await readJson(mapPath)).map.nodes.map((node) => node.id);
    assert(mapNodes.length === 2, 'map must hold two nodes', mapNodes);
    const linked = await cdp.evaluate(
        `window.pisiDomain.command('map.relationship.upsert.v1', { mapPath: ${JSON.stringify(mapPath)}, relationship: { sourceId: ${JSON.stringify(mapNodes[0])}, targetId: ${JSON.stringify(mapNodes[1])}, type: 'down-hub', sourcePort: 'bottom', targetPort: 'top' } })`
    );
    assert(linked?.ok, 'relationship', linked);

    // 5. Two diary days, written in the editor.
    for (const [isoDate, text] of [
        ['2026-11-12', 'Plan belgesini okudum.'],
        ['2026-11-13', 'Veri katmanı için notlar aldım.']
    ]) {
        const diary = await cdp.evaluate(`window.pisiProject.getOrCreateDiaryNode(${project}, ${JSON.stringify(isoDate)})`);
        assert(diary?.ok, 'diary ' + isoDate, diary);
        const diaryPath = path.join(projectPath, 'diary', isoDate + '.node');
        const opened = await cdp.evaluate(
            `openCenterNodeEditor({ fullPath: ${JSON.stringify(diaryPath)}, name: ${JSON.stringify(isoDate + '.node')}, type: 'node', ext: '.node' })`
        );
        assert(opened !== false, 'open diary ' + isoDate, opened);
        await waitUntil('diary editor ' + isoDate, () => cdp.evaluate('window.activeCenterNode?.path === ' + JSON.stringify(diaryPath)));
        await typeParagraphs(cdp, [text]);
        await saveEditor(cdp, diaryPath, text);
    }
    assert(await cdp.evaluate('flushPisiPendingSaves()'), 'pending saves');
    await sleep(2500);

    // The project the desktop wrote must be clean for the desktop's own audit.
    const audit = await cdp.evaluate(`window.pisiProject.auditIntegrity(${project})`);
    const issues = audit?.report?.issues ?? audit?.issues ?? null;
    assert(Array.isArray(issues), 'integrity audit', audit);
    // pisi-error.md §5c: Quick Add's Inbox must not leave a property without its schema.
    assert(issues.length === 0, 'integrity issues', issues);
    const store = await readJson(path.join(projectPath, '.pisi', 'tasks.json'));
    const relationships = await readJson(path.join(projectPath, '.pisi', 'relationships.json'));
    assert(store.tasks.length === 6 && relationships.relationships.length === 1, 'authorities', {
        tasks: store.tasks.length,
        relationships: relationships.relationships.length
    });
    console.log(JSON.stringify({ project: projectPath, tasks: store.tasks.length, relationships: relationships.relationships.length, issues }, null, 2));

    await stop(cdp);
    cdp = null;
    if (process.argv.includes('--write')) {
        await copyProject(projectPath, fixtureTarget);
        console.log('Fixture written to ' + path.relative(repoRoot, fixtureTarget));
    }
    console.log('Mobile fixture E2E passed.');
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true });
}
