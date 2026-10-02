import { registerModule } from '../core/module-registry.mjs';

const PISI_MAP_EXPORT_PADDING = 220;
const PISI_MAP_EXPORT_MAX_DIMENSION = 8192;
const PISI_MAP_EXPORT_MAX_PIXELS = 30_000_000;
let pisiMapExportMeasureContext = null;

function escapePisiMapExportXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getPisiMapExportNumber(value, fallback = 0) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : fallback;
}

function getPisiMapExportColor(value, fallback) {
    const color = String(value || '').trim();
    return !color || color === 'none' || color === 'transparent' || color === 'rgba(0, 0, 0, 0)' ? fallback : color;
}

function isPisiMapExportNodeVisible(box) {
    if (!box || box.hidden || box.getAttribute('aria-hidden') === 'true') {
        return false;
    }

    if (box.classList.contains('pisi-hub-descendant-hidden')) return false;
    return getComputedStyle(box).display !== 'none';
}

function collectPisiMapExportNodes() {
    return [...document.querySelectorAll('#map-board .map-node-box[data-node-id]')].filter(isPisiMapExportNodeVisible).map((box) => {
        const titleEl = box.querySelector('.map-node-title');
        const previewEl = box.querySelector('.map-node-preview');
        const boxStyle = getComputedStyle(box);
        const titleStyle = titleEl ? getComputedStyle(titleEl) : boxStyle;
        const previewStyle = previewEl ? getComputedStyle(previewEl) : boxStyle;
        const width = Math.max(1, getPisiMapExportNumber(box.style.width, box.offsetWidth || 220));
        const height = Math.max(1, getPisiMapExportNumber(box.style.height, box.offsetHeight || 92));

        return {
            id: String(box.dataset.nodeId || ''),
            x: getPisiMapExportNumber(box.style.left, box.offsetLeft || 0),
            y: getPisiMapExportNumber(box.style.top, box.offsetTop || 0),
            width,
            height,
            title: titleEl?.textContent?.trim() || 'Node',
            preview: previewEl?.textContent?.trim() || '',
            boxColor: getPisiMapExportColor(boxStyle.backgroundColor, '#252526'),
            titleColor: getPisiMapExportColor(titleStyle.color, '#f39c12'),
            previewColor: getPisiMapExportColor(previewStyle.color, '#aaaaaa'),
            titleFontFamily: titleStyle.fontFamily || '"Segoe UI", sans-serif',
            previewFontFamily: previewStyle.fontFamily || '"Segoe UI", sans-serif',
            titleFontWeight: titleStyle.fontWeight || '800',
            previewFontWeight: previewStyle.fontWeight || '600',
            titleSize: Math.max(9, getPisiMapExportNumber(titleStyle.fontSize, 13)),
            previewSize: Math.max(8, getPisiMapExportNumber(previewStyle.fontSize, 12))
        };
    });
}

function getPisiMapExportBounds(nodes) {
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));

    return {
        x: Math.floor(minX - PISI_MAP_EXPORT_PADDING),
        y: Math.floor(minY - PISI_MAP_EXPORT_PADDING),
        width: Math.max(1, Math.ceil(maxX - minX + PISI_MAP_EXPORT_PADDING * 2)),
        height: Math.max(1, Math.ceil(maxY - minY + PISI_MAP_EXPORT_PADDING * 2))
    };
}

function getPisiMapExportPortPoint(node, port) {
    if (port === 'top') {
        return { x: node.x + node.width / 2, y: node.y };
    }
    if (port === 'right') {
        return { x: node.x + node.width, y: node.y + node.height / 2 };
    }
    if (port === 'bottom') {
        return { x: node.x + node.width / 2, y: node.y + node.height };
    }
    return { x: node.x, y: node.y + node.height / 2 };
}

function getPisiMapExportPortDirection(port) {
    if (port === 'top') return { x: 0, y: -1 };
    if (port === 'right') return { x: 1, y: 0 };
    if (port === 'bottom') return { x: 0, y: 1 };
    return { x: -1, y: 0 };
}

function offsetPisiMapExportPoint(point, direction, distance) {
    return {
        x: point.x + direction.x * distance,
        y: point.y + direction.y * distance
    };
}

