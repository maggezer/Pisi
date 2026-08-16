import { openPisiSearchResult } from '../search/pisi-global-search.mjs';
import {
    materializePisiDatabaseDocuments,
    normalizePisiPropertyCollection
} from './pisi-properties-core.mjs';
import {
    buildPisiBaseProjection,
    formatPisiBasePropertyValue,
    normalizePisiBaseDefinitions,
    normalizePisiBaseLayout
} from './pisi-bases-core.mjs';

const pisiBasesViewState = {
    layout: 'table',
    projectFolder: null,
    query: '',
    savedViews: []
};

function pisiBasesViewTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function makePisiBasesButton(label, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiBasesViewTranslate(label);
    return button;
}

function getPisiBasesNodeLabel(node) {
    return node?.metadata?.title ||
        String(node?.fileName || '').replace(/\.node$/i, '') ||
        node?.fullPath ||
        pisiBasesViewTranslate('Node');
}

function makePisiBasesDatabaseDocuments(nodes = [], mapPath = null) {
    return nodes.map((node) => ({
        ...node,
        path: node.fullPath,
        relativePath: node.fileName || node.fullPath,
        title: getPisiBasesNodeLabel(node),
        nodeItem: {
            ...node,
            name: node.fileName,
            type: 'file',
            isFile: true,
            isDirectory: false,
            mapPath
        },
        memberships: mapPath ? [{ mapPath }] : []
    }));
}

function collectPisiBasesFallbackDefinitions(nodes = []) {
    const definitions = new Map();
    for (const node of nodes) {
        for (const property of normalizePisiPropertyCollection(node?.properties)) {
            if (definitions.has(property.id)) continue;
            definitions.set(property.id, {
                id: property.id,
                name: property.name,
                type: property.type,
                system: property.system === true
            });
        }
    }
    return Array.from(definitions.values()).sort((a, b) => {
        const byName = a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' });
        return byName || a.id.localeCompare(b.id, 'en');
    });
}

async function loadPisiBasesContext() {
    const mapPath = window.activeMapPath || null;
    if (!mapPath) {
        return { mapPath: null, nodes: [], propertyDefinitions: [] };
    }

    const listed = await window.pisiProject?.listMapNodes?.(mapPath);
    if (!listed?.ok) {
        throw new Error(listed?.error || 'Map özellikleri yüklenemedi.');
    }
    let nodes = Array.isArray(listed.nodes) ? listed.nodes : [];
    let propertyDefinitions = [];

    const anchorNode = nodes.find((node) => node?.fullPath);
    if (anchorNode && typeof window.pisiProject?.getNodePropertyContext === 'function') {
        const schemaContext = await window.pisiProject.getNodePropertyContext(
            anchorNode.fullPath,
            mapPath
        );
        if (schemaContext?.ok) {
            nodes = Array.isArray(schemaContext.nodes) ? schemaContext.nodes : nodes;
            propertyDefinitions = normalizePisiBaseDefinitions(
                schemaContext.propertyDefinitions
            );
        }
    }
    if (!propertyDefinitions.length) {
        propertyDefinitions = collectPisiBasesFallbackDefinitions(nodes);
    }
    return { mapPath, nodes, propertyDefinitions };
}

function normalizePisiBasesSavedView(view = {}) {
    const id = String(view.id || '').trim();
    const name = String(view.name || '').trim().slice(0, 120);
    if (!id || !name) return null;
    return {
        id,
        name,
        query: String(view.query || '').trim().slice(0, 2000),
        layout: normalizePisiBaseLayout(view.layout),
        updatedAt: view.updatedAt || null
    };
}

async function loadPisiBasesSavedViews() {
    const result = await window.pisiProject?.listSavedViews?.(window.currentProjectFolder);
    if (!result?.ok) {
        pisiBasesViewState.savedViews = [];
        return [];
    }
    const views = [];
    const seen = new Set();
    for (const raw of Array.isArray(result.views) ? result.views : []) {
        const view = normalizePisiBasesSavedView(raw);
        if (!view || seen.has(view.id)) continue;
        seen.add(view.id);
        views.push(view);
    }
    pisiBasesViewState.savedViews = views;
    return views;
}

function makePisiBasesOpenButton(documentRecord) {
    const button = makePisiBasesButton(documentRecord.title, 'pisi-base-open');
    button.addEventListener('click', () => {
        window.closePisiBasesDialog?.();
        openPisiSearchResult({
            kind: 'node',
            nodePath: documentRecord.path,
            nodeTitle: documentRecord.title,
            nodeItem: documentRecord.nodeItem,
            mapPath: documentRecord.memberships?.[0]?.mapPath || null
        });
    });
    return button;
}

