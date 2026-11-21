// The phone of scripts/sync-e2e-matrix.mjs: Pisi Mobil's production build (debug
// flavour, VITE_PISI_DEVELOPER=1, like the test APK) served by `vite preview` and
// opened in Playwright's Chromium as a Pixel 7. The app pairs with the code like a
// user would and talks to https://sync.test; a Playwright route sends those requests
// to the fault proxy, which forwards them to the real PHP test server. `offline`
// stands for a phone without a connection (the route aborts every request).
// Playwright comes from mobile/node_modules (the mobile package's own dev dependency).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { assert, sleep } from './desktop.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const mobileRoot = path.join(repoRoot, 'mobile');
const mobileRequire = createRequire(path.join(mobileRoot, 'package.json'));
export const PHONE_SERVER = 'https://sync.test';
const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, pisi-sync-protocol, pisi-part-sha256, range, x-pisi-token',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range, retry-after, pisi-blob-sha256'
};
const SKIP_REQUEST_HEADERS = new Set(['host', 'origin', 'referer', 'content-length', 'connection']);

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

/** Builds mobile/dist as the debug build the Playwright tests use. */
export function buildMobile() {
    const result = spawnSync('npm', ['--prefix', mobileRoot, 'run', 'build'], {
        cwd: repoRoot,
        env: { ...process.env, VITE_PISI_DEVELOPER: '1' },
        encoding: 'utf8',
        shell: process.platform === 'win32'
    });
    if (result.status !== 0) throw new Error(`Mobil derleme başarısız:\n${result.stdout}\n${result.stderr}`);
}

