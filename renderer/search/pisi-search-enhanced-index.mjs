import { registerModule } from '../core/module-registry.mjs';
import { pisiSearchPathKey } from './pisi-search-core.mjs';
import { ensurePisiSearchIndex, getPisiSearchCurrentNodePath, getPisiSearchLiveIndex } from './pisi-search-index.mjs';
import { buildPisiDisposableSearchSnapshot, createPisiRebuildableSearchIndex } from './pisi-search-index-adapter.mjs';
import { makePisiProjectionSourceFingerprint } from './pisi-projection-index-core.mjs';
import { getPisiTaskSearchFingerprintPart, makePisiTaskSearchRecord } from './pisi-search-task-records.mjs';
import { findPisiTaskNotePath, formatPisiTaskPanelDay, getPisiTaskNoteTitle } from '../tasks/pisi-task-panel-dom.mjs';

const PISI_SEARCH_PROPERTY_VALUE_LIMIT = 1400;
const PISI_SEARCH_PROPERTY_FIELD_LIMIT = 80;

let pisiSearchTaskGeneration = 0;
let pisiSearchTaskLoadedProjectKey = '';
const pisiSearchLastIndexByProject = new Map();
const pisiSearchProjectionByProject = new Map();
let pisiSearchWarmupTimer = null;

function normalizePisiSearchPropertyValue(value, depth = 0) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value).slice(0, PISI_SEARCH_PROPERTY_VALUE_LIMIT);
    }
    if (depth >= 2) return '';
    if (Array.isArray(value)) {
        return value
            .slice(0, 40)
            .map((item) => normalizePisiSearchPropertyValue(item, depth + 1))
            .filter(Boolean)
            .join(' ')
            .slice(0, PISI_SEARCH_PROPERTY_VALUE_LIMIT);
    }
    if (typeof value === 'object') {
        return Object.entries(value)
            .slice(0, 40)
            .flatMap(([key, item]) => [key, normalizePisiSearchPropertyValue(item, depth + 1)])
            .filter(Boolean)
            .join(' ')
            .slice(0, PISI_SEARCH_PROPERTY_VALUE_LIMIT);
    }
    return '';
}

function makePisiSearchPropertyFields(properties = {}) {
    const entries = Array.isArray(properties)
        ? properties.map((item, index) => [String(item?.name || item?.key || index), item?.value ?? item])
        : Object.entries(properties && typeof properties === 'object' ? properties : {});
    return entries
        .slice(0, PISI_SEARCH_PROPERTY_FIELD_LIMIT)
        .map(([name, value]) => ({
            kind: 'property',
            value: `${String(name || '')} ${normalizePisiSearchPropertyValue(value)}`.trim(),
            weight: 92
        }))
        .filter((field) => field.value);
}

/**
 * Tasks for search from the task store (tasks.json): every task gives one
 * record (pisi-search-task-records.mjs, docs/task-plan.md G5), the tasks of a
 * diary and the tasks without a place (written by the phone) too.
 */
function getPisiCanonicalSearchTasks() {
    return window.getPisiTasks?.() || [];
}

async function ensurePisiCanonicalSearchTasks(projectFolder) {
    const projectKey = pisiSearchPathKey(projectFolder);
    if (pisiSearchTaskLoadedProjectKey !== projectKey || !window.isPisiTaskStoreLoaded?.()) {
        await window.loadPisiTaskStore?.();
        pisiSearchTaskLoadedProjectKey = projectKey;
    }
    return getPisiCanonicalSearchTasks();
}

const pisiSearchNotesById = new WeakMap();

/** The index's note documents by their `pisi.id`, built once per document map. */
function getPisiSearchNotesById(index) {
    const documents = index?.documents;
    if (!(documents instanceof Map)) return new Map();
    let byId = pisiSearchNotesById.get(documents);
    if (!byId) {
        byId = new Map();
        for (const record of documents.values()) if (record?.metadata?.id) byId.set(record.metadata.id, record);
        pisiSearchNotesById.set(documents, byId);
    }
    return byId;
}

