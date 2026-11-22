// The one producer of task search records (docs/task-plan.md G5, GB11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getPisiTaskSearchFingerprintPart, getPisiTaskSearchPlace, makePisiTaskSearchRecord } from '../renderer/search/pisi-search-task-records.mjs';

const id = 'task_00000000-0000-4000-9000-000000000001';
const EN = { Not: 'Note', Günlük: 'Diary', 'Yeri yok': 'No place', Görev: 'Task' };
const translate = (value) => EN[value] ?? value;
const formatDay = (day) => day.split('-').reverse().join('.');

test('nottaki görev notun başlığı, yolu ve haritasıyla bulunur ve yerini açar', () => {
    const note = { path: '/p/Plan.node', title: 'Plan', relativePath: 'Plan.node', nodeItem: { fullPath: '/p/Plan.node' } };
    const record = makePisiTaskSearchRecord(
        { id, title: 'Raporu bitir', status: 'doing', priority: 5, noteId: 'node_a', dueDate: '2026-11-25' },
        { note, memberships: [{ mapPath: '/p/Harita.map', mapTitle: 'Harita' }], translate, formatDay }
    );
    assert.equal(record.id, `task:${id}`);
    assert.equal(record.kind, 'task');
    assert.equal(record.place, 'note');
    assert.equal(record.opensDetail, false);
    assert.equal(record.nodePath, '/p/Plan.node');
    assert.equal(record.nodeTitle, 'Plan');
    assert.equal(record.mapTitle, 'Harita');
    assert.equal(record.preview, 'Plan · Harita · 25.11.2026');
    assert.deepEqual(
        record.searchFields.filter((field) => field.value).map((field) => field.kind),
        ['task', 'title', 'title', 'map', 'path', 'status', 'priority']
    );
});

test('günlükteki görev gününün günlüğüyle, notu bulunmayan ve yeri olmayan görev ayrıntıyla açılır', () => {
    const diary = makePisiTaskSearchRecord({ id, title: 'Spor', diaryDate: '2026-11-22' }, { translate, formatDay });
    assert.equal(diary.place, 'diary');
    assert.equal(diary.nodeTitle, 'Diary · 22.11.2026');
    assert.equal(diary.opensDetail, false);
    assert.equal(diary.nodePath, null);

    const missingNote = makePisiTaskSearchRecord({ id, title: 'Kayıp', noteId: 'node_gone' }, { note: null, translate });
    assert.equal(missingNote.nodeTitle, 'Note');
    assert.equal(missingNote.opensDetail, true);

    // Telefonun yazdığı sürüm 1 kaydı: yeri yok ama aranır (GB11).
    const phone = makePisiTaskSearchRecord({ id, title: 'Telefonda eklendi', status: 'todo', source: { nodePath: null } }, { translate });
    assert.equal(getPisiTaskSearchPlace(phone), 'none');
    assert.equal(phone.place, 'none');
    assert.equal(phone.nodeTitle, 'No place');
    assert.equal(phone.opensDetail, true);
    assert.equal(phone.searchFields[0].value, 'Telefonda eklendi');
});

test('başlıksız görevin adı "Görev"dir; geçersiz değer kayıt vermez; değişen alan parmak izini değiştirir', () => {
    assert.equal(makePisiTaskSearchRecord({ id, title: '  ', noteId: 'node_a' }, { translate }).title, 'Task');
    assert.equal(makePisiTaskSearchRecord(null), null);
    assert.equal(makePisiTaskSearchRecord({ title: 'kimliksiz' }), null);
    const task = { id, title: 'A', noteId: 'node_a', updatedAt: '2026-11-22T00:00:00.000Z' };
    const base = getPisiTaskSearchFingerprintPart(task, { path: '/p/A.node', title: 'A' });
    assert.notEqual(base, getPisiTaskSearchFingerprintPart({ ...task, diaryDate: '2026-11-22', noteId: null }, null));
    assert.notEqual(base, getPisiTaskSearchFingerprintPart(task, { path: '/p/B.node', title: 'A' }));
    assert.equal(base, getPisiTaskSearchFingerprintPart({ ...task }, { path: '/p/A.node', title: 'A' }));
});

test('görevin etiketleri (G6) kayıtta durur ve görevi # ile ya da # olmadan buldurur', async () => {
    const { searchPisiRecords } = await import('../renderer/search/pisi-search-core.mjs');
    const tagged = makePisiTaskSearchRecord({ id, title: 'Raporu bitir', tags: ['proje', 'acil'], diaryDate: '2026-11-22' }, { translate, formatDay });
    assert.deepEqual(tagged.tags, ['proje', 'acil']);
    assert.equal(tagged.tag, 'proje');
    assert.deepEqual(
        tagged.searchFields.filter((field) => field.kind === 'tag').map((field) => field.value),
        ['proje', 'acil']
    );
    const plain = makePisiTaskSearchRecord({ id: `${id}2`, title: 'Başka iş', diaryDate: '2026-11-22' }, { translate, formatDay });
    for (const query of ['#acil', 'acil']) {
        assert.deepEqual(
            searchPisiRecords([tagged, plain], query).map((record) => record.taskId),
            [id],
            query
        );
    }
    assert.notEqual(
        getPisiTaskSearchFingerprintPart({ id, tags: ['proje'] }),
        getPisiTaskSearchFingerprintPart({ id, tags: ['acil'] }),
        'a tag change rebuilds the record'
    );
});
