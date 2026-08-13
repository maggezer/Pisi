import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommand } from "../core/pisi-command-registry.mjs";
import { registerPisiCommandCenterPage } from "../shell/pisi-command-center.mjs";
import { normalizePisiSearchText, pisiSearchPathKey } from "./pisi-search-core.mjs";
import {
    ensurePisiSearchIndex,
    getPisiSearchCurrentNodePath,
    getPisiSearchLiveIndex
} from "./pisi-search-index.mjs";
import { openPisiSearchResult } from "./pisi-global-search.mjs";

function pisiBlockGraphTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function getPisiBlockGraphKey(path, blockId) {
    return `${pisiSearchPathKey(path)}#${String(blockId || '').toLowerCase()}`;
}

function collectPisiBlockGraphData(index) {
    const nodes = new Map();
    const byBlockId = new Map();
    const documents = Array.from(index?.documents?.values?.() || []);
    for (const documentRecord of documents) {
        for (const block of documentRecord.contentBlocks || []) {
            if (!block.blockId) continue;
            const key = getPisiBlockGraphKey(documentRecord.path, block.blockId);
            const node = {
                key,
                path: documentRecord.path,
                relativePath: documentRecord.relativePath,
                nodeTitle: documentRecord.title,
                nodeItem: documentRecord.nodeItem,
                membership: documentRecord.memberships?.[0] || null,
                blockId: block.blockId,
                blockType: block.blockType || 'paragraph',
                text: block.text || pisiBlockGraphTranslate('(boş blok)'),
                references: block.references || [],
                order: block.order || 0
            };
            nodes.set(key, node);
            if (!byBlockId.has(node.blockId)) byBlockId.set(node.blockId, []);
            byBlockId.get(node.blockId).push(node);
        }
    }

    const resolveDocument = (token, sourceNode) => {
        if (!token) return null;
        const pathToken = pisiSearchPathKey(token);
        const textToken = normalizePisiSearchText(String(token).replace(/\.node$/i, ''));
        return documents.find((documentRecord) => {
            return [
                documentRecord.path,
                documentRecord.relativePath,
                documentRecord.fileName
            ].some((value) => pisiSearchPathKey(value) === pathToken) ||
                normalizePisiSearchText(documentRecord.title) === textToken ||
                normalizePisiSearchText(documentRecord.fileName?.replace(/\.node$/i, '')) === textToken;
        }) || (pisiSearchPathKey(sourceNode.relativePath) === pathToken
            ? documents.find((item) => item.path === sourceNode.path)
            : null);
    };

    const edges = [];
    const seenEdges = new Set();
    for (const source of nodes.values()) {
        for (const reference of source.references) {
            let target = null;
            const targetDocument = resolveDocument(reference.target, source);
            if (targetDocument) {
                target = nodes.get(getPisiBlockGraphKey(
                    targetDocument.path,
                    reference.blockId
                ));
            }
            if (!target && !reference.target) {
                const sameDocument = nodes.get(getPisiBlockGraphKey(
                    source.path,
                    reference.blockId
                ));
                target = sameDocument || (byBlockId.get(reference.blockId)?.length === 1
                    ? byBlockId.get(reference.blockId)[0]
                    : null);
            }
            if (!target) continue;
            const edgeKey = `${source.key}>${target.key}:${reference.kind}`;
            if (seenEdges.has(edgeKey)) continue;
            seenEdges.add(edgeKey);
            edges.push({
                key: edgeKey,
                source: source.key,
                target: target.key,
                kind: reference.kind || 'reference'
            });
        }
    }
    return { nodes, edges };
}

function buildPisiBlockRelationshipModel(index, targetPath, blockId = null) {
    const graph = collectPisiBlockGraphData(index);
    const pathKey = pisiSearchPathKey(targetPath);
    const targetKey = blockId ? getPisiBlockGraphKey(targetPath, blockId) : null;
    const target = targetKey ? graph.nodes.get(targetKey) || null : null;
    const localNodes = Array.from(graph.nodes.values()).filter((node) => {
        return pisiSearchPathKey(node.path) === pathKey;
    });
    const selectedKeys = new Set(target ? [target.key] : localNodes.map((node) => node.key));
    const inbound = [];
    const outbound = [];
    const mentions = [];
    const relevantEdges = graph.edges.filter((edge) => {
        const touchesSource = selectedKeys.has(edge.source);
        const touchesTarget = selectedKeys.has(edge.target);
        if (touchesSource) {
            const node = graph.nodes.get(edge.target);
            if (node) outbound.push({ ...node, relationKind: edge.kind });
        }
        if (touchesTarget) {
            const node = graph.nodes.get(edge.source);
            if (node) {
                inbound.push({ ...node, relationKind: edge.kind });
                if (edge.kind === 'mention') mentions.push({ ...node, relationKind: edge.kind });
            }
        }
        return touchesSource || touchesTarget;
    });
    const visibleKeys = new Set(selectedKeys);
    relevantEdges.forEach((edge) => {
        visibleKeys.add(edge.source);
        visibleKeys.add(edge.target);
    });
    return {
        target,
        localNodes,
        nodes: Array.from(visibleKeys).map((key) => graph.nodes.get(key)).filter(Boolean),
        edges: relevantEdges,
        inbound,
        outbound,
        mentions
    };
}

