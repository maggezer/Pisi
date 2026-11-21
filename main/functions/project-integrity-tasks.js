import * as fs from 'node:fs';
import * as path from 'node:path';
import { modules } from '../module-registry.js';
import * as shared from './project-integrity-shared.js';
import { findPisiTaskDependencyCycle, getPisiTaskLocation, readPisiTask, readPisiTaskStore } from '../../shared/task-model.mjs';
import { listPisiTaskBlocks } from '../../shared/task-blocks.mjs';
import { listPisiDiaryTaskIds, readPisiDiaryTaskSection } from '../../shared/task-diary.mjs';
import { getPisiDiaryNodeFileName, normalizePisiDiaryIsoDate, PISI_DIARY_FOLDER } from '../../shared/diary-rules.mjs';

// Project Integrity for tasks (docs/task-plan.md G2 step 5, GV14). The audit
// is the one task operation that reads every note: the user starts it and it
// writes nothing. Repairs come in G7. A task without a place (a version 1
// record, written by the phone until G8) is not a finding (§3.1).

const STORE_PATH = '.pisi/tasks.json';
// Version 2 fields a record may hold only in their valid form.
const CHECKED_FIELDS = ['title', 'status', 'priority', 'dueDate', 'repeat', 'reminderMode', 'reminderAt', 'noteId', 'diaryDate', 'completions', 'dependencies'];

function taskIssue(context, code, severity, message, extra = {}) {
    shared.issue(context, { severity, code, domain: 'tasks', path: extra.path || STORE_PATH, entityId: extra.entityId || '', message });
}

function readTaskRecords(projectFolder, context) {
    const storePath = modules['main.taskStore'].getPisiTaskStorePath(projectFolder);
    if (!fs.existsSync(storePath)) return { records: [], ok: true };
    const read = shared.readJson(storePath);
    const store = read.ok ? readPisiTaskStore(read.data) : { ok: false, error: read.error };
    if (!store.ok) {
        shared.issue(
            context,
            {
                severity: 'critical',
                code: 'task-store-invalid',
                domain: 'tasks',
                path: STORE_PATH,
                message: `Görev deposu okunamıyor: ${store.error || 'geçersiz'}`
            },
            {
                safety: 'manual',
                action: 'recover-task-store',
                description: 'tasks.json dosyasını yedekten ya da Depo geçmişinden kurtarın; görevler bu sırada salt okunurdur.'
            }
        );
        return { records: [], ok: false };
    }
    return { records: store.tasks, ok: true };
}

function sameValue(a, b) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function auditTaskRecords(context, records) {
    const byId = new Map();
    for (const record of records) {
        const task = readPisiTask(record);
        const rawId = String(record?.id || '');
        if (!task) {
            taskIssue(context, 'task-id-invalid', 'error', `Görev kimliği geçersiz: ${rawId || '?'}`, { entityId: rawId });
            continue;
        }
        if (byId.has(task.id)) {
            taskIssue(context, 'task-duplicate-id', 'critical', `Aynı görev kimliği birden çok kayıtta: ${task.id}`, { entityId: task.id });
            continue;
        }
        byId.set(task.id, task);
        const invalid = CHECKED_FIELDS.filter((field) => record[field] !== undefined && record[field] !== null && !sameValue(record[field], task[field]));
        if (record.noteId && record.diaryDate) invalid.push('noteId+diaryDate');
        if (invalid.length) {
            taskIssue(context, 'task-field-invalid', 'warning', `Görev alanı geçersiz: ${invalid.join(', ')}`, { entityId: task.id });
        }
    }
    return byId;
}

function auditTaskDependencies(context, byId) {
    const tasks = [...byId.values()];
    const reportedCycles = new Set();
    for (const task of tasks) {
        const raw = Array.isArray(task.dependencies) ? task.dependencies : [];
        for (const dependencyId of raw) {
            if (!byId.has(dependencyId))
                taskIssue(context, 'task-dependency-missing', 'error', `Bağımlı olunan görev yok: ${dependencyId}`, { entityId: task.id });
        }
        const cycle = findPisiTaskDependencyCycle(tasks, task.id, raw);
        if (cycle) {
            const key = [...new Set(cycle)].sort().join('|');
            if (reportedCycles.has(key)) continue;
            reportedCycles.add(key);
            taskIssue(context, 'task-dependency-cycle', 'error', `Görev bağımlılıkları döngü oluşturuyor: ${cycle.join(' → ')}`, { entityId: task.id });
        }
    }
}

