import { describe, expect, it } from 'vitest';
import { loadSampleProject } from '../src/data/sample-project.mjs';
import { NOW, TODAY, createMemoryProject, json, noteFile, paragraph, storeJson } from './data-helpers.mjs';

const SHEET =
    '<div class="pisi-sheet-block" contenteditable="false"><table data-pisi-sheet="1" data-pisi-sheet-asset="sheet/aa.json"><tbody><tr><td>Kalem</td></tr></tbody></table></div>';
const MANAGED =
    '\n<!--PISI_DIARY_MANAGED_START-->\n<div class="pisi-diary-managed-block" data-pisi-task-id="task_1"><span class="pisi-diary-task-text">Egzersiz</span></div>\n<!--PISI_DIARY_MANAGED_END-->';
const parse = (driver, key) => JSON.parse(driver.snapshot()[key]);

describe('ProjectRepo', () => {
    it('boş klasörde iskeleti kurar: boş özellik şeması ve günlük işaretçisi', async () => {
        const { project, driver } = createMemoryProject();
        const opened = await project.open();

        expect(opened).toEqual({ ok: true, created: true, integrity: { healthy: true, readOnlyFiles: [] } });
        expect(driver.snapshot()).toEqual({
            '.pisi/properties.json': json({ version: 1, definitions: [], conflicts: [], updatedAt: NOW.toISOString() }),
            'diary/.pisi-diary': 'Bu klasör PISI diary özelliği tarafından yönetilir.\n'
        });
    });

    it('var olan projeye dokunmaz, yarım yazmaları toparlar ve bozuk otorite dosyalarını bildirir', async () => {
        const { project, driver } = createMemoryProject({
            'Not.node': noteFile({}),
            '.pisi/relationships.json': '{bozuk',
            '.pisi/.tasks.json.mobile-9.tmp': storeJson({ version: 1, updatedAt: null, tasks: [] }),
            'diary/.2026-11-14.node.mobile-8.tmp': '{"yarım"'
        });
        const opened = await project.open();

        expect(opened).toMatchObject({ created: false, integrity: { healthy: false, readOnlyFiles: ['.pisi/relationships.json'] } });
        expect(Object.keys(driver.snapshot())).toEqual(['.pisi/relationships.json', '.pisi/tasks.json', 'Not.node']);
        expect(driver.snapshot()['.pisi/relationships.json']).toBe('{bozuk');
    });
});

