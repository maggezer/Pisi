import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { addSampleMap } from '../src/data/sample-map.mjs';
import { clampZoom, fitCamera, getLayoutBounds, panBy, pinchCamera, toWorld, zoomAt } from '../src/screens/maps/map-camera.mjs';
import { NOW, createMemoryProject, json, noteFile, paragraph } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

describe('harita kamerası', () => {
    const near = (actual, expected) => {
        for (const key of Object.keys(expected)) expect(actual[key]).toBeCloseTo(expected[key], 6);
    };

    it('ekrana sığdırma bütün notları ortalar ve 1 kattan fazla büyütmez', () => {
        const bounds = getLayoutBounds([
            { x: 80, y: 80, width: 220, height: 92 },
            { x: 1080, y: 580, width: 220, height: 92 }
        ]);
        expect(bounds).toEqual({ x: 80, y: 80, width: 1220, height: 592 });
        const camera = fitCamera(bounds, { width: 360, height: 600 });
        // (360 - 48) / 1220 is narrower than (600 - 48) / 592.
        expect(camera.zoom).toBeCloseTo(312 / 1220, 6);
        // The middle of the notes lands in the middle of the screen.
        near(toWorld(camera, { x: 180, y: 300 }), { x: 690, y: 376 });
        expect(fitCamera(getLayoutBounds([{ x: 0, y: 0, width: 220, height: 92 }]), { width: 360, height: 600 }).zoom).toBe(1);
        expect(getLayoutBounds([])).toBe(null);
    });

    it('noktaya göre yakınlaştırma o noktadaki dünya noktasını yerinde tutar; yakınlık 0.1 ile 3 arasında kalır', () => {
        const camera = { x: 10, y: 20, zoom: 0.5 };
        const point = { x: 100, y: 200 };
        const zoomed = zoomAt(camera, 2, point);
        expect(zoomed.zoom).toBe(1);
        near(toWorld(zoomed, point), toWorld(camera, point));
        expect(zoomAt(camera, 100, point).zoom).toBe(3);
        expect(clampZoom(0.01)).toBe(0.1);
        expect(panBy(camera, 5, -5)).toEqual({ x: 15, y: 15, zoom: 0.5 });
    });

    it('iki parmak: parmaklar açılınca yakınlaşır, aradaki nokta parmakların ortasıyla birlikte gider', () => {
        const start = { x: 0, y: 0, zoom: 1 };
        const camera = pinchCamera(
            start,
            [
                { x: 100, y: 100 },
                { x: 200, y: 100 }
            ],
            [
                { x: 50, y: 150 },
                { x: 250, y: 150 }
            ]
        );
        expect(camera.zoom).toBe(2);
        // The world point that was under (150, 100) is now under (150, 150).
        near(toWorld(camera, { x: 150, y: 150 }), { x: 150, y: 100 });
    });
});

const MAP_ID = 'map_yol';
const SIDECAR = `nd_Yol Haritası__${MAP_ID}`;
const node = (id, x, y) => ({ id, x, y, width: 220, height: 92 });
const view = (relationshipId, sourcePort = 'bottom', targetPort = 'top') => ({ relationshipId, sourcePort, targetPort });
const FILES = {
    'Yol Haritası.map': json({
        pisi: { version: 1, type: 'map', id: MAP_ID, title: 'Yol Haritası', sidecar: SIDECAR },
        map: {
            nodes: [node('node_kok', 400, 60), node('node_a', 100, 280), node('node_b', 700, 280), node('node_c', 700, 500)],
            relationshipViews: [view('edge_1'), view('edge_2'), view('edge_3'), view('edge_4', 'right', 'left')],
            collapsedHubs: ['node_b::bottom'],
            camera: { x: 999, y: 999, zoom: 3 }
        }
    }),
    '.pisi/relationships.json': json({
        version: 1,
        relationships: [
            { id: 'edge_1', sourceId: 'node_kok', targetId: 'node_a', type: 'down-hub' },
            { id: 'edge_2', sourceId: 'node_kok', targetId: 'node_b', type: 'down-hub' },
            { id: 'edge_3', sourceId: 'node_b', targetId: 'node_c', type: 'down-hub' },
            { id: 'edge_4', sourceId: 'node_a', targetId: 'node_b', type: 'co-level' }
        ]
    }),
    [`${SIDECAR}/Kök.node`]: noteFile({ id: 'node_kok', title: 'Kök', content: paragraph('blk_1', 'Haritanın kökü') }),
    [`${SIDECAR}/A.node`]: noteFile({ id: 'node_a', title: 'A' }),
    [`${SIDECAR}/B.node`]: noteFile({ id: 'node_b', title: 'B' }),
    [`${SIDECAR}/C.node`]: noteFile({ id: 'node_c', title: 'C' }),
    'Boş.map': json({ pisi: { version: 1, type: 'map', id: 'map_bos', title: 'Boş' }, map: { nodes: [] } })
};

