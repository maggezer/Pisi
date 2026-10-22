import { registerModule } from '../core/module-registry.mjs';

function bindNodeModalControls() {
    const closeModalBtn = document.getElementById('node-modal-close');
    const overlay = document.getElementById('node-modal-overlay');

    if (closeModalBtn && closeModalBtn.dataset.bound !== '1') {
        closeModalBtn.dataset.bound = '1';
        closeModalBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const saved = await closeNodeModalAndSave();
            if (saved) refreshAllPisiMapNodePreviewsFromDisk();
        });
    }

    if (overlay && overlay.dataset.bound !== '1') {
        overlay.dataset.bound = '1';
        overlay.addEventListener('mousedown', async (event) => {
            if (event.target !== overlay) return;
            const saved = await closeNodeModalAndSave();
            if (saved) refreshAllPisiMapNodePreviewsFromDisk();
        });
    }

    if (document.body.dataset.nodeModalEscBound !== '1') {
        document.body.dataset.nodeModalEscBound = '1';
        document.addEventListener('keydown', async (event) => {
            const modalOverlay = document.getElementById('node-modal-overlay');
            if (!modalOverlay?.classList.contains('visible')) return;

            if (event.key === 'Tab' && !event.defaultPrevented) {
                const focusable = Array.from(
                    modalOverlay.querySelectorAll('button:not([disabled]), input:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])')
                ).filter((element) => !element.hidden);

                if (focusable.length) {
                    const currentIndex = focusable.indexOf(document.activeElement);
                    const nextIndex = event.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : (currentIndex + 1) % focusable.length;
                    event.preventDefault();
                    focusable[nextIndex].focus();
                }
                return;
            }

            if (event.key !== 'Escape') return;

            const tagMenu = document.getElementById('pisi-tag-menu');
            if (tagMenu && !tagMenu.hidden) {
                closePisiTagMenu();
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            const saved = await closeNodeModalAndSave();
            if (saved) refreshAllPisiMapNodePreviewsFromDisk();
        });
    }
}

const PISI_NODE_PREVIEW_DELAY_MS = 1500;

let pisiNodePreviewTimer = null;

let pisiNodePreviewRequest = 0;

/** @param {Document | Element} [root] */
function hidePisiCanvasHints(root = document) {
    if (root instanceof HTMLElement && root.matches('.pisi-canvas-toolbar-hint')) {
        root.hidden = true;
    }
    root.querySelectorAll?.('.pisi-canvas-toolbar-hint').forEach((hint) => {
        hint.hidden = true;
        hint.style.display = 'none';
    });
}

function parsePisiNodePreviewContent(content = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(content || '');
    wrapper.querySelectorAll('script, style, iframe, object, embed').forEach((item) => item.remove());

    const firstCanvas = wrapper.querySelector('canvas[data-pisi-canvas][data-image]');
    const rawImage = firstCanvas?.getAttribute('data-image') || '';

    wrapper.querySelectorAll('.pisi-canvas-toolbar-hint, canvas, table').forEach((item) => item.remove());
    const text = (wrapper.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 720);

    return {
        image: /^data:image\/png;base64,/i.test(rawImage) ? rawImage : '',
        text
    };
}

function findPisiMapNodeForBox(box) {
    const nodeId = box?.dataset?.nodeId;
    if (!nodeId || !Array.isArray(window.activeMapNodes)) return null;
    return window.activeMapNodes.find((node) => String(node.id) === String(nodeId)) || null;
}

function stylePisiCanvasThumbnail(image) {
    Object.assign(image.style, {
        width: '100%',
        height: '100%',
        minHeight: '28px',
        display: 'block',
        objectFit: 'contain',
        borderRadius: '5px',
        background: '#fff',
        pointerEvents: 'none'
    });
}

function refreshPisiMapNodeCanvasPreview(box, content = null) {
    if (!box?.isConnected) return;

    const node = findPisiMapNodeForBox(box);
    const parsed = parsePisiNodePreviewContent(content ?? node?.content ?? '');
    const preview = box.querySelector('.map-node-preview');
    if (!preview) return;

    preview.querySelector('.pisi-map-node-canvas-preview')?.remove();
    preview.style.padding = '';

    if (!parsed.image) {
        preview.textContent = node?.preview || parsed.text || '';
        return;
    }

    const image = document.createElement('img');
    image.className = 'pisi-map-node-canvas-preview';
    image.alt = '';
    image.src = parsed.image;
    stylePisiCanvasThumbnail(image);

    preview.textContent = '';
    preview.style.padding = '5px 7px 7px';
    preview.appendChild(image);
}

async function refreshPisiMapNodePreviewFromDisk(box) {
    if (!box?.isConnected || !box.dataset.nodePath) return;

    try {
        const result = await window.pisiProject?.getPisiDocument?.(box.dataset.nodePath);
        if (!result?.ok || !box.isConnected) return;

        const content = result.data?.content || result.content || '';
        const node = findPisiMapNodeForBox(box);
        if (node) {
            node.content = content;
            node.metadata = result.metadata || node.metadata;
        }
        refreshPisiMapNodeCanvasPreview(box, content);
    } catch (error) {
        console.warn('[PISI] Node küçük önizlemesi yenilenemedi:', error);
    }
}