describe('NoteRepo ve proje indeksi', () => {
    const files = {
        'Toplantı.node': noteFile({
            id: 'node_t',
            title: 'Toplantı',
            content: paragraph('blk_a', 'Gündem') + paragraph('blk_b', 'Kararlar') + SHEET,
            pisi: { updatedAt: '2026-11-10T08:00:00.000Z' }
        }),
        'nd_Harita__map_m/Çocuk.node': noteFile({
            id: 'node_c',
            title: 'Çocuk',
            content: paragraph('blk_c', 'IŞIK ve ısı'),
            pisi: { parentMap: 'map_m', updatedAt: '2026-11-12T08:00:00.000Z' }
        }),
        'diary/2026-11-13.node': noteFile({
            id: 'node_d',
            title: '13-11-2026',
            content: paragraph('blk_d', 'Günlük satırı') + MANAGED,
            pisi: { parentMap: 'diary' }
        }),
        'inv_Toplantı__node_t/Gizli.node': noteFile({ id: 'node_gizli', title: 'Sidecar içi' }),
        '.pisi-history/node_t/Eski.node': noteFile({ id: 'node_eski', title: 'Geçmiş' }),
        'Bozuk.node': '{ "pisi": ',
        'Harita.map': json({
            pisi: { version: 1, type: 'map', id: 'map_m', title: 'Harita', updatedAt: '2026-11-01T08:00:00.000Z' },
            map: { nodes: [{ id: 'node_c', x: 80, y: 80, width: 220, height: 92 }] }
        })
    };

    it('hafif indeks: kimlik, başlık, yol, updatedAt ve bloklar arası boşluklu önizleme', async () => {
        const { project } = createMemoryProject(files);
        await project.open();
        await project.index.build();

        expect(project.notes.list().map(({ text: _text, ...entry }) => entry)).toEqual([
            {
                id: 'node_c',
                title: 'Çocuk',
                key: 'nd_Harita__map_m/Çocuk.node',
                updatedAt: '2026-11-12T08:00:00.000Z',
                preview: 'IŞIK ve ısı',
                kind: 'note',
                parentMap: 'map_m'
            },
            {
                id: 'node_t',
                title: 'Toplantı',
                key: 'Toplantı.node',
                updatedAt: '2026-11-10T08:00:00.000Z',
                preview: 'Gündem\nKararlar\nKalem',
                kind: 'note',
                parentMap: 'none'
            },
            {
                id: 'node_d',
                title: '13-11-2026',
                key: 'diary/2026-11-13.node',
                updatedAt: '2026-11-01T08:00:00.000Z',
                preview: 'Günlük satırı',
                kind: 'diary',
                parentMap: 'diary'
            }
        ]);
        expect(project.maps.list()).toEqual([{ id: 'map_m', title: 'Harita', key: 'Harita.map', updatedAt: '2026-11-01T08:00:00.000Z', nodeCount: 1 }]);
        expect(project.getIntegrity().readOnlyFiles).toEqual(['Bozuk.node']);
    });

    it('arama Türkçe harfleri masaüstüyle aynı kuralla eşler ve yazılan dosyayı artımlı görür', async () => {
        const { project } = createMemoryProject(files);
        await project.open();
        await project.index.build();
        const titles = (query) => project.search.query(query).map((note) => note.title);

        expect(titles('isik')).toEqual(['Çocuk']);
        expect(titles('ışık')).toEqual(['Çocuk']);
        expect(titles('TOPLANTI')).toEqual(['Toplantı']);
        expect(titles('toplanti kararlar')).toEqual(['Toplantı']);
        expect(titles('gunluk')).toEqual(['13-11-2026']);
        expect(titles('egzersiz')).toEqual([]);
        expect(titles('  ')).toEqual([]);

        await project.notes.create({ title: 'İstanbul gezisi', text: 'Vapur saatleri' });
        await project.notes.updateContent('Toplantı.node', [{ op: 'replace', blockId: 'blk_b', html: 'Bütçe onaylandı' }]);
        await project.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(titles('istanbul')).toEqual(['İstanbul gezisi']);
        expect(titles('ISTANBUL vapur')).toEqual(['İstanbul gezisi']);
        expect(titles('butce')).toEqual(['Toplantı']);
        expect(titles('kararlar')).toEqual([]);
    });

    it('updateContent yalnız content ve updatedAt alanını değiştirir; diğer alanlar ve Sheet bloğu aynen kalır', async () => {
        const original = noteFile({
            id: 'node_t',
            title: 'Toplantı',
            content: paragraph('blk_a', 'Gündem') + SHEET,
            extra: { properties: { p: { id: 'p', value: [1] } }, futureField: { x: 1 } }
        });
        const { project, driver } = createMemoryProject({ 'Toplantı.node': original });

        const result = await project.notes.updateContent('Toplantı.node', [{ op: 'replace', blockId: 'blk_a', html: 'Yeni gündem' }]);
        const before = JSON.parse(original);
        const after = parse(driver, 'Toplantı.node');

        expect(result).toEqual({ ok: true, changed: true, key: 'Toplantı.node' });
        expect(Object.keys(after)).toEqual(Object.keys(before));
        expect(after).toEqual({ ...before, pisi: { ...before.pisi, updatedAt: NOW.toISOString() }, content: paragraph('blk_a', 'Yeni gündem') + SHEET });
        expect(driver.snapshot()['Toplantı.node']).toBe(json(after));
    });

    it('değişiklik getirmeyen yama dosyayı yazmaz; korumalı bloğa yama ve bozuk not reddedilir', async () => {
        const original = noteFile({ content: paragraph('blk_a', 'Gündem') + SHEET });
        const { project, driver } = createMemoryProject({ 'Not.node': original, 'Bozuk.node': 'x' });

        expect((await project.notes.updateContent('Not.node', [{ op: 'replace', blockId: 'blk_a', html: 'Gündem' }])).changed).toBe(false);
        await expect(project.notes.updateContent('Not.node', [{ op: 'replace', blockId: 'blk_yok', html: 'x' }])).rejects.toMatchObject({
            code: 'BLOCK_NOT_FOUND'
        });
        await expect(project.notes.updateContent('Bozuk.node', [])).rejects.toMatchObject({ code: 'READ_ONLY' });
        await expect(project.notes.updateContent('Yok.node', [])).rejects.toThrow(/Note not found/);
        expect(await project.notes.read('Bozuk.node')).toMatchObject({ ok: false, corrupt: true, readOnly: true });
        expect(await project.notes.read('Yok.node')).toMatchObject({ ok: false, missing: true });
        expect(driver.snapshot()).toEqual({ 'Bozuk.node': 'x', 'Not.node': original });
    });

    it('create: dosya adı, kimlik, sidecar ve blok biçimi shared kurallarından gelir', async () => {
        const { project, driver } = createMemoryProject({ 'Plan.node': noteFile({ title: 'Plan' }) });
        const first = await project.notes.create({ title: ' Yeni: Not? ', text: 'İlk paragraf\nikinci satır\n\n\nİkinci <paragraf>' });
        const clash = await project.notes.create({ title: 'Plan' });
        const empty = await project.notes.create({ title: '  ' });

        expect(first.key).toBe('Yeni_ Not_.node');
        expect(parse(driver, first.key)).toEqual({
            pisi: {
                version: 1,
                type: 'node',
                id: 'node_00000000-0000-4000-8000-000000000001',
                title: 'Yeni_ Not_',
                sidecar: 'inv_Yeni_ Not___node_00000000-0000-4000-8000-000000000001',
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
                parentMap: 'none'
            },
            content:
                '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000002" data-pisi-block-type="paragraph">İlk paragraf<br>ikinci satır</div>' +
                '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000003" data-pisi-block-type="paragraph">İkinci &lt;paragraf&gt;</div>'
        });
        expect(await driver.stat('inv_Yeni_ Not___node_00000000-0000-4000-8000-000000000001')).toMatchObject({ type: 'directory' });
        // The name is taken: the id is appended, as the desktop does.
        expect(clash.key).toBe(`Plan__${clash.id}.node`);
        expect(parse(driver, clash.key).content).toBe('');
        expect(empty).toEqual({ ok: false, error: 'empty-title' });
        // No mobile-only field or attribute reaches the disk (V2).
        expect(driver.snapshot()[first.key]).not.toMatch(/data-block-id|"blocks"|"drawing"|"sheet"|"pinned"|documentKind|connectionTypes/);
    });
});