let app;
let root;

async function start({ files = FILES, deviceLanguage = 'tr-TR', loadSampleMap = null } = {}) {
    const platform = createFakePlatform();
    const memory = createMemoryProject(files);
    app = createApp({
        root,
        platform,
        storage: createFakeStorage(),
        systemTheme: createFakeSystemTheme(),
        deviceLanguage,
        project: memory.project,
        loadSampleMap,
        now: () => new Date(NOW),
        onError: (error) => memory.errors.push(error)
    });
    await app.ready;
    app.router.selectTab('maps');
    await settle();
    return { ...memory, platform };
}

const $ = (selector) => root.querySelector(selector);
const all = (selector) => [...root.querySelectorAll(selector)];
const settle = async () => {
    for (let round = 0; round < 3; round += 1) await vi.advanceTimersByTimeAsync(0);
};
const viewport = () => $('[data-map="viewport"]');
const zoom = () => Number(viewport().dataset.zoom);

function pointer(type, id, x, y, target = viewport()) {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y });
    target.dispatchEvent(event);
}

async function openMap(title = 'Yol Haritası') {
    all('[data-maps="list"] [data-map]')
        .find((row) => row.textContent.includes(title))
        .click();
    await settle();
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root = document.createElement('div');
    document.body.append(root);
});

afterEach(() => {
    app?.destroy();
    root.remove();
    vi.useRealTimers();
});

