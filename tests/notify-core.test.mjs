import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_NOTIFY_MAX_VISIBLE,
    createPisiNotifyQueue,
    getPisiNotifyAria,
    getPisiNotifyDuration,
    normalizePisiNotification
} from '../renderer/shell/pisi-notify-core.mjs';

test('durations: info and success 4 s, warning 6 s, errors stay open', () => {
    assert.equal(getPisiNotifyDuration('info'), 4000);
    assert.equal(getPisiNotifyDuration('success'), 4000);
    assert.equal(getPisiNotifyDuration('warning'), 6000);
    assert.equal(getPisiNotifyDuration('error'), 0);
    assert.equal(getPisiNotifyDuration('error', 3000), 0, 'an error cannot be given a timeout');
    assert.equal(getPisiNotifyDuration('info', 8000), 8000);
    assert.equal(getPisiNotifyDuration('info', -1), 4000);
    assert.equal(getPisiNotifyDuration('unknown'), 4000, 'unknown types are info');
});

test('accessibility: errors and warnings are assertive alerts, the rest polite status', () => {
    assert.deepEqual(getPisiNotifyAria('error'), { role: 'alert', live: 'assertive' });
    assert.deepEqual(getPisiNotifyAria('warning'), { role: 'alert', live: 'assertive' });
    assert.deepEqual(getPisiNotifyAria('success'), { role: 'status', live: 'polite' });
    assert.deepEqual(getPisiNotifyAria('info'), { role: 'status', live: 'polite' });
});

test('normalizing: Error objects, trimmed text, detail equal to the message is dropped', () => {
    const fromError = normalizePisiNotification({ type: 'error', message: new Error('Disk dolu') });
    assert.equal(fromError.message, 'Disk dolu');
    assert.equal(normalizePisiNotification({ message: '  Kaydedildi  ' }).message, 'Kaydedildi');
    assert.equal(normalizePisiNotification({ message: 'Aynı', detail: 'Aynı' }).detail, '');
    assert.equal(normalizePisiNotification({ message: 'x', action: { label: 'Aç' } }).action, null, 'an action needs run()');
    assert.equal(normalizePisiNotification({ message: 'x'.repeat(2000) }).message.length, 600);
});

test('the same message merges into the open strip and counts up', () => {
    const queue = createPisiNotifyQueue();
    const first = queue.push({ type: 'error', message: 'Not kaydedilemedi.', detail: 'EACCES' });
    const second = queue.push({ type: 'error', message: 'Not kaydedilemedi.', detail: 'EACCES' });
    assert.equal(first.merged, false);
    assert.equal(second.merged, true);
    assert.equal(second.item.id, first.item.id);
    assert.equal(second.item.count, 2);
    assert.equal(queue.items.length, 1);
    // A different type, text or detail is a separate strip.
    assert.equal(queue.push({ type: 'warning', message: 'Not kaydedilemedi.', detail: 'EACCES' }).merged, false);
    assert.equal(queue.push({ type: 'error', message: 'Not kaydedilemedi.', detail: 'ENOSPC' }).merged, false);
    assert.equal(queue.items.length, 3);
    // Once closed, the next one is new again.
    queue.remove(first.item.id);
    const again = queue.push({ type: 'error', message: 'Not kaydedilemedi.', detail: 'EACCES' });
    assert.equal(again.merged, false);
    assert.equal(again.item.count, 1);
    assert.equal(queue.push({ message: '   ' }).item, null, 'empty messages are ignored');
});

test('past the visible limit the oldest non-error strip leaves, errors are kept', () => {
    assert.equal(PISI_NOTIFY_MAX_VISIBLE, 4);
    const queue = createPisiNotifyQueue();
    queue.push({ type: 'error', message: 'E1' });
    queue.push({ type: 'info', message: 'I1' });
    queue.push({ type: 'success', message: 'S1' });
    queue.push({ type: 'error', message: 'E2' });
    const fifth = queue.push({ type: 'info', message: 'I2' });
    assert.deepEqual(
        fifth.removed.map((item) => item.message),
        ['I1']
    );
    assert.deepEqual(
        queue.items.map((item) => item.message),
        ['E1', 'S1', 'E2', 'I2']
    );
    const errorsOnly = createPisiNotifyQueue(2);
    errorsOnly.push({ type: 'error', message: 'A' });
    errorsOnly.push({ type: 'error', message: 'B' });
    assert.deepEqual(
        errorsOnly.push({ type: 'error', message: 'C' }).removed.map((item) => item.message),
        ['A'],
        'with only errors the oldest leaves'
    );
});
