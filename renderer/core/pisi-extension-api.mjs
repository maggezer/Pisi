import { registerModule } from "./module-registry.mjs";

const PISI_EXTENSION_API_VERSION = '1.0.0';
const PISI_EXTENSION_POINTS = Object.freeze([
    'nodeType',
    'exporter',
    'taskView',
    'toolbarTool',
    'mapLayout',
    'rightPanel'
]);

const pisiExtensionRegistry = new Map(
    PISI_EXTENSION_POINTS.map((point) => [point, new Map()])
);
const pisiPluginRegistry = new Map();

function normalizePisiExtensionId(value = '') {
    const id = String(value || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id)) {
        throw new TypeError('Uzantı kimliği harf ile başlamalı ve yalnızca harf, sayı, nokta, alt çizgi veya tire içermeli.');
    }
    return id.slice(0, 120);
}

function assertPisiExtensionPoint(point) {
    if (!pisiExtensionRegistry.has(point)) {
        throw new TypeError(`Desteklenmeyen Pisi uzantı noktası: ${point}`);
    }
    return point;
}

function makePisiExtensionRecord(point, descriptor = {}, owner = 'host') {
    if (!descriptor || typeof descriptor !== 'object') {
        throw new TypeError('Uzantı tanımı bir nesne olmalı.');
    }
    const id = normalizePisiExtensionId(descriptor.id);
    const label = String(descriptor.label || id).trim().slice(0, 120);
    return Object.freeze({
        ...descriptor,
        id,
        label,
        point,
        owner: normalizePisiExtensionId(owner),
        apiVersion: PISI_EXTENSION_API_VERSION
    });
}

function dispatchPisiExtensionsChanged(point, action, extension) {
    document.dispatchEvent(new CustomEvent('pisi:extensions-changed', {
        detail: { point, action, extension }
    }));
}

function registerPisiExtension(point, descriptor, owner = 'host') {
    assertPisiExtensionPoint(point);
    const record = makePisiExtensionRecord(point, descriptor, owner);
    const bucket = pisiExtensionRegistry.get(point);
    if (bucket.has(record.id)) {
        throw new Error(`Pisi uzantısı zaten kayıtlı: ${point}/${record.id}`);
    }
    bucket.set(record.id, record);
    dispatchPisiExtensionsChanged(point, 'registered', record);
    return () => unregisterPisiExtension(point, record.id, record.owner);
}

function unregisterPisiExtension(point, id, owner = null) {
    assertPisiExtensionPoint(point);
    const bucket = pisiExtensionRegistry.get(point);
    const record = bucket.get(normalizePisiExtensionId(id));
    if (!record || (owner && record.owner !== normalizePisiExtensionId(owner))) {
        return false;
    }
    bucket.delete(record.id);
    dispatchPisiExtensionsChanged(point, 'unregistered', record);
    return true;
}

function listPisiExtensions(point = null) {
    if (point) {
        assertPisiExtensionPoint(point);
        return Array.from(pisiExtensionRegistry.get(point).values());
    }
    return Object.fromEntries(PISI_EXTENSION_POINTS.map((name) => [
        name,
        Array.from(pisiExtensionRegistry.get(name).values())
    ]));
}

function getPisiExtension(point, id) {
    assertPisiExtensionPoint(point);
    return pisiExtensionRegistry.get(point).get(normalizePisiExtensionId(id)) || null;
}

async function invokePisiExtension(point, id, context = {}) {
    const extension = getPisiExtension(point, id);
    if (!extension) throw new Error(`Pisi uzantısı bulunamadı: ${point}/${id}`);
    const handler = extension.run || extension.handler || extension.render;
    if (typeof handler !== 'function') {
        throw new TypeError(`Pisi uzantısının çalıştırılabilir işleyicisi yok: ${point}/${id}`);
    }
    return handler(Object.freeze({
        ...context,
        extension,
        projectFolder: window.currentProjectFolder || null
    }));
}

