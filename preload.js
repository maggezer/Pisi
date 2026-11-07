const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('pisiEnvironment', {
    platform: process.platform
});

contextBridge.exposeInMainWorld('electronWindow', {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    focusRenderer: () => ipcRenderer.send('window:focus-renderer'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

    onMaximized: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('window:maximized', listener);
        return () => ipcRenderer.removeListener('window:maximized', listener);
    },

    onUnmaximized: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('window:unmaximized', listener);
        return () => ipcRenderer.removeListener('window:unmaximized', listener);
    },

    onCloseRequested: (callback) => {
        const listener = async () => {
            try {
                const result = await callback();
                ipcRenderer.send('window:close-ready', {
                    ok: result !== false
                });
            } catch (error) {
                ipcRenderer.send('window:close-ready', {
                    ok: false,
                    error: error.message
                });
            }
        };

        ipcRenderer.on('window:request-close', listener);
        return () => ipcRenderer.removeListener('window:request-close', listener);
    }
});

contextBridge.exposeInMainWorld('pisiUpdates', {
    getStatus: () => ipcRenderer.invoke('app:get-update-status'),
    check: () => ipcRenderer.invoke('app:check-for-updates'),
    install: () => ipcRenderer.invoke('app:install-update'),
    onStatus: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('app:update-status', listener);
        return () => ipcRenderer.removeListener('app:update-status', listener);
    }
});

function invokePisiDomainQuery(name, payload = {}) {
    return ipcRenderer.invoke('pisi:domain-query', name, payload || {});
}

function invokePisiDomainCommand(name, payload = {}) {
    return ipcRenderer.invoke('pisi:domain-command', name, payload || {});
}

function invokePisiTaskOperation(projectFolder, payload = {}) {
    const operation = String(payload?.op || 'add').toLowerCase();
    if (operation === 'list') {
        return invokePisiDomainQuery('task.list.v1', { projectFolder });
    }
    if (operation === 'upsert') {
        return invokePisiDomainCommand('task.upsert.v1', {
            projectFolder,
            task: payload.task || payload
        });
    }
    if (operation === 'update') {
        return invokePisiDomainCommand('task.update.v1', {
            projectFolder,
            taskId: payload.taskId || payload.id,
            patch: payload.patch || payload.task || {}
        });
    }
    if (operation === 'delete') {
        return invokePisiDomainCommand('task.delete.v1', {
            projectFolder,
            taskId: payload.taskId || payload.id
        });
    }
    if (operation === 'sync-index') {
        return invokePisiDomainCommand('task.sync-projection.v1', {
            projectFolder,
            complete: payload.complete,
            pruneMissing: payload.pruneMissing,
            tasks: payload.tasks
        });
    }
    return invokePisiDomainCommand('task.capture.v1', {
        projectFolder,
        task: payload
    });
}

// Reminder events from the main-process reminder service (open, complete,
// pending list changes). Commands go through pisiDomain (reminder.*.v1).
contextBridge.exposeInMainWorld('pisiReminders', {
    onEvent: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => {
            if (payload && typeof payload === 'object' && typeof payload.type === 'string') callback(payload);
        };
        ipcRenderer.on('pisi:reminder', listener);
        return () => ipcRenderer.removeListener('pisi:reminder', listener);
    }
});

contextBridge.exposeInMainWorld('pisiDomain', {
    query: (name, payload) => invokePisiDomainQuery(name, payload),
    command: (name, payload) => invokePisiDomainCommand(name, payload)
});

