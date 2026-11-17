// The map viewer (docs/mobile-plan.md M9): a map as the desktop lays it out,
// read-only. One finger moves the map, two fingers zoom it, the buttons zoom
// and fit it to the screen, and a tap on a note opens that note. The map
// opens fitted to the screen: the camera stored in the file belongs to a
// desktop window and is not used.
//
// Built once and updated in place: the map and its camera stay as they were
// when the user comes back from a note opened on it, and when the map, one of
// its notes or the relationships change from outside (sync).

import { PISI_RELATIONSHIP_STORE_KEY } from '../../data/map-repo.mjs';
import { renderIconButton } from '../../ui/button.mjs';
import { h } from '../../ui/dom.mjs';
import { renderEmptyState } from '../../ui/list.mjs';
import { renderMapWorld } from './map-canvas.mjs';
import { fitCamera, getLayoutBounds, panBy, pinchCamera, zoomAt } from './map-camera.mjs';

// A finger that moves less than this is a tap, not a drag.
const TAP_SLOP_PX = 8;
const ZOOM_STEP = 1.4;
const KEY_PAN_PX = 48;
// Phone-sized stand-in while the viewer has not been laid out yet (tests, a hidden tab).
const FALLBACK_VIEWPORT = Object.freeze({ width: 360, height: 560 });

/**
 * `project` is the data layer; `onOpenNote({ path, title })` opens a note.
 * `context.map` (from the router) is `{ key, title }` of the map to show.
 */
