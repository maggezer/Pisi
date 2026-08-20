'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const hardeningSource = fs.readFileSync(
    path.join(root, 'main/functions/map-node-create-hardening.js'),
    'utf8'
);
const workspaceSource = fs.readFileSync(
    path.join(root, 'renderer/map/pisi-map-workspace.mjs'),
    'utf8'
);

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function makeBackendHarness(projectFolder, mapPath, desiredSidecarName) {
    const ipcHandlers = new Map();
    let nodeCounter = 0;

    const ipcMain = {
        removeHandler(name) {
            ipcHandlers.delete(name);
        },
        handle(name, handler) {
            ipcHandlers.set(name, handler);
        }
    };

    const context = vm.createContext({
        console: {
            warn() {},
            log() {},
            error() {}
        },
        require(request) {
            if (request === 'electron') return { ipcMain };
            if (request === 'fs') return fs;
            if (request === 'path') return path;
            if (request === '../module-registry') {
                return { registerMainModule() {} };
            }
            throw new Error(`Beklenmeyen test require: ${request}`);
        },
        readJsonFileSafe(targetPath) {
            try {
                return readJson(targetPath);
            } catch {
                return null;
            }
        },
        ensurePisiFileMetadata(targetPath) {
            const data = readJson(targetPath);
            const ext = path.extname(targetPath).toLowerCase();

            if (ext === '.map') {
                if (!data.pisi || typeof data.pisi !== 'object') {
                    data.pisi = data.kedi && typeof data.kedi === 'object'
                        ? { ...data.kedi }
                        : {};
                }
                delete data.kedi;
                data.pisi.version = 1;
                data.pisi.type = 'map';
                data.pisi.title = 'Legacy Map';
                data.pisi.sidecar = desiredSidecarName;
                if (!data.pisi.id) data.pisi.id = 'map_legacy_e2e';

                const sidecarPath = path.join(
                    path.dirname(targetPath),
                    desiredSidecarName
                );
                fs.mkdirSync(sidecarPath, { recursive: true });
                writeJson(targetPath, data);

                return {
                    ok: true,
                    metadata: data.pisi,
                    sidecarPath,
                    data
                };
            }

            if (ext === '.node' && data.pisi?.id) {
                return {
                    ok: true,
                    metadata: data.pisi,
                    sidecarPath: null,
                    data
                };
            }

            return {
                ok: false,
                error: 'Test belgesi okunamadı.'
            };
        },
        normalizePathForCompare(targetPath) {
            const normalized = path.resolve(targetPath).replace(/[\\/]+/g, '/');
            return process.platform === 'win32'
                ? normalized.toLowerCase()
                : normalized;
        },
        markInternalFileChange() {},
        sealInternalFileChange() {},
        renamePathInternal(oldPath, newPath) {
            fs.renameSync(oldPath, newPath);
        },
        getPisiFileExt(targetPath) {
            return path.extname(targetPath).toLowerCase();
        },
        createUniquePisiFile(folderPath, ext, options = {}) {
            assert.equal(ext, '.node');
            nodeCounter += 1;
            const id = `node_e2e_${nodeCounter}`;
            const fileName = `Yeni Node ${nodeCounter}.node`;
            const fullPath = path.join(folderPath, fileName);
            const data = {
                pisi: {
                    version: 1,
                    type: 'node',
                    id,
                    title: `Yeni Node ${nodeCounter}`,
                    parentMap: options.parentMap || 'none'
                },
                content: '<p>Yeni içerik</p>',
                properties: {}
            };
            writeJson(fullPath, data);
            return {
                ok: true,
                fileName,
                fullPath,
                metadata: data.pisi,
                sidecarPath: null
            };
        },
        normalizePisiId(value, ext) {
            const raw = String(value || '');
            const prefix = ext === '.map' ? 'map_' : 'node_';
            return raw.startsWith(prefix) ? raw : null;
        },
        getDefaultNodeLayout(index) {
            const col = index % 4;
            const row = Math.floor(index / 4);
            return {
                x: 80 + col * 240,
                y: 80 + row * 150,
                width: 220,
                height: 92
            };
        },
        normalizePisiNodeLayout(layout = {}, fallback = {}) {
            return {
                x: Number.isFinite(Number(layout.x)) ? Number(layout.x) : fallback.x,
                y: Number.isFinite(Number(layout.y)) ? Number(layout.y) : fallback.y,
                width: Number.isFinite(Number(layout.width))
                    ? Number(layout.width)
                    : fallback.width,
                height: Number.isFinite(Number(layout.height))
                    ? Number(layout.height)
                    : fallback.height
            };
        },
        normalizePisiMapNodeCustomization() {
            return {};
        },
        writePisiDocument(targetPath, data) {
            writeJson(targetPath, data);
        },
        stripPreviewText(value) {
            return String(value || '').replace(/<[^>]+>/g, ' ').trim();
        },
        projectOperation(operation) {
            try {
                return operation();
            } catch (error) {
                return { ok: false, error: error.message };
            }
        },
        assertProjectPath(targetPath) {
            const resolved = path.resolve(targetPath);
            const relative = path.relative(projectFolder, resolved);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                throw new Error('Test yolu proje dışında.');
            }
            return resolved;
        },
        listNodesForMap() {
            throw new Error('Yeni node oluşturma eski node listesini parse etmemeli.');
        }
    });

    vm.runInContext(
        `${hardeningSource}\nglobalThis.__pisiCreateE2E = createPisiMapNodeResilient;`,
        context,
        { filename: 'map-node-create-hardening.js' }
    );

    return {
        createNode: context.__pisiCreateE2E
    };
}

