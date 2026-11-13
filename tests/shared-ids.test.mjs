import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatPisiBlockId,
    formatPisiDocumentId,
    formatPisiSourceTaskId,
    formatPisiTaskId,
    hashPisiTaskIdentity,
    isPisiTaskId,
    normalizePisiId,
    normalizePisiTaskId,
    normalizePisiTaskIdentityPath
} from '../shared/ids.mjs';

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

test('belge, görev ve blok kimlikleri masaüstünün yazdığı biçimdedir', () => {
    assert.equal(formatPisiDocumentId('.node', UUID), `node_${UUID}`);
    assert.equal(formatPisiDocumentId('.map', UUID), `map_${UUID}`);
    assert.equal(formatPisiDocumentId('', UUID), `node_${UUID}`);
    assert.equal(formatPisiTaskId(UUID), `task_${UUID}`);
    assert.equal(formatPisiBlockId(UUID), `blk_${UUID}`);

    assert.equal(normalizePisiId(formatPisiDocumentId('.node', UUID), '.node'), `node_${UUID}`);
    assert.equal(normalizePisiId(formatPisiDocumentId('.map', UUID), '.map'), `map_${UUID}`);
    assert.equal(isPisiTaskId(formatPisiTaskId(UUID)), true);
});

test('normalizePisiId tür önekini, uzunluğu ve karakter kümesini denetler', () => {
    assert.equal(normalizePisiId('  node_abc-123_X  ', '.node'), 'node_abc-123_X');
    assert.equal(normalizePisiId('map_1', '.map'), 'map_1');
    assert.equal(normalizePisiId('map_1'), 'map_1');
    assert.equal(normalizePisiId('node_1', '.map'), null);
    assert.equal(normalizePisiId('map_1', '.node'), null);
    assert.equal(normalizePisiId('node_', '.node'), null);
    assert.equal(normalizePisiId('node_a/b', '.node'), null);
    assert.equal(normalizePisiId('../node_a', '.node'), null);
    assert.equal(normalizePisiId('node_..\\outside', '.node'), null);
    assert.equal(normalizePisiId('task_abcd'), null);
    assert.equal(normalizePisiId('', '.node'), null);
    assert.equal(normalizePisiId(null), null);

    const longest = `node_${'a'.repeat(96)}`;
    assert.equal(normalizePisiId(longest, '.node'), longest);
    assert.equal(normalizePisiId(`${longest}a`, '.node'), null);
});

test('görev kimliği: geçerli olan kırpılarak korunur, geçersiz olan reddedilir', () => {
    assert.equal(normalizePisiTaskId('  task_abcd  '), 'task_abcd');
    assert.equal(normalizePisiTaskId('task_source_640e449a1418dc29'), 'task_source_640e449a1418dc29');
    assert.equal(normalizePisiTaskId('task_a.b:c-d'), 'task_a.b:c-d');
    assert.equal(normalizePisiTaskId('task_abc'), null);
    assert.equal(normalizePisiTaskId('node_abcd'), null);
    assert.equal(normalizePisiTaskId('task_ab cd'), null);
    assert.equal(normalizePisiTaskId(`task_${'a'.repeat(181)}`), null);
    assert.equal(normalizePisiTaskId(''), null);
    assert.equal(normalizePisiTaskId(undefined), null);

    assert.equal(isPisiTaskId('task_abcd'), true);
    assert.equal(isPisiTaskId(' task_abcd'), false);
    assert.equal(isPisiTaskId(null), false);
});

test('kaynak görev kimliği aynı blok için hep aynıdır; masaüstünün daha önce yazdığı değerler değişmez', () => {
    // Values written by the desktop before the hash moved to shared/.
    assert.equal(formatPisiSourceTaskId('notes/a.node', 'blk_1', 'todo.3.none'), 'task_source_640e449a1418dc29');
    assert.equal(formatPisiSourceTaskId('notes/a.node', 'blk_2', 'todo.3.none'), 'task_source_97b6823995720f9e');
    assert.equal(formatPisiSourceTaskId('/abs/çğı.node', 'blk_ü', 'todo.5.13-11-2026'), 'task_source_3819f83d58535016');
    assert.equal(formatPisiSourceTaskId('', '', ''), 'task_source_736abaa5d23acb79');
    assert.equal(formatPisiSourceTaskId(null, null, null), 'task_source_736abaa5d23acb79');

    assert.notEqual(formatPisiSourceTaskId('notes/b.node', 'blk_1', 'todo.3.none'), 'task_source_640e449a1418dc29');
    assert.notEqual(formatPisiSourceTaskId('notes/a.node', 'blk_1', 'todo.4.none'), 'task_source_640e449a1418dc29');
    assert.equal(isPisiTaskId(formatPisiSourceTaskId('notes/a.node', 'blk_1', 'todo.3.none')), true);

    assert.equal(hashPisiTaskIdentity(''), '811c9dc59e3779b9');
    assert.match(hashPisiTaskIdentity('herhangi bir metin'), /^[0-9a-f]{16}$/);
});

test('kimlik yolu: ayırıcılar tek eğik çizgiye iner, harf büyüklüğü yalnız istenirse yok sayılır', () => {
    assert.equal(normalizePisiTaskIdentityPath('C:\\Proje\\\\Notlar//A.node'), 'C:/Proje/Notlar/A.node');
    assert.equal(normalizePisiTaskIdentityPath('C:\\Proje\\A.node', true), 'c:/proje/a.node');
    assert.equal(normalizePisiTaskIdentityPath('notes\\a.node'), 'notes/a.node');
    assert.equal(normalizePisiTaskIdentityPath(null), '');

    // Both spellings of one path give one task id.
    assert.equal(
        formatPisiSourceTaskId(normalizePisiTaskIdentityPath('notes\\a.node'), 'blk_1', 'todo.3.none'),
        formatPisiSourceTaskId(normalizePisiTaskIdentityPath('notes/a.node'), 'blk_1', 'todo.3.none')
    );
});