function renderPisiBasesTable(host, projection, sourceDocuments) {
    const table = document.createElement('table');
    table.className = 'pisi-base-table';
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    const nodeHeader = document.createElement('th');
    nodeHeader.textContent = pisiBasesViewTranslate('Node');
    header.appendChild(nodeHeader);
    for (const column of projection.columns) {
        const cell = document.createElement('th');
        cell.textContent = column.name;
        cell.dataset.propertyId = column.id;
        header.appendChild(cell);
    }
    head.appendChild(header);

    const body = document.createElement('tbody');
    for (const rowRecord of projection.rows) {
        const row = document.createElement('tr');
        row.dataset.nodePath = rowRecord.document.path || '';
        const titleCell = document.createElement('td');
        titleCell.appendChild(makePisiBasesOpenButton(rowRecord.document));
        row.appendChild(titleCell);
        for (const column of projection.columns) {
            const cell = document.createElement('td');
            cell.dataset.propertyId = column.id;
            cell.textContent = formatPisiBasePropertyValue(
                rowRecord.properties.get(column.id),
                sourceDocuments
            );
            row.appendChild(cell);
        }
        body.appendChild(row);
    }
    table.append(head, body);
    host.appendChild(table);
}

function renderPisiBasesCards(host, projection, sourceDocuments) {
    const grid = document.createElement('div');
    grid.className = 'pisi-base-cards';
    for (const rowRecord of projection.rows) {
        const card = document.createElement('article');
        card.className = 'pisi-base-card';
        card.dataset.nodePath = rowRecord.document.path || '';
        card.appendChild(makePisiBasesOpenButton(rowRecord.document));
        const path = document.createElement('small');
        path.textContent = rowRecord.document.relativePath || '';
        card.appendChild(path);
        for (const column of projection.cardColumns) {
            const row = document.createElement('div');
            row.dataset.propertyId = column.id;
            const name = document.createElement('span');
            name.textContent = column.name;
            const value = document.createElement('strong');
            value.textContent = formatPisiBasePropertyValue(
                rowRecord.properties.get(column.id),
                sourceDocuments
            );
            row.append(name, value);
            card.appendChild(row);
        }
        grid.appendChild(card);
    }
    host.appendChild(grid);
}

function renderPisiBasesSavedViewControls(host, queryInput, rerenderAll) {
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = pisiBasesViewTranslate('Kaydedilmiş filtreler');
    select.appendChild(empty);
    for (const view of pisiBasesViewState.savedViews) {
        const option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.name;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        const view = pisiBasesViewState.savedViews.find((item) => item.id === select.value);
        if (!view) return;
        pisiBasesViewState.query = view.query;
        pisiBasesViewState.layout = normalizePisiBaseLayout(view.layout);
        queryInput.value = pisiBasesViewState.query;
        rerenderAll();
    });

    const save = makePisiBasesButton('Filtreyi kaydet', 'pisi-secondary-button');
    save.addEventListener('click', async () => {
        const name = prompt(pisiBasesViewTranslate('Görünüm adı'));
        if (!name) return;
        const result = await window.pisiProject?.saveView?.(
            window.currentProjectFolder,
            {
                name,
                query: pisiBasesViewState.query,
                layout: normalizePisiBaseLayout(pisiBasesViewState.layout)
            }
        );
        if (!result?.ok) {
            alert(result?.error || pisiBasesViewTranslate('Görünüm kaydedilemedi.'));
            return;
        }
        await loadPisiBasesSavedViews();
        rerenderAll();
    });

    const remove = makePisiBasesButton('Filtreyi sil', 'pisi-secondary-button');
    remove.addEventListener('click', async () => {
        if (!select.value) return;
        const result = await window.pisiProject?.deleteView?.(
            window.currentProjectFolder,
            select.value
        );
        if (!result?.ok) {
            alert(result?.error || pisiBasesViewTranslate('Görünüm silinemedi.'));
            return;
        }
        await loadPisiBasesSavedViews();
        rerenderAll();
    });
    host.append(select, save, remove);
}

