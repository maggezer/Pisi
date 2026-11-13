// Diary rules: the diary lives in the project's `diary/` folder, marked by a
// `.pisi-diary` file. A day is `diary/YYYY-MM-DD.node`, titled `DD-MM-YYYY`,
// with parentMap `diary` and the date repeated in pisi.diaryDate.

import { makePisiDocumentData } from './document-model.mjs';

const PISI_DIARY_FOLDER = 'diary';
const PISI_DIARY_MARKER_FILE = '.pisi-diary';
const PISI_DIARY_MARKER_TEXT = 'Bu klasör PISI diary özelliği tarafından yönetilir.\n';
const PISI_DIARY_PARENT_MAP = 'diary';
const PISI_DIARY_EMPTY_CONTENT = '<div><br></div>';

function normalizePisiDiaryIsoDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    return raw;
}

function makePisiDiaryNodeTitle(isoDate) {
    const [year, month, day] = String(isoDate).split('-');
    return `${day}-${month}-${year}`;
}

function getPisiDiaryNodeFileName(isoDate) {
    return `${isoDate}.node`;
}

/** Project-relative key of a day's diary note, with forward slashes. */
function getPisiDiaryNodeKey(isoDate) {
    return `${PISI_DIARY_FOLDER}/${getPisiDiaryNodeFileName(isoDate)}`;
}

/** The day a diary file name stands for (`2026-11-12.node`), or null. */
function getPisiDiaryDateFromFileName(fileName) {
    const name = String(fileName || '');
    if (name.length <= '.node'.length || !name.endsWith('.node')) return null;
    return normalizePisiDiaryIsoDate(name.slice(0, -'.node'.length));
}

/**
 * Document data of a new diary note. `isoDate` must already be normalized;
 * `now` is the ISO timestamp for createdAt/updatedAt.
 */
function makePisiDiaryDocumentData({ isoDate, id, now }) {
    const data = makePisiDocumentData({
        ext: '.node',
        title: makePisiDiaryNodeTitle(isoDate),
        id,
        parentMap: PISI_DIARY_PARENT_MAP,
        now
    });

    data.pisi.diaryDate = isoDate;
    data.content = PISI_DIARY_EMPTY_CONTENT;
    return data;
}

export {
    PISI_DIARY_EMPTY_CONTENT,
    PISI_DIARY_FOLDER,
    PISI_DIARY_MARKER_FILE,
    PISI_DIARY_MARKER_TEXT,
    PISI_DIARY_PARENT_MAP,
    getPisiDiaryDateFromFileName,
    getPisiDiaryNodeFileName,
    getPisiDiaryNodeKey,
    makePisiDiaryDocumentData,
    makePisiDiaryNodeTitle,
    normalizePisiDiaryIsoDate
};