/**
 * The note of a task: the search index's document with its id, else the
 * Explorer tree (a note made after the index was built, pisi-error.md §5h).
 */
function findPisiTaskSearchNote(index, task) {
    if (!task?.noteId) return null;
    const documentRecord = getPisiSearchNotesById(index).get(task.noteId);
    if (documentRecord) {
        return {
            path: documentRecord.path,
            title: documentRecord.title || documentRecord.metadata?.title || '',
            relativePath: documentRecord.relativePath || '',
            nodeItem: documentRecord.nodeItem || null,
            memberships: Array.isArray(documentRecord.memberships) ? documentRecord.memberships : []
        };
    }
    const notePath = findPisiTaskNotePath(task.noteId);
    if (!notePath) return null;
    const root = String(index?.projectFolder || window.currentProjectFolder || '').replace(/[\\/]+$/, '');
    return {
        path: notePath,
        title: getPisiTaskNoteTitle(task.noteId) || '',
        relativePath: root && notePath.startsWith(root) ? notePath.slice(root.length + 1).replace(/\\/g, '/') : '',
        nodeItem: null,
        memberships: []
    };
}

function getPisiDocumentForRecord(index, record) {
    if (!(index?.documents instanceof Map) || !record?.nodePath) return null;
    return index.documents.get(pisiSearchPathKey(record.nodePath)) || null;
}

function getPisiRecordMemberships(index, record) {
    const documentRecord = getPisiDocumentForRecord(index, record);
    if (Array.isArray(documentRecord?.memberships)) return documentRecord.memberships;
    if (record?.mapPath) {
        return [
            {
                mapPath: record.mapPath,
                mapTitle: record.mapTitle || '',
                mapItem: record.mapItem || null
            }
        ];
    }
    return [];
}

function addPisiSearchPathKeys(record, memberships = []) {
    return {
        ...record,
        nodePathKey: pisiSearchPathKey(record?.nodePath),
        mapPathKey: pisiSearchPathKey(record?.mapPath),
        memberships: memberships.map((membership) => ({
            ...membership,
            mapPathKey: pisiSearchPathKey(membership?.mapPath)
        }))
    };
}

function enhancePisiBaseSearchRecord(index, record) {
    const memberships = getPisiRecordMemberships(index, record);
    const enhanced = addPisiSearchPathKeys(record, memberships);
    if (record?.kind !== 'node') return enhanced;
    const documentRecord = getPisiDocumentForRecord(index, record);
    const propertyFields = makePisiSearchPropertyFields(documentRecord?.properties || {});
    if (!propertyFields.length) return enhanced;
    return {
        ...enhanced,
        searchFields: [...(Array.isArray(record.searchFields) ? record.searchFields : []), ...propertyFields]
    };
}

function makePisiCanonicalTaskSearchRecord(index, task) {
    const note = findPisiTaskSearchNote(index, task);
    const record = makePisiTaskSearchRecord(task, {
        note,
        memberships: note?.memberships || [],
        translate: (value) => window.pisiT?.(value) ?? value,
        formatDay: formatPisiTaskPanelDay
    });
    return record ? addPisiSearchPathKeys(record, record.memberships) : null;
}

function makePisiEnhancedSourceFingerprint(baseIndex, tasks = getPisiCanonicalSearchTasks()) {
    const parts = [];
    for (const record of Array.isArray(baseIndex?.records) ? baseIndex.records : []) {
        parts.push(['base', record?.id || '', record?.nodeItem?.metadata?.updatedAt || '', record?.nodeItem?.metadata?.id || '', record?.kind || ''].join(':'));
    }
    for (const task of Array.isArray(tasks) ? tasks : []) parts.push(getPisiTaskSearchFingerprintPart(task, findPisiTaskSearchNote(baseIndex, task)));
    return makePisiProjectionSourceFingerprint(parts);
}

