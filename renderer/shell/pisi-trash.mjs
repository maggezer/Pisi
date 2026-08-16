import { registerModule } from '../core/module-registry.mjs';
import { queryPisiDomain, commandPisiDomain } from '../domain/pisi-domain-client.mjs';
import { registerPisiCommandCenterPage } from './pisi-command-center.mjs';

const PISI_TRASH_TEXT = {
    tr: {
        title: 'Çöp Kutusu',
        description: 'Silinen proje öğelerini geri yükleyin veya kalıcı olarak silin.',
        refresh: 'Yenile',
        empty: 'Çöp Kutusunu Boşalt',
        emptyState: 'Çöp kutusu boş.',
        restore: 'Geri Yükle',
        deletePermanently: 'Kalıcı Sil',
        originalPath: 'Önceki konum',
        deletedAt: 'Silinme zamanı',
        node: 'Node',
        map: 'Map',
        folder: 'Klasör',
        file: 'Dosya',
        references: 'Bağlı kayıtlar',
        confirmDelete: 'Bu öğe kalıcı olarak silinsin mi? Bu işlem geri alınamaz.',
        confirmEmpty: 'Çöp kutusundaki tüm öğeler kalıcı olarak silinsin mi? Bu işlem geri alınamaz.',
        restoreConflict: 'Bu öğe güvenli biçimde geri yüklenemiyor.',
        pathExists: 'Önceki konumda aynı adlı bir öğe var.',
        parentMissing: 'Öğenin önceki parent map’i artık mevcut değil.',
        taskConflict: 'Aynı görev kimliği aktif projede yeniden kullanılmış.',
        relationshipConflict: 'Eski semantic ilişki mevcut proje yapısıyla çakışıyor.',
        operationFailed: 'Çöp kutusu işlemi başarısız.',
        nodes: 'node',
        maps: 'map',
        tasks: 'görev',
        relationships: 'ilişki',
        mapReferences: 'map referansı'
    },
    eng: {
        title: 'Trash',
        description: 'Restore deleted project items or remove them permanently.',
        refresh: 'Refresh',
        empty: 'Empty Trash',
        emptyState: 'Trash is empty.',
        restore: 'Restore',
        deletePermanently: 'Delete Permanently',
        originalPath: 'Previous location',
        deletedAt: 'Deleted',
        node: 'Node',
        map: 'Map',
        folder: 'Folder',
        file: 'File',
        references: 'Linked records',
        confirmDelete: 'Delete this item permanently? This action cannot be undone.',
        confirmEmpty: 'Permanently delete every item in Trash? This action cannot be undone.',
        restoreConflict: 'This item cannot be restored safely.',
        pathExists: 'An item with the same name exists at the previous location.',
        parentMissing: 'The item’s previous parent map no longer exists.',
        taskConflict: 'The same task identity is already active in the project.',
        relationshipConflict: 'A previous semantic relationship conflicts with the current project structure.',
        operationFailed: 'Trash operation failed.',
        nodes: 'nodes',
        maps: 'maps',
        tasks: 'tasks',
        relationships: 'relationships',
        mapReferences: 'map references'
    }
};

function getPisiTrashLanguage() {
    return window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
}

function pisiTrashText(key) {
    const language = getPisiTrashLanguage();
    return PISI_TRASH_TEXT[language]?.[key] || PISI_TRASH_TEXT.tr[key] || key;
}

function formatPisiTrashDate(value) {
    const timestamp = Date.parse(String(value || ''));
    if (!Number.isFinite(timestamp)) return String(value || '—');
    return new Intl.DateTimeFormat(getPisiTrashLanguage() === 'eng' ? 'en' : 'tr', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(timestamp));
}

function describePisiTrashConflict(conflict = {}) {
    if (conflict.type === 'path-exists') {
        return `${pisiTrashText('pathExists')} (${conflict.path || '—'})`;
    }
    if (conflict.type === 'parent-missing') {
        return `${pisiTrashText('parentMissing')} (${conflict.path || '—'})`;
    }
    if (conflict.type === 'task-id') {
        return `${pisiTrashText('taskConflict')} (${conflict.id || '—'})`;
    }
    if (String(conflict.type || '').includes('relationship') || conflict.id) {
        return `${pisiTrashText('relationshipConflict')} (${conflict.id || '—'})`;
    }
    return String(conflict.error || conflict.type || pisiTrashText('restoreConflict'));
}

function makePisiTrashCounts(item) {
    const counts = [
        [item.nodeCount, pisiTrashText('nodes')],
        [item.mapCount, pisiTrashText('maps')],
        [item.taskCount, pisiTrashText('tasks')],
        [item.relationshipCount, pisiTrashText('relationships')],
        [item.mapReferenceCount, pisiTrashText('mapReferences')]
    ].filter(([count]) => Number(count) > 0);
    return counts.length
        ? counts.map(([count, label]) => `${count} ${label}`).join(' · ')
        : '—';
}

async function refreshPisiTrashProjectTree() {
    if (typeof window.refreshCurrentProjectTree === 'function') {
        await window.refreshCurrentProjectTree();
    }
    document.dispatchEvent(new CustomEvent('pisi:trash-changed'));
}

function renderPisiTrashError(container, result) {
    const error = document.createElement('div');
    error.className = 'pisi-trash-error';
    const title = document.createElement('strong');
    title.textContent = result?.code === 'TRASH_RESTORE_CONFLICT'
        ? pisiTrashText('restoreConflict')
        : pisiTrashText('operationFailed');
    error.appendChild(title);
    if (result?.error && result.code !== 'TRASH_RESTORE_CONFLICT') {
        const detail = document.createElement('span');
        detail.textContent = result.error;
        error.appendChild(detail);
    }
    for (const conflict of result?.conflicts || []) {
        const detail = document.createElement('span');
        detail.textContent = `• ${describePisiTrashConflict(conflict)}`;
        error.appendChild(detail);
    }
    container.prepend(error);
}

