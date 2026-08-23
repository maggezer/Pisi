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
      writable: true,
      permissionPersisted: true,
      provider: 'com.google.android.apps.docs.storage'
    },
    failWrites: false,
    failDeletes: false,
    failWritePattern: '',
    backup: {
      format: 'pisi-backup', version: 4,
      documents: [], tasks: [], histories: [], settings: {}
    }
  };
  const plugin = {
    chooseFolder: vi.fn(async () => ({ ...data.folder })),
    getFolder: vi.fn(async () => ({ ...data.folder })),
    readText: vi.fn(async ({ path }) => ({
      exists: data.files.has(path),
      content: data.files.get(path) || ''
    })),
    writeText: vi.fn(async ({ path, content }) => {
      if (data.failWrites || (data.failWritePattern && path.includes(data.failWritePattern))) {
        throw new Error('Sağlayıcı yazmayı reddetti.');
      }
      data.files.set(path, content);
      return {
        ok: true, verified: true, listed: true, jsonParsed: true,
        bytes: content.length, path, completedAt: new Date().toISOString()
      };
    }),
    listFiles: vi.fn(async ({ path }) => {
      const prefix = path ? `${path}/` : '';
      return {
        files: Array.from(data.files.keys())
          .filter((name) => name.startsWith(prefix) && /\.(?:json|node|map)$/i.test(name))
          .map((name) => name.slice(prefix.length))
      };
    }),
    deleteFile: vi.fn(async ({ path }) => {
      if (data.failDeletes) throw new Error('Sağlayıcı silmeyi reddetti.');
      data.files.delete(path);
      return { ok: true, verified: true };
    }),
    moveEntry: vi.fn(async ({ fromPath, toPath }) => {
      const rows = Array.from(data.files.entries()).filter(([path]) => (
        path === fromPath || path.startsWith(`${fromPath}/`)
      ));
      if (!rows.length) {
        const alreadyMoved = Array.from(data.files.keys()).some((path) => (
          path === toPath || path.startsWith(`${toPath}/`)
        ));
        return {
          ok: true, verified: alreadyMoved, moved: false,
          missing: !alreadyMoved, alreadyMoved
        };
      }
      if (Array.from(data.files.keys()).some((path) => path === toPath || path.startsWith(`${toPath}/`))) {
        throw new Error('Taşıma hedefi zaten var.');
      }
      for (const [path, content] of rows) {
        data.files.delete(path);
        data.files.set(`${toPath}${path.slice(fromPath.length)}`, content);
      }
      return { ok: true, verified: true, moved: true, missing: false };
    }),
    probeFolder: vi.fn(async () => {
      if (data.failWrites) throw new Error('Sağlayıcı yazmayı reddetti.');
      return {
        ok: true, verified: true, created: true, readBack: true,
        listed: true, deleted: true, checkedAt: new Date().toISOString()
      };
    }),
    openDriveSync: vi.fn(async () => ({ opened: true, installed: true })),
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
  exportDatabase: vi.fn(async () => structuredClone(harness.data.backup)),
  getSetting: vi.fn(async (key, fallback = null) => (
    harness.data.settings.has(key)
      ? structuredClone(harness.data.settings.get(key))
      : fallback
  )),
  setSetting: vi.fn(async (key, value) => {
    harness.data.settings.set(key, structuredClone(value));
  }),
  installDurableMutationHandler: vi.fn()
}));

vi.mock('./sync-adapter.js', () => ({
  exportMobileSyncEntities: harness.adapter.exportEntities,
  applyMobileSyncRecords: harness.adapter.applyRecords,
  preserveMobileSyncConflicts: vi.fn((records) => ({
    records: structuredClone(records.filter((record) => !record.deleted)),
    log: []
  }))
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
    writable: true,
    permissionPersisted: true,
    provider: 'com.google.android.apps.docs.storage'
  };
  harness.data.failWrites = false;
  harness.data.failDeletes = false;
  harness.data.failWritePattern = '';
  harness.data.backup = {
    format: 'pisi-backup', version: 4,
    documents: [], tasks: [], histories: [], settings: {}
  };
  Object.values(harness.plugin).forEach((mock) => mock.mockClear?.());
  Object.values(harness.adapter).forEach((mock) => mock.mockClear?.());
});