function makePisiPluginContext(pluginId, disposables) {
    return Object.freeze({
        apiVersion: PISI_EXTENSION_API_VERSION,
        register(point, descriptor) {
            const dispose = registerPisiExtension(point, descriptor, pluginId);
            disposables.push(dispose);
            return dispose;
        },
        registerCommand(command) {
            if (typeof window.registerPisiCommand !== 'function') {
                throw new Error('Pisi komut sistemi henüz hazır değil.');
            }
            const dispose = window.registerPisiCommand({
                ...command,
                owner: pluginId
            });
            disposables.push(dispose);
            return dispose;
        },
        getActiveNodePath() {
            return window.activeModalNode?.path || window.activeCenterNode?.path || null;
        },
        getProjectFolder() {
            return window.currentProjectFolder || null;
        },
        project: Object.freeze({
            getDocument: (...args) => window.pisiProject?.getPisiDocument?.(...args),
            saveContent: (...args) => window.pisiProject?.saveNodeContent?.(...args),
            exportNode: (...args) => window.pisiProject?.exportNode?.(...args)
        })
    });
}

async function registerPisiPlugin(manifest = {}, activate = manifest.activate) {
    const id = normalizePisiExtensionId(manifest.id);
    if (pisiPluginRegistry.has(id)) {
        throw new Error(`Pisi eklentisi zaten etkin: ${id}`);
    }
    if (typeof activate !== 'function') {
        throw new TypeError('Pisi eklentisi bir activate fonksiyonu sağlamalı.');
    }
    const requiredMajor = Number(String(manifest.apiVersion || '1').split('.')[0]);
    if (requiredMajor !== 1) {
        throw new Error(`Uyumsuz Pisi eklenti API sürümü: ${manifest.apiVersion}`);
    }
    const disposables = [];
    const plugin = {
        id,
        name: String(manifest.name || id).slice(0, 120),
        version: String(manifest.version || '0.0.0').slice(0, 40),
        apiVersion: PISI_EXTENSION_API_VERSION,
        disposables,
        deactivate: null
    };
    pisiPluginRegistry.set(id, plugin);
    try {
        const deactivate = await activate(makePisiPluginContext(id, disposables));
        if (typeof deactivate === 'function') plugin.deactivate = deactivate;
        document.dispatchEvent(new CustomEvent('pisi:plugin-activated', {
            detail: { id, name: plugin.name, version: plugin.version }
        }));
        return Object.freeze({
            id,
            deactivate: () => deactivatePisiPlugin(id)
        });
    } catch (error) {
        disposables.reverse().forEach((dispose) => dispose());
        pisiPluginRegistry.delete(id);
        throw error;
    }
}

async function deactivatePisiPlugin(id) {
    const pluginId = normalizePisiExtensionId(id);
    const plugin = pisiPluginRegistry.get(pluginId);
    if (!plugin) return false;
    try {
        await plugin.deactivate?.();
    } finally {
        plugin.disposables.reverse().forEach((dispose) => dispose());
        pisiPluginRegistry.delete(pluginId);
        document.dispatchEvent(new CustomEvent('pisi:plugin-deactivated', {
            detail: { id: pluginId }
        }));
    }
    return true;
}

function listPisiPlugins() {
    return Array.from(pisiPluginRegistry.values()).map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        apiVersion: plugin.apiVersion
    }));
}