contextBridge.exposeInMainWorld('pisiProject', {
    getLastFolder: () => ipcRenderer.invoke('project:get-last-folder'),
    chooseFolder: () => ipcRenderer.invoke('project:choose-folder'),
    setLastFolder: (folderPath) => ipcRenderer.invoke('project:set-last-folder', folderPath),
    listFolder: (folderPath) => invokePisiDomainQuery('project.folder.list.v1', { folderPath }),
    deletePath: (targetPath) => invokePisiDomainCommand('project.path.delete.v1', { targetPath }),
    folderExists: (folderPath) => ipcRenderer.invoke('project:folder-exists', folderPath),

    createPisiFile: (folderPath, ext) => ipcRenderer.invoke('project:create-pisi-file', folderPath, ext),
    renamePisiFile: (oldPath, newBaseName) => invokePisiDomainCommand('project.item.rename.v1', { oldPath, newBaseName }),
    movePisiItem: (sourcePath, destinationFolderPath, options) =>
        invokePisiDomainCommand('project.item.move.v1', { sourcePath, destinationFolderPath, options: options || {} }),
    createNodeUnderMap: (mapPath) => invokePisiDomainCommand('map.node.create.v1', { mapPath }),
    getOrCreateDiaryNode: (projectFolder, isoDate) => ipcRenderer.invoke('project:get-or-create-diary-node', projectFolder, isoDate),
    listDiaryDates: (projectFolder) => ipcRenderer.invoke('project:list-diary-dates', projectFolder),
    syncDiaryMissions: (projectFolder, entries) => ipcRenderer.invoke('project:sync-diary-missions', projectFolder, entries),

    listMapNodes: (mapPath) => invokePisiDomainQuery('map.projection.v1', { mapPath }),
    getNodePropertyContext: (nodePath, preferredMapPath) => ipcRenderer.invoke('project:get-node-property-context', nodePath, preferredMapPath || null),
    saveMapLayout: (mapPath, nodeLayouts) => invokePisiDomainCommand('map.layout.save.v1', { mapPath, nodes: nodeLayouts }),
    saveNodeContent: (nodePath, content) => ipcRenderer.invoke('project:save-node-content', nodePath, content),
    quickAddTask: (projectFolder, payload) => invokePisiTaskOperation(projectFolder, payload),
    saveNodeProperties: (nodePath, properties) => ipcRenderer.invoke('project:save-node-properties', nodePath, properties),
    listSavedViews: (projectFolder) => ipcRenderer.invoke('project:list-saved-views', projectFolder),
    saveView: (projectFolder, view) => ipcRenderer.invoke('project:save-view', projectFolder, view),
    deleteView: (projectFolder, viewId) => ipcRenderer.invoke('project:delete-view', projectFolder, viewId),
    listDatabaseTemplates: (projectFolder) => ipcRenderer.invoke('project:list-database-templates', projectFolder),
    saveDatabaseTemplate: (projectFolder, template) => ipcRenderer.invoke('project:save-database-template', projectFolder, template),
    deleteDatabaseTemplate: (projectFolder, templateId) => ipcRenderer.invoke('project:delete-database-template', projectFolder, templateId),
    applyDatabaseTemplate: (nodePath, templateId, options) => ipcRenderer.invoke('project:apply-database-template', nodePath, templateId, options || {}),
    createPropertyMap: (projectFolder, options) => ipcRenderer.invoke('project:create-property-map', projectFolder, options),
    detachMapReference: (mapPath, nodeId) => invokePisiDomainCommand('map.reference.detach.v1', { mapPath, nodeId }),

    exportMap: (mapPath, payload) => ipcRenderer.invoke('project:export-map', mapPath, payload || {}),
    exportNode: (nodePath, format) => ipcRenderer.invoke('project:export-node', nodePath, format),
    exportProjectMarkdown: (projectFolder) => ipcRenderer.invoke('project:export-markdown', projectFolder),
    importMarkdownFolder: (projectFolder) => ipcRenderer.invoke('project:import-markdown', projectFolder),
    listNodeHistory: (nodePath) => ipcRenderer.invoke('project:list-node-history', nodePath),
    getNodeHistoryVersion: (nodePath, historyId) => ipcRenderer.invoke('project:get-node-history-version', nodePath, historyId),
    restoreNodeHistory: (nodePath, historyId) => ipcRenderer.invoke('project:restore-node-history', nodePath, historyId),
    auditIntegrity: (projectFolder) => ipcRenderer.invoke('project:audit-integrity', projectFolder),
    listBackups: (projectFolder, filePath) => ipcRenderer.invoke('project:list-backups', projectFolder, filePath || null),
    restoreBackup: (projectFolder, backupId) => ipcRenderer.invoke('project:restore-backup', projectFolder, backupId),

    getPisiDocument: (filePath) => invokePisiDomainQuery('document.read.v1', { filePath }),
    deleteNodeFromMap: (nodePath) => invokePisiDomainCommand('project.item.delete.v1', { targetPath: nodePath }),

    upsertMapConnection: (mapPath, edge) => invokePisiDomainCommand('map.relationship.upsert.v1', { mapPath, edge }),
    reparentMapNode: (mapPath, childId, parentId) => invokePisiDomainCommand('map.relationship.reparent.v1', { mapPath, childId, parentId }),

    deleteMapConnection: (mapPath, edgeId) => invokePisiDomainCommand('map.relationship.delete.v1', { mapPath, edgeId }),
    saveMapCamera: (mapPath, camera) => invokePisiDomainCommand('map.camera.save.v1', { mapPath, camera }),

    deletePisiFile: (targetPath) => invokePisiDomainCommand('project.item.delete.v1', { targetPath }),

    onFileSystemChanged: (callback) => {
        const listener = (_event, payload) => {
            callback(payload);
        };

        ipcRenderer.on('project:filesystem-changed', listener);
        return () => {
            ipcRenderer.removeListener('project:filesystem-changed', listener);
        };
    }
});

