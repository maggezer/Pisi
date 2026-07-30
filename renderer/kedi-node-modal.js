function bindNodeModalControls() {
    const closeModalBtn = document.getElementById('node-modal-close');
    const overlay = document.getElementById('node-modal-overlay');

    if (closeModalBtn && closeModalBtn.dataset.bound !== '1') {
        closeModalBtn.dataset.bound = '1';
        closeModalBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const saved = await closeNodeModalAndSave();
            if (saved) refreshAllKediMapNodePreviewsFromDisk();
        });
    }

    if (overlay && overlay.dataset.bound !== '1') {
        overlay.dataset.bound = '1';
        overlay.addEventListener('mousedown', async (event) => {
            if (event.target !== overlay) return;
            const saved = await closeNodeModalAndSave();
            if (saved) refreshAllKediMapNodePreviewsFromDisk();
        });
    }

    if (document.body.dataset.nodeModalEscBound !== '1') {
        document.body.dataset.nodeModalEscBound = '1';
        document.addEventListener('keydown', async (event) => {
            const modalOverlay = document.getElementById('node-modal-overlay');
            if (!modalOverlay?.classList.contains('visible')) return;

            if (event.key === 'Tab') {
                const focusable = Array.from(modalOverlay.querySelectorAll(
                    'button:not([disabled]), input:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
                )).filter((element) => !element.hidden);

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
            const saved = await closeNodeModalAndSave();
            if (saved) refreshAllKediMapNodePreviewsFromDisk();
        });
    }
}

const KEDI_NODE_PREVIEW_DELAY_MS = 1500;
let kediNodePreviewTimer = null;
let kediNodePreviewRequest = 0;

function hideKediCanvasHints(root = document) {
    if (root.matches?.('.kedi-canvas-toolbar-hint')) root.hidden = true;
    root.querySelectorAll?.('.kedi-canvas-toolbar-hint').forEach((hint) => {
        hint.hidden = true;
        hint.style.display = 'none';
    });
}

function parseKediNodePreviewContent(content = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(content || '');
    wrapper.querySelectorAll('script, style, iframe, object, embed').forEach((item) => item.remove());

    const firstCanvas = wrapper.querySelector('canvas[data-kedi-canvas][data-image]');
    const rawImage = firstCanvas?.getAttribute('data-image') || '';

    wrapper.querySelectorAll('.kedi-canvas-toolbar-hint, canvas, table').forEach((item) => item.remove());
    const text = (wrapper.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 720);

    return {
        image: /^data:image\/png;base64,/i.test(rawImage) ? rawImage : '',
        text
    };
}

function findKediMapNodeForBox(box) {
    const nodeId = box?.dataset?.nodeId;
    if (!nodeId || !Array.isArray(window.activeMapNodes)) return null;
    return window.activeMapNodes.find((node) => String(node.id) === String(nodeId)) || null;
}

function styleKediCanvasThumbnail(image) {
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

function refreshKediMapNodeCanvasPreview(box, content = null) {
    if (!box?.isConnected) return;

    const node = findKediMapNodeForBox(box);
    const parsed = parseKediNodePreviewContent(content ?? node?.content ?? '');
    const preview = box.querySelector('.map-node-preview');
    if (!preview) return;

    preview.querySelector('.kedi-map-node-canvas-preview')?.remove();
    preview.style.padding = '';

    if (!parsed.image) {
        preview.textContent = node?.preview || parsed.text || '';
        return;
    }

    const image = document.createElement('img');
    image.className = 'kedi-map-node-canvas-preview';
    image.alt = '';
    image.src = parsed.image;
    styleKediCanvasThumbnail(image);

    preview.textContent = '';
    preview.style.padding = '5px 7px 7px';
    preview.appendChild(image);
}

async function refreshKediMapNodePreviewFromDisk(box) {
    if (!box?.isConnected || !box.dataset.nodePath) return;

    try {
        const result = await window.kediProject?.getKediDocument?.(box.dataset.nodePath);
        if (!result?.ok || !box.isConnected) return;

        const content = result.data?.content || result.content || '';
        const node = findKediMapNodeForBox(box);
        if (node) {
            node.content = content;
            node.metadata = result.metadata || node.metadata;
        }
        refreshKediMapNodeCanvasPreview(box, content);
    } catch (error) {
        console.warn('[KEDI] Node küçük önizlemesi yenilenemedi:', error);
    }
}

function refreshAllKediMapNodePreviewsFromDisk() {
    document.querySelectorAll('.map-node-box').forEach((box) => {
        refreshKediMapNodePreviewFromDisk(box);
    });
}

function styleKediHoverLayer(layer) {
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

function getKediNodePreviewLayer() {
    let layer = document.getElementById('kedi-node-hover-preview');
    if (layer) return layer;

    layer = document.createElement('aside');
    layer.id = 'kedi-node-hover-preview';
    layer.hidden = true;
    layer.setAttribute('aria-live', 'polite');
    styleKediHoverLayer(layer);
    document.body.appendChild(layer);
    return layer;
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

function appendKediHoverPreviewContent(layer, title, parsed) {
    const heading = document.createElement('h3');
    heading.textContent = title;
    Object.assign(heading.style, {
        margin: '0 0 9px',
        color: 'var(--kedi-map-node-title-color, #f39c12)',
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
    text.textContent = parsed.text || (parsed.image
        ? 'Bu node yalnızca bir tuval içeriyor.'
        : 'Bu node henüz boş.');
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

async function showKediNodeHoverPreview(box) {
    if (!box?.isConnected || box.classList.contains('dragging')) return;

    const requestId = ++kediNodePreviewRequest;
    let node = findKediMapNodeForBox(box);
    let title = node?.metadata?.title || node?.fileName?.replace(/\.node$/i, '') || 'Node';
    let content = node?.content || '';

    try {
        const result = await window.kediProject?.getKediDocument?.(box.dataset.nodePath);
        if (requestId !== kediNodePreviewRequest || !box.matches(':hover')) return;

        if (result?.ok) {
            title = result.metadata?.title || title;
            content = result.data?.content || result.content || '';
            if (node) {
                node.content = content;
                node.metadata = result.metadata || node.metadata;
            }
            refreshKediMapNodeCanvasPreview(box, content);
        }
    } catch (error) {
        console.warn('[KEDI] Node önizlemesi yüklenemedi:', error);
    }

    if (requestId !== kediNodePreviewRequest || !box.matches(':hover')) return;

    const layer = getKediNodePreviewLayer();
    layer.innerHTML = '';
    appendKediHoverPreviewContent(layer, title, parseKediNodePreviewContent(content));
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

function processKediPreviewAddedNode(addedNode) {
    if (!(addedNode instanceof Element)) return;
    hideKediCanvasHints(addedNode);

    if (addedNode.matches('.map-node-box')) {
        refreshKediMapNodeCanvasPreview(addedNode);
    }
    addedNode.querySelectorAll?.('.map-node-box').forEach((box) => {
        refreshKediMapNodeCanvasPreview(box);
    });
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

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach(processKediPreviewAddedNode);
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    hideKediCanvasHints();
    document.querySelectorAll('.map-node-box').forEach((box) => {
        refreshKediMapNodeCanvasPreview(box);
    });
}

function setupKediNodePreviews() {
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
