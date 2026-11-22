// Conflict copies of the sync core (docs/sync-plan.md §3.4, rules SV3, SV6).
// A copy is a new note with a new node_ id and its own sidecar, in the same
// folder and with the same parentMap as the original. A diary day's copy is a
// normal note at the project root. Task blocks and the diary's task section
// stay out of the copy: the tasks stay in the original note (docs/task-plan.md
// §3.3, G9), so no task id is in two notes. The attachments the copy refers to are
// listed as new paths for the same content (the same blob id on the server).
// Clock, uuid and the "is this path taken" question come from the caller.

import { formatPisiDocumentId } from './ids.mjs';
import { getPisiPhysicalFileName, getPisiSidecarName, isPisiManagedSidecarFolder } from './document-naming.mjs';
import { splitNoteBlocks, htmlToText } from './note-blocks.mjs';
import { getPisiSyncDiaryDate, getPisiSyncParentPath, joinPisiSyncPath } from './sync-paths.mjs';
import { clonePisiSyncJson } from './sync-merge-json.mjs';

export const PISI_SYNC_CONFLICT_LABELS = Object.freeze({ conflict: 'çakışma', diaryConflict: 'Günlük çakışması' });
const ASSET_ATTRIBUTE = /\sdata-pisi-(?:asset|sheet-asset|image-asset|file-asset)="((?:image|file|paint|sheet)\/[^"/]+)"/g;
// The todo tag and checkbox of a task block: their text is markup, not the user's words.
const TASK_CHROME = /<span\b[^>]*\bclass="[^"]*\b(?:pisi-user-tag|pisi-block-task-marker)\b[^"]*"[^>]*>[^<]*<\/span>/gi;
const MANAGED_START = 'PISI_DIARY_MANAGED_START';
const MANAGED_END = 'PISI_DIARY_MANAGED_END';
const MAX_ATTEMPTS = 1000;

const two = (value) => String(value).padStart(2, '0');

/** "DD-MM-YYYY HH.mm" of a Date in the caller's local time. */
export function formatPisiSyncConflictStamp(date) {
    return `${two(date.getDate())}-${two(date.getMonth() + 1)}-${date.getFullYear()} ${two(date.getHours())}.${two(date.getMinutes())}`;
}

function escapeText(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Sidecar-relative attachment references of note content (`image/<sha>.png`, …), sorted. */
export function getPisiSyncContentAssetReferences(content) {
    const references = new Set();
    for (const match of String(content || '').matchAll(ASSET_ATTRIBUTE)) references.add(match[1]);
    return [...references].sort();
}

/**
 * Content of a conflict copy. Task blocks (§3.2.1) and the diary's task
 * section (§3.2.2) are left out, as stripPisiTaskBlocks (shared/task-blocks.mjs)
 * leaves them out; they carry only task ids, so no text is lost. Old markup
 * keeps its earlier handling: an old task block becomes a paragraph with the
 * same text (one line per line of the task) and the old managed section is
 * left out.
 */
export function makePisiSyncConflictContent(content) {
    let out = '';
    let managed = false;
    for (const segment of splitNoteBlocks(content)) {
        if (segment.kind === 'comment' && segment.html.includes(MANAGED_START)) {
            managed = true;
            continue;
        }
        if (segment.kind === 'comment' && segment.html.includes(MANAGED_END)) {
            managed = false;
            continue;
        }
        if (managed || segment.blockType === 'diary-managed' || segment.blockType === 'diary-heading') continue;
        if (segment.blockType === 'diary-tasks' || (segment.blockType === 'task' && segment.taskId)) continue;
        if (segment.blockType === 'task') {
            const text = htmlToText((segment.inner || '').replace(TASK_CHROME, (span) => (/data-pisi-tag="(?!todo\.)/i.test(span) ? span : '')))
                .split('\n')
                .map((line) => line.replace(/[ \t]+/g, ' ').trim())
                .filter(Boolean)
                .map(escapeText)
                .join('<br>');
            const id = segment.blockId ? ` data-pisi-block-id="${escapeText(segment.blockId)}"` : '';
            out += `<div class="pisi-editor-block"${id} data-pisi-block-type="paragraph">${text || '<br>'}</div>`;
            continue;
        }
        out += segment.html;
    }
    return out;
}

/**
 * Builds the conflict copy of a note. `path` is the original's path, `document`
 * the parsed side that lost (written whole), `now` a Date, `makeUuid()` a new
 * uuid, `isTaken(path)` whether a project path is in use (the caller folds
 * case as its file system does). Returns `{ path, document, sidecar, assets }`:
 * `sidecar` is the folder to create next to the copy and `assets` the
 * `{ from, to }` attachment paths to copy into it.
 */
export function makePisiSyncConflictCopy({ path, document, deviceName = '', now, makeUuid, isTaken = (_path) => false, labels = PISI_SYNC_CONFLICT_LABELS }) {
    const diaryDate = getPisiSyncDiaryDate(path);
    const originalFolder = getPisiSyncParentPath(path);
    const folder = diaryDate ? '' : originalFolder;
    const device = String(deviceName || '').trim();
    const originalTitle = String(
        document?.pisi?.title ||
            path
                .split('/')
                .at(-1)
                .replace(/\.node$/i, '')
    );
    const stamp = formatPisiSyncConflictStamp(now);
    let title;
    if (diaryDate) {
        const [year, month, day] = diaryDate.split('-');
        title = `${labels.diaryConflict} ${day}-${month}-${year}${device ? ` (${device})` : ''}`;
    } else {
        title = `${originalTitle} (${labels.conflict} ${stamp}${device ? ` ${device}` : ''})`;
    }

    const id = formatPisiDocumentId('.node', makeUuid());
    let fileName = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !fileName; attempt += 1) {
        const candidate = getPisiPhysicalFileName(title, '.node', id, attempt);
        if (!isTaken(joinPisiSyncPath(folder, candidate))) fileName = candidate;
    }
    if (!fileName) throw new Error('Çakışma kopyası için boş dosya adı bulunamadı.');

    const sidecar = getPisiSidecarName(title, '.node', id);
    const iso = now.toISOString();
    const copy = clonePisiSyncJson(document) || {};
    const pisi = { ...(copy.pisi || {}), version: copy.pisi?.version ?? 1, type: 'node', id, title, sidecar, createdAt: iso, updatedAt: iso };
    pisi.parentMap = diaryDate ? 'none' : copy.pisi?.parentMap || 'none';
    delete pisi.diaryDate;
    copy.pisi = pisi;
    const originalContent = typeof copy.content === 'string' ? copy.content : '';
    copy.content = makePisiSyncConflictContent(originalContent);

    const originalSidecar = document?.pisi?.sidecar;
    const assets = isPisiManagedSidecarFolder(originalSidecar)
        ? getPisiSyncContentAssetReferences(copy.content).map((reference) => ({
              from: joinPisiSyncPath(joinPisiSyncPath(originalFolder, originalSidecar), reference),
              to: joinPisiSyncPath(joinPisiSyncPath(folder, sidecar), reference)
          }))
        : [];
    return { path: joinPisiSyncPath(folder, fileName), document: copy, sidecar: joinPisiSyncPath(folder, sidecar), assets };
}

/**
 * Path of the conflict copy of a non-note file (class `other`, plan §3.4):
 * `name (çakışma DD-MM-YYYY HH.mm device).ext` next to the original.
 */
export function makePisiSyncOtherConflictPath({ path, deviceName = '', now, isTaken = (_path) => false, labels = PISI_SYNC_CONFLICT_LABELS }) {
    const folder = getPisiSyncParentPath(path);
    const name = path.split('/').at(-1);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const device = String(deviceName || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .trim();
    const label = `${labels.conflict} ${formatPisiSyncConflictStamp(now)}${device ? ` ${device}` : ''}`;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const candidate = joinPisiSyncPath(folder, `${stem} (${label}${attempt ? ` ${attempt + 1}` : ''})${ext}`);
        if (!isTaken(candidate)) return candidate;
    }
    throw new Error('Çakışma kopyası için boş dosya adı bulunamadı.');
}
