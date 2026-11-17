// S4: what happens to the blocks on screen when the open note's file changed
// from outside (note-rebase.mjs), and how the diary text is kept when the day
// changed on disk while text typed here was waiting (day-model.mjs).

import { describe, expect, it } from 'vitest';
import { splitNoteBlocks } from '../../shared/note-blocks.mjs';
import { getSegmentKeys, planNoteRebase } from '../src/screens/notes/note-rebase.mjs';
import { mergeDiaryText } from '../src/screens/pisi/day-model.mjs';
import { PisiNoteChangedError } from '../src/data/note-repo.mjs';
import { createMemoryProject, noteFile, paragraph } from './data-helpers.mjs';

const p = (id, text) => paragraph(id, text);
const items = (html) => splitNoteBlocks(html).map((segment) => ({ segment, dirty: false, name: segment.blockId ?? segment.html.trim() }));
const describeOrder = (plan) =>
    plan.order.map(
        (entry) => `${entry.kind}:${entry.item?.name ?? entry.segment.blockId ?? entry.segment.html.trim()}${entry.segment ? `@${entry.index}` : ''}`
    );

describe('planNoteRebase', () => {
    it('değişmeyen blok yerinde kalır, değişen güncellenir, yeni blok uzak sıraya girer, silinen çıkar', () => {
        const old = items(p('a', 'A') + p('b', 'B') + p('c', 'C'));
        const plan = planNoteRebase({ items: old, segments: splitNoteBlocks(p('a', 'A') + p('n', 'N') + p('b', 'B2')) });
        expect(describeOrder(plan)).toEqual(['keep:a@0', 'new:n@1', 'update:b@2']);
        expect(plan.dropped.map((item) => item.name)).toEqual(['c']);
        expect(plan.detached).toEqual([]);
    });

    it('kaydedilmemiş yerel blok önceki komşusunun arkasında kalır; boş not başa gelir', () => {
        const old = items(p('a', 'A') + p('b', 'B'));
        const local = { segment: null, dirty: true, name: 'yerel' };
        old.splice(1, 0, local);
        const plan = planNoteRebase({ items: old, segments: splitNoteBlocks(p('z', 'Z') + p('a', 'A') + p('b', 'B')) });
        expect(describeOrder(plan)).toEqual(['new:z@0', 'keep:a@1', 'local:yerel', 'keep:b@2']);

        const first = { segment: null, dirty: true, name: 'ilk' };
        const plan2 = planNoteRebase({ items: [first, ...items(p('a', 'A'))], segments: splitNoteBlocks(p('a', 'A2')) });
        expect(describeOrder(plan2)).toEqual(['local:ilk', 'update:a@0']);
    });

    it('kirli blok uzakta da değiştiyse uzak sürüm gösterilir, yerel düzenleme hemen altında ayrı blok olarak kalır (SV3)', () => {
        const old = items(p('a', 'A') + p('b', 'B'));
        old[0].dirty = true;
        const plan = planNoteRebase({ items: old, segments: splitNoteBlocks(p('a', 'A uzak') + p('b', 'B')) });
        expect(describeOrder(plan)).toEqual(['new:a@0', 'local:a', 'keep:b@1']);
        expect(plan.detached.map((item) => item.name)).toEqual(['a']);
    });

    it('kirli blok uzakta silindiyse düzenleme yerel blok olarak kalır; temiz blok kalkar', () => {
        const old = items(p('a', 'A') + p('b', 'B') + p('c', 'C'));
        old[1].dirty = true;
        const plan = planNoteRebase({ items: old, segments: splitNoteBlocks(p('a', 'A')) });
        expect(describeOrder(plan)).toEqual(['keep:a@0', 'local:b']);
        expect(plan.dropped.map((item) => item.name)).toEqual(['c']);
    });

    it('ekranda silinmiş blok: uzak değiştirmediyse silinmiş kalır (yeni konumuyla), değiştirdiyse geri gelir', () => {
        const [a, b, c] = items(p('a', 'A') + p('b', 'B') + p('c', 'C'));
        const plan = planNoteRebase({ items: [a], removed: [b, c], segments: splitNoteBlocks(p('n', 'N') + p('a', 'A') + p('b', 'B') + p('c', 'C2')) });
        expect(describeOrder(plan)).toEqual(['new:n@0', 'keep:a@1', 'new:c@3']);
        expect(plan.removed.map((entry) => [entry.item.name, entry.index])).toEqual([['b', 2]]);
    });

    it('kimliksiz parçalar HTML ve sırasıyla eşlenir', () => {
        const html = '\n' + p('a', 'A') + '\n<!-- not -->' + '\n';
        expect(getSegmentKeys(splitNoteBlocks(html))).toEqual(['html:\n#0', 'id:a#0', 'html:\n#1', 'html:<!-- not -->#0', 'html:\n#2']);
        const plan = planNoteRebase({ items: items(html), segments: splitNoteBlocks(html.replace('A', 'A2')) });
        expect(plan.order.map((entry) => entry.kind)).toEqual(['keep', 'update', 'keep', 'keep', 'keep']);
    });
});

describe('günlük metni dışarıda değişince (S4)', () => {
    it('yalnız bir taraf değiştiyse o taraf; ikisi de değiştiyse diskteki metin önce, burada yazılan yeni paragraflar arkasında', () => {
        expect(mergeDiaryText({ base: 'Sabah', local: 'Sabah', remote: 'Sabah\n\nUzak' })).toBe('Sabah\n\nUzak');
        expect(mergeDiaryText({ base: 'Sabah', local: 'Sabah\n\nYerel', remote: 'Sabah' })).toBe('Sabah\n\nYerel');
        expect(mergeDiaryText({ base: 'Sabah', local: 'Sabah değişti\n\nYerel', remote: 'Sabah\n\nUzak' })).toBe('Sabah\n\nUzak\n\nSabah değişti\n\nYerel');
        expect(mergeDiaryText({ base: '', local: 'Aynı', remote: 'Aynı' })).toBe('Aynı');
    });

    it('diary.setText `expectedText` tutmazsa yazmaz ve NOTE_CHANGED fırlatır; tutarsa diskteki metni döndürür', async () => {
        const day = noteFile({ id: 'node_d', title: '14-11-2026', content: p('blk_1', 'Sabah') });
        const { project, driver } = createMemoryProject({ 'diary/.pisi-diary': '', 'diary/2026-11-14.node': day });
        await project.open();
        await expect(project.diary.setText('2026-11-14', 'Sabah\n\nYerel', { expectedText: 'Başka' })).rejects.toBeInstanceOf(PisiNoteChangedError);
        expect(driver.snapshot()['diary/2026-11-14.node']).toBe(day);
        const result = await project.diary.setText('2026-11-14', 'Sabah\n\nYerel\n\n\n', { expectedText: 'Sabah' });
        expect(result).toMatchObject({ changed: true, text: 'Sabah\n\nYerel' });
        expect((await project.diary.read('2026-11-14')).text).toBe(result.text);
        await expect(project.diary.setText('2026-11-15', 'Yeni', { expectedText: 'x' })).rejects.toThrow('Note changed');
        expect(await project.diary.setText('2026-11-15', 'Yeni', { expectedText: '' })).toMatchObject({ created: true, text: 'Yeni' });
    });
});
