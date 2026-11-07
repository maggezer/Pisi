import { parentPort } from 'node:worker_threads';
import { readPisiJsonFiles, scanPisiWikiRenameCandidates, walkPisiProjectFiles } from './project-read-core.js';

// The project read worker: long, read-only scans run here so the main process
// stays responsive. Messages: { id, op, args } → { id, ok, value } or { id, ok: false, error }.

const operations = {
    walk: (args) => walkPisiProjectFiles(args.root, args.options),
    readJson: (args) => readPisiJsonFiles(args.paths, args.options),
    wikiRenameCandidates: (args) => scanPisiWikiRenameCandidates(args.root, args.options)
};

parentPort?.on('message', async (message) => {
    const { id, op, args } = message || {};
    try {
        if (!operations[op]) throw new Error(`Bilinmeyen işlem: ${op}`);
        parentPort.postMessage({ id, ok: true, value: await operations[op](args || {}) });
    } catch (error) {
        parentPort.postMessage({ id, ok: false, error: error?.message || String(error) });
    }
});
