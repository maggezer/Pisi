import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  settings: new Map(),
  replaceSyncedWorkspace: vi.fn(async () => {})
}));

vi.mock('./db.js', () => ({
  getSetting: vi.fn(async (key, fallback = null) => (
    db.settings.has(key) ? structuredClone(db.settings.get(key)) : fallback
  )),
  listDocuments: vi.fn(async () => []),
  listTasks: vi.fn(async () => []),
  replaceSyncedWorkspace: db.replaceSyncedWorkspace
}));

import { normalizePropertySchema } from './properties.js';
import {
  applyMobileSyncRecords,
  exportMobileSyncEntities
} from './sync-adapter.js';

const desktopSchema = [
  { id: 'prop_date', name: 'Tarih', type: 'date', options: [], custom: { source: 'desktop' } },
  { id: 'prop_checkbox', name: 'Tamamlandı', type: 'checkbox', options: [] },
  { id: 'prop_select', name: 'Kategori', type: 'select', options: ['A', 'B'] },
  { id: 'prop_multi', name: 'Etiketler', type: 'multiselect', options: ['X'] },
  { id: 'prop_relation', name: 'İlişki', type: 'relation', relationDocumentIds: ['node_a'] }
];

describe('property schema type preservation', () => {
  beforeEach(() => {
    db.settings.clear();
    db.replaceSyncedWorkspace.mockClear();
  });

  it('does not coerce desktop property types in mobile schema normalization', () => {
    const normalized = normalizePropertySchema(desktopSchema);

    expect(normalized.map(({ type }) => type)).toEqual([
      'date', 'checkbox', 'select', 'multiselect', 'relation'
    ]);
    expect(normalized[0].custom).toEqual({ source: 'desktop' });
    expect(normalized[2].options).toEqual(['A', 'B']);
  });

  it('preserves property types when exporting mobile sync config', async () => {
    db.settings.set('propertySchema', desktopSchema);
    db.settings.set('savedViews', []);
    db.settings.set('templates', []);

    const entities = await exportMobileSyncEntities();
    const propertyConfig = entities.find(
      ({ kind, id }) => kind === 'config' && id === 'propertySchema'
    );

    expect(propertyConfig.payload.value.map(({ type }) => type)).toEqual([
      'date', 'checkbox', 'select', 'multiselect', 'relation'
    ]);
    expect(propertyConfig.payload.value[0].custom).toEqual({ source: 'desktop' });
  });

  it('preserves property types when importing sync records back to mobile', async () => {
    await applyMobileSyncRecords([{
      key: 'config:propertySchema',
      kind: 'config',
      id: 'propertySchema',
      deleted: false,
      hash: 'schema_hash',
      version: { counter: 1, deviceId: 'desktop' },
      ancestors: [],
      updatedAt: '2026-09-27T08:00:00.000Z',
      payload: { value: desktopSchema }
    }]);

    expect(db.replaceSyncedWorkspace).toHaveBeenCalledTimes(1);
    const [{ settings }] = db.replaceSyncedWorkspace.mock.calls[0];
    expect(settings.propertySchema.map(({ type }) => type)).toEqual([
      'date', 'checkbox', 'select', 'multiselect', 'relation'
    ]);
    expect(settings.propertySchema[0].custom).toEqual({ source: 'desktop' });
  });
});
