import * as fs from 'node:fs';
import * as path from 'node:path';
import { modules } from '../module-registry.js';
import * as shared from './project-integrity-shared.js';
import { findPisiTaskDependencyCycle, getPisiTaskLocation, readPisiTask, readPisiTaskStore } from '../../shared/task-model.mjs';
import { listPisiTaskBlocks } from '../../shared/task-blocks.mjs';
import { readPisiDiaryTaskSection } from '../../shared/task-diary.mjs';
import { getPisiDiaryNodeFileName, normalizePisiDiaryIsoDate, PISI_DIARY_FOLDER } from '../../shared/diary-rules.mjs';

// Project Integrity for tasks (docs/task-plan.md G2 step 5, GV14). The audit
// is the one task operation that reads every note: the user starts it and it
// writes nothing. A finding a task repair can fix carries it (G7,
// task-repair.js); those repairs are 'review': the user starts each one. A
// task without a place (a version 1 record, written by the phone until G8)
// is not a finding (§3.1).

const STORE_PATH = '.pisi/tasks.json';
// Version 2 fields a record may hold only in their valid form.
const CHECKED_FIELDS = [
    'title',
    'tags',
    'status',
    'priority',
    'dueDate',
    'repeat',
    'reminderMode',
    'reminderAt',
    'noteId',
    'diaryDate',
    'completions',
    'dependencies'
];

