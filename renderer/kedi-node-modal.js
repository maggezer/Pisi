function bindNodeModalControls() {
    const closeModalBtn = document.getElementById('node-modal-close');
    const overlay = document.getElementById('node-modal-overlay');

    if (closeModalBtn && closeModalBtn.dataset.bound !== '1') {
        closeModalBtn.dataset.bound = '1';

        closeModalBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await closeNodeModalAndSave();
        });
    }

    if (overlay && overlay.dataset.bound !== '1') {
        overlay.dataset.bound = '1';

        overlay.addEventListener('mousedown', async (event) => {
            if (event.target === overlay) {
                await closeNodeModalAndSave();
            }
        });
    }

    if (document.body.dataset.nodeModalEscBound !== '1') {
        document.body.dataset.nodeModalEscBound = '1';

        document.addEventListener('keydown', async (event) => {
            const modalOverlay = document.getElementById('node-modal-overlay');

            if (!modalOverlay?.classList.contains('visible')) {
                return;
            }

            if (event.key === 'Tab') {
                const focusable = Array.from(
                    modalOverlay.querySelectorAll(
                        'button:not([disabled]), input:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
                    )
                ).filter((element) => !element.hidden);

                if (focusable.length) {
                    const currentIndex = focusable.indexOf(document.activeElement);
                    const nextIndex = event.shiftKey
                        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                        : (currentIndex + 1) % focusable.length;

                    event.preventDefault();
                    focusable[nextIndex].focus();
                }
                return;
            }

            if (event.key !== 'Escape') return;

            const tagMenu = document.getElementById('kedi-tag-menu');

            if (tagMenu && !tagMenu.hidden) {
                closeKediTagMenu();
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            await closeNodeModalAndSave();
        });
    }
}

const KEDI_NODE_PREVIEW_DELAY_MS = 1500;
let kediNodePreviewTimer = null;
let kediNodePreviewRequest = 0;

function installKediNodePreviewStyles() {
    if (document.getElementById('kedi-node-preview-styles')) return;

    const style = document.createElement('style');
    style.id = 'kedi-node-preview-styles';
    style.textContent = `
        .kedi-canvas-toolbar-hint { display: none !important; }

        .map-node-preview.has-canvas-preview {
            padding: 5px 7px 7px;
        }

        .kedi-map-node-canvas-preview {
            width: 100%;
            height: 100%;
            min-height: 28px;
            display: block;
            object-fit: contain;
            border-radius: 5px;
            background: #fff;
            pointer-events: none;
        }

        #kedi-node-hover-preview {
            position: fixed;
            z-index: 12000;
            width: min(380px, calc(100vw - 24px));
            max-height: min(520px, calc(100vh - 24px));
            overflow: hidden;
            padding: 14px;
            border: 1px solid #555;
            border-radius: 12px;
            background: rgba(37, 37, 38, 0.98);
            color: #d4d4d4;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.58);
            pointer-events: none;
        }

        #kedi-node-hover-preview[hidden] { display: none; }

        .kedi-node-hover-preview-title {
            margin: 0 0 9px;
            color: var(--kedi-map-node-title-color, #f39c12);
            font-size: 15px;
            font-weight: 800;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .kedi-node-hover-preview-image {
            width: 100%;
            max-height: 250px;
            display: block;
            object-fit: contain;
            margin: 0 0 10px;
            border-radius: 8px;
            background: #fff;
        }

        .kedi-node-hover-preview-text {
            max-height: 190px;
            overflow: hidden;
            color: #c4c4c4;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .kedi-node-hover-preview-empty {
            color: #777;
            font-size: 12px;
            font-style: italic;
        }
    `;
    document.head.appendChild(style);
}

function getKediNodePreviewLayer() {
    let layer = document.getElementById('kedi-node-hover-preview');
    if (layer) return layer;

    layer = document.createElement('aside');
    layer.id = 'kedi-node-hover-preview';
    layer.hidden = true;
    layer.setAttribute('aria-live', 'polite');
    document.body.appendChild(layer);
    return layer;
}

function parseKediNodePreviewContent(content = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(content || '');

    wrapper.querySelectorAll('script, style, iframe, object, embed').forEach((item) => item.remove());

    const firstCanvas = wrapper.querySelector('canvas[data-kedi-canvas][data-image]');
    const image = firstCanvas?.getAttribute('data-image') || '';

    wrapper.querySelectorAll('.kedi-canvas-toolbar-hint, canvas, table').forEach((item) => item.remove());
    const text = (wrapper.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 720);

    return {
        image: /^data:image\/png;base64,/i.test(image) ? image : '',
        text
    };
}

function findKediMapNodeForBox(box) {
    const nodeId = box?.dataset?.nodeId;
    if (!nodeId || !Array.isArray(window.activeMapNodes)) return null;
    return window.activeMapNodes.find((node) => String(node.id) === String(nodeId)) || null;
}

