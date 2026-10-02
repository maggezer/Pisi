'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../main/functions/sync-core');

function entity(title = 'A') {
    return { kind: 'node', id: 'node_alpha', payload: { title, content: title } };
}

test('sync çekirdeği değişmeyen kaydın sürümünü korur ve silmeyi tombstone yapar', () => {
    const first = sync.prepareDeviceRecords({
        entities: [entity()],
        deviceId: 'device_desktop',
        clock: 0,
        now: '2026-01-01T00:00:00.000Z'
    });
    const unchanged = sync.prepareDeviceRecords({
        entities: [entity()],
        baseRecords: first.records,
        deviceId: 'device_desktop',
        clock: first.clock
    });
    assert.deepEqual(unchanged.records[0].version, first.records[0].version);
    const deleted = sync.prepareDeviceRecords({
        entities: [],
        baseRecords: unchanged.records,
        deviceId: 'device_desktop',
        clock: unchanged.clock
    });
    assert.equal(deleted.records[0].deleted, true);
    assert.ok(deleted.records[0].version.counter > first.records[0].version.counter);
});

test('eşzamanlı değişiklik deterministik birleşir ve kaybeden çakışma olarak bildirilir', () => {
    const base = sync.prepareDeviceRecords({ entities: [entity()], deviceId: 'device_seed' });
    const desktop = sync.prepareDeviceRecords({
        entities: [entity('Masaüstü')],
        baseRecords: base.records,
        deviceId: 'device_desktop',
        clock: base.clock
    });
    const mobile = sync.prepareDeviceRecords({
        entities: [entity('Mobil')],
        baseRecords: base.records,
        deviceId: 'device_mobile',
        clock: base.clock
    });
    const plan = sync.planMergedRecords({
        baseRecords: base.records,
        localRecords: desktop.records,
        remoteRecords: mobile.records
    });
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.records[0].payload.title, 'Mobil');
    assert.equal(plan.conflicts[0].loser.payload.title, 'Masaüstü');
});

test('eski cihaz anlık görüntüsü yeni bir çakışma üretmez', () => {
    const old = sync.prepareDeviceRecords({ entities: [entity('Eski')], deviceId: 'device_old' });
    const base = sync.prepareDeviceRecords({
        entities: [entity('Ortak')],
        baseRecords: old.records,
        deviceId: 'device_seed',
        clock: old.clock
    });
    const local = sync.prepareDeviceRecords({
        entities: [entity('Yeni')],
        baseRecords: base.records,
        deviceId: 'device_desktop',
        clock: base.clock
    });
    const plan = sync.planMergedRecords({
        baseRecords: base.records,
        localRecords: local.records,
        remoteRecords: old.records
    });
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.records[0].payload.title, 'Yeni');
});

test('eşzamanlı snapshotlar sonraki turda buluşsa da soy zinciri çakışmayı korur', () => {
    const base = sync.prepareDeviceRecords({ entities: [entity('Ortak')], deviceId: 'device_seed' });
    const left = sync.prepareDeviceRecords({
        entities: [entity('Sol')],
        baseRecords: base.records,
        deviceId: 'device_left',
        clock: base.clock
    });
    const right = sync.prepareDeviceRecords({
        entities: [entity('Sağ')],
        baseRecords: base.records,
        deviceId: 'device_right',
        clock: base.clock
    });
    const delayed = sync.planMergedRecords({
        baseRecords: left.records,
        localRecords: left.records,
        remoteRecords: right.records
    });
    assert.equal(delayed.conflicts.length, 1);
    assert.equal(delayed.conflicts[0].loser.payload.title, 'Sol');
});

test('cihaz snapshot fold işlemi proje sınırını ve en yüksek Lamport sürümünü uygular', () => {
    const a = sync.prepareDeviceRecords({ entities: [entity('A')], deviceId: 'device_a' });
    const b = sync.prepareDeviceRecords({
        entities: [entity('B')],
        baseRecords: a.records,
        deviceId: 'device_b',
        clock: a.clock
    });
    const snapshots = [
        sync.makeDeviceSnapshot({ projectId: 'project_one', deviceId: 'device_a', records: a.records, clock: a.clock }),
        sync.makeDeviceSnapshot({ projectId: 'project_one', deviceId: 'device_b', records: b.records, clock: b.clock }),
        sync.makeDeviceSnapshot({ projectId: 'project_other', deviceId: 'device_x', records: a.records, clock: 99 })
    ];
    const folded = sync.foldDeviceSnapshots(snapshots, 'project_one');
    assert.equal(folded.records[0].payload.title, 'B');
    assert.equal(folded.clock, b.clock);
});