function refreshAllPisiMapNodePreviewsFromDisk() {
    document.querySelectorAll('.map-node-box').forEach((box) => {
        refreshPisiMapNodePreviewFromDisk(box);
    });
}

function stylePisiHoverLayer(layer) {
    Object.assign(layer.style, {
        position: 'fixed',
        zIndex: '12000',
        width: 'min(380px, calc(100vw - 24px))',
        maxHeight: 'min(520px, calc(100vh - 24px))',
        overflow: 'hidden',
        padding: '14px',
        border: '1px solid #555',
        borderRadius: '12px',
        background: 'rgba(37, 37, 38, 0.98)',
        color: '#d4d4d4',
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.58)',
        pointerEvents: 'none'
    });
}

function getPisiNodePreviewLayer() {
    let layer = document.getElementById('pisi-node-hover-preview');
    if (layer) return layer;

    layer = document.createElement('aside');
    layer.id = 'pisi-node-hover-preview';
    layer.hidden = true;
    layer.setAttribute('aria-live', 'polite');
    stylePisiHoverLayer(layer);
    document.body.appendChild(layer);
    return layer;
}

function hidePisiNodeHoverPreview() {
    clearTimeout(pisiNodePreviewTimer);
    pisiNodePreviewTimer = null;
    pisiNodePreviewRequest += 1;

    const layer = document.getElementById('pisi-node-hover-preview');
    if (layer) {
        layer.hidden = true;
        layer.innerHTML = '';
    }
}

function positionPisiNodeHoverPreview(layer, box) {
    const boxRect = box.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const gap = 12;

    let left = boxRect.right + gap;
    if (left + layerRect.width > window.innerWidth - 8) {
        left = boxRect.left - layerRect.width - gap;
    }

    let top = boxRect.top;
    if (top + layerRect.height > window.innerHeight - 8) {
        top = window.innerHeight - layerRect.height - 8;
    }

    layer.style.left = `${Math.max(8, left)}px`;
    layer.style.top = `${Math.max(8, top)}px`;
}

function appendPisiHoverPreviewContent(layer, title, parsed) {
    const heading = document.createElement('h3');
    heading.textContent = title;
    Object.assign(heading.style, {
        margin: '0 0 9px',
        color: 'var(--pisi-map-node-title-color, #f39c12)',
        fontSize: '15px',
        fontWeight: '800',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
    });
    layer.appendChild(heading);

    if (parsed.image) {
        const image = document.createElement('img');
        image.alt = `${title} tuval önizlemesi`;
        image.src = parsed.image;
        Object.assign(image.style, {
            width: '100%',
            maxHeight: '250px',
            display: 'block',
            objectFit: 'contain',
            margin: '0 0 10px',
            borderRadius: '8px',
            background: '#fff'
        });
        layer.appendChild(image);
    }

    const text = document.createElement('div');
    text.textContent = parsed.text || (parsed.image ? 'Bu node yalnızca bir tuval içeriyor.' : 'Bu node henüz boş.');
    Object.assign(text.style, {
        maxHeight: '190px',
        overflow: 'hidden',
        color: parsed.text ? '#c4c4c4' : '#777',
        fontSize: parsed.text ? '13px' : '12px',
        lineHeight: '1.5',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontStyle: parsed.text ? 'normal' : 'italic'
    });
    layer.appendChild(text);
}

async function showPisiNodeHoverPreview(box) {
    if (!box?.isConnected || box.classList.contains('dragging')) return;

    const requestId = ++pisiNodePreviewRequest;
    let node = findPisiMapNodeForBox(box);
    let title = node?.metadata?.title || node?.fileName?.replace(/\.node$/i, '') || 'Node';
    let content = node?.content || '';

    try {
        const result = await window.pisiProject?.getPisiDocument?.(box.dataset.nodePath);
        if (requestId !== pisiNodePreviewRequest || !box.matches(':hover')) return;

        if (result?.ok) {
            title = result.metadata?.title || title;
            content = result.data?.content || result.content || '';
            if (node) {
                node.content = content;
                node.metadata = result.metadata || node.metadata;
            }
            refreshPisiMapNodeCanvasPreview(box, content);
        }
    } catch (error) {
        console.warn('[PISI] Node önizlemesi yüklenemedi:', error);
    }

    if (requestId !== pisiNodePreviewRequest || !box.matches(':hover')) return;

    const layer = getPisiNodePreviewLayer();
    layer.innerHTML = '';
    appendPisiHoverPreviewContent(layer, title, parsePisiNodePreviewContent(content));
    layer.hidden = false;
    positionPisiNodeHoverPreview(layer, box);
}