function refreshKediMapNodeCanvasPreview(box, content = null) {
    if (!box?.isConnected) return;

    const node = findKediMapNodeForBox(box);
    const parsed = parseKediNodePreviewContent(content ?? node?.content ?? '');
    const preview = box.querySelector('.map-node-preview');
    if (!preview) return;

    preview.querySelector('.kedi-map-node-canvas-preview')?.remove();
    preview.classList.remove('has-canvas-preview');

    if (!parsed.image) return;

    const image = document.createElement('img');
    image.className = 'kedi-map-node-canvas-preview';
    image.alt = '';
    image.src = parsed.image;
    preview.textContent = '';
    preview.classList.add('has-canvas-preview');
    preview.appendChild(image);
}

function refreshAllKediMapNodeCanvasPreviews() {
    document.querySelectorAll('.map-node-box').forEach((box) => {
        refreshKediMapNodeCanvasPreview(box);
    });
}

function hideKediNodeHoverPreview() {
    clearTimeout(kediNodePreviewTimer);
    kediNodePreviewTimer = null;
    kediNodePreviewRequest += 1;

    const layer = document.getElementById('kedi-node-hover-preview');
    if (layer) {
        layer.hidden = true;
        layer.innerHTML = '';
    }
}

function positionKediNodeHoverPreview(layer, box) {
    const boxRect = box.getBoundingClientRect();
    const gap = 12;
    const layerRect = layer.getBoundingClientRect();

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

async function showKediNodeHoverPreview(box) {
    if (!box?.isConnected || box.classList.contains('dragging')) return;

    const requestId = ++kediNodePreviewRequest;
    const nodePath = box.dataset.nodePath;
    let node = findKediMapNodeForBox(box);
    let title = node?.metadata?.title || node?.fileName?.replace(/\.node$/i, '') || 'Node';
    let content = node?.content || '';

    try {
        const result = await window.kediProject?.getKediDocument?.(nodePath);
        if (requestId !== kediNodePreviewRequest || !box.matches(':hover')) return;

        if (result?.ok) {
            title = result.metadata?.title || title;
            content = result.data?.content || result.content || '';

            if (node) {
                node.content = content;
                node.preview = typeof stripPreviewText === 'function'
                    ? stripPreviewText(content)
                    : node.preview;
            }
            refreshKediMapNodeCanvasPreview(box, content);
        }
    } catch (error) {
        console.warn('[KEDI] Node önizlemesi yüklenemedi:', error);
    }

    if (requestId !== kediNodePreviewRequest || !box.matches(':hover')) return;

    const parsed = parseKediNodePreviewContent(content);
    const layer = getKediNodePreviewLayer();
    layer.innerHTML = '';

    const heading = document.createElement('h3');
    heading.className = 'kedi-node-hover-preview-title';
    heading.textContent = title;
    layer.appendChild(heading);

    if (parsed.image) {
        const image = document.createElement('img');
        image.className = 'kedi-node-hover-preview-image';
        image.alt = `${title} tuval önizlemesi`;
        image.src = parsed.image;
        layer.appendChild(image);
    }

    const text = document.createElement('div');
    text.className = parsed.text
        ? 'kedi-node-hover-preview-text'
        : 'kedi-node-hover-preview-empty';
    text.textContent = parsed.text || (parsed.image ? 'Bu node yalnızca bir tuval içeriyor.' : 'Bu node henüz boş.');
    layer.appendChild(text);

    layer.hidden = false;
    positionKediNodeHoverPreview(layer, box);
}

function scheduleKediNodeHoverPreview(box) {
    hideKediNodeHoverPreview();
    const requestId = kediNodePreviewRequest;

    kediNodePreviewTimer = setTimeout(() => {
        if (requestId !== kediNodePreviewRequest || !box.matches(':hover')) return;
        showKediNodeHoverPreview(box);
    }, KEDI_NODE_PREVIEW_DELAY_MS);
}

function bindKediMapNodePreviewEvents() {
    if (document.body.dataset.kediNodePreviewBound === '1') return;
    document.body.dataset.kediNodePreviewBound = '1';

    document.addEventListener('mouseover', (event) => {
        const box = event.target.closest?.('.map-node-box');
        if (!box || box.contains(event.relatedTarget)) return;
        scheduleKediNodeHoverPreview(box);
    });

    document.addEventListener('mouseout', (event) => {
        const box = event.target.closest?.('.map-node-box');
        if (!box || box.contains(event.relatedTarget)) return;
        hideKediNodeHoverPreview();
    });

    document.addEventListener('mousedown', hideKediNodeHoverPreview, true);
    window.addEventListener('blur', hideKediNodeHoverPreview);
    window.addEventListener('resize', hideKediNodeHoverPreview);

    const board = document.getElementById('map-board');
    if (board) {
        const observer = new MutationObserver(() => {
            requestAnimationFrame(refreshAllKediMapNodeCanvasPreviews);
        });
        observer.observe(board, { childList: true, subtree: true });
    }

    refreshAllKediMapNodeCanvasPreviews();
}

function setupKediNodePreviews() {
    installKediNodePreviewStyles();
    bindKediMapNodePreviewEvents();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bindNodeModalControls();
        setupKediNodePreviews();
    });
} else {
    bindNodeModalControls();
    setupKediNodePreviews();
}
