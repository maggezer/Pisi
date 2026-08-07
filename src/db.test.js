import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createDocument,
  exportDatabase,
  getDocument,
  inspectDatabaseIntegrity,
  listDocumentVersions,
  listDocuments,
  putDocument,
  removeDocument,
  seedDatabase
} from './db.js';

describe('local Pisi database', () => {
  it('seeds, stores, exports and removes documents', async () => {
    const seeded = await seedDatabase();
    expect(seeded.some(({ kind }) => kind === 'note')).toBe(true);
    expect(seeded.some(({ kind }) => kind === 'canvas')).toBe(true);

    const note = createDocument('note', { title: 'Test notu' });
    await putDocument(note);
    expect((await getDocument(note.id)).title).toBe('Test notu');
    await putDocument({ ...(await getDocument(note.id)), title: 'Güncel test notu' });
    expect((await listDocumentVersions(note.id)).length).toBeGreaterThan(0);
    const backup = await exportDatabase();
    expect(backup.format).toBe('pisi-backup');
    expect(backup.version).toBe(3);
    expect(backup.documents.some(({ id }) => id === note.id)).toBe(true);
    expect((await inspectDatabaseIntegrity()).ok).toBe(true);

    await removeDocument(note.id);
    expect(await getDocument(note.id)).toBeUndefined();
    expect((await listDocuments()).some(({ id }) => id === note.id)).toBe(false);
  });
});

