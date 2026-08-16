import { buildPisiSearchAccelerator } from './pisi-search-core.mjs';
import { createPisiRebuildableProjectionIndex } from './pisi-projection-index-core.mjs';

const PISI_SEARCH_INDEX_SCHEMA_VERSION = 1;
const PISI_SEARCH_MEMORY_DRIVER_ID = 'memory-trigram-v1';

function createPisiSearchMemoryIndexDriver() {
    let recordsById = new Map();
    let accelerator = buildPisiSearchAccelerator([]);

    function rebuildAccelerator() {
        const records = Array.from(recordsById.values());
        accelerator = buildPisiSearchAccelerator(records);
        return records;
    }

    return Object.freeze({
        id: PISI_SEARCH_MEMORY_DRIVER_ID,
        replaceAll(records = []) {
            const next = new Map();
            for (const record of Array.isArray(records) ? records : []) {
                if (!record?.id) continue;
                next.set(String(record.id), record);
            }
            recordsById = next;
            rebuildAccelerator();
        },
        applyDelta(delta = {}) {
            const next = new Map(recordsById);
            for (const id of delta.remove || []) next.delete(String(id));
            for (const record of delta.upsert || []) {
                if (!record?.id) continue;
                next.set(String(record.id), record);
            }
            recordsById = next;
            rebuildAccelerator();
        },
        snapshot() {
            return {
                records: Array.from(recordsById.values()),
                accelerator
            };
        },
        clear() {
            recordsById = new Map();
            accelerator = buildPisiSearchAccelerator([]);
        }
    });
}

function createPisiRebuildableSearchIndex(name = 'search') {
    return createPisiRebuildableProjectionIndex({
        name,
        schemaVersion: PISI_SEARCH_INDEX_SCHEMA_VERSION,
        driver: createPisiSearchMemoryIndexDriver()
    });
}

function buildPisiDisposableSearchSnapshot(records = [], options = {}) {
    const index = createPisiRebuildableSearchIndex(options.name || 'search-transient');
    return index.replaceAll(records, {
        sourceFingerprint: options.sourceFingerprint || '',
        builtAt: options.builtAt || Date.now()
    });
}

export {
    PISI_SEARCH_INDEX_SCHEMA_VERSION,
    PISI_SEARCH_MEMORY_DRIVER_ID,
    createPisiSearchMemoryIndexDriver,
    createPisiRebuildableSearchIndex,
    buildPisiDisposableSearchSnapshot
};