function makePisiMapExportConnectionPath(sourceNode, sourcePort, targetNode, targetPort, edgeType) {
    const sourceDirection = getPisiMapExportPortDirection(sourcePort);
    const targetDirection = getPisiMapExportPortDirection(targetPort);
    const source = offsetPisiMapExportPoint(getPisiMapExportPortPoint(sourceNode, sourcePort), sourceDirection, edgeType === 'co-level' ? 9 : 2);
    const target = offsetPisiMapExportPoint(getPisiMapExportPortPoint(targetNode, targetPort), targetDirection, 9);
    const distance = Math.hypot(target.x - source.x, target.y - source.y);
    const control = Math.max(40, Math.min(180, distance * 0.38));
    const c1 = offsetPisiMapExportPoint(source, sourceDirection, control);
    const c2 = offsetPisiMapExportPoint(target, targetDirection, control);

    return `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ` + `${c2.x} ${c2.y}, ${target.x} ${target.y}`;
}

function getPisiMapExportMeasureContext() {
    if (pisiMapExportMeasureContext) return pisiMapExportMeasureContext;
    pisiMapExportMeasureContext = document.createElement('canvas').getContext('2d');
    return pisiMapExportMeasureContext;
}

function fitPisiMapExportLine(text, maxWidth, font) {
    const value = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    const context = getPisiMapExportMeasureContext();
    if (!value || !context) return value;
    context.font = font;
    if (context.measureText(value).width <= maxWidth) return value;

    let low = 0;
    let high = value.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = `${value.slice(0, middle).trimEnd()}…`;
        if (context.measureText(candidate).width <= maxWidth) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return `${value.slice(0, low).trimEnd()}…`;
}

function wrapPisiMapExportText(text, maxWidth, font, maxLines) {
    const context = getPisiMapExportMeasureContext();
    const paragraphs = String(text || '').split(/\r?\n/);
    if (!context || maxLines < 1) return [];
    context.font = font;
    const lines = [];

    for (const paragraph of paragraphs) {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        if (!words.length) continue;
        let line = '';

        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (context.measureText(candidate).width <= maxWidth) {
                line = candidate;
                continue;
            }

            if (line) lines.push(line);
            line = context.measureText(word).width <= maxWidth ? word : fitPisiMapExportLine(word, maxWidth, font);
            if (lines.length >= maxLines) break;
        }

        if (lines.length < maxLines && line) lines.push(line);
        if (lines.length >= maxLines) break;
    }

    if (lines.length === maxLines) {
        const sourceWords = String(text || '')
            .trim()
            .split(/\s+/).length;
        const lineWords = lines.join(' ').trim().split(/\s+/).length;
        if (sourceWords > lineWords && !lines[maxLines - 1].endsWith('…')) {
            lines[maxLines - 1] = fitPisiMapExportLine(`${lines[maxLines - 1]}…`, maxWidth, font);
        }
    }
    return lines;
}

function getPisiMapExportEdgeColor(edge, livePath, isLight) {
    const fallback = edge.type === 'co-level' ? '#34ace0' : edge.type === 'stream' ? '#2ecc71' : '#f39c12';
    return getPisiMapExportColor(livePath ? getComputedStyle(livePath).stroke : '', isLight && edge.type === 'down-hub' ? '#c97900' : fallback);
}