contextBridge.exposeInMainWorld('pisiSync', {
    getStatus: () => ipcRenderer.invoke('pisi-sync:status'),
    selectFolder: () => ipcRenderer.invoke('pisi-sync:select-folder'),
    run: (options = {}) => ipcRenderer.invoke('pisi-sync:run', options),
    disconnect: () => ipcRenderer.invoke('pisi-sync:disconnect')
});

// Renderer errors for the local log only (main validates, clips and rate-limits).
contextBridge.exposeInMainWorld('pisiDiagnostics', {
    report: (report = {}) => {
        /** @type {Record<string, unknown>} */
        const value = report && typeof report === 'object' ? /** @type {Record<string, unknown>} */ (report) : {};
        const text = (field, limit) => (typeof value[field] === 'string' ? value[field].slice(0, limit) : '');
        ipcRenderer.send('pisi:diagnostics-report', {
            kind: value.kind === 'unhandledrejection' ? 'unhandledrejection' : 'error',
            message: text('message', 2000),
            stack: text('stack', 8000),
            source: text('source', 300),
            line: Number(value.line) || 0,
            column: Number(value.column) || 0
        });
    }
});

contextBridge.exposeInMainWorld('pisiShell', {
    // Main validates the URL again; only http, https and mailto are ever opened.
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', typeof url === 'string' ? url : '')
});

contextBridge.exposeInMainWorld('pisiTrash', {
    list: (projectFolder) => ipcRenderer.invoke('project:list-trash', projectFolder),
    restore: (projectFolder, trashId) => ipcRenderer.invoke('project:restore-trash-item', projectFolder, trashId),
    deletePermanently: (projectFolder, trashId) => ipcRenderer.invoke('project:delete-trash-item', projectFolder, trashId),
    empty: (projectFolder) => ipcRenderer.invoke('project:empty-trash', projectFolder)
});

contextBridge.exposeInMainWorld('pisiClipboard', {
    writeText: (value) => clipboard.writeText(String(value || '')),
    readText: () => clipboard.readText()
});

const PISI_LANGUAGE_STORAGE_KEY = 'pisi.language';
const PISI_TRANSLATABLE_ATTRIBUTES = ['title', 'aria-label', 'alt', 'placeholder'];
const PISI_USER_CONTENT_SELECTOR = [
    'input',
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '.pisi-rich-editor',
    '.map-node-title',
    '.map-node-preview',
    '.tree-name',
    '.center-tab-title',
    '.pisi-tag-result-text',
    '.pisi-tag-result-node',
    '.pisi-mission-text',
    '.pisi-mission-node',
    '[data-pisi-user-content]'
].join(', ');

const pisiTextSources = new WeakMap();
const pisiAttributeSources = new WeakMap();
const pisiLanguageListeners = new Set();
let pisiLocale = null;
let pisiIcons = null;
let pisiLanguage = 'tr';
let pisiTemplateTranslations = [];
let pisiPrefixTranslations = [];
let pisiLocalizationObserver = null;
let pisiApplyingTranslations = false;

function pisiNormalizeLanguage(language) {
    return language === 'eng' || language === 'en' ? 'eng' : 'tr';
}

async function pisiLoadJson(relativePath) {
    const response = await fetch(new URL(relativePath, window.location.href));
    if (!response.ok) {
        throw new Error(`Resource could not be loaded: ${relativePath}`);
    }
    return response.json();
}

function pisiEscapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pisiBuildTemplateTranslations(strings = {}) {
    const templates = [];
    const prefixes = [];

    for (const [source, translated] of Object.entries(strings)) {
        if (source.includes('{value}')) {
            const pieces = source.split('{value}').map(pisiEscapeRegExp);
            templates.push({
                source,
                translated,
                regexp: new RegExp(`^${pieces.join('(.+?)')}$`, 'u')
            });
            continue;
        }

        if (source.endsWith(':') || source.endsWith(': ')) {
            prefixes.push({ source, translated });
        }
    }

    templates.sort((a, b) => b.source.length - a.source.length);
    prefixes.sort((a, b) => b.source.length - a.source.length);
    pisiTemplateTranslations = templates;
    pisiPrefixTranslations = prefixes;
}