describe('mobile folder-backed synchronization', () => {
  it('treats a persisted SAF grant as configured after process restart', async () => {
    harness.data.folder.uri = 'content://com.android.externalstorage.documents/tree/primary%3APisi';
    const status = await getMobileSyncStatus();
    expect(status.configured).toBe(true);
    expect(status.permissionPersisted).toBe(true);
    expect(status.folderUri).toContain('content://');
  });

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
    expect(result.uploadedRecords).toBe(4); // node + three canonical config authorities
    expect(result.filesVerified).toBe(1);
    expect(result.filesWritten).toBe(1);
    const nodePath = paths.find((path) => path.endsWith('.node'));
    expect(nodePath).toBeTruthy();
    expect(JSON.parse(harness.data.files.get(nodePath)).pisi.id).toBe('node_mobile');
    expect(harness.plugin.writeText).toHaveBeenCalledWith(expect.objectContaining({
      path: nodePath,
      expectedId: 'node_mobile',
      expectedType: 'node'
    }));
    expect(harness.plugin.probeFolder).toHaveBeenCalled();
    expect(result.peerDevices).toBe(0);
    expect(status.layout).toBe('nested');
    expect(status.storagePath).toBe('Pisi Sync/.pisi-sync');
    expect(status.lastError).toBeNull();
    expect(status.permissionPersisted).toBe(true);
  });

  it('imports an existing visible desktop project and verifies its real file', async () => {
    harness.data.folder.name = 'Pisi Projem';
    harness.data.files.set('Masaüstü Notu.node', `${JSON.stringify({
      pisi: {
        version: 1,
        type: 'node',
        id: 'node_existing',
        title: 'Masaüstü Notu',
        sidecar: 'inv_Masaüstü Notu__node_existing',
        parentMap: 'none',
        createdAt: '2026-08-23T09:00:00.000Z',
        updatedAt: '2026-08-23T09:00:00.000Z'
      },
      content: '<p>Diskteki gerçek içerik</p>',
      blocks: [], tags: [], properties: {}, sources: []
    }, null, 2)}\n`);

    const result = await selectMobileSyncFolder();

    expect(harness.data.entities.some(({ id, payload }) => (
      id === 'node_existing' && payload.content === '<p>Diskteki gerçek içerik</p>'
    ))).toBe(true);
    expect(result.filesVerified).toBe(1);
    expect(result.visibleFiles).toContain('Masaüstü Notu.node');
    expect(harness.data.files.has('.pisi-sync/workspace-files.json')).toBe(true);
  });

  it('detects a DriveSync-style external file edit during a foreground scan', async () => {
    harness.data.entities = [{
      kind: 'node', id: 'node_external', payload: { title: 'Dış', content: '<p>önce</p>' }
    }];
    await selectMobileSyncFolder();
    const nodePath = Array.from(harness.data.files.keys()).find((path) => path.endsWith('.node'));
    const external = JSON.parse(harness.data.files.get(nodePath));
    external.content = '<p>DriveSync indirdi</p>';
    external.pisi.updatedAt = '2026-08-23T13:00:00.000Z';
    harness.data.files.set(nodePath, `${JSON.stringify(external, null, 2)}\n`);

    await runMobileSync({ reason: 'external-scan', requireFresh: true });
    const status = await getMobileSyncStatus();

    expect(harness.data.entities.find(({ id }) => id === 'node_external').payload.content)
      .toBe('<p>DriveSync indirdi</p>');
    expect(status.lastExternalScanAt).toBeTruthy();
    expect(status.lastExternalChangeAt).toBeTruthy();
  });

  it('treats deletion of an indexed visible file as a real workspace deletion', async () => {
    harness.data.entities = [{
      kind: 'node',
      id: 'node_delete_me',
      payload: { title: 'Silinecek not', content: '<p>Geçici</p>' }
    }];
    await selectMobileSyncFolder();
    const visiblePath = Array.from(harness.data.files.keys())
      .find((path) => path.endsWith('.node'));
    expect(visiblePath).toBeTruthy();

    harness.data.files.delete(visiblePath);
    const result = await runMobileSync({ reason: 'manual' });

    expect(harness.data.entities.some(({ id }) => id === 'node_delete_me')).toBe(false);
    expect(harness.data.files.has(visiblePath)).toBe(false);
    expect(result.filesVerified).toBe(0);
  });

  it('never overwrites a present but corrupted real project file', async () => {
    harness.data.entities = [{
      kind: 'node',
      id: 'node_protected',
      payload: { title: 'Korunan not', content: '<p>Önemli</p>' }
    }];
    await selectMobileSyncFolder();
    const visiblePath = Array.from(harness.data.files.keys())
      .find((path) => path.endsWith('.node'));
    harness.data.files.set(visiblePath, '{bozuk-json');

    await expect(runMobileSync({ reason: 'manual' }))
      .rejects.toThrow('Proje dosyaları güvenle okunamadı');

    expect(harness.data.files.get(visiblePath)).toBe('{bozuk-json');
    expect(harness.data.entities.some(({ id }) => id === 'node_protected')).toBe(true);
  });

  it('keeps a manual-sync storage failure visible in status', async () => {
    harness.data.entities = [{
      kind: 'node', id: 'node_mobile', payload: { title: 'Mobil', content: 'x' }
    }];
    await selectMobileSyncFolder();
    harness.data.failWrites = true;

    await expect(runMobileSync({ reason: 'manual' }))
      .rejects.toThrow('fiziksel oluşturma/yazma/okuma/listeleme/silme doğrulamasını geçemedi');
    const status = await getMobileSyncStatus();

    expect(status.configured).toBe(true);
    expect(status.lastError?.message).toContain('Sağlayıcı yazmayı reddetti');
    expect(status.lastError?.reason).toBe('manual');
    expect(status.lastAttemptAt).toBeTruthy();
  });

  it('fails closed after permission revoke and becomes ready after explicit reselection', async () => {
    await selectMobileSyncFolder();
    harness.data.folder = {
      configured: false,
      name: '',
      uri: 'content://revoked',
      readable: false,
      writable: false,
      permissionPersisted: false,
      provider: 'com.android.externalstorage.documents'
    };
    const revoked = await getMobileSyncStatus();
    expect(revoked.configured).toBe(false);
    expect(revoked.folderSelected).toBe(true);
    expect(revoked.permissionPersisted).toBe(false);
    await expect(runMobileSync({ reason: 'manual', requireFresh: true }))
      .rejects.toThrow('Önce gerçek Pisi proje klasörünü seçin');

    harness.data.folder = {
      configured: true,
      name: 'Pisi Yeni',
      uri: 'content://new-folder',
      readable: true,
      writable: true,
      permissionPersisted: true,
      provider: 'com.android.externalstorage.documents'
    };
    const result = await selectMobileSyncFolder();
    expect(result.localFilesVerified).toBe(true);
    expect((await getMobileSyncStatus()).configured).toBe(true);
  });

  it('writes and rereads physical files before replacing the IndexedDB cache', async () => {
    harness.data.entities = [{
      kind: 'node', id: 'node_order', payload: { title: 'Sıra', content: '<p>önce</p>' }
    }];
    await selectMobileSyncFolder();
    const nodePath = Array.from(harness.data.files.keys()).find((path) => path.endsWith('.node'));
    const oldContent = harness.data.files.get(nodePath);
    harness.data.entities.find(({ id }) => id === 'node_order').payload.content = '<p>sonra</p>';
    harness.adapter.applyRecords.mockClear();
    harness.data.failWritePattern = '.node';

    await expect(runMobileSync({ reason: 'manual', requireFresh: true }))
      .rejects.toThrow('Sağlayıcı yazmayı reddetti');

    expect(harness.adapter.applyRecords).not.toHaveBeenCalled();
    expect(harness.data.files.get(nodePath)).toBe(oldContent);
  });

  it('creates and verifies a recovery backup before merging pre-folder private data', async () => {
    harness.data.backup.documents = [{
      id: 'node_private', kind: 'note', title: 'Özel not', content: '<p>koru</p>'
    }];
    harness.data.entities = [{
      kind: 'node', id: 'node_private', payload: { title: 'Özel not', content: '<p>koru</p>' }
    }];

    const result = await selectMobileSyncFolder();
    const backupPath = Array.from(harness.data.files.keys())
      .find((path) => path.startsWith('.pisi/recovery/mobile-private-'));

    expect(result.migrationBackupPath).toBe(backupPath);
    expect(JSON.parse(harness.data.files.get(backupPath)).documents[0].id).toBe('node_private');
  });

  it('does not rename or delete existing binary sidecar assets during a mobile edit', async () => {
    const sidecar = 'inv_Sabit__node_binary';
    harness.data.files.set(`${sidecar}/attachment.bin`, 'BINARY\u0000PAYLOAD');
    harness.data.entities = [{
      kind: 'node',
      id: 'node_binary',
      payload: {
        title: 'Yeni başlık',
        content: '<p>Mobil</p>',
        relativePath: 'Sabit.node',
        native: {
          pisi: {
            version: 1, type: 'node', id: 'node_binary', title: 'Sabit',
            sidecar, parentMap: 'none'
          },
          attachments: [{ path: 'attachment.bin' }]
        }
      }
    }];

    await selectMobileSyncFolder();
    const written = JSON.parse(harness.data.files.get('Sabit.node'));

    expect(written.pisi.sidecar).toBe(sidecar);
    expect(written.attachments[0].path).toBe('attachment.bin');
    expect(harness.data.files.get(`${sidecar}/attachment.bin`)).toBe('BINARY\u0000PAYLOAD');
  });

  it('moves deleted project files and binary sidecars into recoverable sync trash', async () => {
    const sidecar = 'inv_Silinecek__node_with_asset';
    harness.data.files.set(`${sidecar}/asset.bin`, 'ASSET');
    harness.data.entities = [{
      kind: 'node',
      id: 'node_with_asset',
      payload: {
        title: 'Silinecek', content: '<p>sil</p>', relativePath: 'Silinecek.node',
        native: {
          pisi: {
            version: 1, type: 'node', id: 'node_with_asset', title: 'Silinecek',
            sidecar, parentMap: 'none'
          }
        }
      }
    }];
    await selectMobileSyncFolder();
    harness.data.entities = harness.data.entities.filter(({ id }) => id !== 'node_with_asset');

    const result = await runMobileSync({ reason: 'manual', requireFresh: true });
    const paths = Array.from(harness.data.files.keys());

    expect(result.filesRemoved).toBe(1);
    expect(harness.data.files.has('Silinecek.node')).toBe(false);
    expect(harness.data.files.has(`${sidecar}/asset.bin`)).toBe(false);
    expect(paths.some((path) => (
      path.startsWith('.pisi/sync-trash/') && path.endsWith('/Silinecek.node')
    ))).toBe(true);
    expect(paths.some((path) => (
      path.startsWith('.pisi/sync-trash/') && path.endsWith(`/${sidecar}/asset.bin`)
    ))).toBe(true);
  });

  it('moves a reparented node sidecar without losing binary attachments', async () => {
    const mapASidecar = 'nd_A__map_a';
    const mapBSidecar = 'nd_B__map_b';
    const nodeSidecar = 'inv_Child__node_child';
    harness.data.files.set(`${mapASidecar}/${nodeSidecar}/asset.bin`, 'MOVE-ME');
    harness.data.entities = [
      {
        kind: 'map', id: 'map_a', payload: {
          title: 'A', relativePath: 'A.map',
          map: { nodes: [{ id: 'node_child', x: 1, y: 2 }], edges: [] },
          native: { pisi: { version: 1, type: 'map', id: 'map_a', title: 'A', sidecar: mapASidecar } }
        }
      },
      {
        kind: 'map', id: 'map_b', payload: {
          title: 'B', relativePath: 'B.map',
          map: { nodes: [], edges: [] },
          native: { pisi: { version: 1, type: 'map', id: 'map_b', title: 'B', sidecar: mapBSidecar } }
        }
      },
      {
        kind: 'node', id: 'node_child', payload: {
          title: 'Child', content: 'child', parentMap: 'map_a',
          relativePath: `${mapASidecar}/Child.node`,
          native: {
            pisi: {
              version: 1, type: 'node', id: 'node_child', title: 'Child',
              sidecar: nodeSidecar, parentMap: 'map_a'
            }
          }
        }
      }
    ];
    await selectMobileSyncFolder();
    harness.data.entities.find(({ id }) => id === 'node_child').payload.parentMap = 'map_b';

    await runMobileSync({ reason: 'manual', requireFresh: true });

    expect(harness.data.files.get(`${mapBSidecar}/${nodeSidecar}/asset.bin`)).toBe('MOVE-ME');
    expect(harness.data.files.has(`${mapASidecar}/${nodeSidecar}/asset.bin`)).toBe(false);
    expect(harness.plugin.moveEntry).toHaveBeenCalledWith(expect.objectContaining({
      fromPath: `${mapASidecar}/${nodeSidecar}`,
      toPath: `${mapBSidecar}/${nodeSidecar}`
    }));

    harness.data.entities.find(({ id }) => id === 'node_child').payload.parentMap = 'map_a';
    harness.data.failWritePattern = '.node';
    await expect(runMobileSync({ reason: 'manual', requireFresh: true }))
      .rejects.toThrow('Sağlayıcı yazmayı reddetti');
    expect(harness.data.files.get(`${mapBSidecar}/${nodeSidecar}/asset.bin`)).toBe('MOVE-ME');
    expect(harness.data.files.has(`${mapASidecar}/${nodeSidecar}/asset.bin`)).toBe(false);
  });
});