function schedulePisiNodeHoverPreview(box) {
    hidePisiNodeHoverPreview();
    const requestId = pisiNodePreviewRequest;

    pisiNodePreviewTimer = setTimeout(() => {
        if (requestId !== pisiNodePreviewRequest || !box.matches(':hover')) return;
        showPisiNodeHoverPreview(box);
    }, PISI_NODE_PREVIEW_DELAY_MS);
}

function processPisiPreviewAddedNode(addedNode) {
    if (!(addedNode instanceof Element)) return;
    hidePisiCanvasHints(addedNode);

    if (addedNode.matches('.map-node-box')) {
        refreshPisiMapNodeCanvasPreview(addedNode);
    }
    addedNode.querySelectorAll?.('.map-node-box').forEach((box) => {
        refreshPisiMapNodeCanvasPreview(box);
    });
}

function bindPisiMapNodePreviewEvents() {
    if (document.body.dataset.pisiNodePreviewBound === '1') return;
    document.body.dataset.pisiNodePreviewBound = '1';

    document.addEventListener('mouseover', (event) => {
        const box = event.target.closest?.('.map-node-box');
        if (!box || box.contains(/** @type {Node | null} */ (event.relatedTarget))) return;
        schedulePisiNodeHoverPreview(box);
    });

    document.addEventListener('mouseout', (event) => {
        const box = event.target.closest?.('.map-node-box');
        if (!box || box.contains(/** @type {Node | null} */ (event.relatedTarget))) return;
        hidePisiNodeHoverPreview();
    });

    document.addEventListener('mousedown', hidePisiNodeHoverPreview, true);
    window.addEventListener('blur', hidePisiNodeHoverPreview);
    window.addEventListener('resize', hidePisiNodeHoverPreview);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach(processPisiPreviewAddedNode);
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    hidePisiCanvasHints();
    document.querySelectorAll('.map-node-box').forEach((box) => {
        refreshPisiMapNodeCanvasPreview(box);
    });
}

function setupPisiNodePreviews() {
    bindPisiMapNodePreviewEvents();
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    bindNodeModalControls: {
        enumerable: true,
        get() {
            return bindNodeModalControls;
        }
    },
    PISI_NODE_PREVIEW_DELAY_MS: {
        enumerable: true,
        get() {
            return PISI_NODE_PREVIEW_DELAY_MS;
        }
    },
    pisiNodePreviewTimer: {
        enumerable: true,
        get() {
            return pisiNodePreviewTimer;
        },
        set(value) {
            pisiNodePreviewTimer = value;
        }
    },
    pisiNodePreviewRequest: {
        enumerable: true,
        get() {
            return pisiNodePreviewRequest;
        },
        set(value) {
            pisiNodePreviewRequest = value;
        }
    },
    hidePisiCanvasHints: {
        enumerable: true,
        get() {
            return hidePisiCanvasHints;
        }
    },
    parsePisiNodePreviewContent: {
        enumerable: true,
        get() {
            return parsePisiNodePreviewContent;
        }
    },
    findPisiMapNodeForBox: {
        enumerable: true,
        get() {
            return findPisiMapNodeForBox;
        }
    },
    stylePisiCanvasThumbnail: {
        enumerable: true,
        get() {
            return stylePisiCanvasThumbnail;
        }
    },
    refreshPisiMapNodeCanvasPreview: {
        enumerable: true,
        get() {
            return refreshPisiMapNodeCanvasPreview;
        }
    },
    refreshPisiMapNodePreviewFromDisk: {
        enumerable: true,
        get() {
            return refreshPisiMapNodePreviewFromDisk;
        }
    },
    refreshAllPisiMapNodePreviewsFromDisk: {
        enumerable: true,
        get() {
            return refreshAllPisiMapNodePreviewsFromDisk;
        }
    },
    stylePisiHoverLayer: {
        enumerable: true,
        get() {
            return stylePisiHoverLayer;
        }
    },
    getPisiNodePreviewLayer: {
        enumerable: true,
        get() {
            return getPisiNodePreviewLayer;
        }
    },
    hidePisiNodeHoverPreview: {
        enumerable: true,
        get() {
            return hidePisiNodeHoverPreview;
        }
    },
    positionPisiNodeHoverPreview: {
        enumerable: true,
        get() {
            return positionPisiNodeHoverPreview;
        }
    },
    appendPisiHoverPreviewContent: {
        enumerable: true,
        get() {
            return appendPisiHoverPreviewContent;
        }
    },
    showPisiNodeHoverPreview: {
        enumerable: true,
        get() {
            return showPisiNodeHoverPreview;
        }
    },
    schedulePisiNodeHoverPreview: {
        enumerable: true,
        get() {
            return schedulePisiNodeHoverPreview;
        }
    },
    processPisiPreviewAddedNode: {
        enumerable: true,
        get() {
            return processPisiPreviewAddedNode;
        }
    },
    bindPisiMapNodePreviewEvents: {
        enumerable: true,
        get() {
            return bindPisiMapNodePreviewEvents;
        }
    },
    setupPisiNodePreviews: {
        enumerable: true,
        get() {
            return setupPisiNodePreviews;
        }
    }
});
registerModule('editor.preview', moduleApi);