function buildPisiMapExportSvg() {
    const nodes = collectPisiMapExportNodes();
    if (!nodes.length) {
        return { ok: false, error: 'Dışa aktarılacak görünür node yok.' };
    }

    const bounds = getPisiMapExportBounds(nodes);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const isLight = document.documentElement.dataset.pisiTheme === 'light';
    const background = isLight ? '#e7e9ec' : '#1e1e1e';
    const grid = isLight ? '#cfd4da' : '#333333';
    const cardBorder = isLight ? '#b9c0c8' : '#444444';
    const titleDivider = isLight ? '#cbd0d6' : '#333333';
    const edges = typeof activeMapEdges !== 'undefined' && Array.isArray(activeMapEdges) ? activeMapEdges : [];
    const markerDefs = [];
    const edgeMarkup = [];

    edges.forEach((edge, index) => {
        const sourceNode = nodeById.get(String(edge.sourceId || ''));
        const targetNode = nodeById.get(String(edge.targetId || ''));
        if (!sourceNode || !targetNode) return;

        const selector = `.map-edge-group[data-edge-id="${CSS.escape(String(edge.id || ''))}"] .map-edge`;
        const livePath = document.querySelector(selector);
        if (!livePath) return;

        const type = ['co-level', 'stream'].includes(edge.type) ? edge.type : 'down-hub';
        const color = getPisiMapExportEdgeColor(edge, livePath, isLight);
        const markerId = `pisi-export-arrow-${index}`;
        const pathData = makePisiMapExportConnectionPath(sourceNode, edge.sourcePort || 'right', targetNode, edge.targetPort || 'left', type);

        markerDefs.push(
            `<marker id="${markerId}" viewBox="0 0 10 10" refX="9" ` +
                'refY="5" markerWidth="4" markerHeight="4" ' +
                'orient="auto-start-reverse" markerUnits="strokeWidth">' +
                `<path d="M 0 0 L 10 5 L 0 10 z" fill="${escapePisiMapExportXml(color)}"/></marker>`
        );
        edgeMarkup.push(
            `<path d="${pathData}" fill="none" stroke="${escapePisiMapExportXml(color)}" stroke-width="2.7" stroke-linecap="round" ` +
                `stroke-linejoin="round" marker-end="url(#${markerId})"` +
                (type === 'co-level' ? ` marker-start="url(#${markerId})"` : '') +
                '/>'
        );
    });

    const nodeMarkup = nodes
        .map((node) => {
            const titleFont = `${node.titleFontWeight} ${node.titleSize}px ${node.titleFontFamily}`;
            const previewFont = `${node.previewFontWeight} ${node.previewSize}px ${node.previewFontFamily}`;
            const title = fitPisiMapExportLine(node.title, Math.max(20, node.width - 32), titleFont);
            const previewLines = wrapPisiMapExportText(
                node.preview,
                Math.max(20, node.width - 24),
                previewFont,
                Math.max(0, Math.floor((node.height - 49) / (node.previewSize * 1.4)))
            );
            const previewTspans = previewLines
                .map((line, index) => `<tspan x="${node.x + 12}" dy="${index === 0 ? 0 : node.previewSize * 1.4}">${escapePisiMapExportXml(line)}</tspan>`)
                .join('');

            return (
                `<g filter="url(#pisi-export-card-shadow)">` +
                `<rect x="${node.x}" y="${node.y}" width="${node.width}" ` +
                `height="${node.height}" rx="10" fill="${escapePisiMapExportXml(node.boxColor)}" stroke="${cardBorder}"/>` +
                `<line x1="${node.x}" y1="${node.y + 30}" ` +
                `x2="${node.x + node.width}" y2="${node.y + 30}" ` +
                `stroke="${titleDivider}"/>` +
                `<text x="${node.x + node.width / 2}" y="${node.y + 20}" ` +
                `fill="${escapePisiMapExportXml(node.titleColor)}" ` +
                `font-family="${escapePisiMapExportXml(node.titleFontFamily)}" ` +
                `font-size="${node.titleSize}" font-weight="${escapePisiMapExportXml(node.titleFontWeight)}" text-anchor="middle">${escapePisiMapExportXml(
                    title
                )}</text>` +
                (previewTspans
                    ? `<text x="${node.x + 12}" y="${node.y + 49}" ` +
                      `fill="${escapePisiMapExportXml(node.previewColor)}" ` +
                      `font-family="${escapePisiMapExportXml(node.previewFontFamily)}" font-size="${node.previewSize}" font-weight="${escapePisiMapExportXml(
                          node.previewFontWeight
                      )}">${previewTspans}</text>`
                    : '') +
                '</g>'
            );
        })
        .join('');

    const mapTitle =
        typeof activeMapPath !== 'undefined'
            ? String(activeMapPath || '')
                  .split(/[\\/]/)
                  .pop()
                  ?.replace(/\.map$/i, '')
            : 'Pisi Map';
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `width="${bounds.width}" height="${bounds.height}" ` +
        `viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">` +
        `<title>${escapePisiMapExportXml(mapTitle || 'Pisi Map')}</title>` +
        '<defs>' +
        `<pattern id="pisi-export-grid" width="28" height="28" ` +
        'patternUnits="userSpaceOnUse">' +
        `<circle cx="1" cy="1" r="1" fill="${grid}"/></pattern>` +
        '<filter id="pisi-export-card-shadow" x="-30%" y="-30%" ' +
        'width="160%" height="180%"><feDropShadow dx="0" dy="7" ' +
        'stdDeviation="9" flood-color="#000000" flood-opacity="0.28"/>' +
        '</filter>' +
        markerDefs.join('') +
        '</defs>' +
        `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" ` +
        `height="${bounds.height}" fill="${background}"/>` +
        `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" ` +
        'height="${bounds.height}" fill="url(#pisi-export-grid)"/>' +
        `<g>${edgeMarkup.join('')}</g><g>${nodeMarkup}</g></svg>`;

    return {
        ok: true,
        svg,
        width: bounds.width,
        height: bounds.height,
        nodeCount: nodes.length
    };
}

function readPisiMapExportBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('PNG verisi okunamadı.'));
        reader.readAsDataURL(blob);
    });
}

async function rasterizePisiMapExportSvg(svg, width, height) {
    const baseScale = 2;
    const scale = Math.max(
        0.01,
        Math.min(
            baseScale,
            PISI_MAP_EXPORT_MAX_DIMENSION / width,
            PISI_MAP_EXPORT_MAX_DIMENSION / height,
            Math.sqrt(PISI_MAP_EXPORT_MAX_PIXELS / (width * height))
        )
    );
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const sizedSvg = svg.replace(/width="[^"]+" height="[^"]+"/, `width="${outputWidth}" height="${outputHeight}"`);
    const objectUrl = URL.createObjectURL(new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' }));

    try {
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Harita görseli oluşturulamadı.'));
            image.src = objectUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PNG çizim alanı oluşturulamadı.');
        context.drawImage(image, 0, 0, outputWidth, outputHeight);
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG dosyası oluşturulamadı.'))), 'image/png');
        });
        return readPisiMapExportBlobAsDataUrl(blob);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function closePisiMapExportMenu({ restoreFocus = false } = {}) {
    const control = document.getElementById('pisi-map-export-control');
    const trigger = control?.querySelector('.pisi-map-export-trigger');
    const menu = control?.querySelector('.pisi-map-export-menu');
    if (!trigger || !menu) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
}

function syncPisiMapExportControl() {
    const control = ensurePisiMapExportControl();
    if (!control) return;
    const canvas = document.getElementById('map-canvas');
    const hasMap = typeof activeMapPath !== 'undefined' && Boolean(activeMapPath);
    control.hidden = !hasMap || Boolean(canvas?.hidden);
    const trigger = control.querySelector('.pisi-map-export-trigger');
    if (trigger && trigger.getAttribute('aria-busy') !== 'true') {
        trigger.disabled = !hasMap;
    }
    if (!hasMap) closePisiMapExportMenu();
}

async function exportCurrentPisiMap(format) {
    const normalized = String(format || '').toLowerCase();
    if (!['png', 'pdf'].includes(normalized)) return;
    const mapPath = typeof activeMapPath !== 'undefined' ? activeMapPath : null;
    if (!mapPath) return;

    const control = document.getElementById('pisi-map-export-control');
    const trigger = control?.querySelector('.pisi-map-export-trigger');
    closePisiMapExportMenu();
    if (trigger) {
        trigger.disabled = true;
        trigger.setAttribute('aria-busy', 'true');
        trigger.title = window.pisiT?.('Dışa aktarılıyor…') || 'Dışa aktarılıyor…';
    }

    try {
        const snapshot = buildPisiMapExportSvg();
        if (!snapshot.ok) {
            alert(snapshot.error || 'Harita dışa aktarılamadı.');
            return;
        }
        const payload = {
            format: normalized,
            svg: snapshot.svg,
            width: snapshot.width,
            height: snapshot.height
        };
        if (normalized === 'png') {
            payload.pngDataUrl = await rasterizePisiMapExportSvg(snapshot.svg, snapshot.width, snapshot.height);
        }

        const result = await window.pisiProject?.exportMap?.(mapPath, payload);
        if (!result?.ok && !result?.canceled) {
            alert(result?.error || 'Harita dışa aktarılamadı.');
        }
    } catch (error) {
        console.error('[Pisi] Map export failed:', error);
        alert(error?.message || 'Harita dışa aktarılamadı.');
    } finally {
        if (trigger) {
            trigger.removeAttribute('aria-busy');
            trigger.title = window.pisiT?.('Haritayı dışa aktar') || 'Haritayı dışa aktar';
        }
        syncPisiMapExportControl();
    }
}

function ensurePisiMapExportControl() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return null;
    let control = document.getElementById('pisi-map-export-control');
    if (control) return control;

    control = document.createElement('div');
    control.id = 'pisi-map-export-control';
    control.className = 'pisi-map-overlay-control';
    control.hidden = true;
    control.innerHTML = `
        <button type="button" class="pisi-map-export-trigger"
            aria-haspopup="menu" aria-expanded="false">
            <span class="pisi-map-export-icon" aria-hidden="true"></span>
        </button>
        <div class="pisi-map-export-menu" role="menu" hidden>
            <button type="button" class="pisi-map-export-option"
                role="menuitem" data-map-export-format="png">
                <span class="pisi-map-export-format">PNG</span>
                <span data-pisi-export-label="png"></span>
            </button>
            <button type="button" class="pisi-map-export-option"
                role="menuitem" data-map-export-format="pdf">
                <span class="pisi-map-export-format">PDF</span>
                <span data-pisi-export-label="pdf"></span>
            </button>
        </div>`;

    const stopMapInteraction = (event) => event.stopPropagation();
    ['pointerdown', 'mousedown', 'dblclick', 'contextmenu'].forEach((name) => {
        control.addEventListener(name, stopMapInteraction);
    });
    const trigger = control.querySelector('.pisi-map-export-trigger');
    const menu = control.querySelector('.pisi-map-export-menu');
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) menu.querySelector('.pisi-map-export-option')?.focus();
    });
    control.querySelectorAll('[data-map-export-format]').forEach((button) => {
        button.addEventListener('click', () => {
            exportCurrentPisiMap(button.dataset.mapExportFormat);
        });
    });
    canvas.appendChild(control);
    updatePisiMapExportTranslations();
    return control;
}