async function startPreview() {
    const port = await freePort();
    const vite = path.join(mobileRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: mobileRoot,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const url = `http://127.0.0.1:${port}`;
    for (let tries = 0; tries < 150; tries += 1) {
        if (child.exitCode !== null) throw new Error('vite preview kapandı');
        try {
            if ((await fetch(url)).ok) return { url, child };
        } catch {}
        await sleep(200);
    }
    child.kill('SIGKILL');
    throw new Error('vite preview açılmadı');
}

/**
 * @param {{ proxy: { baseUrl: string, log: any[] }, timezoneId: string }} options
 */
export async function startPhone({ proxy, timezoneId }) {
    const { chromium, devices } = mobileRequire('playwright');
    const preview = await startPreview();
    const browser = await chromium.launch();
    const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId, baseURL: preview.url });
    const page = await context.newPage();
    // PISI_SYNC_MATRIX_PHONE_SLOWDOWN=4 runs the phone's page four times slower (CDP CPU throttling),
    // to bring out timing races locally that a slow CI machine shows.
    const slowdown = Number(process.env.PISI_SYNC_MATRIX_PHONE_SLOWDOWN || 0);
    if (slowdown > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: slowdown });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.stack || error)));
    let inFlight = 0;
    const state = { offline: false };

    await context.route(`${PHONE_SERVER}/**`, async (route) => {
        const request = route.request();
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        if (state.offline) return route.abort('internetdisconnected');
        inFlight += 1;
        try {
            const url = new URL(request.url());
            /** @type {Record<string, string>} */
            const headers = {};
            for (const [name, value] of Object.entries(request.headers())) if (!SKIP_REQUEST_HEADERS.has(name)) headers[name] = value;
            headers['x-forwarded-proto'] = 'https';
            headers['x-pisi-e2e-client'] = 'phone';
            const body = request.postDataBuffer();
            let response;
            try {
                response = await fetch(proxy.baseUrl + url.pathname + url.search, { method: request.method(), headers, body: body ?? undefined });
            } catch {
                return route.abort('connectionreset');
            }
            const out = Buffer.from(await response.arrayBuffer());
            const extra = {};
            for (const name of ['content-type', 'content-range', 'pisi-blob-sha256', 'retry-after']) {
                const value = response.headers.get(name);
                if (value) extra[name] = value;
            }
            return route.fulfill({ status: response.status, headers: { ...CORS, ...extra }, body: out });
        } finally {
            inFlight -= 1;
        }
    });

    const screen = page.locator('[data-screen]');
    const screenName = () => screen.first().getAttribute('data-screen');
    const until = async (label, probe, timeoutMs = 30000) => {
        const started = Date.now();
        let last = null;
        while (Date.now() - started < timeoutMs) {
            try {
                last = await probe();
                if (last) return last;
            } catch (error) {
                last = String(error?.message || error);
            }
            await sleep(150);
        }
        throw new Error(`Telefon: ${label} beklenirken süre doldu. Son değer: ${JSON.stringify(last)}`);
    };

    /** Every entry of the Filesystem plugin's web store (IndexedDB) under `prefix`. */
    const store = (prefix) =>
        page.evaluate(
            (root) =>
                new Promise((resolve, reject) => {
                    const request = indexedDB.open('Disc');
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const all = request.result.transaction('FileStorage').objectStore('FileStorage').getAll();
                        all.onerror = () => reject(all.error);
                        all.onsuccess = () =>
                            resolve(
                                all.result
                                    .filter((entry) => entry.path.startsWith(root))
                                    .map((entry) => ({
                                        path: entry.path.slice(root.length),
                                        type: entry.type,
                                        content: entry.type === 'file' ? entry.content : null
                                    }))
                            );
                    };
                }),
            prefix
        );

    const phone = {
        page,
        state,
        errors,
        get offline() {
            return state.offline;
        },
        set offline(value) {
            state.offline = Boolean(value);
        },
        screenName,
        until,
        /** The project's files and folders: `{ path, type, content }` (text, or base64 for bytes). */
        entries: () => store('/DATA/projects/default/'),
        async files() {
            return (await phone.entries()).filter((entry) => entry.type === 'file');
        },
        async read(key) {
            return (await phone.files()).find((entry) => entry.path === key)?.content ?? null;
        },
        async readJson(key) {
            const text = await phone.read(key);
            return text === null ? null : JSON.parse(text);
        },
        /** The device state (cursor, issues, conflict log …) of the bound space. */
        async syncState() {
            const entries = await store('/DATA/sync/');
            const file = entries.find((entry) => entry.type === 'file' && /^sp_[^/]+\/state\.json$/.test(entry.path));
            return file ? JSON.parse(file.content) : null;
        },
        async open() {
            await page.goto('/');
            await screen.first().waitFor();
            await page.waitForFunction(() => Boolean(window.pisiDeveloper));
        },
        back: () => page.keyboard.press('Escape'),
        /** Back to the Pisi tab, whatever is open. */
        async home() {
            for (let tries = 0; tries < 6 && (await screenName()) !== 'pisi'; tries += 1) {
                await phone.back();
                await sleep(150);
            }
            assert((await screenName()) === 'pisi', 'Telefon Pisi ekranına dönemedi', await screenName());
        },
        async openFromMenu(target) {
            await phone.home();
            await page.locator('[data-action="launcher"]').tap();
            await page.locator(`[data-menu="${target}"]`).tap();
            await until(`${target} ekranı`, async () => (await screenName()) === target);
        },
        async openNote(key) {
            await phone.openFromMenu('notes');
            const row = page.locator(`[data-note="${key.replace(/"/g, '\\"')}"]`);
            // The list is newest first and draws only the rows near the screen: a note no
            // scenario touched lately is further down, so the list is scrolled until it is drawn.
            for (let step = 0; step < 40 && (await row.count()) === 0; step += 1) {
                await page.evaluate(() => {
                    let scroller = document.querySelector('.pisi-virtual')?.parentElement;
                    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
                    (scroller || document.scrollingElement).scrollBy(0, Math.max(200, (scroller || document.scrollingElement).clientHeight / 2));
                });
                await sleep(100);
            }
            await phone.tap(row);
            await until('not ekranı', async () => (await screenName()) === 'note');
            await page.locator('.pisi-note-editor > .pisi-note-block').first().waitFor();
        },
        /** Types `text` at the end of the note block `index` (0-based) with the keyboard. */
        async typeAtEnd(index, text) {
            const block = page.locator('.pisi-note-editor > .pisi-note-block').nth(index);
            await block.tap();
            await page.keyboard.press('End');
            await page.keyboard.type(text);
        },
        /**
         * Taps a row of a list that a sync change can draw again at any moment (notes, tasks): the
         * tap scrolls to it and finds it again; if it went away under the tap, it is tried again.
         */
        async tap(locator) {
            for (let attempt = 1; ; attempt += 1) {
                try {
                    return await locator.tap({ timeout: 5000 });
                } catch (error) {
                    if (attempt >= 5) throw error;
                    await sleep(200);
                }
            }
        },
        statusRow: () => page.locator('[data-sync="status"]'),
        async openSettings() {
            if ((await screenName()) !== 'settings') await phone.openFromMenu('settings');
        },
        /** Settings → "Şimdi eşitle"; waits until the turn has talked to the server and ended. Resolves with the status row. */
        async syncNow(label = 'tur') {
            await phone.openSettings();
            const syncNow = page.locator('[data-sync="sync-now"]');
            // Settings is drawn again on every status change, so an automatic turn (the phone's own
            // "3 s after the last write" trigger) can replace the row while it is being tapped. "Şimdi
            // eşitle" also does nothing while a turn runs. So: wait for the running turn, tap (the tap
            // scrolls and finds the row again), and try again if the row went away under the tap.
            for (let attempt = 1; ; attempt += 1) {
                await until(`${label}: süren tur`, async () => inFlight === 0 && (await phone.statusRow().getAttribute('data-state')) !== 'running', 120000);
                const mark = proxy.log.length;
                try {
                    await syncNow.tap({ timeout: 5000 });
                } catch (error) {
                    if (attempt >= 5) throw error;
                    continue;
                }
                return phone.settle(label, mark);
            }
        },
        /** Waits for the phone's turn that started after proxy log index `mark` to end. */
        async settle(label, mark) {
            let quietSince = 0;
            return until(
                label,
                async () => {
                    const row = phone.statusRow();
                    const current = (await row.count()) ? await row.getAttribute('data-state') : 'unpaired';
                    const talked = proxy.log.slice(mark).some((entry) => entry.client === 'phone') || phone.offline;
                    if (!talked || inFlight > 0 || current === 'running') {
                        quietSince = 0;
                        return null;
                    }
                    if (!quietSince) quietSince = Date.now();
                    if (Date.now() - quietSince < 700) return null;
                    return { state: current, text: (await row.count()) ? await row.textContent() : '' };
                },
                120000
            );
        },
        /** The app came back to the foreground: the lifecycle's resume trigger runs a turn. */
        async resume(label = 'uygulamaya dönüş') {
            const mark = proxy.log.length;
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            return phone.settle(label, mark);
        },
        snackbar: () => page.getByRole('status'),
        async stop() {
            await browser.close().catch(() => {});
            preview.child.kill('SIGTERM');
        }
    };
    return phone;
}

/** Writes the phone's project into `folder` (text as UTF-8, attachments from base64) for the desktop audit. */
export async function exportPhoneProject(phone, folder, isBinary) {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    for (const entry of await phone.entries()) {
        const target = path.join(folder, ...entry.path.split('/'));
        if (entry.type === 'directory') fs.mkdirSync(target, { recursive: true });
        else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, isBinary(entry.path) ? Buffer.from(entry.content, 'base64') : entry.content);
        }
    }
}
