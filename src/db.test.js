import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createDocument,
  exportDatabase,
  getDocument,
  listDocuments,
  putDocument,
  removeDocument,
  seedDatabase
} from './db.js';

describe('local KEDI database', () => {
  it('seeds, stores, exports and removes documents', async () => {
    const seeded = await seedDatabase();
    expect(seeded.some(({ kind }) => kind === 'note')).toBe(true);
    expect(seeded.some(({ kind }) => kind === 'canvas')).toBe(true);

    const note = createDocument('note', { title: 'Test notu' });
    await putDocument(note);
    expect((await getDocument(note.id)).title).toBe('Test notu');
    expect((await exportDatabase()).documents.some(({ id }) => id === note.id)).toBe(true);

    await removeDocument(note.id);
    expect(await getDocument(note.id)).toBeUndefined();
    expect((await listDocuments()).some(({ id }) => id === note.id)).toBe(false);
  });
});