function mountPisiToolbarExtensions(toolbar) {
    const root = toolbar?.querySelector?.('[data-pisi-unified-toolbar]');
    if (!root) return false;
    let section = root.querySelector('[data-pisi-extension-toolbar]');
    if (!section) {
        section = document.createElement('section');
        section.className = 'pisi-toolbar-section pisi-extension-toolbar';
        section.dataset.pisiExtensionToolbar = 'true';
        section.setAttribute('aria-label', window.pisiT?.('Eklenti araçları') || 'Eklenti araçları');
        root.appendChild(section);
    }
    section.replaceChildren();
    for (const tool of listPisiExtensions('toolbarTool')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-ribbon-btn pisi-extension-toolbar-button';
        button.title = window.pisiT?.(tool.label) || tool.label;
        button.textContent = tool.icon || tool.label;
        button.addEventListener('click', () => {
            void invokePisiExtension('toolbarTool', tool.id, { toolbar });
        });
        section.appendChild(button);
    }
    section.hidden = !section.childElementCount;
    return true;
}

function installPisiRightPanelExtensions() {
    const tabs = document.getElementById('right-panel-tabs');
    const content = document.getElementById('right-panel-content');
    if (!tabs || !content) return false;
    for (const panel of listPisiExtensions('rightPanel')) {
        const tabId = `pisi-extension-panel-tab-${panel.id}`;
        const pageId = `right-tab-extension-${panel.id}`;
        if (!document.getElementById(tabId)) {
            const button = document.createElement('button');
            button.id = tabId;
            button.type = 'button';
            button.className = 'right-panel-tab';
            button.dataset.rightTab = `extension-${panel.id}`;
            const label = window.pisiT?.(panel.label) || panel.label;
            button.title = label;
            button.setAttribute('aria-label', label);
            const iconName = String(panel.icon || '');
            if (/^[a-z][a-z0-9-]*$/.test(iconName)) {
                const icon = document.createElement('span');
                icon.className = `pisi-right-tab-icon pisi-right-tab-icon-${iconName}`;
                icon.setAttribute('aria-hidden', 'true');
                button.appendChild(icon);
            } else {
                button.textContent = label;
            }
            tabs.appendChild(button);
        }
        let page = document.getElementById(pageId);
        if (!page) {
            page = document.createElement('section');
            page.id = pageId;
            page.className = 'right-tab-page pisi-extension-right-panel';
            content.appendChild(page);
        }
        if (page.dataset.pisiExtensionRendered !== '1') {
            page.dataset.pisiExtensionRendered = '1';
            Promise.resolve(panel.render?.(page, {
                getActiveNodePath: () => window.activeModalNode?.path || window.activeCenterNode?.path || null
            })).catch((error) => {
                page.textContent = error.message;
            });
        }
    }
    window.bindRightPanelTabs?.();
    return true;
}

function renderPisiExtensionsPage(container) {
    const heading = document.createElement('div');
    heading.className = 'pisi-command-section-heading';
    const title = document.createElement('h2');
    title.textContent = window.pisiT?.('Eklenti API ve uzantı noktaları') || 'Eklenti API ve uzantı noktaları';
    const badge = document.createElement('span');
    badge.className = 'pisi-api-version-badge';
    badge.textContent = `API ${PISI_EXTENSION_API_VERSION}`;
    heading.append(title, badge);
    const grid = document.createElement('div');
    grid.className = 'pisi-extension-point-grid';
    for (const point of PISI_EXTENSION_POINTS) {
        const card = document.createElement('section');
        card.className = 'pisi-extension-point-card';
        const name = document.createElement('strong');
        name.textContent = point;
        const count = document.createElement('span');
        count.textContent = String(pisiExtensionRegistry.get(point).size);
        const list = document.createElement('small');
        list.textContent = Array.from(pisiExtensionRegistry.get(point).values())
            .map((extension) => extension.label)
            .join(', ') || (window.pisiT?.('Kayıt yok') || 'Kayıt yok');
        card.append(name, count, list);
        grid.appendChild(card);
    }
    const note = document.createElement('p');
    note.className = 'pisi-extension-safety-note';
    note.textContent = window.pisiT?.(
        'API yalnızca güvenilen, uygulama içine alınmış eklentileri çalıştırır; proje klasöründen kendiliğinden kod yüklemez.'
    ) || 'API yalnızca güvenilen, uygulama içine alınmış eklentileri çalıştırır; proje klasöründen kendiliğinden kod yüklemez.';
    container.append(heading, grid, note);
}

