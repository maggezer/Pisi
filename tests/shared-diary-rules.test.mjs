import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
} from '../shared/diary-rules.mjs';

test('günlük tarihi YYYY-MM-DD biçiminde ve gerçek bir gün olmalıdır', () => {
    assert.equal(normalizePisiDiaryIsoDate('2026-11-12'), '2026-11-12');
    assert.equal(normalizePisiDiaryIsoDate(' 2026-11-12 '), '2026-11-12');
    assert.equal(normalizePisiDiaryIsoDate('2028-02-29'), '2028-02-29');

    for (const invalid of ['2026-02-30', '2026-13-01', '12-11-2026', '2026-11-12T10:00', '2026-1-1', '', null, undefined]) {
        assert.equal(normalizePisiDiaryIsoDate(invalid), null, String(invalid));
    }
});

test('günlük notunun başlığı GG-AA-YYYY, dosyası diary/YYYY-MM-DD.node', () => {
    assert.equal(makePisiDiaryNodeTitle('2026-11-12'), '12-11-2026');
    assert.equal(getPisiDiaryNodeFileName('2026-11-12'), '2026-11-12.node');
    assert.equal(getPisiDiaryNodeKey('2026-11-12'), 'diary/2026-11-12.node');

    assert.equal(PISI_DIARY_FOLDER, 'diary');
    assert.equal(PISI_DIARY_MARKER_FILE, '.pisi-diary');
    assert.equal(PISI_DIARY_MARKER_TEXT, 'Bu klasör PISI diary özelliği tarafından yönetilir.\n');
    assert.equal(PISI_DIARY_PARENT_MAP, 'diary');
});

test('dosya adından gün: yalnız tam ada sahip .node dosyası bir günü gösterir', () => {
    assert.equal(getPisiDiaryDateFromFileName('2026-11-12.node'), '2026-11-12');
    assert.equal(getPisiDiaryDateFromFileName(getPisiDiaryNodeFileName('2028-02-29')), '2028-02-29');

    for (const other of ['2026-11-12.NODE', '2026-02-30.node', 'notlar.node', '.node', '2026-11-12', '2026-11-12.node.bak', '', null]) {
        assert.equal(getPisiDiaryDateFromFileName(other), null, String(other));
    }
});

test('yeni günlük notu: masaüstünün yazdığı alanlar, sıra ve boş içerik', () => {
    const data = makePisiDiaryDocumentData({ isoDate: '2026-10-21', id: 'node_abc', now: '2026-11-13T09:30:15.123Z' });

    assert.equal(
        JSON.stringify(data),
        '{"pisi":{"version":1,"type":"node","id":"node_abc","title":"21-10-2026","sidecar":"inv_21-10-2026__node_abc","createdAt":"2026-11-13T09:30:15.123Z","updatedAt":"2026-11-13T09:30:15.123Z","parentMap":"diary","diaryDate":"2026-10-21"},"content":"<div><br></div>"}'
    );
    assert.equal(data.content, PISI_DIARY_EMPTY_CONTENT);
    assert.doesNotMatch(data.content, /<h[1-6]\b/i);
});