function buildPisiEnhancedRecords(baseIndex, tasks = getPisiCanonicalSearchTasks()) {
    const records = (Array.isArray(baseIndex?.records) ? baseIndex.records : [])
        .filter((record) => record?.kind !== 'task')
        .map((record) => enhancePisiBaseSearchRecord(baseIndex, record));
    for (const task of tasks) {
        const record = makePisiCanonicalTaskSearchRecord(baseIndex, task);
        if (record) records.push(record);
    }
    return records;
}

function makePisiEnhancedIndexResult(baseIndex, snapshot, taskCount) {
    const records = snapshot.records || [];
    const accelerator = snapshot.accelerator;
    return {
        ...baseIndex,
        records,
        accelerator,
        projection: snapshot.projection,
        canonicalTasks: true,
        performance: {
            ...(baseIndex.performance || {}),
            enhancedRecordCount: records.length,
            enhancedGramCount: accelerator?.gramCount || 0,
            canonicalTaskCount: taskCount
        }
    };
}

function makePisiEnhancedSearchIndex(baseIndex, options = {}) {
    if (!baseIndex) return null;
    const projectKey = pisiSearchPathKey(baseIndex.projectFolder);
    const tasks = getPisiCanonicalSearchTasks();
    const sourceFingerprint = makePisiEnhancedSourceFingerprint(baseIndex, tasks);
    const cached = !options.transient ? pisiSearchProjectionByProject.get(projectKey) : null;
    if (
        cached?.baseIndex === baseIndex &&
        cached?.taskGeneration === pisiSearchTaskGeneration &&
        cached?.index?.projection?.sourceFingerprint === sourceFingerprint
    ) {
        return cached.index;
    }

    const records = buildPisiEnhancedRecords(baseIndex, tasks);
    let snapshot;
    let projection = null;
    if (options.transient) {
        snapshot = buildPisiDisposableSearchSnapshot(records, {
            name: 'search-live',
            sourceFingerprint
        });
    } else {
        projection = cached?.projection || createPisiRebuildableSearchIndex('search-enhanced');
        snapshot = projection.replaceAll(records, { sourceFingerprint });
    }
    const index = makePisiEnhancedIndexResult(baseIndex, snapshot, tasks.length);
    if (!options.transient && projectKey) {
        pisiSearchProjectionByProject.set(projectKey, {
            baseIndex,
            taskGeneration: pisiSearchTaskGeneration,
            projection,
            index
        });
        pisiSearchLastIndexByProject.set(projectKey, index);
    }
    return index;
}

function applyPisiCanonicalTaskSearchDelta(projectFolder = window.currentProjectFolder) {
    const projectKey = pisiSearchPathKey(projectFolder);
    const cached = pisiSearchProjectionByProject.get(projectKey);
    if (!cached?.projection || !cached?.baseIndex) return null;
    const tasks = getPisiCanonicalSearchTasks();
    const taskRecords = tasks.map((task) => makePisiCanonicalTaskSearchRecord(cached.baseIndex, task)).filter(Boolean);
    const existingTaskIds = (cached.index?.records || []).filter((record) => record?.kind === 'task').map((record) => record.id);
    const sourceFingerprint = makePisiEnhancedSourceFingerprint(cached.baseIndex, tasks);
    const delta = cached.projection.applyDelta(
        {
            remove: existingTaskIds,
            upsert: taskRecords
        },
        { sourceFingerprint }
    );
    if (!delta.ok) {
        cached.projection.invalidate('task-delta-rebuild-required');
        pisiSearchProjectionByProject.delete(projectKey);
        pisiSearchLastIndexByProject.delete(projectKey);
        return null;
    }
    const index = makePisiEnhancedIndexResult(cached.baseIndex, delta, tasks.length);
    pisiSearchProjectionByProject.set(projectKey, {
        ...cached,
        taskGeneration: pisiSearchTaskGeneration,
        index
    });
    pisiSearchLastIndexByProject.set(projectKey, index);
    return index;
}

async function ensurePisiEnhancedSearchIndex(options = {}) {
    const projectFolder = window.currentProjectFolder;
    if (!projectFolder) return null;
    const [baseIndex] = await Promise.all([ensurePisiSearchIndex(options), ensurePisiCanonicalSearchTasks(projectFolder)]);
    return makePisiEnhancedSearchIndex(baseIndex);
}