describe('Haritalar sekmesi', () => {
    it('haritaları başlığa göre ve masaüstünün saydığı not sayısıyla listeler', async () => {
        const { driver } = await start();
        expect($('.pisi-header-title').textContent).toBe('Haritalar');
        expect(
            all('[data-maps="list"] [data-map]').map((row) => [
                row.dataset.map,
                row.querySelector('.pisi-row-title').textContent,
                row.querySelector('.pisi-row-meta').textContent
            ])
        ).toEqual([
            ['Boş.map', 'Boş', '0 not'],
            ['Yol Haritası.map', 'Yol Haritası', '4 not']
        ]);
        expect(driver.count('writeText') + driver.count('rename')).toBe(0);
    });

    it('haritası olmayan projede boş durum gösterilir', async () => {
        await start({ files: {} });
        expect($('[data-maps="list"] .pisi-empty-title').textContent).toBe('Bu projede harita yok');
    });

    it('harita ekrana sığmış açılır; daraltılmış dalın altındaki not ve bağlantıları çizilmez; dosyadaki kamera kullanılmaz', async () => {
        await start();
        await openMap();
        expect(app.router.getState()).toMatchObject({ tab: 'maps', stack: ['map'], map: { key: 'Yol Haritası.map', title: 'Yol Haritası' } });
        expect($('.pisi-header-title').textContent).toBe('Yol Haritası');
        expect(all('.pisi-map-node').map((button) => button.getAttribute('aria-label'))).toEqual(['Kök', 'A', 'B, altında 1 gizli not']);
        expect([viewport().dataset.nodes, viewport().dataset.edges]).toEqual(['3', '3']);
        expect(all('.pisi-map-edge').map((path) => [path.dataset.edge, path.getAttribute('class')])).toEqual([
            ['edge_1', 'pisi-map-edge pisi-map-edge-hub'],
            ['edge_2', 'pisi-map-edge pisi-map-edge-hub'],
            ['edge_4', 'pisi-map-edge pisi-map-edge-peer']
        ]);
        // A co-level connection has arrows at both ends, the others only at the end.
        expect(all('.pisi-map-edge').map((path) => Boolean(path.getAttribute('marker-start')))).toEqual([false, false, true]);
        expect($('.pisi-map-node-hub').textContent).toBe('+1');
        expect($('.pisi-map-notice').textContent).toBe('1 not daraltılmış bir dalın altında.');
        // Fitted into the 360 × 560 stand-in viewport (happy-dom lays nothing out): the notes span 820 × 332.
        expect(zoom()).toBeCloseTo(312 / 820, 3);
        expect($('.pisi-map-world').style.transform).toMatch(/^translate3d\(.+\) scale\(0\.38/);
    });

    it('bir nota dokunmak notu açar; geri tuşu haritaya, sonra listeye döner; harita kaldığı yerde durur', async () => {
        const { platform } = await start();
        await openMap();
        $('[data-action="zoom-in"]').click();
        const zoomed = zoom();
        $('.pisi-map-node[data-node="node_a"]').click();
        await settle();
        expect(app.router.getState()).toMatchObject({ stack: ['map', 'note'], note: { path: `${SIDECAR}/A.node`, title: 'A' } });
        platform.pressBack();
        await settle();
        expect(app.router.getState().stack).toEqual(['map']);
        expect(zoom()).toBe(zoomed);
        platform.pressBack();
        await settle();
        expect($('[data-screen="maps"]')).not.toBe(null);
    });

    it('tek parmakla sürükleme haritayı kaydırır ve notu açmaz; iki parmak yakınlaştırır; düğmeler yakınlaştırır ve sığdırır', async () => {
        await start();
        await openMap();
        const fitted = zoom();
        const before = $('.pisi-map-world').style.transform;
        const card = $('.pisi-map-node[data-node="node_a"]');
        pointer('pointerdown', 1, 100, 100, card);
        pointer('pointermove', 1, 104, 103, card);
        // Within the tap slop nothing moves.
        expect($('.pisi-map-world').style.transform).toBe(before);
        pointer('pointermove', 1, 160, 140, card);
        pointer('pointerup', 1, 160, 140, card);
        card.click();
        await settle();
        expect(app.router.getState().stack).toEqual(['map']);
        expect($('.pisi-map-world').style.transform).not.toBe(before);

        pointer('pointerdown', 1, 100, 200);
        pointer('pointerdown', 2, 200, 200);
        pointer('pointermove', 2, 300, 200);
        pointer('pointerup', 2, 300, 200);
        pointer('pointerup', 1, 100, 200);
        expect(zoom()).toBeCloseTo(fitted * 2, 2);

        $('[data-action="zoom-out"]').click();
        expect(zoom()).toBeCloseTo((fitted * 2) / 1.4, 2);
        $('[data-action="fit"]').click();
        expect(zoom()).toBeCloseTo(fitted, 6);
        // After a drag a plain tap opens the note again.
        await settle();
        $('.pisi-map-node[data-node="node_kok"]').click();
        await settle();
        expect(app.router.getState().note).toMatchObject({ title: 'Kök' });
    });

    it('notu olmayan harita ve bozuk harita kendi durumunu gösterir', async () => {
        await start({ files: { ...FILES, 'Bozuk.map': '{' } });
        await openMap('Boş');
        expect($('[data-screen="map"] .pisi-empty-title').textContent).toBe('Bu haritada not yok');
        expect($('.pisi-map-controls').hidden).toBe(true);
        app.router.openMap({ key: 'Bozuk.map', title: 'Bozuk' });
        await settle();
        expect($('[data-screen="map"] .pisi-empty-title').textContent).toBe('Bu haritanın dosyası okunamadı; değiştirilmeyecek.');
    });

    it('İngilizcede metinler ve düğme adları çevrilir', async () => {
        await start({ deviceLanguage: 'en-GB' });
        expect($('[data-map="Yol Haritası.map"] .pisi-row-meta').textContent).toBe('4 notes');
        await openMap();
        expect([...all('.pisi-map-controls button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'Fit to screen']);
        expect($('.pisi-map-node[data-node="node_b"]').getAttribute('aria-label')).toBe('B, 1 hidden note under it');
    });

    it('geliştirici bölümündeki "Örnek harita yükle" haritayı ekler; liste ve görüntüleyici onu gösterir', async () => {
        await start({ files: {}, loadSampleMap: addSampleMap });
        app.router.push('settings');
        await settle();
        $('[data-developer="load-sample-map"]').click();
        await settle();
        expect($('[role="status"]').textContent).toContain('Örnek harita eklendi.');
        app.router.selectTab('maps');
        await settle();
        expect($('[data-map="Örnek Harita.map"] .pisi-row-meta').textContent).toBe('6 not');
        await openMap('Örnek Harita');
        expect([viewport().dataset.nodes, viewport().dataset.edges]).toEqual(['6', '6']);
    });
});
