import { openPisiSearchResult } from '../search/pisi-global-search.mjs';
import { normalizePisiPropertyCollection } from './pisi-properties-core.mjs';
import {
    formatPisiPropertyValue,
    getPisiActiveMapPropertyContext,
    makePisiStructuredButton,
    pisiStructuredTranslate
} from './pisi-structured-view-helpers.mjs';
import {
    collectPisiStructuredPropertyColumns,
    filterAndSortPisiStructuredDocuments,
    materializePisiStructuredDocuments
} from './pisi-structured-view-query.mjs';
import { applyPisiSavedView, deletePisiSavedView, loadPisiSavedViews, pisiStructuredViewState, savePisiSavedView } from './pisi-structured-view-state.mjs';

function makePisiBaseOpenButton(documentRecord) {
    const button = makePisiStructuredButton(documentRecord.title, 'pisi-base-open');
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

function renderPisiBaseTable(host, documents) {
    const table = document.createElement('table');
    table.className = 'pisi-base-table';
    const columns = collectPisiStructuredPropertyColumns(documents);
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    for (const label of [pisiStructuredTranslate('Node'), ...columns.map((item) => item.name)]) {
        const cell = document.createElement('th');
        cell.textContent = label;
        header.appendChild(cell);
    }
    head.appendChild(header);
    const body = document.createElement('tbody');
    for (const documentRecord of documents) {
        const row = document.createElement('tr');
        const titleCell = document.createElement('td');
        titleCell.appendChild(makePisiBaseOpenButton(documentRecord));
        row.appendChild(titleCell);
        const properties = new Map(normalizePisiPropertyCollection(documentRecord.properties).map((item) => [item.id, item]));
        for (const column of columns) {
            const cell = document.createElement('td');
            cell.textContent = formatPisiPropertyValue(properties.get(column.id)?.value);
            row.appendChild(cell);
        }
        body.appendChild(row);
    }
    table.append(head, body);
    host.appendChild(table);
}

function renderPisiBaseCards(host, documents) {
    const grid = document.createElement('div');
    grid.className = 'pisi-base-cards';
    for (const documentRecord of documents) {
        const card = document.createElement('article');
        card.className = 'pisi-base-card';
        card.appendChild(makePisiBaseOpenButton(documentRecord));
        const path = document.createElement('small');
        path.textContent = documentRecord.relativePath;
        card.appendChild(path);
        for (const property of normalizePisiPropertyCollection(documentRecord.properties).slice(0, 8)) {
            const row = document.createElement('div');
            const name = document.createElement('span');
            name.textContent = property.name;
            const value = document.createElement('strong');
            value.textContent = formatPisiPropertyValue(property.value);
            row.append(name, value);
            card.appendChild(row);
        }
        grid.appendChild(card);
    }
    host.appendChild(grid);
}

function renderPisiSavedViewControls(host, rerender) {
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = pisiStructuredTranslate('Kaydedilmiş filtreler');
    select.appendChild(empty);
    for (const view of pisiStructuredViewState.savedViews) {
        const option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.name;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        if (applyPisiSavedView(select.value)) rerender();
    });
    const save = makePisiStructuredButton('Filtreyi kaydet', 'pisi-secondary-button');
    save.addEventListener('click', async () => {
        const name = prompt(pisiStructuredTranslate('Görünüm adı'));
        if (!name) return;
        const result = await savePisiSavedView(name);
        if (!result?.ok) return void pisiNotifyError(result?.error || pisiStructuredTranslate('Görünüm kaydedilemedi.'));
        rerender();
    });
    const remove = makePisiStructuredButton('Filtreyi sil', 'pisi-secondary-button');
    remove.addEventListener('click', async () => {
        if (!select.value) return;
        const result = await deletePisiSavedView(select.value);
        if (!result?.ok) return void pisiNotifyError(result?.error || pisiStructuredTranslate('Görünüm silinemedi.'));
        rerender();
    });
    host.append(select, save, remove);
}

async function renderPisiBases(container, options = {}) {
    const section = document.createElement('section');
    section.className = 'pisi-bases';
    const title = document.createElement('h2');
    title.textContent = pisiStructuredTranslate('Bases-lite');
    const propertyContext = await getPisiActiveMapPropertyContext();
    const mapDocuments = materializePisiStructuredDocuments(propertyContext);
    await loadPisiSavedViews();
    const toolbar = document.createElement('div');
    toolbar.className = 'pisi-bases-toolbar';
    const query = document.createElement('input');
    query.type = 'search';
    query.value = pisiStructuredViewState.query;
    query.placeholder = pisiStructuredTranslate('Durum:"Devam ediyor" Öncelik:>=4');
    const tableButton = makePisiStructuredButton('Tablo', 'pisi-base-layout-button');
    const cardsButton = makePisiStructuredButton('Kart', 'pisi-base-layout-button');
    const results = document.createElement('div');
    results.className = 'pisi-bases-results';
    const actions = document.createElement('div');
    actions.className = 'pisi-bases-actions';
    const rerenderResults = () => {
        pisiStructuredViewState.query = query.value.trim();
        tableButton.classList.toggle('active', pisiStructuredViewState.layout === 'table');
        cardsButton.classList.toggle('active', pisiStructuredViewState.layout === 'cards');
        const documents = filterAndSortPisiStructuredDocuments(mapDocuments, pisiStructuredViewState.query);
        results.replaceChildren();
        if (pisiStructuredViewState.layout === 'cards') renderPisiBaseCards(results, documents);
        else renderPisiBaseTable(results, documents);
        results.dataset.count = String(documents.length);
    };
    query.addEventListener('input', rerenderResults);
    tableButton.addEventListener('click', () => {
        pisiStructuredViewState.layout = 'table';
        rerenderResults();
    });
    cardsButton.addEventListener('click', () => {
        pisiStructuredViewState.layout = 'cards';
        rerenderResults();
    });
    const savedHost = document.createElement('div');
    savedHost.className = 'pisi-saved-view-controls';
    renderPisiSavedViewControls(savedHost, () => {
        container.replaceChildren();
        void renderPisiBases(container, options);
    });
    const createMap = makePisiStructuredButton('Sonuçlardan map üret', 'pisi-primary-button');
    createMap.addEventListener('click', async () => {
        const documents = filterAndSortPisiStructuredDocuments(mapDocuments, pisiStructuredViewState.query);
        const titleValue = prompt(pisiStructuredTranslate('Map adı'), pisiStructuredTranslate('Özellik görünümü'));
        if (!titleValue) return;
        createMap.disabled = true;
        const result = await window.pisiProject?.createPropertyMap?.(window.currentProjectFolder, {
            title: titleValue,
            query: pisiStructuredViewState.query,
            nodePaths: documents.map((item) => item.path)
        });
        if (!result?.ok) {
            pisiNotifyError(result?.error || pisiStructuredTranslate('Harita oluşturulamadı.'));
            createMap.disabled = false;
            return;
        }
        await window.refreshCurrentProjectTree?.();
        pisiNotifySuccess(`${pisiStructuredTranslate('Harita oluşturuldu')}: ${result.fileName}`);
        createMap.disabled = false;
    });
    toolbar.append(query, tableButton, cardsButton);
    actions.append(savedHost, createMap);
    if (options.showTitle !== false) section.appendChild(title);
    section.append(toolbar, actions, results);
    container.appendChild(section);
    rerenderResults();
}

export { renderPisiBases };