function taskIssue(context, code, severity, message, extra = {}, repair = null) {
    shared.issue(
        context,
        { severity, code, domain: 'tasks', path: extra.path || STORE_PATH, entityId: extra.entityId || '', message },
        repair ? { safety: 'review', ...repair } : null
    );
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
                taskIssue(
                    context,
                    'task-dependency-missing',
                    'error',
                    `Bağımlı olunan görev yok: ${dependencyId}`,
                    { entityId: task.id },
                    {
                        action: 'task-remove-dependency',
                        description: 'Olmayan göreve bağımlılığı kaldır.',
                        payload: { taskId: task.id, dependencyId }
                    }
                );
        }
        const cycle = findPisiTaskDependencyCycle(tasks, task.id, raw);
        if (cycle) {
            const key = [...new Set(cycle)].sort().join('|');
            if (reportedCycles.has(key)) continue;
            reportedCycles.add(key);
            // The loop closes again through the task's first step; that dependency goes.
            taskIssue(
                context,
                'task-dependency-cycle',
                'error',
                `Görev bağımlılıkları döngü oluşturuyor: ${cycle.join(' → ')}`,
                { entityId: task.id },
                {
                    action: 'task-remove-dependency',
                    description: 'Döngüyü kapatan bağımlılığı kaldır.',
                    payload: { taskId: task.id, dependencyId: cycle[1] }
                }
            );
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

const noteRef = (projectFolder, doc) => ({
    notePath: doc.storedPath,
    noteId: doc.metadata?.id || null,
    diaryDate: getDiaryDateOfDoc(projectFolder, doc)
});

function auditTaskBlocks(projectFolder, context, inventory, byId) {
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
    let trashed = null;
    const isTrashed = (taskId) => {
        trashed ??= modules['main.trashStore'].listPisiTrashedTaskIds(projectFolder);
        return trashed.has(taskId);
    };
    // A task whose only block is in another note gets the move repair, not a second block (GV7).
    const movedHere = new Set();
    for (const [taskId, docs] of occurrences) {
        const task = byId.get(taskId);
        if (!task) {
            const restore = isTrashed(taskId);
            for (const doc of docs) {
                taskIssue(
                    context,
                    'task-block-orphan',
                    'warning',
                    `Notta kaydı olmayan bir görev bloğu var: ${taskId}`,
                    { path: doc.storedPath, entityId: taskId },
                    restore && docs.length === 1
                        ? {
                              action: 'task-restore-orphan',
                              description: 'Görevi çöp kutusundan geri getir; yeri bu not olur.',
                              payload: { taskId, ...noteRef(projectFolder, doc) }
                          }
                        : {
                              action: 'task-remove-orphan-block',
                              description: 'Görev bloğunu nottan kaldır.',
                              payload: { taskId, ...noteRef(projectFolder, doc) }
                          }
                );
            }
            continue;
        }
        if (docs.length > 1) {
            const notes = docs
                .map((doc) => noteRef(projectFolder, doc))
                .filter((note) => note.noteId)
                .sort((a, b) => Number(b.noteId === task.noteId) - Number(a.noteId === task.noteId) || a.notePath.localeCompare(b.notePath));
            taskIssue(
                context,
                'task-duplicate-reference',
                'warning',
                `Görevin bloğu birden çok notta: ${docs.map((doc) => doc.storedPath).join(', ')}`,
                { entityId: taskId },
                notes.length > 1
                    ? {
                          action: 'task-split-duplicate',
                          description: `${notes[0].notePath} dışındaki bloklar yeni görevlere (kopya) çevrilir.`,
                          payload: { taskId, notes }
                      }
                    : null
            );
            continue;
        }
        const location = getPisiTaskLocation(task);
        if (location && (location.kind !== 'note' || docs[0].metadata?.id !== location.noteId)) {
            movedHere.add(taskId);
            taskIssue(
                context,
                'task-block-misplaced',
                'warning',
                'Görevin bloğu görevin yeri olmayan bir notta.',
                { path: docs[0].storedPath, entityId: taskId },
                docs[0].metadata?.id
                    ? {
                          action: 'task-move-to-block',
                          description: 'Görevin yeri bloğun bulunduğu not olsun.',
                          payload: { taskId, ...noteRef(projectFolder, docs[0]) }
                      }
                    : null
            );
        }
    }
    for (const task of byId.values()) {
        if (!task.noteId) continue;
        const note = inventory.nodeById.get(task.noteId);
        if (!note) {
            taskIssue(
                context,
                'task-note-missing',
                'error',
                `Görevin notu yok: ${task.noteId}`,
                { entityId: task.id },
                movedHere.has(task.id)
                    ? null
                    : {
                          action: 'task-place-in-today-diary',
                          description: 'Görevi bugünün günlüğüne bağla.',
                          payload: { taskId: task.id, noteId: task.noteId }
                      }
            );
            continue;
        }
        if (!(occurrences.get(task.id) || []).some((doc) => doc.filePath === note.filePath)) {
            taskIssue(
                context,
                'task-homeless',
                'warning',
                'Görevin notunda görev bloğu yok.',
                { path: note.storedPath, entityId: task.id },
                movedHere.has(task.id)
                    ? null
                    : {
                          action: 'task-append-block',
                          description: 'Görev bloğunu notun sonuna ekle.',
                          payload: { taskId: task.id, notePath: note.storedPath, noteId: task.noteId }
                      }
            );
        }
    }
}

/**
 * A diary's task section (GV15): one section, the diary's last block, with
 * the block id of its day and only ids of tasks that exist. Until the phone
 * writes sections too (G8), a section is not checked against the full day
 * rule: the phone (task records version 1) completes and moves tasks without
 * rewriting sections, and the desktop brings a section back to the rule the
 * next time a task of that day changes or the diary is saved.
 */
function auditDiarySections(projectFolder, context, inventory, byId) {
    for (const doc of inventory.docs) {
        if (doc.type !== 'node' || !doc.metadata) continue;
        const day = getDiaryDateOfDoc(projectFolder, doc);
        if (!day) continue;
        const section = readPisiDiaryTaskSection(String(doc.data?.content || ''));
        if (!section) {
            taskIssue(context, 'diary-task-section-mismatch', 'warning', 'Günlüğün içeriği izlenemiyor; görev bölümü denetlenemedi.', { path: doc.storedPath });
            continue;
        }
        if (!section.count) continue;
        const unknown = section.taskIds.filter((id) => !byId.has(id));
        const fits = section.count === 1 && section.last && section.blockId === `blk_diary-tasks-${day}` && !unknown.length;
        if (!fits) {
            taskIssue(
                context,
                'diary-task-section-mismatch',
                'warning',
                'Günlüğün görev bölümü kurala uymuyor.',
                { path: doc.storedPath },
                { action: 'task-rebuild-diary-section', description: 'Görev bölümünü görev kayıtlarından yeniden üret.', payload: { diaryDate: day } }
            );
        }
    }
}

function auditPisiTasks(projectFolder, context, inventory) {
    const read = readTaskRecords(projectFolder, context);
    if (!read.ok) return { tasks: [], byId: new Map() };
    const byId = auditTaskRecords(context, read.records);
    auditTaskDependencies(context, byId);
    auditTaskBlocks(projectFolder, context, inventory, byId);
    auditDiarySections(projectFolder, context, inventory, byId);
    return { tasks: [...byId.values()], byId };
}

export { auditPisiTasks };