function getDiaryDateOfDoc(projectFolder, doc) {
    const day = normalizePisiDiaryIsoDate(doc.data?.pisi?.diaryDate);
    if (!day) return null;
    const expected = path.join(path.resolve(projectFolder), PISI_DIARY_FOLDER, getPisiDiaryNodeFileName(day));
    const compare = (value) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
    return compare(expected) === compare(doc.filePath) ? day : null;
}

function auditTaskBlocks(context, inventory, byId) {
    const occurrences = new Map();
    for (const doc of inventory.docs) {
        if (doc.type !== 'node' || !doc.metadata) continue;
        const blocks = listPisiTaskBlocks(String(doc.data?.content || ''));
        if (!blocks) continue;
        for (const block of blocks) {
            if (!occurrences.has(block.taskId)) occurrences.set(block.taskId, []);
            const list = occurrences.get(block.taskId);
            if (!list.includes(doc)) list.push(doc);
        }
    }
    for (const [taskId, docs] of occurrences) {
        const task = byId.get(taskId);
        if (!task) {
            for (const doc of docs) {
                taskIssue(context, 'task-block-orphan', 'warning', `Notta kaydı olmayan bir görev bloğu var: ${taskId}`, {
                    path: doc.storedPath,
                    entityId: taskId
                });
            }
            continue;
        }
        if (docs.length > 1) {
            taskIssue(context, 'task-duplicate-reference', 'warning', `Görevin bloğu birden çok notta: ${docs.map((doc) => doc.storedPath).join(', ')}`, {
                entityId: taskId
            });
            continue;
        }
        const location = getPisiTaskLocation(task);
        if (location && (location.kind !== 'note' || docs[0].metadata?.id !== location.noteId)) {
            taskIssue(context, 'task-block-misplaced', 'warning', 'Görevin bloğu görevin yeri olmayan bir notta.', {
                path: docs[0].storedPath,
                entityId: taskId
            });
        }
    }
    for (const task of byId.values()) {
        if (!task.noteId) continue;
        const note = inventory.nodeById.get(task.noteId);
        if (!note) {
            taskIssue(context, 'task-note-missing', 'error', `Görevin notu yok: ${task.noteId}`, { entityId: task.id });
            continue;
        }
        if (!(occurrences.get(task.id) || []).some((doc) => doc.filePath === note.filePath)) {
            taskIssue(context, 'task-homeless', 'warning', 'Görevin notunda görev bloğu yok.', { path: note.storedPath, entityId: task.id });
        }
    }
}

/**
 * A diary's task section must be the one the rule gives (GV15): one section,
 * the last block, the ids of the day in order. A task without a place (version
 * 1, §3.1) may be listed or not: the phone does not write sections until G8.
 */
function auditDiarySections(projectFolder, context, inventory, byId) {
    const tasks = [...byId.values()];
    const located = (id) => Boolean(getPisiTaskLocation(byId.get(id)));
    for (const doc of inventory.docs) {
        if (doc.type !== 'node' || !doc.metadata) continue;
        const day = getDiaryDateOfDoc(projectFolder, doc);
        if (!day) continue;
        const section = readPisiDiaryTaskSection(String(doc.data?.content || ''));
        if (!section) {
            taskIssue(context, 'diary-task-section-mismatch', 'warning', 'Günlüğün içeriği izlenemiyor; görev bölümü denetlenemedi.', { path: doc.storedPath });
            continue;
        }
        const expected = listPisiDiaryTaskIds(day, tasks);
        const listed = section.taskIds;
        const wanted = expected.filter(located);
        const shown = listed.filter((id) => !byId.has(id) || located(id));
        const structure = expected.length ? section.count <= 1 && (section.count === 0 || section.last) : section.count === 0 || !listed.length;
        const extra = listed.filter((id) => !expected.includes(id));
        const fits = structure && !extra.length && sameValue(shown, wanted) && (!section.count || section.blockId === `blk_diary-tasks-${day}`);
        if (!fits) {
            taskIssue(context, 'diary-task-section-mismatch', 'warning', 'Günlüğün görev bölümü görev kayıtlarıyla uyuşmuyor.', { path: doc.storedPath });
        }
    }
}

function auditPisiTasks(projectFolder, context, inventory) {
    const read = readTaskRecords(projectFolder, context);
    if (!read.ok) return { tasks: [], byId: new Map() };
    const byId = auditTaskRecords(context, read.records);
    auditTaskDependencies(context, byId);
    auditTaskBlocks(context, inventory, byId);
    auditDiarySections(projectFolder, context, inventory, byId);
    return { tasks: [...byId.values()], byId };
}

export { auditPisiTasks };
