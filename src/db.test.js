import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createDocument,
  exportDatabase,
  getDocument,
  installDurableMutationHandler,
  inspectDatabaseIntegrity,
  listDocumentVersions,
  listDocuments,
  listTasks,
  putDocument,
  putTask,
  removeDocument,
  seedDatabase
} from './db.js';

describe('local Pisi database', () => {
  it('seeds, stores, exports and removes documents', async () => {
    const seeded = await seedDatabase();
    expect(seeded).toHaveLength(0);

    const note = createDocument('note', { title: 'Test notu' });
    await putDocument(note);
    expect((await getDocument(note.id)).title).toBe('Test notu');
    await putDocument({ ...(await getDocument(note.id)), title: 'Güncel test notu' });
    expect((await listDocumentVersions(note.id)).length).toBeGreaterThan(0);
    const backup = await exportDatabase();
    expect(backup.format).toBe('pisi-backup');
    expect(backup.version).toBe(4);
    expect(backup.documents.some(({ id }) => id === note.id)).toBe(true);
    expect((await inspectDatabaseIntegrity()).ok).toBe(true);

    await removeDocument(note.id);
    expect(await getDocument(note.id)).toBeUndefined();
    expect((await listDocuments()).some(({ id }) => id === note.id)).toBe(false);
  });

  it('stores tasks with main-compatible ids and dependency fields', async () => {
    const parent = await putTask({ id: 'task-old-parent', text: 'Üst görev' });
    const child = await putTask({
      id: 'task-old-child', text: 'Alt görev', parentId: parent.id
    });
    expect(parent.id).toMatch(/^task_[A-Za-z0-9._:-]+$/);
    expect(child.dependencies).toContain(parent.id);
    expect(child.parentId).toBeNull();
    expect((await listTasks()).some(({ id }) => id === child.id)).toBe(true);
  });

  it('reports verified folder durability and rolls IndexedDB back on a failed physical write', async () => {
    const note = createDocument('note', { title: 'Dayanıklılık sınaması' });
    try {
      installDurableMutationHandler(async (detail) => ({
        verified: true,
        storage: 'selected-project-folder',
        id: detail.id
      }));
      const stored = await putDocument(note);
      expect(stored.__pisiStorageResult).toMatchObject({
        verified: true,
        storage: 'selected-project-folder',
        id: note.id
      });

      installDurableMutationHandler(async () => {
        throw new Error('SAF geri okuma doğrulaması başarısız.');
      });
      await expect(putDocument({ ...stored, title: 'Yazılmamalı' }))
        .rejects.toThrow('SAF geri okuma doğrulaması başarısız');
      expect((await getDocument(note.id)).title).toBe('Dayanıklılık sınaması');

      await expect(removeDocument(note.id))
        .rejects.toThrow('SAF geri okuma doğrulaması başarısız');
      expect(await getDocument(note.id)).toBeTruthy();
    } finally {
      installDurableMutationHandler(null);
      await removeDocument(note.id, { durable: false });
    }
  });
});