describe('DiaryRepo', () => {
    it('ilk karakter yazılınca dosyayı oluşturur; boş günlük dosyası yaratmaz', async () => {
        const { project, driver } = createMemoryProject();
        expect(await project.diary.read(TODAY)).toMatchObject({ ok: true, exists: false, text: '', key: 'diary/2026-11-14.node' });
        expect(await project.diary.setText(TODAY, ' \n ')).toMatchObject({ changed: false, created: false });
        expect(driver.snapshot()).toEqual({});

        const written = await project.diary.setText(TODAY, 'Bugün neler oldu?\n\nİkinci paragraf.');
        expect(written).toMatchObject({ ok: true, changed: true, created: true });
        expect(driver.snapshot()['diary/.pisi-diary']).toBe('Bu klasör PISI diary özelliği tarafından yönetilir.\n');
        expect(parse(driver, 'diary/2026-11-14.node')).toEqual({
            pisi: {
                version: 1,
                type: 'node',
                id: 'node_00000000-0000-4000-8000-000000000002',
                title: '14-11-2026',
                sidecar: 'inv_14-11-2026__node_00000000-0000-4000-8000-000000000002',
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
                parentMap: 'diary',
                diaryDate: TODAY
            },
            content:
                '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000003" data-pisi-block-type="paragraph">Bugün neler oldu?</div>' +
                '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000004" data-pisi-block-type="paragraph">İkinci paragraf.</div>'
        });
        expect(await driver.stat('diary/inv_14-11-2026__node_00000000-0000-4000-8000-000000000002')).toMatchObject({ type: 'directory' });
        expect((await project.diary.read(TODAY)).text).toBe('Bugün neler oldu?\n\nİkinci paragraf.');
        expect(await project.diary.listDates()).toEqual([TODAY]);
    });

    it('var olan günlükte yalnız düz paragrafları değiştirir; yönetilen bölüm ve biçimli bloklar aynen kalır', async () => {
        const formatted = paragraph('blk_f', '<strong>Kalın</strong> not');
        const content = paragraph('blk_1', 'Birinci') + formatted + paragraph('blk_2', 'İkinci &amp; son') + MANAGED;
        const { project, driver } = createMemoryProject({
            'diary/2026-11-14.node': noteFile({ id: 'node_d', title: '14-11-2026', content, pisi: { parentMap: 'diary', diaryDate: TODAY } })
        });

        expect(await project.diary.read(TODAY)).toMatchObject({ exists: true, text: 'Birinci\n\nİkinci & son', otherBlocks: 2 });
        expect((await project.diary.setText(TODAY, 'Birinci\n\nİkinci & son')).changed).toBe(false);
        expect(driver.count('rename')).toBe(0);

        await project.diary.setText(TODAY, 'Birinci (düzeltildi)\n\nİkinci & son\n\nÜçüncü');
        expect(parse(driver, 'diary/2026-11-14.node').content).toBe(
            paragraph('blk_1', 'Birinci (düzeltildi)') +
                formatted +
                paragraph('blk_2', 'İkinci &amp; son') +
                '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000001" data-pisi-block-type="paragraph">Üçüncü</div>' +
                MANAGED
        );

        await project.diary.setText(TODAY, 'Yalnız bu kaldı');
        expect(parse(driver, 'diary/2026-11-14.node').content).toBe(paragraph('blk_1', 'Yalnız bu kaldı') + formatted + MANAGED);
    });

    it('masaüstünün açtığı boş günlükte ilk metin yönetilen bölümün üstüne eklenir', async () => {
        const content = '<div><br></div>' + MANAGED;
        const { project, driver } = createMemoryProject({
            'diary/2026-11-14.node': noteFile({ id: 'node_d', title: '14-11-2026', content, pisi: { parentMap: 'diary' } })
        });
        await project.diary.setText(TODAY, 'İlk satır');
        expect(parse(driver, 'diary/2026-11-14.node').content).toBe(
            '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000001" data-pisi-block-type="paragraph">İlk satır</div>' +
                content
        );
    });

    it('geçersiz tarihi ve bozuk günlük dosyasını reddeder', async () => {
        const { project, driver } = createMemoryProject({ 'diary/2026-11-14.node': '{' });
        await expect(project.diary.read('14-11-2026')).rejects.toThrow(/Invalid diary date/);
        await expect(project.diary.setText('2026-02-30', 'x')).rejects.toThrow(/Invalid diary date/);
        expect(await project.diary.read(TODAY)).toMatchObject({ ok: false, corrupt: true, readOnly: true });
        await expect(project.diary.setText(TODAY, 'x')).rejects.toMatchObject({ code: 'READ_ONLY' });
        expect(driver.snapshot()).toEqual({ 'diary/2026-11-14.node': '{' });
    });
});