function makePisiBlockResult(node) {
    return {
        kind: 'content',
        title: node.nodeTitle,
        nodeTitle: node.nodeTitle,
        nodePath: node.path,
        nodeItem: node.nodeItem,
        mapPath: node.membership?.mapPath || null,
        mapTitle: node.membership?.mapTitle || '',
        mapItem: node.membership?.mapItem || null,
        blockId: node.blockId,
        preview: node.text
    };
}

function makePisiBlockRelationList(title, items) {
    const section = document.createElement('section');
    section.className = 'pisi-block-relation-section';
    const heading = document.createElement('h3');
    heading.textContent = `${pisiBlockGraphTranslate(title)} (${items.length})`;
    section.appendChild(heading);
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-block-relation-empty';
        empty.textContent = pisiBlockGraphTranslate('Kayıt yok');
        section.appendChild(empty);
        return section;
    }
    for (const item of items.slice(0, 100)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-block-relation-item';
        const titleElement = document.createElement('strong');
        titleElement.textContent = item.nodeTitle;
        const preview = document.createElement('span');
        preview.textContent = item.text;
        const meta = document.createElement('small');
        const relationLabel = {
            reference: 'Referans',
            link: 'Bağlantı',
            mention: 'Bahsetme'
        }[item.relationKind] || 'Referans';
        meta.textContent = [
            pisiBlockGraphTranslate(relationLabel),
            item.membership?.mapTitle
        ].filter(Boolean).join(' · ');
        button.append(titleElement, preview, meta);
        button.addEventListener('click', () => void openPisiSearchResult(makePisiBlockResult(item)));
        section.appendChild(button);
    }
    return section;
}

function renderPisiBlockGraphSvg(host, model) {
    const width = Math.max(640, host.clientWidth || 760);
    const height = 430;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('pisi-block-graph-svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', pisiBlockGraphTranslate('Blok ilişki grafiği'));
    const nodes = model.nodes.slice(0, 60);
    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    const centerKey = model.target?.key || nodes[0]?.key;
    const positions = new Map();
    const centerX = width / 2;
    const centerY = height / 2;
    nodes.forEach((node, index) => {
        if (node.key === centerKey) {
            positions.set(node.key, { x: centerX, y: centerY });
            return;
        }
        const offset = centerKey && nodes.some((candidate) => candidate.key === centerKey) ? 1 : 0;
        const count = Math.max(1, nodes.length - offset);
        const angle = ((index - offset) / count) * Math.PI * 2 - Math.PI / 2;
        const radius = Math.min(width, height) * (index % 2 ? 0.38 : 0.29);
        positions.set(node.key, {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius
        });
    });
    for (const edge of model.edges) {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', source.x);
        line.setAttribute('y1', source.y);
        line.setAttribute('x2', target.x);
        line.setAttribute('y2', target.y);
        line.classList.add('pisi-block-graph-edge', `pisi-block-graph-edge-${edge.kind}`);
        svg.appendChild(line);
    }
    for (const [key, position] of positions) {
        const node = nodeByKey.get(key);
        if (!node) continue;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('pisi-block-graph-node');
        if (key === centerKey) group.classList.add('active');
        group.setAttribute('tabindex', '0');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', position.x - 82);
        rect.setAttribute('y', position.y - 27);
        rect.setAttribute('width', '164');
        rect.setAttribute('height', '54');
        rect.setAttribute('rx', '10');
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        title.setAttribute('x', position.x);
        title.setAttribute('y', position.y - 5);
        title.textContent = String(node.nodeTitle || '').slice(0, 22);
        const preview = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        preview.setAttribute('x', position.x);
        preview.setAttribute('y', position.y + 14);
        preview.classList.add('pisi-block-graph-node-preview');
        preview.textContent = String(node.text || '').slice(0, 28);
        group.append(rect, title, preview);
        const open = () => void openPisiSearchResult(makePisiBlockResult(node));
        group.addEventListener('click', open);
        group.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') open();
        });
        svg.appendChild(group);
    }
    host.appendChild(svg);
}

