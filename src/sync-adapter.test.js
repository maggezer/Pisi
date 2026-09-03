import { describe, expect, it } from 'vitest';
import { preserveMobileSyncConflicts } from './sync-adapter.js';

function nodeRecord(title, deviceId, counter = 1) {
  return {
    key: 'node:node_shared',
    kind: 'node',
    id: 'node_shared',
    deleted: false,
    hash: `hash_${title}`,
    version: { counter, deviceId },
    ancestors: [],
    updatedAt: '2026-08-23T13:00:00.000Z',
    payload: { title, content: `<p>${title}</p>`, parentMap: 'none' }
  };
}

describe('mobile conflict preservation', () => {
  it('keeps the losing offline edit as a separate deterministic node', () => {
    const winner = nodeRecord('Desktop offline', 'device_desktop', 4);
    const loser = nodeRecord('Mobile offline', 'device_mobile', 3);
    const preserved = preserveMobileSyncConflicts([winner], [{
      key: winner.key,
      winner,
      loser
    }]);

    expect(preserved.records).toHaveLength(2);
    expect(preserved.records.some(({ id }) => id === 'node_shared')).toBe(true);
    const copy = preserved.records.find(({ id }) => id !== 'node_shared');
    expect(copy.id).toMatch(/^node_conflict_/);
    expect(copy.payload.content).toBe('<p>Mobile offline</p>');
    expect(copy.payload.title).toContain('Sync çakışması');
    expect(preserved.log).toHaveLength(1);
  });
});
