// A new diary file, `diary/YYYY-MM-DD.node` (shared/diary-rules.mjs), made the
// way the desktop makes one (document-store-diary.js getOrCreateDiaryNode): the
// diary folder and its marker file, the note with the desktop's metadata and
// its sidecar folder. The diary text (DiaryRepo) and a task joining a day
// (task-days.mjs) both create a day through here, inside one writer job.

import {
    PISI_DIARY_FOLDER,
    PISI_DIARY_MARKER_FILE,
    PISI_DIARY_MARKER_TEXT,
    getPisiDiaryNodeKey,
    makePisiDiaryDocumentData
} from '../../../shared/diary-rules.mjs';
import { formatPisiDocumentId } from '../../../shared/ids.mjs';
import { joinKey } from './drivers/keys.mjs';
import { serializeDocument } from './json-file.mjs';

export const PISI_DIARY_MARKER_KEY = joinKey(PISI_DIARY_FOLDER, PISI_DIARY_MARKER_FILE);

/**
 * Writes the diary of `day` (which must not exist yet) through `tx`, a
 * ProjectWriter job. `content(empty)` gives the note's content from the
 * desktop's empty diary content. Resolves with `{ key, data }`.
 */
export async function createDiaryFile(tx, day, content, { now, makeUuid }) {
    const key = getPisiDiaryNodeKey(day);
    await tx.mkdir(PISI_DIARY_FOLDER);
    if (!(await tx.exists(PISI_DIARY_MARKER_KEY))) await tx.write(PISI_DIARY_MARKER_KEY, PISI_DIARY_MARKER_TEXT);
    const data = makePisiDiaryDocumentData({ isoDate: day, id: formatPisiDocumentId('.node', makeUuid()), now: now().toISOString() });
    data.content = content(data.content);
    await tx.write(key, serializeDocument(data));
    await tx.mkdir(joinKey(PISI_DIARY_FOLDER, data.pisi.sidecar));
    return { key, data };
}