function initializePisiExtensionApi() {
    const root = window.Pisi || (window.Pisi = {});
    if (!Object.prototype.hasOwnProperty.call(root, 'extensions')) {
        Object.defineProperty(root, 'extensions', {
            configurable: false,
            enumerable: true,
            writable: false,
            value: Object.freeze({
                apiVersion: PISI_EXTENSION_API_VERSION,
                points: PISI_EXTENSION_POINTS,
                register: registerPisiExtension,
                unregister: unregisterPisiExtension,
                list: listPisiExtensions,
                get: getPisiExtension,
                invoke: invokePisiExtension,
                registerPlugin: registerPisiPlugin,
                deactivatePlugin: deactivatePisiPlugin,
                listPlugins: listPisiPlugins
            })
        });
    }
    registerPisiExtension('exporter', {
        id: 'core.markdown',
        label: 'Markdown dışa aktarıcı',
        formats: ['md'],
        run: ({ nodePath }) => window.pisiProject?.exportNode?.(
            nodePath || window.activeModalNode?.path || window.activeCenterNode?.path,
            'md'
        )
    });
    registerPisiExtension('nodeType', {
        id: 'core.note',
        label: 'Not node’u',
        icon: '◆',
        schema: { content: 'blocks', properties: true }
    });
    registerPisiExtension('exporter', {
        id: 'core.pdf',
        label: 'PDF dışa aktarıcı',
        formats: ['pdf'],
        run: ({ nodePath }) => window.pisiProject?.exportNode?.(
            nodePath || window.activeModalNode?.path || window.activeCenterNode?.path,
            'pdf'
        )
    });
    registerPisiExtension('mapLayout', {
        id: 'core.grid',
        label: 'Izgara yerleşimi',
        run: ({ nodes = [], columns = 4, gapX = 280, gapY = 150 }) => nodes.map((node, index) => ({
            id: node.id,
            x: (index % columns) * gapX,
            y: Math.floor(index / columns) * gapY,
            width: Number(node.layout?.width || 220),
            height: Number(node.layout?.height || 92)
        }))
    });

    document.addEventListener('pisi:extensions-changed', (event) => {
        if (event.detail?.point === 'toolbarTool') {
            document.querySelectorAll('[data-pisi-unified-toolbar]')
                .forEach((rootElement) => mountPisiToolbarExtensions(rootElement.parentElement));
        }
        if (event.detail?.point === 'rightPanel') installPisiRightPanelExtensions();
    });
    document.addEventListener('DOMContentLoaded', () => {
        window.registerPisiCommandCenterPage?.({
            id: 'extensions',
            label: 'Eklentiler',
            order: 70,
            render: renderPisiExtensionsPage
        });
        installPisiRightPanelExtensions();
    });
}

const moduleApi = {
    PISI_EXTENSION_API_VERSION,
    PISI_EXTENSION_POINTS,
    registerPisiExtension,
    unregisterPisiExtension,
    listPisiExtensions,
    getPisiExtension,
    invokePisiExtension,
    registerPisiPlugin,
    deactivatePisiPlugin,
    listPisiPlugins,
    mountPisiToolbarExtensions,
    installPisiRightPanelExtensions,
    renderPisiExtensionsPage,
    initializePisiExtensionApi
};

registerModule('core.extensions', moduleApi);
initializePisiExtensionApi();

export {
    PISI_EXTENSION_API_VERSION,
    PISI_EXTENSION_POINTS,
    deactivatePisiPlugin,
    getPisiExtension,
    installPisiRightPanelExtensions,
    invokePisiExtension,
    listPisiExtensions,
    listPisiPlugins,
    mountPisiToolbarExtensions,
    registerPisiExtension,
    registerPisiPlugin,
    renderPisiExtensionsPage,
    unregisterPisiExtension
};