async function ensurePisiEnhancedLiveSearchIndex(options = {}) {
    const base = await ensurePisiSearchIndex(options);
    if (!base) return null;
    await ensurePisiCanonicalSearchTasks(base.projectFolder);
    const live = getPisiSearchLiveIndex(base, options.targetPath || getPisiSearchCurrentNodePath());
    if (live === base) return makePisiEnhancedSearchIndex(base);
    return makePisiEnhancedSearchIndex(live, { transient: true });
}

function getPisiStaleSearchIndex(projectFolder = window.currentProjectFolder) {
    return pisiSearchLastIndexByProject.get(pisiSearchPathKey(projectFolder)) || null;
}

function getPisiRebuildableSearchIndexStatus(projectFolder = window.currentProjectFolder) {
    const cached = pisiSearchProjectionByProject.get(pisiSearchPathKey(projectFolder));
    return cached?.projection?.getManifest?.() || null;
}

function invalidatePisiEnhancedSearchProjection(reason = 'source-changed', projectFolder = window.currentProjectFolder) {
    const projectKey = pisiSearchPathKey(projectFolder);
    const cached = pisiSearchProjectionByProject.get(projectKey);
    cached?.projection?.invalidate?.(reason);
    pisiSearchProjectionByProject.delete(projectKey);
    pisiSearchLastIndexByProject.delete(projectKey);
}

function schedulePisiSearchWarmup(delay = 120) {
    clearTimeout(pisiSearchWarmupTimer);
    if (!window.currentProjectFolder) return;
    pisiSearchWarmupTimer = setTimeout(
        () => {
            pisiSearchWarmupTimer = null;
            const run = () =>
                void ensurePisiEnhancedSearchIndex().catch((error) => {
                    console.warn('[PISI] Search warmup failed:', error);
                });
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(run, { timeout: 1200 });
            } else {
                run();
            }
        },
        Math.max(0, Number(delay) || 0)
    );
}

document.addEventListener('pisi:task-store-updated', () => {
    pisiSearchTaskGeneration += 1;
    const index = applyPisiCanonicalTaskSearchDelta();
    document.dispatchEvent(
        new CustomEvent('pisi:enhanced-search-index-updated', {
            detail: {
                reason: 'tasks',
                mode: index ? 'delta' : 'rebuild-required',
                projection: index?.projection || null
            }
        })
    );
});

document.addEventListener('pisi:search-index-invalidated', (event) => {
    invalidatePisiEnhancedSearchProjection(event.detail?.reason || 'base-invalidated');
});

document.addEventListener('pisi:search-index-ready', (event) => {
    if (event.detail?.index) makePisiEnhancedSearchIndex(event.detail.index);
});

const moduleApi = {
    ensurePisiEnhancedSearchIndex,
    ensurePisiEnhancedLiveSearchIndex,
    getPisiStaleSearchIndex,
    getPisiRebuildableSearchIndexStatus,
    invalidatePisiEnhancedSearchProjection,
    applyPisiCanonicalTaskSearchDelta,
    makePisiCanonicalTaskSearchRecord,
    makePisiEnhancedSearchIndex,
    makePisiEnhancedSourceFingerprint,
    makePisiSearchPropertyFields,
    normalizePisiSearchPropertyValue,
    schedulePisiSearchWarmup
};
registerModule('search.enhancedIndex', moduleApi);

export {
    ensurePisiEnhancedSearchIndex,
    ensurePisiEnhancedLiveSearchIndex,
    getPisiStaleSearchIndex,
    getPisiRebuildableSearchIndexStatus,
    invalidatePisiEnhancedSearchProjection,
    applyPisiCanonicalTaskSearchDelta,
    makePisiCanonicalTaskSearchRecord,
    makePisiEnhancedSearchIndex,
    makePisiEnhancedSourceFingerprint,
    makePisiSearchPropertyFields,
    normalizePisiSearchPropertyValue,
    schedulePisiSearchWarmup
};
