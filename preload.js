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

contextBridge.exposeInMainWorld('pisiProject', {
    getLastFolder: () => ipcRenderer.invoke('project:get-last-folder'),
    chooseFolder: () => ipcRenderer.invoke('project:choose-folder'),
    setLastFolder: (folderPath) => ipcRenderer.invoke('project:set-last-folder', folderPath),
    listFolder: (folderPath) => ipcRenderer.invoke('project:list-folder', folderPath),
    deletePath: (targetPath) => ipcRenderer.invoke('project:delete-path', targetPath),
    folderExists: (folderPath) => ipcRenderer.invoke('project:folder-exists', folderPath),

    createPisiFile: (folderPath, ext) => ipcRenderer.invoke('project:create-pisi-file', folderPath, ext),
    renamePisiFile: (oldPath, newBaseName) => ipcRenderer.invoke('project:rename-pisi-file', oldPath, newBaseName),
    movePisiItem: (sourcePath, destinationFolderPath, options) => ipcRenderer.invoke('project:move-pisi-item', sourcePath, destinationFolderPath, options || {}),
    createNodeUnderMap: (mapPath) => ipcRenderer.invoke('project:create-node-under-map', mapPath),
    getOrCreateDiaryNode: (projectFolder, isoDate) => ipcRenderer.invoke('project:get-or-create-diary-node', projectFolder, isoDate),
    listDiaryDates: (projectFolder) => ipcRenderer.invoke('project:list-diary-dates', projectFolder),
    syncDiaryMissions: (projectFolder, entries) => ipcRenderer.invoke('project:sync-diary-missions', projectFolder, entries),

    listMapNodes: (mapPath) => ipcRenderer.invoke('project:list-map-nodes', mapPath),
    getNodePropertyContext: (nodePath, preferredMapPath) => ipcRenderer.invoke(
        'project:get-node-property-context',
        nodePath,
        preferredMapPath || null
    ),
    saveMapLayout: (mapPath, nodeLayouts) => ipcRenderer.invoke('project:save-map-layout', mapPath, nodeLayouts),
    saveNodeContent: (nodePath, content) => ipcRenderer.invoke('project:save-node-content', nodePath, content),
    quickAddTask: (projectFolder, payload) => ipcRenderer.invoke('project:quick-add-task', projectFolder, payload),
    saveNodeProperties: (nodePath, properties) => ipcRenderer.invoke('project:save-node-properties', nodePath, properties),
    listSavedViews: (projectFolder) => ipcRenderer.invoke('project:list-saved-views', projectFolder),
    saveView: (projectFolder, view) => ipcRenderer.invoke('project:save-view', projectFolder, view),
    deleteView: (projectFolder, viewId) => ipcRenderer.invoke('project:delete-view', projectFolder, viewId),
    listDatabaseTemplates: (projectFolder) => ipcRenderer.invoke('project:list-database-templates', projectFolder),
    saveDatabaseTemplate: (projectFolder, template) => ipcRenderer.invoke('project:save-database-template', projectFolder, template),
    deleteDatabaseTemplate: (projectFolder, templateId) => ipcRenderer.invoke('project:delete-database-template', projectFolder, templateId),
    applyDatabaseTemplate: (nodePath, templateId, options) => ipcRenderer.invoke('project:apply-database-template', nodePath, templateId, options || {}),
    createPropertyMap: (projectFolder, options) => ipcRenderer.invoke('project:create-property-map', projectFolder, options),
    detachMapReference: (mapPath, nodeId) => ipcRenderer.invoke('project:detach-map-reference', mapPath, nodeId),

    exportNode: (nodePath, format) => ipcRenderer.invoke('project:export-node', nodePath, format),
    exportProjectMarkdown: (projectFolder) => ipcRenderer.invoke('project:export-markdown', projectFolder),
    importMarkdownFolder: (projectFolder) => ipcRenderer.invoke('project:import-markdown', projectFolder),
    listNodeHistory: (nodePath) => ipcRenderer.invoke('project:list-node-history', nodePath),
    getNodeHistoryVersion: (nodePath, historyId) => ipcRenderer.invoke('project:get-node-history-version', nodePath, historyId),
    restoreNodeHistory: (nodePath, historyId) => ipcRenderer.invoke('project:restore-node-history', nodePath, historyId),
    auditIntegrity: (projectFolder) => ipcRenderer.invoke('project:audit-integrity', projectFolder),
    listBackups: (projectFolder, filePath) => ipcRenderer.invoke('project:list-backups', projectFolder, filePath || null),
    restoreBackup: (projectFolder, backupId) => ipcRenderer.invoke('project:restore-backup', projectFolder, backupId),
    captureWebSource: (projectFolder, payload) => ipcRenderer.invoke('project:capture-web-source', projectFolder, payload),

    getPisiDocument: (filePath) => ipcRenderer.invoke('project:get-pisi-document', filePath),
    deleteNodeFromMap: (nodePath) => ipcRenderer.invoke('project:delete-node-from-map', nodePath),

    upsertMapConnection: (mapPath, edge) => ipcRenderer.invoke('project:upsert-map-connection', mapPath, edge),
    reparentMapNode: (mapPath, childId, parentId) => ipcRenderer.invoke('project:reparent-map-node', mapPath, childId, parentId),

    deleteMapConnection: (mapPath, edgeId) => ipcRenderer.invoke('project:delete-map-connection', mapPath, edgeId),
    saveMapCamera: (mapPath, camera) => ipcRenderer.invoke('project:save-map-camera', mapPath, camera),

    deletePisiFile: (targetPath) => ipcRenderer.invoke('project:delete-pisi-file', targetPath),

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

contextBridge.exposeInMainWorld('pisiClipboard', {
    writeText: (value) => clipboard.writeText(String(value || '')),
    readText: () => clipboard.readText()
});

contextBridge.exposeInMainWorld('pisiTeamTransport', {
    getConfig: (projectFolder) => ipcRenderer.invoke('team:get-config', projectFolder),
    saveConfig: (projectFolder, config, options) => ipcRenderer.invoke(
        'team:save-config',
        projectFolder,
        config,
        options || {}
    ),
    listEvents: (projectFolder, options) => ipcRenderer.invoke(
        'team:list-events',
        projectFolder,
        options || {}
    ),
    appendEvent: (projectFolder, event) => ipcRenderer.invoke(
        'team:append-event',
        projectFolder,
        event
    )
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
    const element = node?.nodeType === Node.ELEMENT_NODE
        ? node
        : node?.parentElement;
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

function pisiApplyToRoot(root = document) {
    if (!root || !pisiLocale) return;
    pisiApplyingTranslations = true;
    try {
        if (root.nodeType === Node.TEXT_NODE) {
            pisiTranslateTextNode(root);
            return;
        }

        const elements = root.nodeType === Node.ELEMENT_NODE
            ? [root, ...root.querySelectorAll('*')]
            : [...document.querySelectorAll('*')];

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
        toggle.title = pisiLanguage === 'tr'
            ? pisiTranslateCore('İngilizceye geç')
            : pisiTranslateCore('Türkçeye geç');
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
        try { listener(detail); } catch (error) { console.error(error); }
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
            for (const node of mutation.addedNodes) pisiApplyToRoot(node);
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
        configuredLanguage = await ipcRenderer.invoke('app:get-language') || configuredLanguage;
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
