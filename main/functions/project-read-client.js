import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { registerMainModule } from '../module-registry.js';
import { readPisiJsonFiles, scanPisiWikiRenameCandidates, walkPisiProjectFiles } from './project-read-core.js';

// Main-process side of the project read worker. Long read-only scans (Project
// Integrity inventory, export file lists, link rename candidates, bulk reads)
// go to one lazily started worker_threads worker. If the worker cannot start
// (or crashes) the same functions run in this process, still asynchronously.
// Results come back in batches so no single structured-clone blocks the loop.

const PISI_READ_BATCH = 250;
const readState = { worker: null, failed: false, nextId: 1, pending: new Map() };
const inProcess = {
    walk: (args) => walkPisiProjectFiles(args.root, args.options),
    readJson: (args) => readPisiJsonFiles(args.paths, args.options),
    wikiRenameCandidates: (args) => scanPisiWikiRenameCandidates(args.root, args.options)
};

function getPisiReadWorkerUrl() {
    // Inside a packaged app the worker file is unpacked next to app.asar (package.json asarUnpack).
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'project-read-worker.js');
    return pathToFileURL(file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`));
}

function failPisiReadWorker(error) {
    readState.failed = true;
    readState.worker = null;
    for (const { reject } of readState.pending.values()) reject(error);
    readState.pending.clear();
}

function getPisiReadWorker() {
    if (readState.failed) return null;
    if (readState.worker) return readState.worker;
    try {
        const worker = new Worker(getPisiReadWorkerUrl());
        worker.unref();
        worker.on('message', (message) => {
            const pending = readState.pending.get(message?.id);
            if (!pending) return;
            readState.pending.delete(message.id);
            if (message.ok) pending.resolve(message.value);
            else pending.reject(new Error(message.error));
        });
        worker.on('error', (error) => {
            console.warn('[PISI] Okuma işçisi hata verdi, işlem süreç içinde sürecek:', error?.message || error);
            failPisiReadWorker(error);
        });
        worker.on('exit', (code) => {
            if (readState.worker === worker && code !== 0) failPisiReadWorker(new Error(`Okuma işçisi kapandı (${code}).`));
        });
        readState.worker = worker;
        return worker;
    } catch (error) {
        console.warn('[PISI] Okuma işçisi başlatılamadı, işlem süreç içinde sürecek:', error?.message || error);
        readState.failed = true;
        return null;
    }
}

/** Runs one read operation in the worker (or in this process when no worker is available). */
async function runPisiProjectRead(op, args = {}) {
    const worker = getPisiReadWorker();
    if (!worker) return inProcess[op](args);
    try {
        return await new Promise((resolve, reject) => {
            const id = readState.nextId++;
            readState.pending.set(id, { resolve, reject });
            worker.postMessage({ id, op, args });
        });
    } catch (error) {
        if (!readState.failed) throw error;
        return inProcess[op](args);
    }
}

/**
 * Reads many JSON files in batches. `onProgress(done, total)` is called after each batch.
 * @returns {Promise<Map<string, { path: string, ok: boolean, data?: any, raw?: string, missing?: boolean, error?: string }>>}
 */
async function readPisiJsonFilesBatched(paths, options = {}) {
    const results = new Map();
    const batchSize = Number(options.batchSize) || PISI_READ_BATCH;
    for (let offset = 0; offset < paths.length; offset += batchSize) {
        const batch = paths.slice(offset, offset + batchSize);
        for (const result of await runPisiProjectRead('readJson', { paths: batch, options: { raw: options.raw === true } })) results.set(result.path, result);
        options.onProgress?.(Math.min(paths.length, offset + batch.length), paths.length);
    }
    return results;
}

/**
 * Progress of a long operation for the renderer ("Bütünlük taraması: 2.300 / 10.000").
 * Sent at most every 100 ms per operation, and always for the last step.
 */
const progressSentAt = new Map();
function sendPisiProgress(operation, done, total) {
    const window = globalThis.mainWindow;
    if (!window || window.isDestroyed()) return false;
    const now = Date.now();
    const finished = done >= total;
    if (!finished && now - (progressSentAt.get(operation) || 0) < 100) return false;
    progressSentAt.set(operation, now);
    window.webContents.send('pisi:progress', { operation, done, total });
    return true;
}

/** Test hook: whether the worker is in use (false after a failure or before first use). */
function isPisiReadWorkerActive() {
    return Boolean(readState.worker) && !readState.failed;
}

function stopPisiReadWorker() {
    const worker = readState.worker;
    readState.worker = null;
    return worker ? worker.terminate() : Promise.resolve(0);
}

const moduleApi = {
    runPisiProjectRead,
    readPisiJsonFilesBatched,
    sendPisiProgress,
    isPisiReadWorkerActive,
    stopPisiReadWorker
};

registerMainModule('main.projectRead', moduleApi);

export { readPisiJsonFilesBatched, runPisiProjectRead, stopPisiReadWorker };