async function renderPisiBasesView(container, options = {}) {
    const projectFolder = window.currentProjectFolder || null;
    if (pisiBasesViewState.projectFolder !== projectFolder) {
        pisiBasesViewState.projectFolder = projectFolder;
        pisiBasesViewState.query = '';
        pisiBasesViewState.layout = 'table';
        pisiBasesViewState.savedViews = [];
    }

    const section = document.createElement('section');
    section.className = 'pisi-bases';
    const title = document.createElement('h2');
    title.textContent = pisiBasesViewTranslate('Bases-lite');
    const context = await loadPisiBasesContext();
    const sourceDocuments = materializePisiDatabaseDocuments(
        makePisiBasesDatabaseDocuments(context.nodes, context.mapPath)
    );
    const definitions = normalizePisiBaseDefinitions(context.propertyDefinitions);
    await loadPisiBasesSavedViews();

    const toolbar = document.createElement('div');
    toolbar.className = 'pisi-bases-toolbar';
    const query = document.createElement('input');
    query.type = 'search';
    query.value = pisiBasesViewState.query;
    query.placeholder = pisiBasesViewTranslate('Durum:"Devam ediyor" Öncelik:>=4');
    const tableButton = makePisiBasesButton('Tablo', 'pisi-base-layout-button');
    const cardsButton = makePisiBasesButton('Kart', 'pisi-base-layout-button');
    const results = document.createElement('div');
    results.className = 'pisi-bases-results';
    const actions = document.createElement('div');
    actions.className = 'pisi-bases-actions';

    let currentProjection = buildPisiBaseProjection(
        sourceDocuments,
        definitions,
        pisiBasesViewState.query
    );
    const rerenderResults = () => {
        pisiBasesViewState.query = query.value.trim().slice(0, 2000);
        pisiBasesViewState.layout = normalizePisiBaseLayout(pisiBasesViewState.layout);
        tableButton.classList.toggle('active', pisiBasesViewState.layout === 'table');
        cardsButton.classList.toggle('active', pisiBasesViewState.layout === 'cards');
        currentProjection = buildPisiBaseProjection(
            sourceDocuments,
            definitions,
            pisiBasesViewState.query
        );
        results.replaceChildren();
        if (pisiBasesViewState.layout === 'cards') {
            renderPisiBasesCards(results, currentProjection, sourceDocuments);
        } else {
            renderPisiBasesTable(results, currentProjection, sourceDocuments);
        }
        results.dataset.count = String(currentProjection.count);
        results.dataset.sourceCount = String(currentProjection.sourceCount);
    };

    query.addEventListener('input', rerenderResults);
    tableButton.addEventListener('click', () => {
        pisiBasesViewState.layout = 'table';
        rerenderResults();
    });
    cardsButton.addEventListener('click', () => {
        pisiBasesViewState.layout = 'cards';
        rerenderResults();
    });

    const rerenderAll = () => {
        container.replaceChildren();
        void renderPisiBasesView(container, options);
    };
    const savedHost = document.createElement('div');
    savedHost.className = 'pisi-saved-view-controls';
    renderPisiBasesSavedViewControls(savedHost, query, rerenderAll);

    const createMap = makePisiBasesButton('Sonuçlardan map üret', 'pisi-primary-button');
    createMap.addEventListener('click', async () => {
        const titleValue = prompt(
            pisiBasesViewTranslate('Map adı'),
            pisiBasesViewTranslate('Özellik görünümü')
        );
        if (!titleValue) return;
        createMap.disabled = true;
        const result = await window.pisiProject?.createPropertyMap?.(
            window.currentProjectFolder,
            {
                title: titleValue,
                query: currentProjection.query,
                nodePaths: currentProjection.documents.map((item) => item.path)
            }
        );
        if (!result?.ok) {
            alert(result?.error || pisiBasesViewTranslate('Map oluşturulamadı.'));
            createMap.disabled = false;
            return;
        }
        await window.refreshCurrentProjectTree?.();
        alert(`${pisiBasesViewTranslate('Map oluşturuldu')}: ${result.fileName}`);
        createMap.disabled = false;
    });

    toolbar.append(query, tableButton, cardsButton);
    actions.append(savedHost, createMap);
    if (options.showTitle !== false) section.appendChild(title);
    section.append(toolbar, actions, results);
    container.appendChild(section);
    rerenderResults();
}

export {
    collectPisiBasesFallbackDefinitions,
    loadPisiBasesContext,
    loadPisiBasesSavedViews,
    makePisiBasesDatabaseDocuments,
    normalizePisiBasesSavedView,
    pisiBasesViewState,
    renderPisiBasesCards,
    renderPisiBasesTable,
    renderPisiBasesView
};