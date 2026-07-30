const { contextBridge, ipcRenderer } = require('electron');

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
    saveMapLayout: (mapPath, nodeLayouts) => ipcRenderer.invoke('project:save-map-layout', mapPath, nodeLayouts),
    saveNodeContent: (nodePath, content) => ipcRenderer.invoke('project:save-node-content', nodePath, content),

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

const PISI_LANGUAGE_STORAGE_KEY = 'pisi.language';
const pisiTextSources = new WeakMap();
const pisiAttributeSources = new WeakMap();
let pisiLocale = null;
let pisiIcons = null;
let pisiLanguage = 'tr';

async function pisiLoadJson(relativePath) {
    const response = await fetch(new URL(relativePath, window.location.href));
    if (!response.ok) {
        throw new Error(`Resource could not be loaded: ${relativePath}`);
    }
    return response.json();
}

function pisiTranslate(source) {
    const cleanSource = String(source ?? '');
    const exact = pisiLocale?.strings?.[cleanSource];
    if (exact !== undefined) return exact;

    return cleanSource
        .replace(/PISI/g, 'Pisi')
        .replace(/Pisi/g, 'Pisi');
}

function pisiIsEditableNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE
        ? node
        : node?.parentElement;

    if (!element) return false;

    return Boolean(element.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]'
    ));
}

function pisiTranslateTextNode(node) {
    // Kullanıcının yazdığı metne dokunmak caret/selection konumunu sıfırlar.
    // Editör, modal ve form alanları çeviri gözlemcisinin dışında kalmalıdır.
    if (pisiIsEditableNode(node)) return;

    if (!pisiTextSources.has(node)) {
        pisiTextSources.set(node, node.nodeValue || '');
    }
    node.nodeValue = pisiTranslate(pisiTextSources.get(node));
}

function pisiTranslateAttributes(element) {
    const translatableAttributes = ['title', 'aria-label', 'alt', 'placeholder'];
    let sources = pisiAttributeSources.get(element);
    if (!sources) {
        sources = {};
        pisiAttributeSources.set(element, sources);
    }

    for (const attribute of translatableAttributes) {
        if (!element.hasAttribute(attribute)) continue;
        if (!(attribute in sources)) sources[attribute] = element.getAttribute(attribute);
        element.setAttribute(attribute, pisiTranslate(sources[attribute]));
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
    if (label) element.append(document.createTextNode(` ${pisiTranslate(label)}`));
    element.dataset.pisiIconized = '1';
}

function pisiApplyToRoot(root = document) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
        pisiTranslateTextNode(root);
        return;
    }

    const elements = root.nodeType === Node.ELEMENT_NODE
        ? [root, ...root.querySelectorAll('*')]
        : [...document.querySelectorAll('*')];

    for (const element of elements) {
        pisiTranslateAttributes(element);

        // Düzenlenebilir alanların metin düğümlerini veya çocuklarını yeniden
        // yazmak imleci başa taşır. Sadece güvenli öznitelikler çevrilir.
        if (pisiIsEditableNode(element)) continue;

        if (element.matches('button')) {
            const source = element.textContent;
            pisiApplyIcon(element, source);
        }

        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) pisiTranslateTextNode(child);
        }
    }

    document.documentElement.lang = pisiLanguage === 'eng' ? 'en' : 'tr';
    document.title = 'Pisi';

    const brandImages = document.querySelectorAll('#window-logo, .modal-logo-row img');
    for (const image of brandImages) {
        image.src = pisiIcons?.brand || 'assets/icons/pisi-logo.svg';
        image.alt = 'Pisi';
    }
}

async function pisiSetLanguage(language) {
    pisiLanguage = language === 'eng' ? 'eng' : 'tr';
    localStorage.setItem(PISI_LANGUAGE_STORAGE_KEY, pisiLanguage);
    pisiLocale = await pisiLoadJson(`locales/lang-${pisiLanguage}.json`);
    pisiApplyToRoot(document);

    const toggle = document.getElementById('pisi-language-toggle');
    if (toggle) {
        toggle.textContent = pisiLanguage === 'tr' ? 'EN' : 'TR';
        toggle.title = pisiLanguage === 'tr' ? 'Switch to English' : 'Türkçeye geç';
    }
}

function pisiInstallLanguageToggle() {
    if (document.getElementById('pisi-language-toggle')) return;
    const controls = document.getElementById('window-controls');
    if (!controls) return;

    const button = document.createElement('button');
    button.id = 'pisi-language-toggle';
    button.type = 'button';
    button.className = 'window-btn';
    button.addEventListener('click', () => {
        void pisiSetLanguage(pisiLanguage === 'tr' ? 'eng' : 'tr');
    });
    controls.prepend(button);
}

window.addEventListener('DOMContentLoaded', async () => {
    try {
        pisiIcons = await pisiLoadJson('assets/icons/icons.json');
        pisiInstallLanguageToggle();
        await pisiSetLanguage(localStorage.getItem(PISI_LANGUAGE_STORAGE_KEY) || 'tr');

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) pisiApplyToRoot(node);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    } catch (error) {
        console.error('[Pisi] Localization could not be initialized:', error);
        document.title = 'Pisi';
    }
});
