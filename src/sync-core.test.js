import { describe, expect, it } from 'vitest';
import {
  foldDeviceSnapshots, makeDeviceSnapshot, planMergedRecords, prepareDeviceRecords
} from './sync-core.js';

const entity = (title = 'A') => ({
  kind: 'node', id: 'node_alpha', payload: { title, content: title }
});

describe('Pisi sync protocol', () => {
  it('keeps versions for unchanged records and creates tombstones', () => {
    const first = prepareDeviceRecords({ entities: [entity()], deviceId: 'device_mobile' });
    const unchanged = prepareDeviceRecords({
      entities: [entity()], baseRecords: first.records,
      deviceId: 'device_mobile', clock: first.clock
    });
    expect(unchanged.records[0].version).toEqual(first.records[0].version);
    const deleted = prepareDeviceRecords({
      entities: [], baseRecords: unchanged.records,
      deviceId: 'device_mobile', clock: unchanged.clock
    });
    expect(deleted.records[0].deleted).toBe(true);
  });

  it('merges concurrent edits deterministically and reports the losing copy', () => {
    const base = prepareDeviceRecords({ entities: [entity()], deviceId: 'device_seed' });
    const desktop = prepareDeviceRecords({
      entities: [entity('Desktop')], baseRecords: base.records,
      deviceId: 'device_desktop', clock: base.clock
    });
    const mobile = prepareDeviceRecords({
      entities: [entity('Mobile')], baseRecords: base.records,
      deviceId: 'device_mobile', clock: base.clock
    });
    const plan = planMergedRecords({
      baseRecords: base.records, localRecords: desktop.records, remoteRecords: mobile.records
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.records[0].payload.title).toBe('Mobile');
    expect(plan.conflicts[0].loser.payload.title).toBe('Desktop');
  });

  it('ignores stale snapshots while folding by project', () => {
    const a = prepareDeviceRecords({ entities: [entity('A')], deviceId: 'device_a' });
    const b = prepareDeviceRecords({
      entities: [entity('B')], baseRecords: a.records, deviceId: 'device_b', clock: a.clock
    });
    const folded = foldDeviceSnapshots([
      makeDeviceSnapshot({ projectId: 'project_one', deviceId: 'device_a', records: a.records, clock: a.clock }),
      makeDeviceSnapshot({ projectId: 'project_one', deviceId: 'device_b', records: b.records, clock: b.clock }),
      makeDeviceSnapshot({ projectId: 'project_other', deviceId: 'device_x', records: a.records, clock: 99 })
    ], 'project_one');
    expect(folded.records[0].payload.title).toBe('B');
    expect(folded.clock).toBe(b.clock);
  });

  it('retains delayed conflicts through bounded record ancestry', () => {
    const base = prepareDeviceRecords({ entities: [entity('Base')], deviceId: 'device_seed' });
    const left = prepareDeviceRecords({
      entities: [entity('Left')], baseRecords: base.records,
      deviceId: 'device_left', clock: base.clock
    });
    const right = prepareDeviceRecords({
      entities: [entity('Right')], baseRecords: base.records,
      deviceId: 'device_right', clock: base.clock
    });
    const delayed = planMergedRecords({
      baseRecords: left.records, localRecords: left.records, remoteRecords: right.records
    });
    expect(delayed.conflicts).toHaveLength(1);
    expect(delayed.conflicts[0].loser.payload.title).toBe('Left');
  });
});