function pisiTranslateCore(source) {
    const cleanSource = String(source ?? '');
    const exact = pisiLocale?.strings?.[cleanSource];
    if (exact !== undefined) return exact;

    for (const template of pisiTemplateTranslations) {
        const match = cleanSource.match(template.regexp);
        if (!match) continue;
        let captureIndex = 1;
        return template.translated.replace(/\{value\}/g, () => {
            const value = match[captureIndex] ?? '';
            captureIndex += 1;
            return value;
        });
    }

    for (const prefix of pisiPrefixTranslations) {
        if (!cleanSource.startsWith(prefix.source)) continue;
        return prefix.translated + cleanSource.slice(prefix.source.length);
    }

    return cleanSource.replace(/PISI/g, 'Pisi');
}

function pisiTranslate(source) {
    const raw = String(source ?? '');
    if (!raw) return raw;

    const leading = raw.match(/^\s*/u)?.[0] || '';
    const trailing = raw.match(/\s*$/u)?.[0] || '';
    const endIndex = Math.max(leading.length, raw.length - trailing.length);
    const core = raw.slice(leading.length, endIndex).replace(/\s+/gu, ' ');
    if (!core) return raw;

    const translated = pisiTranslateCore(core);
    if (translated === core && core === raw) return raw;
    return `${leading}${translated}${trailing}`;
}

function pisiIsUserContentNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest(PISI_USER_CONTENT_SELECTOR));
}

function pisiTranslateTextNode(node, force = false) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (!force && pisiIsUserContentNode(node)) return;

    const current = node.nodeValue || '';
    let record = pisiTextSources.get(node);
    if (!record || (current !== record.rendered && current !== record.source)) {
        record = { source: current, rendered: current };
        pisiTextSources.set(node, record);
    }

    const rendered = pisiTranslate(record.source);
    record.rendered = rendered;
    if (current !== rendered) node.nodeValue = rendered;
}

function pisiTranslateAttributes(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    let records = pisiAttributeSources.get(element);
    if (!records) {
        records = Object.create(null);
        pisiAttributeSources.set(element, records);
    }

    for (const attribute of PISI_TRANSLATABLE_ATTRIBUTES) {
        if (!element.hasAttribute(attribute)) continue;
        const current = element.getAttribute(attribute) || '';
        let record = records[attribute];
        if (!record || (current !== record.rendered && current !== record.source)) {
            record = { source: current, rendered: current };
            records[attribute] = record;
        }
        const rendered = pisiTranslate(record.source);
        record.rendered = rendered;
        if (current !== rendered) element.setAttribute(attribute, rendered);
    }
}

function pisiApplyIcon(element, sourceText) {
    if (!pisiIcons?.emoji || element.dataset.pisiIconized === '1') return;
    const trimmed = String(sourceText || '').trim();
    const match = Object.keys(pisiIcons.emoji).find((emoji) => trimmed.startsWith(emoji));
    if (!match) return;

    const image = document.createElement('img');
    image.src = pisiIcons.emoji[match];
    image.alt = '';
    image.width = 16;
    image.height = 16;
    image.setAttribute('aria-hidden', 'true');

    const label = trimmed.slice(match.length).trim();
    element.replaceChildren(image);
    if (label) element.append(document.createTextNode(` ${label}`));
    element.dataset.pisiIconized = '1';
}

/** @param {Document | Element | Node} [root] */
function pisiApplyToRoot(root = document) {
    if (!root || !pisiLocale) return;
    pisiApplyingTranslations = true;
    try {
        if (root.nodeType === Node.TEXT_NODE) {
            pisiTranslateTextNode(root);
            return;
        }

        const elements =
            root.nodeType === Node.ELEMENT_NODE
                ? [root, ...root.querySelectorAll('*')]
                : root.nodeType === Node.DOCUMENT_NODE
                  ? [...document.querySelectorAll('*')]
                  : [];

        for (const element of elements) {
            pisiTranslateAttributes(element);
            if (element.matches('button')) pisiApplyIcon(element, element.textContent);
            for (const child of element.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) pisiTranslateTextNode(child);
            }
        }

        document.documentElement.lang = pisiLanguage === 'eng' ? 'en' : 'tr';
        document.title = 'Pisi';

        for (const image of document.querySelectorAll('#window-logo, .modal-logo-row img')) {
            image.src = pisiIcons?.brand || 'assets/pisi.png';
            image.alt = 'Pisi';
        }
    } finally {
        pisiApplyingTranslations = false;
    }
}