function makePisiTrashActionButton(label, className, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

function makePisiTrashItemCard(item, rerender) {
    const card = document.createElement('article');
    card.className = 'pisi-trash-card';

    const copy = document.createElement('div');
    copy.className = 'pisi-trash-card-copy';
    const heading = document.createElement('div');
    heading.className = 'pisi-trash-card-heading';
    const title = document.createElement('strong');
    title.textContent = item.label || item.originalTarget || item.id;
    const kind = document.createElement('span');
    kind.className = 'pisi-trash-kind';
    kind.textContent = pisiTrashText(item.kind || 'file');
    heading.append(title, kind);

    const pathLine = document.createElement('div');
    pathLine.className = 'pisi-trash-meta';
    pathLine.textContent = `${pisiTrashText('originalPath')}: ${item.originalTarget || '—'}`;
    const dateLine = document.createElement('div');
    dateLine.className = 'pisi-trash-meta';
    dateLine.textContent = `${pisiTrashText('deletedAt')}: ${formatPisiTrashDate(item.deletedAt)}`;
    const refs = document.createElement('div');
    refs.className = 'pisi-trash-meta';
    refs.textContent = `${pisiTrashText('references')}: ${makePisiTrashCounts(item)}`;
    copy.append(heading, pathLine, dateLine, refs);

    const actions = document.createElement('div');
    actions.className = 'pisi-trash-card-actions';
    const restore = makePisiTrashActionButton(
        pisiTrashText('restore'),
        'pisi-trash-btn primary',
        async () => {
            restore.disabled = true;
            permanent.disabled = true;
            const result = await commandPisiDomain('trash.restore.v1', {
                projectFolder: window.currentProjectFolder,
                trashId: item.id
            });
            if (!result?.ok) {
                restore.disabled = false;
                permanent.disabled = false;
                renderPisiTrashError(card, result);
                return;
            }
            await refreshPisiTrashProjectTree();
            await rerender();
        }
    );
    const permanent = makePisiTrashActionButton(
        pisiTrashText('deletePermanently'),
        'pisi-trash-btn danger',
        async () => {
            if (!window.confirm(pisiTrashText('confirmDelete'))) return;
            restore.disabled = true;
            permanent.disabled = true;
            const result = await commandPisiDomain('trash.delete-permanently.v1', {
                projectFolder: window.currentProjectFolder,
                trashId: item.id
            });
            if (!result?.ok) {
                restore.disabled = false;
                permanent.disabled = false;
                renderPisiTrashError(card, result);
                return;
            }
            await rerender();
        }
    );
    actions.append(restore, permanent);
    card.append(copy, actions);
    return card;
}

async function renderPisiTrashPage(container) {
    const projectFolder = window.currentProjectFolder;
    const page = document.createElement('section');
    page.className = 'pisi-trash-page';
    container.replaceChildren(page);

    const header = document.createElement('div');
    header.className = 'pisi-trash-header';
    const heading = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = pisiTrashText('title');
    const description = document.createElement('p');
    description.textContent = pisiTrashText('description');
    heading.append(title, description);

    const headerActions = document.createElement('div');
    headerActions.className = 'pisi-trash-header-actions';
    const refresh = makePisiTrashActionButton(
        pisiTrashText('refresh'),
        'pisi-trash-btn',
        () => renderPisiTrashPage(container)
    );
    const empty = makePisiTrashActionButton(
        pisiTrashText('empty'),
        'pisi-trash-btn danger',
        async () => {
            if (!window.confirm(pisiTrashText('confirmEmpty'))) return;
            empty.disabled = true;
            const result = await commandPisiDomain('trash.empty.v1', { projectFolder });
            if (!result?.ok) {
                empty.disabled = false;
                renderPisiTrashError(page, result);
                return;
            }
            await renderPisiTrashPage(container);
        }
    );
    headerActions.append(refresh, empty);
    header.append(heading, headerActions);
    page.appendChild(header);

    const result = await queryPisiDomain('trash.list.v1', { projectFolder });
    if (!result?.ok) {
        renderPisiTrashError(page, result);
        empty.disabled = true;
        return;
    }

    const items = Array.isArray(result.items) ? result.items : [];
    empty.disabled = items.length === 0;
    if (!items.length) {
        const emptyState = document.createElement('div');
        emptyState.className = 'pisi-trash-empty';
        emptyState.textContent = pisiTrashText('emptyState');
        page.appendChild(emptyState);
        return;
    }

    const list = document.createElement('div');
    list.className = 'pisi-trash-list';
    const rerender = () => renderPisiTrashPage(container);
    for (const item of items) list.appendChild(makePisiTrashItemCard(item, rerender));
    page.appendChild(list);
}

registerPisiCommandCenterPage({
    id: 'trash',
    label: () => pisiTrashText('title'),
    order: 850,
    requiresProject: true,
    render: renderPisiTrashPage
});

const moduleApi = {
    PISI_TRASH_TEXT,
    pisiTrashText,
    formatPisiTrashDate,
    describePisiTrashConflict,
    makePisiTrashCounts,
    renderPisiTrashPage
};

registerModule('shell.trash', moduleApi);

export {
    PISI_TRASH_TEXT,
    describePisiTrashConflict,
    formatPisiTrashDate,
    makePisiTrashCounts,
    pisiTrashText,
    renderPisiTrashPage
};