export function createMapViewer({ project = null, onOpenNote, onError = () => {} }) {
    const element = h('section', { class: 'pisi-screen pisi-map-viewer', dataset: { screen: 'map' } });
    const notice = h('p', { class: 'pisi-map-notice', 'aria-live': 'polite', hidden: true });
    const viewport = h('div', { class: 'pisi-map-viewport', tabindex: '0', dataset: { map: 'viewport' } });
    const controls = h('div', { class: 'pisi-map-controls' });
    // `moved`: the user has moved or zoomed the map; until then it is kept fitted to the screen.
    const state = { key: null, status: 'idle', map: null, camera: null, moved: false, world: null, counts: { nodes: 0, edges: 0 } };
    const pointers = new Map();
    let gesture = null;
    let suppressTap = false;
    let context = null;
    let builtFor = null;
    let loadToken = 0;
    let destroyed = false;

    element.append(notice, viewport, controls);
    // A map the user has not moved stays fitted when the screen changes size (rotation, keyboard).
    const Observer = element.ownerDocument.defaultView?.ResizeObserver;
    const resizer = typeof Observer === 'function' ? new Observer(() => state.world && !state.moved && fit()) : null;
    resizer?.observe(viewport);

    const size = () => {
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;
        return width && height ? { width, height } : FALLBACK_VIEWPORT;
    };
    const center = () => {
        const { width, height } = size();
        return { x: width / 2, y: height / 2 };
    };

    function applyCamera(camera) {
        state.camera = camera;
        if (state.world) state.world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`;
        viewport.dataset.zoom = camera.zoom.toFixed(3);
    }

    function fit() {
        state.moved = false;
        const layouts = state.map ? state.map.nodes.filter((note) => !note.hidden).map((note) => note.layout) : [];
        applyCamera(fitCamera(getLayoutBounds(layouts), size()));
    }

    function move(camera) {
        state.moved = true;
        applyCamera(camera);
    }

    const zoomBy = (factor, point = center()) => state.camera && move(zoomAt(state.camera, factor, point));

    function buildControls() {
        const { t } = context;
        controls.replaceChildren(
            renderIconButton({ icon: 'plus', label: t('maps.zoomIn'), dataset: { action: 'zoom-in' }, onClick: () => zoomBy(ZOOM_STEP) }),
            renderIconButton({ icon: 'minus', label: t('maps.zoomOut'), dataset: { action: 'zoom-out' }, onClick: () => zoomBy(1 / ZOOM_STEP) }),
            renderIconButton({ icon: 'fit', label: t('maps.fit'), dataset: { action: 'fit' }, onClick: fit })
        );
    }

    function showNotice(text) {
        notice.textContent = text || '';
        notice.hidden = !text;
    }

    function draw() {
        const { t } = context;
        builtFor = { map: state.map, t };
        state.world = null;
        controls.hidden = state.status !== 'ready';
        viewport.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
        viewport.setAttribute('aria-label', context.map?.title || t('tab.maps'));
        if (state.status !== 'ready') {
            showNotice('');
            const message = {
                idle: null,
                loading: t('maps.loading'),
                missing: t('maps.missing'),
                corrupt: t('maps.unreadable'),
                error: t('maps.openFailed')
            }[state.status];
            viewport.replaceChildren(message ? renderEmptyState({ icon: 'maps', title: message }) : '');
            return;
        }
        const map = state.map;
        if (!map.nodes.length) {
            showNotice(map.relationshipsReadable ? '' : t('maps.relationshipsUnreadable'));
            viewport.replaceChildren(renderEmptyState({ icon: 'maps', title: t('maps.emptyMap'), note: t('maps.emptyMapNote') }));
            controls.hidden = true;
            return;
        }
        const world = renderMapWorld({
            map,
            idPrefix: `pisi-map-${loadToken}`,
            labels: {
                untitled: t('maps.untitled'),
                node: (note, hidden) => {
                    const title = note.title || t('maps.untitled');
                    if (!hidden) return title;
                    return hidden === 1 ? t('maps.nodeHidingOne', { title }) : t('maps.nodeHiding', { title, count: hidden });
                }
            },
            onOpen: (note) => {
                if (suppressTap) return;
                if (note.key) onOpenNote({ path: note.key, title: note.title });
            }
        });
        state.world = world.element;
        state.counts = { nodes: world.nodeCount, edges: world.edgeCount };
        viewport.dataset.nodes = String(world.nodeCount);
        viewport.dataset.edges = String(world.edgeCount);
        viewport.replaceChildren(world.element);
        const hiddenCount = map.nodes.filter((note) => note.hidden).length;
        showNotice(
            [
                map.relationshipsReadable ? null : t('maps.relationshipsUnreadable'),
                hiddenCount === 1 ? t('maps.hiddenOne') : hiddenCount ? t('maps.hidden', { count: hiddenCount }) : null
            ]
                .filter(Boolean)
                .join(' ')
        );
        if (state.camera && state.moved) applyCamera(state.camera);
        else fit();
    }

    async function load(key) {
        const token = (loadToken += 1);
        Object.assign(state, { key, status: 'loading', map: null, camera: null, moved: false });
        if (context) draw();
        if (!project) return;
        try {
            const result = await project.maps.read(key);
            if (destroyed || token !== loadToken) return;
            if (result.ok) Object.assign(state, { status: 'ready', map: result });
            else state.status = result.missing ? 'missing' : 'corrupt';
        } catch (error) {
            onError(error);
            if (destroyed || token !== loadToken) return;
            state.status = 'error';
        }
        draw();
    }

    /** The same map read again; a camera the user moved stays where it is, an untouched one fits the map again. */
    async function refresh() {
        const token = (loadToken += 1);
        const key = state.key;
        try {
            const result = await project.maps.read(key);
            if (destroyed || token !== loadToken || key !== state.key) return;
            if (result.ok) Object.assign(state, { status: 'ready', map: result });
            else Object.assign(state, { status: result.missing ? 'missing' : 'corrupt', map: null });
        } catch (error) {
            onError(error);
            return;
        }
        if (context) draw();
    }

    // ----- gestures -----

    const local = (event) => {
        const box = viewport.getBoundingClientRect();
        return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    function startGesture() {
        const points = [...pointers.values()];
        if (!state.camera || !points.length) {
            gesture = null;
            return;
        }
        gesture =
            points.length === 1 ? { kind: 'pan', camera: state.camera, from: points[0] } : { kind: 'pinch', camera: state.camera, from: points.slice(0, 2) };
    }

    viewport.addEventListener('pointerdown', (event) => {
        if (state.status !== 'ready' || (event.pointerType === 'mouse' && event.button !== 0)) return;
        if (!pointers.size) suppressTap = false;
        pointers.set(event.pointerId, local(event));
        if (pointers.size > 1) suppressTap = true;
        startGesture();
    });
    viewport.addEventListener('pointermove', (event) => {
        if (!pointers.has(event.pointerId) || !gesture) return;
        pointers.set(event.pointerId, local(event));
        const points = [...pointers.values()];
        if (gesture.kind === 'pan') {
            const dx = points[0].x - gesture.from.x;
            const dy = points[0].y - gesture.from.y;
            if (!suppressTap && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
            suppressTap = true;
            move(panBy(gesture.camera, dx, dy));
        } else if (points.length >= 2) {
            move(pinchCamera(gesture.camera, gesture.from, points.slice(0, 2)));
        }
    });
    const release = (event) => {
        if (!pointers.delete(event.pointerId)) return;
        // Lifting one of two fingers goes on as a one-finger move from where the map is now.
        startGesture();
        // The click that ends a drag comes right after the last finger is lifted; later clicks
        // (a tap, TalkBack, the keyboard) open the note again.
        if (!pointers.size && suppressTap) element.ownerDocument.defaultView.setTimeout(() => !pointers.size && (suppressTap = false), 0);
    };
    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', release);
    viewport.addEventListener(
        'wheel',
        (event) => {
            if (state.status !== 'ready') return;
            event.preventDefault();
            zoomBy(Math.exp(-event.deltaY / 400), local(event));
        },
        { passive: false }
    );
    viewport.addEventListener('keydown', (event) => {
        if (state.status !== 'ready' || !state.camera) return;
        const pan = { ArrowLeft: [KEY_PAN_PX, 0], ArrowRight: [-KEY_PAN_PX, 0], ArrowUp: [0, KEY_PAN_PX], ArrowDown: [0, -KEY_PAN_PX] }[event.key];
        if (pan) move(panBy(state.camera, ...pan));
        else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
        else if (event.key === '-') zoomBy(1 / ZOOM_STEP);
        else if (event.key === '0') fit();
        else return;
        event.preventDefault();
    });

    return {
        element,

        /** Draws the map `next.map` (`{ key, title }`) with `next.t`; a new key opens that map fitted to the screen. */
        update(next) {
            const relabel = !context || context.t !== next.t;
            context = next;
            if (relabel) buildControls();
            const key = next.map?.key ?? null;
            if (key !== state.key) return void load(key);
            if (relabel || builtFor?.map !== state.map) draw();
        },

        /** The viewer is on screen: until the user moves it, the map is fitted to the size it now has. */
        attach() {
            if (state.world && !state.moved) fit();
        },

        /**
         * A file changed outside the app (`info.removed` when deleted). The open
         * map is read again when it, a note or the relationships changed; a
         * removed map shows as missing. Resolves when it has been drawn.
         */
        async handleExternal(key, info = {}) {
            if (!project || !state.key || state.status === 'idle') return;
            if (key === state.key && info.removed) {
                loadToken += 1;
                Object.assign(state, { status: 'missing', map: null });
                if (context) draw();
                return;
            }
            if (key === state.key || key === PISI_RELATIONSHIP_STORE_KEY || key.toLowerCase().endsWith('.node')) await refresh();
        },

        fit,
        /** The camera, `{ x, y, zoom }`, or null before a map is drawn. */
        getCamera: () => state.camera,
        /** Notes and connections drawn. */
        getCounts: () => ({ ...state.counts }),

        destroy() {
            destroyed = true;
            resizer?.disconnect();
        }
    };
}