async function getPisiCurrentBlockModel() {
    const targetPath = getPisiSearchCurrentNodePath();
    if (!targetPath) return null;
    const index = await ensurePisiSearchIndex();
    if (!index) return null;
    const liveIndex = getPisiSearchLiveIndex(index, targetPath);
    const activeBlock = window.getPisiActiveBlock?.();
    return buildPisiBlockRelationshipModel(
        liveIndex,
        targetPath,
        activeBlock?.dataset?.pisiBlockId || null
    );
}

async function renderPisiBlockGraphPage(container) {
    const heading = document.createElement('div');
    heading.className = 'pisi-command-section-heading';
    const title = document.createElement('h2');
    title.textContent = pisiBlockGraphTranslate('Blok backlink, mention ve ilişki grafiği');
    heading.appendChild(title);
    container.appendChild(heading);
    const model = await getPisiCurrentBlockModel();
    if (!model) {
        const empty = document.createElement('div');
        empty.className = 'pisi-command-empty';
        empty.textContent = pisiBlockGraphTranslate('Blok ilişkilerini görmek için bir node açın.');
        container.appendChild(empty);
        return;
    }
    const graph = document.createElement('div');
    graph.className = 'pisi-block-graph-host';
    renderPisiBlockGraphSvg(graph, model);
    container.append(
        graph,
        makePisiBlockRelationList('Blok backlinkleri', model.inbound),
        makePisiBlockRelationList('Blok bağlantıları', model.outbound),
        makePisiBlockRelationList('Blok mention kayıtları', model.mentions)
    );
}

async function renderPisiBlockRelationshipPanel(container, options = {}) {
    container.classList.add('pisi-block-relationship-panel');
    const refresh = async () => {
        container.replaceChildren();
        if (options.showTitle !== false) {
            const title = document.createElement('div');
            title.className = 'right-panel-section-title';
            title.textContent = pisiBlockGraphTranslate('Blok referansları');
            container.appendChild(title);
        }
        const model = await getPisiCurrentBlockModel();
        if (!model) {
            const empty = document.createElement('div');
            empty.className = 'pisi-block-relation-empty';
            empty.textContent = pisiBlockGraphTranslate('Bir blok seçin');
            container.appendChild(empty);
            return;
        }
        const summary = document.createElement('div');
        summary.className = 'pisi-block-relation-summary';
        summary.textContent = model.target
            ? `${model.target.nodeTitle} · ${String(model.target.text || pisiBlockGraphTranslate('(boş blok)')).slice(0, 90)}`
            : pisiBlockGraphTranslate('Node içindeki bloklar');
        const openGraph = document.createElement('button');
        openGraph.type = 'button';
        openGraph.className = 'pisi-secondary-button';
        openGraph.textContent = pisiBlockGraphTranslate('Gelişmiş grafiği aç');
        openGraph.addEventListener('click', () => window.openPisiCommandCenter?.('block-graph'));
        container.append(
            summary,
            openGraph,
            makePisiBlockRelationList('Bu bloğa referans verenler', model.inbound),
            makePisiBlockRelationList('Bu bloğun referansları', model.outbound),
            makePisiBlockRelationList('Bahsetmeler', model.mentions)
        );
    };
    if (container.dataset.pisiBlockGraphBound !== '1') {
        container.dataset.pisiBlockGraphBound = '1';
        document.addEventListener('pisi:block-selected', refresh);
        document.addEventListener('pisi:search-index-ready', refresh);
        document.addEventListener('pisi:active-node-changed', refresh);
    }
    await refresh();
}

function initializePisiBlockGraph() {
    registerPisiCommandCenterPage({
        id: 'block-graph',
        label: 'Blok grafiği',
        order: 25,
        hidden: true,
        render: renderPisiBlockGraphPage
    });
    registerPisiCommand({
        id: 'pisi.block.graph',
        label: 'Blok ilişki grafiğini aç',
        description: 'Aktif blok için backlink, mention ve referans grafiğini gösterir.',
        category: 'Bağlantılar',
        defaultShortcut: 'Mod+Shift+G',
        allowInInput: true,
        handler: () => window.openPisiCommandCenter?.('block-graph')
    });
}

const moduleApi = {
    getPisiBlockGraphKey,
    collectPisiBlockGraphData,
    buildPisiBlockRelationshipModel,
    renderPisiBlockGraphSvg,
    renderPisiBlockGraphPage,
    renderPisiBlockRelationshipPanel,
    initializePisiBlockGraph
};

registerModule('search.blockGraph', moduleApi);
initializePisiBlockGraph();

export {
    buildPisiBlockRelationshipModel,
    collectPisiBlockGraphData,
    getPisiBlockGraphKey,
    renderPisiBlockGraphPage,
    renderPisiBlockGraphSvg,
    renderPisiBlockRelationshipPanel
};