function pisiSyncLanguageControls() {
    const toggle = document.getElementById('pisi-language-toggle');
    if (toggle) {
        toggle.textContent = pisiLanguage === 'tr' ? 'EN' : 'TR';
        toggle.title = pisiLanguage === 'tr' ? pisiTranslateCore('İngilizceye geç') : pisiTranslateCore('Türkçeye geç');
        toggle.setAttribute('aria-label', toggle.title);
    }

    const select = document.getElementById('pisi-language-select');
    if (select && select.value !== pisiLanguage) select.value = pisiLanguage;
}

async function pisiSetLanguage(language, options = {}) {
    const nextLanguage = pisiNormalizeLanguage(language);
    const nextLocale = await pisiLoadJson(`locales/lang-${nextLanguage}.json`);

    pisiLanguage = nextLanguage;
    pisiLocale = nextLocale;
    pisiBuildTemplateTranslations(nextLocale?.strings || {});
    localStorage.setItem(PISI_LANGUAGE_STORAGE_KEY, pisiLanguage);

    if (options.persist !== false) {
        try {
            await ipcRenderer.invoke('app:set-language', pisiLanguage);
        } catch (error) {
            console.warn('[Pisi] Language setting could not be persisted:', error);
        }
    }

    pisiApplyToRoot(document);
    pisiSyncLanguageControls();

    const detail = { language: pisiLanguage };
    document.dispatchEvent(new CustomEvent('pisi:language-changed', { detail }));
    for (const listener of pisiLanguageListeners) {
        try {
            listener(detail);
        } catch (error) {
            console.error(error);
        }
    }

    return pisiLanguage;
}

function pisiInstallLanguageControls() {
    const controls = document.getElementById('window-controls');
    if (controls && !document.getElementById('pisi-language-toggle')) {
        const button = document.createElement('button');
        button.id = 'pisi-language-toggle';
        button.type = 'button';
        button.className = 'window-btn';
        button.addEventListener('click', () => {
            void pisiSetLanguage(pisiLanguage === 'tr' ? 'eng' : 'tr');
        });
        controls.prepend(button);
    }

    const select = document.getElementById('pisi-language-select');
    if (select && select.dataset.bound !== '1') {
        select.dataset.bound = '1';
        select.addEventListener('change', () => {
            void pisiSetLanguage(select.value);
        });
    }

    pisiSyncLanguageControls();
}

function pisiInstallObserver() {
    if (pisiLocalizationObserver || !document.body) return;
    pisiLocalizationObserver = new MutationObserver((mutations) => {
        if (pisiApplyingTranslations) return;
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                pisiTranslateTextNode(mutation.target);
                continue;
            }
            if (mutation.type === 'attributes') {
                pisiTranslateAttributes(mutation.target);
                continue;
            }
            for (const node of mutation.addedNodes) {
                // Map node boxes translate their own labels when created; viewport culling mounts
                // many per frame. Language changes still translate them through the full document pass.
                if (node.nodeType === Node.ELEMENT_NODE && /** @type {Element} */ (node).hasAttribute('data-pisi-localized')) continue;
                pisiApplyToRoot(node);
            }
        }
    });
    pisiLocalizationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: PISI_TRANSLATABLE_ATTRIBUTES
    });
}

const pisiLocalizationReady = (async () => {
    let configuredLanguage = localStorage.getItem(PISI_LANGUAGE_STORAGE_KEY) || 'tr';
    try {
        configuredLanguage = (await ipcRenderer.invoke('app:get-language')) || configuredLanguage;
    } catch {
        // Older builds may not expose the language IPC yet.
    }

    try {
        pisiIcons = await pisiLoadJson('assets/icons/icons.json');
    } catch {
        pisiIcons = null;
    }

    await pisiSetLanguage(configuredLanguage, { persist: false });
    return pisiLanguage;
})();

contextBridge.exposeInMainWorld('pisiI18n', {
    ready: () => pisiLocalizationReady,
    getLanguage: () => pisiLanguage,
    translate: (source) => pisiTranslate(source),
    setLanguage: (language) => pisiSetLanguage(language),
    onLanguageChanged: (callback) => {
        if (typeof callback !== 'function') return () => {};
        pisiLanguageListeners.add(callback);
        return () => pisiLanguageListeners.delete(callback);
    }
});

window.addEventListener('DOMContentLoaded', async () => {
    try {
        await pisiLocalizationReady;
        pisiInstallLanguageControls();
        pisiApplyToRoot(document);
        pisiInstallObserver();
    } catch (error) {
        console.error('[Pisi] Localization could not be initialized:', error);
        document.title = 'Pisi';
    }
});