function updatePisiMapExportTranslations() {
    const control = document.getElementById('pisi-map-export-control');
    if (!control) return;
    const translate = window.pisiT || ((value) => value);
    const trigger = control.querySelector('.pisi-map-export-trigger');
    const title = translate('Haritayı dışa aktar');
    trigger.title = title;
    trigger.setAttribute('aria-label', title);
    const pngLabel = control.querySelector('[data-pisi-export-label="png"]');
    const pdfLabel = control.querySelector('[data-pisi-export-label="pdf"]');
    if (pngLabel) pngLabel.textContent = translate('PNG olarak dışa aktar');
    if (pdfLabel) pdfLabel.textContent = translate('PDF olarak dışa aktar');
}

function initializePisiMapExport() {
    ensurePisiMapExportControl();
    syncPisiMapExportControl();
    document.addEventListener('pisi:map-customization-context-changed', syncPisiMapExportControl);
    document.addEventListener('pisi:language-changed', () => {
        updatePisiMapExportTranslations();
        syncPisiMapExportControl();
    });
    document.addEventListener('mousedown', (event) => {
        if (!event.target.closest?.('#pisi-map-export-control')) {
            closePisiMapExportMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePisiMapExportMenu({ restoreFocus: true });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiMapExport, {
        once: true
    });
} else {
    initializePisiMapExport();
}

registerModule('map.export', {
    escapePisiMapExportXml,
    collectPisiMapExportNodes,
    getPisiMapExportBounds,
    makePisiMapExportConnectionPath,
    buildPisiMapExportSvg,
    rasterizePisiMapExportSvg,
    closePisiMapExportMenu,
    syncPisiMapExportControl,
    exportCurrentPisiMap,
    ensurePisiMapExportControl,
    updatePisiMapExportTranslations,
    initializePisiMapExport
});
