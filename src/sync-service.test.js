// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeDeviceSnapshot, makeSyncManifest, prepareDeviceRecords
} from './sync-core.js';

const harness = vi.hoisted(() => {
  const data = {
    files: new Map(),
    settings: new Map(),
    entities: [],
    folder: {
      configured: true,
      name: 'Pisi Sync',
      readable: true,
      writable: true
    },
    failWrites: false,
    failDeletes: false
  };
  const plugin = {
    chooseFolder: vi.fn(async () => ({ ...data.folder })),
    getFolder: vi.fn(async () => ({ ...data.folder })),
    readText: vi.fn(async ({ path }) => ({
      exists: data.files.has(path),
      content: data.files.get(path) || ''
    })),
    writeText: vi.fn(async ({ path, content }) => {
      if (data.failWrites) throw new Error('Sağlayıcı yazmayı reddetti.');
      data.files.set(path, content);
      return { ok: true, bytes: content.length };
    }),
    listFiles: vi.fn(async ({ path }) => {
      const prefix = path ? `${path}/` : '';
      return {
        files: Array.from(data.files.keys())
          .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
          .map((name) => name.slice(prefix.length))
      };
    }),
    deleteFile: vi.fn(async ({ path }) => {
      if (data.failDeletes) throw new Error('Sağlayıcı silmeyi reddetti.');
      data.files.delete(path);
      return { ok: true };
    }),
    disconnect: vi.fn(async () => {
      data.folder.configured = false;
    })
  };
  const adapter = {
    exportEntities: vi.fn(async () => structuredClone(data.entities)),
    applyRecords: vi.fn(async (records, conflicts = []) => {
      data.entities = records
        .filter((record) => !record.deleted)
        .map(({ kind, id, payload }) => ({ kind, id, payload: structuredClone(payload) }));
      return { conflicts: conflicts.length };
    })
  };
  return { data, plugin, adapter };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => harness.plugin
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })) }
}));

vi.mock('./db.js', () => ({
  getSetting: vi.fn(async (key, fallback = null) => (
    harness.data.settings.has(key)
      ? structuredClone(harness.data.settings.get(key))
      : fallback
  )),
  setSetting: vi.fn(async (key, value) => {
    harness.data.settings.set(key, structuredClone(value));
  })
}));

vi.mock('./sync-adapter.js', () => ({
  exportMobileSyncEntities: harness.adapter.exportEntities,
  applyMobileSyncRecords: harness.adapter.applyRecords
}));

import {
  getMobileSyncStatus, runMobileSync, selectMobileSyncFolder
} from './sync-service.js';

function putDesktopSnapshot(projectId, title = 'Masaüstü notu') {
  const prepared = prepareDeviceRecords({
    entities: [{
      kind: 'node',
      id: 'node_desktop',
      payload: { title, content: `<p>${title}</p>` }
    }],
    deviceId: 'device_desktop'
  });
  const snapshot = makeDeviceSnapshot({
    projectId,
    deviceId: 'device_desktop',
    deviceName: 'Masaüstü',
    records: prepared.records,
    clock: prepared.clock
  });
  const chunkName = 'gseed_0001.json';
  harness.data.files.set('devices/device_desktop/index.json', JSON.stringify({
    format: 'pisi-sync-device-index',
    version: 1,
    projectId,
    deviceId: snapshot.deviceId,
    deviceName: snapshot.deviceName,
    clock: snapshot.clock,
    createdAt: snapshot.createdAt,
    chunks: [chunkName]
  }));
  harness.data.files.set(`devices/device_desktop/${chunkName}`, JSON.stringify({
    format: 'pisi-sync-device-chunk',
    version: 1,
    projectId,
    deviceId: snapshot.deviceId,
    index: 0,
    records: snapshot.records
  }));
}

beforeEach(() => {
  harness.data.files.clear();
  harness.data.settings.clear();
  harness.data.entities = [];
  harness.data.folder = {
    configured: true,
    name: 'Pisi Sync',
    readable: true,
    writable: true
  };
  harness.data.failWrites = false;
  harness.data.failDeletes = false;
  Object.values(harness.plugin).forEach((mock) => mock.mockClear?.());
  Object.values(harness.adapter).forEach((mock) => mock.mockClear?.());
});

describe('mobile folder-backed synchronization', () => {
  it('joins the desktop project when .pisi-sync itself was selected', async () => {
    const projectId = 'project_shared';
    harness.data.folder.name = '.pisi-sync';
    harness.data.files.set('manifest.json', JSON.stringify(makeSyncManifest({
      projectId,
      createdBy: 'device_desktop'
    })));
    putDesktopSnapshot(projectId);

    const result = await selectMobileSyncFolder();
    const status = await getMobileSyncStatus();

    expect(result.projectId).toBe(projectId);
    expect(result.peerDevices).toBe(1);
    expect(harness.data.entities.some(({ id }) => id === 'node_desktop')).toBe(true);
    expect(Array.from(harness.data.files.keys()).some((path) => path.startsWith('.pisi-sync/'))).toBe(false);
    expect(status.layout).toBe('direct');
    expect(status.storagePath).toBe('.pisi-sync');
  });

  it('uses one nested protocol area for a selected Pisi Sync workspace', async () => {
    harness.data.entities = [{
      kind: 'node',
      id: 'node_mobile',
      payload: { title: 'Mobil not', content: '<p>Telefondan</p>' }
    }];

    const result = await selectMobileSyncFolder();
    const status = await getMobileSyncStatus();
    const paths = Array.from(harness.data.files.keys());

    expect(paths).toContain('.pisi-sync/manifest.json');
    expect(paths.some((path) => path.startsWith('.pisi-sync/devices/device_'))).toBe(true);
    expect(paths.some((path) => path.startsWith('.pisi-sync/.pisi-sync/'))).toBe(false);
    expect(result.uploadedRecords).toBe(1);
    expect(result.peerDevices).toBe(0);
    expect(status.layout).toBe('nested');
    expect(status.storagePath).toBe('Pisi Sync/.pisi-sync');
    expect(status.lastError).toBeNull();
  });

  it('keeps a manual-sync storage failure visible in status', async () => {
    harness.data.entities = [{
      kind: 'node', id: 'node_mobile', payload: { title: 'Mobil', content: 'x' }
    }];
    await selectMobileSyncFolder();
    harness.data.failWrites = true;

    await expect(runMobileSync({ reason: 'manual' }))
      .rejects.toThrow('yazma/okuma doğrulamasını geçemedi');
    const status = await getMobileSyncStatus();

    expect(status.configured).toBe(true);
    expect(status.lastError?.message).toContain('Sağlayıcı yazmayı reddetti');
    expect(status.lastError?.reason).toBe('manual');
    expect(status.lastAttemptAt).toBeTruthy();
  });
});