describe('MapRepo', () => {
    const map = {
        pisi: { version: 1, type: 'map', id: 'map_m', title: 'Harita' },
        map: {
            nodes: [
                { id: 'node_a', x: 80, y: 80, width: 220, height: 92 },
                { id: 'node_b', x: 400, y: 80, width: 220, height: 92 }
            ],
            references: [{ id: 'node_r', path: 'Notlar/Bağımsız.node' }],
            relationshipViews: [{ relationshipId: 'edge_1', sourcePort: 'bottom', targetPort: 'top' }],
            // Not part of the format: never read.
            edges: [{ id: 'edge_eski', sourceId: 'node_a', targetId: 'node_b' }],
            camera: { x: 10, y: 20, zoom: 1.5 },
            collapsedHubs: ['node_a']
        }
    };
    const relationships = [
        { id: 'edge_1', sourceId: 'node_a', targetId: 'node_b', type: 'down-hub' },
        { id: 'edge_2', sourceId: 'node_b', targetId: 'node_r', type: 'co-level' },
        { id: 'edge_3', sourceId: 'node_a', targetId: 'node_başka', type: 'stream' }
    ];

    it('haritayı, relationships.json ilişkilerini ve relationshipViews görünümünü okur; hiçbir şey yazmaz', async () => {
        const { project, driver } = createMemoryProject({
            'Harita.map': json(map),
            '.pisi/relationships.json': json({ version: 1, relationships }),
            'nd_Harita__map_m/A.node': noteFile({ id: 'node_a', title: 'A' })
        });
        await project.index.build();
        const result = await project.maps.read('Harita.map');

        expect(result.nodes).toEqual([
            { id: 'node_a', layout: map.map.nodes[0], title: 'A', key: 'nd_Harita__map_m/A.node' },
            { id: 'node_b', layout: map.map.nodes[1], title: '', key: null }
        ]);
        expect(result.relationships.map((item) => [item.id, item.view?.sourcePort ?? null])).toEqual([
            ['edge_1', 'bottom'],
            ['edge_2', null]
        ]);
        expect([result.camera, result.collapsedHubs, result.relationshipsReadable]).toEqual([{ x: 10, y: 20, zoom: 1.5 }, ['node_a'], true]);
        expect(driver.count('writeText') + driver.count('rename') + driver.count('mkdir')).toBe(0);
    });

    it('bozuk harita ve bozuk ilişki deposu salt okunur sayılır', async () => {
        const { project } = createMemoryProject({ 'Harita.map': json(map), 'Bozuk.map': '{', '.pisi/relationships.json': '{"relationships":5}' });
        expect(await project.maps.read('Bozuk.map')).toMatchObject({ ok: false, corrupt: true });
        expect(await project.maps.read('Yok.map')).toMatchObject({ ok: false, missing: true });
        expect(await project.maps.read('Harita.map')).toMatchObject({ ok: true, relationships: [], relationshipsReadable: false });
        expect(project.getIntegrity().readOnlyFiles).toEqual(['.pisi/relationships.json', 'Bozuk.map']);
    });
});

describe('örnek proje', () => {
    it('depolar üzerinden yüklenir ve ikinci yüklemede kopya oluşturmaz', async () => {
        const { project, driver } = createMemoryProject();
        await project.open();
        const first = await loadSampleProject(project, { now: () => new Date(NOW) });
        const files = driver.snapshot();
        const second = await loadSampleProject(project, { now: () => new Date(NOW) });

        expect(first).toEqual({ tasks: 6, notes: 3 });
        expect(second).toEqual({ tasks: 0, notes: 0 });
        expect(driver.snapshot()).toEqual(files);
        expect((await project.tasks.list()).tasks.map((task) => task.dueDate)).toEqual([TODAY, TODAY, TODAY, '2026-11-12', '2026-11-17', null]);
        expect((await project.diary.read(TODAY)).text).toBe('Örnek proje yüklendi.');
    });
});