function extractRendererCreateFunction() {
    const start = workspaceSource.indexOf(
        'async function createMapNodeBoxAtClientPoint'
    );
    const end = workspaceSource.indexOf(
        '\nfunction hidePisiMapContextMenu',
        start
    );
    assert.ok(start >= 0, 'Renderer nodebox oluşturma fonksiyonu bulunmalı.');
    assert.ok(end > start, 'Renderer nodebox oluşturma fonksiyonu tam okunmalı.');
    return workspaceSource.slice(start, end);
}

test('old-format map creates node file, nodebox and persisted layout together', async () => {
    const projectFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), 'pisi-old-map-node-e2e-')
    );

    try {
        const mapPath = path.join(projectFolder, 'Legacy Map.map');
        const oldSidecarName = 'legacy_nodes_before_pisi';
        const oldSidecarPath = path.join(projectFolder, oldSidecarName);
        const desiredSidecarName = 'nd_Legacy Map__map_legacy_e2e';
        const desiredSidecarPath = path.join(projectFolder, desiredSidecarName);

        fs.mkdirSync(oldSidecarPath, { recursive: true });
        fs.writeFileSync(
            path.join(oldSidecarPath, 'old-broken.node'),
            '{ this old node is intentionally unreadable',
            'utf8'
        );

        writeJson(mapPath, {
            kedi: {
                version: 1,
                type: 'map',
                id: 'map_legacy_e2e',
                title: 'Legacy Map',
                sidecar: oldSidecarName,
                createdAt: '2025-01-01T00:00:00.000Z',
                updatedAt: '2025-01-01T00:00:00.000Z'
            },
            map: {
                nodes: 'legacy-invalid-layout-container',
                edges: null,
                camera: null
            }
        });

        const backend = makeBackendHarness(
            projectFolder,
            mapPath,
            desiredSidecarName
        );
        const alerts = [];
        let appendedNodebox = null;

        const rendererContext = vm.createContext({
            activeMapPath: mapPath,
            activeMapNodes: [],
            window: {
                pisiProject: {
                    async createNodeUnderMap(requestedMapPath) {
                        assert.equal(requestedMapPath, mapPath);
                        return backend.createNode(requestedMapPath);
                    }
                }
            },
            getMapWorldPointFromClient(clientX, clientY) {
                return { x: clientX, y: clientY };
            },
            suppressNextFileSystemRefresh() {},
            alert(message) {
                alerts.push(String(message));
            },
            appendMapNodeBox(node) {
                appendedNodebox = {
                    id: node.id,
                    fullPath: node.fullPath,
                    layout: { ...node.layout }
                };
            },
            async saveCurrentMapLayout() {
                const data = readJson(mapPath);
                for (const node of rendererContext.activeMapNodes) {
                    const stored = data.map.nodes.find((item) => item.id === node.id);
                    assert.ok(stored, 'Backend yeni node layout kaydını önce oluşturmalı.');
                    Object.assign(stored, node.layout);
                }
                writeJson(mapPath, data);
                return { ok: true };
            },
            async refreshActiveMapTreeBranch() {},
            refreshPisiTagsPanelSoon() {}
        });

        vm.runInContext(
            `${extractRendererCreateFunction()}\nglobalThis.__createNodeboxE2E = createMapNodeBoxAtClientPoint;`,
            rendererContext,
            { filename: 'pisi-map-workspace-create-nodebox.mjs' }
        );

        await rendererContext.__createNodeboxE2E(500, 300);

        assert.deepEqual(alerts, []);
        assert.ok(appendedNodebox, 'Yeni node renderer tarafından nodebox olarak eklenmeli.');
        assert.ok(fs.existsSync(appendedNodebox.fullPath), 'Yeni .node dosyası diskte bulunmalı.');
        assert.equal(path.dirname(appendedNodebox.fullPath), desiredSidecarPath);
        assert.equal(fs.existsSync(oldSidecarPath), false);
        assert.equal(fs.existsSync(desiredSidecarPath), true);
        assert.equal(
            fs.existsSync(path.join(desiredSidecarPath, 'old-broken.node')),
            true,
            'Eski sidecar içeriği migration sırasında korunmalı.'
        );

        const persistedMap = readJson(mapPath);
        assert.equal(persistedMap.kedi, undefined);
        assert.equal(persistedMap.pisi.id, 'map_legacy_e2e');
        assert.equal(persistedMap.pisi.sidecar, desiredSidecarName);
        assert.ok(Array.isArray(persistedMap.map.nodes));

        const storedLayout = persistedMap.map.nodes.find(
            (item) => item.id === appendedNodebox.id
        );
        assert.ok(storedLayout, 'Yeni node ID’si map layout kaydında bulunmalı.');
        assert.deepEqual(
            {
                x: storedLayout.x,
                y: storedLayout.y,
                width: storedLayout.width,
                height: storedLayout.height
            },
            appendedNodebox.layout
        );
        assert.deepEqual(appendedNodebox.layout, {
            x: 390,
            y: 254,
            width: 220,
            height: 92
        });
    } finally {
        fs.rmSync(projectFolder, { recursive: true, force: true });
    }
});
