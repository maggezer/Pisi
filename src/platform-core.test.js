// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { parseTodoSyntax, documentBlocksFromHtml } from './blocks.js';
import { parseTurkishDate } from './date-parser.js';
import { buildRelationshipModel, buildSearchIndex, searchIndex } from './search.js';
import { applyStructuredView, generatePropertyMap, propertyValue } from './properties.js';

describe('Pisi mobile platform core', () => {
  it('parses Turkish task date, duration and todo syntax', () => {
    const parsed = parseTurkishDate('raporu yarın saat 14 hatırlat 45 dk', new Date(2026, 7, 7, 10));
    expect(parsed.scheduledAt).toBe('2026-08-08T14:00');
    expect(parsed.reminderAt).toBe('2026-08-08T14:00');
    expect(parsed.durationMinutes).toBe(45);

    const todo = parseTodoSyntax('Sunumu hazırla ..todo.xx.12-08-26');
    expect(todo.text).toBe('Sunumu hazırla');
    expect(todo.importance).toBe('high');
    expect(todo.scheduledAt).toBe('2026-08-12');
  });

  it('assigns block ids and recognizes completed task blocks', () => {
    const blocks = documentBlocksFromHtml('<h1>Başlık</h1><p>Bitir /done</p>');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toMatch(/^blk_/);
    expect(blocks[1]).toMatchObject({ type: 'todo', done: true, text: 'Bitir' });
  });

  it('indexes documents and resolves backlinks and unlinked mentions', () => {
    const documents = [
      { id: 'a', kind: 'note', title: 'Alfa', content: '<p>Temel konu</p>', tags: [], properties: {}, blocks: [] },
      { id: 'b', kind: 'note', title: 'Beta', content: '<p>[[Alfa]] bağlantısı</p>', tags: [], properties: {}, blocks: [] },
      { id: 'c', kind: 'note', title: 'Gama', content: '<p>Alfa ayrıca burada geçiyor</p>', tags: [], properties: {}, blocks: [] }
    ];
    const index = buildSearchIndex(documents, []);
    expect(searchIndex(index, 'temel konu')[0].documentId).toBe('a');
    const links = buildRelationshipModel(documents, 'a');
    expect(links.inbound.map(({ id }) => id)).toContain('b');
    expect(links.unlinked.map(({ id }) => id)).toContain('c');
  });

  it('supports filtered structured views, relations, rollups and property maps', () => {
    const documents = [
      { id: 'node_a', title: 'A', content: '<p>A</p>', updatedAt: '2026-01-01', properties: { durum: 'aktif', related: ['node_b'] } },
      { id: 'node_b', title: 'B', content: '<p>B</p>', updatedAt: '2026-01-02', properties: { durum: 'bekliyor', puan: 8 } }
    ];
    expect(applyStructuredView(documents, {
      filters: [{ propertyId: 'durum', operator: 'equals', value: 'aktif' }]
    })).toHaveLength(1);
    expect(propertyValue(documents[0], {
      id: 'toplam', name: 'Toplam', type: 'rollup',
      rollup: { relationProperty: 'related', targetProperty: 'puan', operation: 'sum' }
    }, documents)).toBe(8);
    const map = generatePropertyMap(documents, 'durum');
    expect(map.nodes).toHaveLength(documents.length);
    expect(map.nodes.map(({ id }) => id)).toEqual(['node_a', 'node_b']);
    expect(map.references).toEqual([{ id: 'node_a' }, { id: 'node_b' }]);
    expect(map.edges).toEqual([]);
    expect(map.collapsedHubs).toEqual([]);
    expect(map.nodes.every(({ isReference }) => isReference)).toBe(true);
  });
});
