import { registerModule } from "../core/module-registry.mjs";
import {
    PISI_SEARCH_FIELD_WEIGHTS,
    buildPisiSearchAccelerator,
    pisiSearchPathKey
} from "./pisi-search-core.mjs";
import {
    classifyPisiSearchChangedPaths,
    removePisiSearchMapMemberships,
    replacePisiSearchMapRecord,
    replacePisiSearchNodeRecords,
    upsertPisiSearchMapMembership
} from './pisi-search-filesystem-delta-core.mjs';

let pisiSearchIndexCache = null;
let pisiSearchBuildPromise = null;
let pisiSearchIndexGeneration = 0;
let pisiSearchFileSystemUnsubscribe = null;
let pisiSearchDeltaPromise = Promise.resolve();
let pisiSearchDeltaActive = false;
const pisiSearchDocumentCache = new Map();

function getPisiSearchMetadataSignature(rawNode = {}) {
    const metadata = rawNode.metadata || rawNode.item?.metadata || {};
    return [
        metadata.id || '',
        metadata.updatedAt || '',
        metadata.title || '',
        JSON.stringify(rawNode.properties || rawNode.item?.properties || {}).length
    ].join('|');
}

function getPisiSearchDocumentSignature(rawNode = {}) {
    const content = String(rawNode.content || '');
    let sampleHash = 2166136261;
    const step = Math.max(1, Math.floor(content.length / 512));
    for (let index = 0; index < content.length; index += step) {
        sampleHash ^= content.charCodeAt(index);
        sampleHash = Math.imul(sampleHash, 16777619);
    }
    return `${getPisiSearchMetadataSignature(rawNode)}|${content.length}|${sampleHash >>> 0}`;
}

function yieldPisiSearchBuild() {
    return new Promise((resolve) => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(resolve, { timeout: 24 });
        } else {
            setTimeout(resolve, 0);
        }
    });
}

function cleanPisiSearchText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getPisiSearchFileName(path = '') {
    return String(path || '').split(/[\\/]/).pop() || '';
}

function getPisiSearchParentPath(filePath = '') {
    const value = String(filePath || '');
    const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return slash > 0 ? value.slice(0, slash) : '';
}

function getPisiSearchRelativePath(path, projectFolder) {
    const normalizedPath = String(path || '').replace(/[\\/]+/g, '/');
    const normalizedProject = String(projectFolder || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');
    const comparisonPath = window.pisiEnvironment?.platform === 'win32'
        ? normalizedPath.toLowerCase()
        : normalizedPath;
    const comparisonProject = window.pisiEnvironment?.platform === 'win32'
        ? normalizedProject.toLowerCase()
        : normalizedProject;

    if (
        comparisonProject &&
        (
            comparisonPath === comparisonProject ||
            comparisonPath.startsWith(comparisonProject + '/')
        )
    ) {
        return normalizedPath
            .slice(normalizedProject.length)
            .replace(/^\/+/, '') || getPisiSearchFileName(path);
    }

    return normalizedPath;
}

function getPisiSearchNodeTitle(item, metadata = {}) {
    return cleanPisiSearchText(
        metadata?.title ||
        item?.metadata?.title ||
        item?.displayName ||
        String(item?.fileName || item?.name || '').replace(/\.node$/i, '') ||
        'Node'
    );
}

function getPisiSearchMapTitle(item) {
    return cleanPisiSearchText(
        item?.metadata?.title ||
        item?.displayName ||
        String(item?.fileName || item?.name || '').replace(/\.map$/i, '') ||
        'Map'
    );
}

function getPisiSearchBlockId(element) {
    return element?.closest?.('[data-pisi-block-id]')
        ?.getAttribute('data-pisi-block-id') || null;
}

function extractPisiDirectTitles(container, plainText) {
    const titles = [];
    const wikiPattern = /\[\[([^\]\n]{1,200})\]\]/g;
    let match;

    while ((match = wikiPattern.exec(plainText)) !== null) {
        const title = cleanPisiSearchText(match[1]);
        if (title) titles.push(title);
    }

    container.querySelectorAll('a').forEach((anchor) => {
        const title = cleanPisiSearchText(
            anchor.dataset?.pisiNodeTitle ||
            anchor.textContent ||
            ''
        );
        if (title) titles.push(title);
    });

    return Array.from(new Set(titles));
}

function extractPisiUnlinkedText(container, plainText) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll('a').forEach((anchor) => anchor.remove());
    return cleanPisiSearchText(
        (clone.textContent || plainText).replace(
            /\[\[[^\]\n]{1,200}\]\]/g,
            ' '
        )
    );
}

function extractPisiSearchTags(container) {
    return Array.from(container.querySelectorAll(
        '.pisi-user-tag[data-pisi-tag]'
    )).map((element) => ({
        value: cleanPisiSearchText(
            element.dataset.pisiTag || element.textContent || ''
        ).replace(/^(?:\.\.|#|\/)/, ''),
        blockId: getPisiSearchBlockId(element),
        element
    })).filter((tag) => tag.value);
}

function extractPisiSearchTasks(container, tags) {
    const tasks = [];

    for (const tag of tags) {
        if (!/^todo\./i.test(tag.value)) continue;
        const block = tag.element.closest(
            '.pisi-editor-block, p, div, li, h1, h2, h3, h4, h5, h6'
        );
        const normalizedTodo = tag.value.toLocaleLowerCase('tr-TR');
        const source = Array.from(
            block?.querySelectorAll?.(
                '.pisi-todo-source[data-pisi-todo-for]'
            ) || []
        ).find((candidate) => {
            return cleanPisiSearchText(
                candidate.dataset.pisiTodoFor || ''
            ).replace(/^(?:\.\.|#|\/)/, '')
                .toLocaleLowerCase('tr-TR') === normalizedTodo;
        });
        const text = cleanPisiSearchText(
            source?.textContent || block?.textContent || tag.value
        );

        tasks.push({
            text,
            todoTag: tag.value,
            blockId: tag.blockId,
            status: tag.element.dataset.pisiTodoStatus || 'todo'
        });
    }

    return tasks;
}

function extractPisiSearchContentBlocks(container) {
    let elements = Array.from(container.querySelectorAll(
        '.pisi-editor-block[data-pisi-block-id]'
    ));

    if (!elements.length) {
        elements = Array.from(container.querySelectorAll(
            'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre'
        ));
    }

    const blocks = elements.slice(0, 5000).map((element, index) => {
        const references = [];
        const sourceText = String(element.textContent || '');
        for (const match of sourceText.matchAll(/\[\[([^\]\n#]+)#\^?([^\]\n]+)\]\]/g)) {
            references.push({
                raw: match[0],
                target: cleanPisiSearchText(match[1]),
                blockId: cleanPisiSearchText(match[2]),
                kind: 'link'
            });
        }
        for (const match of sourceText.matchAll(/\(\((blk_[A-Za-z0-9_-]+)\)\)/g)) {
            references.push({
                raw: match[0],
                target: '',
                blockId: match[1],
                kind: 'mention'
            });
        }
        const clone = element.cloneNode(true);
        clone.querySelectorAll(
            'table, canvas, .pisi-user-tag, .pisi-todo-source'
        ).forEach((child) => child.remove());
        return {
            text: cleanPisiSearchText(clone.textContent || ''),
            blockId: element.getAttribute('data-pisi-block-id') || null,
            blockType: element.getAttribute('data-pisi-block-type') ||
                element.tagName.toLowerCase(),
            references,
            order: index
        };
    }).filter((block) => block.text);

    if (!blocks.length) {
        const text = cleanPisiSearchText(container.textContent || '');
        if (text) blocks.push({ text, blockId: null, order: 0 });
    }
    return blocks;
}

function extractPisiSearchTables(container) {
    return Array.from(container.querySelectorAll('table')).map((table) => ({
        text: cleanPisiSearchText(table.textContent || ''),
        blockId: getPisiSearchBlockId(table)
    })).filter((table) => table.text);
}

function makePisiSearchMembership(map, node) {
    return {
        mapPath: map.path,
        mapTitle: map.title,
        mapItem: map.item,
        nodeId: node.id,
        layout: node.layout || null
    };
}

function createPisiSearchDocumentRecord(rawNode, projectFolder) {
    const template = document.createElement('template');
    template.innerHTML = String(rawNode?.content || '');
    const container = template.content;

    container.querySelectorAll(
        'script, style, iframe, object, embed, .pisi-canvas-toolbar-hint'
    ).forEach((element) => element.remove());

    const plainText = cleanPisiSearchText(container.textContent || '');
    const tags = extractPisiSearchTags(container);
    const tasks = extractPisiSearchTasks(container, tags);
    const title = getPisiSearchNodeTitle(rawNode.item, rawNode.metadata);
    const path = rawNode.path;
    const relativePath = getPisiSearchRelativePath(path, projectFolder);

    return {
        path,
        fileName: rawNode.item?.fileName ||
            rawNode.item?.name ||
            getPisiSearchFileName(path),
        title,
        metadata: rawNode.metadata || rawNode.item?.metadata || {},
        properties: rawNode.properties || rawNode.item?.properties || {},
        nodeItem: {
            ...(rawNode.item || {}),
            name: rawNode.item?.name || getPisiSearchFileName(path),
            fileName: rawNode.item?.fileName || getPisiSearchFileName(path),
            fullPath: path,
            type: 'file',
            isFile: true,
            isDirectory: false,
            metadata: rawNode.metadata || rawNode.item?.metadata || {}
        },
        html: String(rawNode.content || ''),
        plainText,
        unlinkedText: extractPisiUnlinkedText(container, plainText),
        directTitles: extractPisiDirectTitles(container, plainText),
        contentBlocks: extractPisiSearchContentBlocks(container),
        tables: extractPisiSearchTables(container),
        tags: tags.map(({ value, blockId }) => ({ value, blockId })),
        tasks,
        memberships: Array.isArray(rawNode.memberships)
            ? rawNode.memberships
            : [],
        relativePath
    };
}

function makePisiSearchRecordBase(documentRecord) {
    const membership = documentRecord.memberships[0] || null;
    return {
        nodePath: documentRecord.path,
        nodeTitle: documentRecord.title,
        title: documentRecord.title,
        fileName: documentRecord.fileName,
        relativePath: documentRecord.relativePath,
        nodeItem: documentRecord.nodeItem,
        mapPath: membership?.mapPath || null,
        mapTitle: membership?.mapTitle || '',
        mapItem: membership?.mapItem || null
    };
}

function createPisiSearchRecordsForDocument(documentRecord) {
    const base = makePisiSearchRecordBase(documentRecord);
    const records = [{
        ...base,
        id: 'node:' + pisiSearchPathKey(documentRecord.path),
        kind: 'node',
        preview: documentRecord.memberships.length
            ? documentRecord.memberships.map((item) => item.mapTitle).join(', ')
            : documentRecord.relativePath,
        searchFields: [
            {
                kind: 'title',
                value: documentRecord.title,
                weight: PISI_SEARCH_FIELD_WEIGHTS.title
            },
            {
                kind: 'map',
                value: documentRecord.memberships
                    .map((item) => item.mapTitle)
                    .join(' '),
                weight: PISI_SEARCH_FIELD_WEIGHTS.map
            },
            {
                kind: 'path',
                value: documentRecord.relativePath,
                weight: PISI_SEARCH_FIELD_WEIGHTS.path
            }
        ]
    }];

    documentRecord.contentBlocks.forEach((block, index) => {
        records.push({
            ...base,
            id: 'content:' + pisiSearchPathKey(documentRecord.path) +
                ':' + (block.blockId || index),
            kind: 'content',
            blockId: block.blockId,
            preview: block.text,
            searchFields: [{ kind: 'content', value: block.text }]
        });
    });

    documentRecord.tasks.forEach((task, index) => {
        records.push({
            ...base,
            id: 'task:' + pisiSearchPathKey(documentRecord.path) +
                ':' + (task.blockId || index) + ':' + task.todoTag,
            kind: 'task',
            blockId: task.blockId,
            todoTag: task.todoTag,
            sourceText: task.text,
            preview: task.text,
            searchFields: [
                { kind: 'task', value: task.text },
                { kind: 'tag', value: task.todoTag }
            ]
        });
    });

    documentRecord.tags
        .filter((tag) => !/^todo\./i.test(tag.value))
        .forEach((tag, index) => {
            records.push({
                ...base,
                id: 'tag:' + pisiSearchPathKey(documentRecord.path) +
                    ':' + (tag.blockId || index) + ':' + tag.value,
                kind: 'tag',
                blockId: tag.blockId,
                tag: tag.value,
                preview: '#' + tag.value,
                searchFields: [{ kind: 'tag', value: tag.value }]
            });
        });

    documentRecord.tables.forEach((table, index) => {
        records.push({
            ...base,
            id: 'table:' + pisiSearchPathKey(documentRecord.path) +
                ':' + (table.blockId || index),
            kind: 'table',
            blockId: table.blockId,
            preview: table.text,
            searchFields: [{ kind: 'table', value: table.text }]
        });
    });

    return records;
}

function makePisiRawNode(item, content = '', metadata = null) {
    return {
        path: item.fullPath,
        item,
        content: String(content || ''),
        metadata: metadata || item.metadata || {},
        properties: item.properties || {},
        memberships: []
    };
}

function upsertPisiRawNode(rawNodes, item, content, metadata, membership) {
    const key = pisiSearchPathKey(item?.fullPath);
    if (!key) return;
    let node = rawNodes.get(key);

    if (!node) {
        node = makePisiRawNode(item, content, metadata);
        rawNodes.set(key, node);
    } else {
        node.item = { ...node.item, ...item };
        if (content !== undefined && content !== null) {
            node.content = String(content || '');
        }
        node.metadata = metadata || node.metadata || {};
        node.properties = item.properties || node.properties || {};
    }

    if (
        membership &&
        !node.memberships.some((existing) => {
            return pisiSearchPathKey(existing.mapPath) ===
                pisiSearchPathKey(membership.mapPath);
        })
    ) {
        node.memberships.push(membership);
    }
}

function makePisiSearchMapRecord(item, mapResult) {
    const fileName = String(item?.name || item?.fileName || getPisiSearchFileName(item?.fullPath));
    const mapRecord = {
        path: item.fullPath,
        title: getPisiSearchMapTitle(item),
        item: {
            ...item,
            fileName,
            name: fileName,
            metadata: item?.metadata || {}
        },
        nodes: [],
        edges: Array.isArray(mapResult?.edges) ? mapResult.edges : []
    };

    for (const node of mapResult?.nodes || []) {
        const nodeItem = {
            ...node,
            name: node.fileName,
            fileName: node.fileName,
            type: 'file',
            isFile: true,
            isDirectory: false
        };
        mapRecord.nodes.push({
            id: node.id,
            path: node.fullPath,
            title: getPisiSearchNodeTitle(nodeItem, node.metadata),
            layout: node.layout || null
        });
    }
    return mapRecord;
}

function makePisiSearchMapSearchRecord(map, projectFolder) {
    const relativePath = getPisiSearchRelativePath(map.path, projectFolder);
    return {
        id: 'map:' + pisiSearchPathKey(map.path),
        kind: 'map',
        title: map.title,
        mapTitle: map.title,
        mapPath: map.path,
        mapItem: map.item,
        relativePath,
        preview: relativePath,
        searchFields: [
            { kind: 'title', value: map.title },
            { kind: 'path', value: relativePath }
        ]
    };
}

function cachePisiSearchDocument(rawNode, documentRecord) {
    const key = pisiSearchPathKey(documentRecord?.path || rawNode?.path);
    if (!key) return;
    pisiSearchDocumentCache.set(key, {
        signature: getPisiSearchDocumentSignature(rawNode),
        metadataSignature: getPisiSearchMetadataSignature(rawNode),
        document: documentRecord
    });
}

async function scanPisiSearchFolder(folderPath, context) {
    const result = await window.pisiProject?.listFolder?.(folderPath);
    if (!result?.ok || !Array.isArray(result.items)) {
        context.complete = false;
        context.errors.push(result?.error || 'Klasör listelenemedi: ' + folderPath);
        return;
    }

    for (const item of result.items) {
        if (context.generation !== pisiSearchIndexGeneration) return;
        if (item?.isDirectory) {
            await scanPisiSearchFolder(item.fullPath, context);
            continue;
        }
        if (!item?.isFile || !item.fullPath) continue;
        const fileName = String(item.name || item.fileName || '');

        if (/\.node$/i.test(fileName)) {
            upsertPisiRawNode(
                context.rawNodes,
                { ...item, fileName, name: fileName },
                null,
                item.metadata,
                null
            );
            continue;
        }
        if (!/\.map$/i.test(fileName)) continue;

        const mapResult = await window.pisiProject?.listMapNodes?.(item.fullPath);
        const mapRecord = makePisiSearchMapRecord(item, mapResult);
        context.maps.push(mapRecord);
        if (!mapResult?.ok) {
            context.complete = false;
            context.errors.push(mapResult?.error || 'Map okunamadı: ' + item.fullPath);
            continue;
        }

        for (const node of mapResult.nodes || []) {
            const nodeItem = {
                ...node,
                name: node.fileName,
                fileName: node.fileName,
                type: 'file',
                isFile: true,
                isDirectory: false
            };
            const membership = makePisiSearchMembership(mapRecord, node);
            upsertPisiRawNode(
                context.rawNodes,
                nodeItem,
                node.content,
                node.metadata,
                membership
            );
        }
    }
}

async function hydratePisiStandaloneNodes(rawNodes, context) {
    const pending = [];
    for (const node of rawNodes.values()) {
        if (node.content || node.memberships.length) continue;
        const cached = pisiSearchDocumentCache.get(pisiSearchPathKey(node.path));
        if (
            cached &&
            cached.metadataSignature === getPisiSearchMetadataSignature(node)
        ) {
            node.content = cached.document.html;
            node.metadata = cached.document.metadata;
            node.properties = cached.document.properties;
        } else {
            pending.push(node);
        }
    }

    for (let offset = 0; offset < pending.length; offset += 12) {
        if (context.generation !== pisiSearchIndexGeneration) return;
        const batch = pending.slice(offset, offset + 12);
        const results = await Promise.all(batch.map((node) => {
            return window.pisiProject?.getPisiDocument?.(node.path);
        }));

        results.forEach((result, index) => {
            const node = batch[index];
            if (!result?.ok) {
                context.complete = false;
                context.errors.push(result?.error || 'Node okunamadı: ' + node.path);
                return;
            }
            node.content = String(result.data?.content || '');
            node.metadata = result.metadata || node.metadata || {};
            node.properties = result.data?.properties || {};
            node.item = {
                ...node.item,
                metadata: node.metadata,
                properties: node.properties
            };
        });
    }
}

async function buildPisiSearchIndex(projectFolder, generation) {
    const context = {
        generation,
        projectFolder,
        rawNodes: new Map(),
        maps: [],
        complete: true,
        errors: [],
        parsedDocuments: 0,
        reusedDocuments: 0
    };

    await scanPisiSearchFolder(projectFolder, context);
    await hydratePisiStandaloneNodes(context.rawNodes, context);
    if (generation !== pisiSearchIndexGeneration) return null;

    const documents = new Map();
    const records = context.maps.map((map) => {
        return makePisiSearchMapSearchRecord(map, projectFolder);
    });

    let documentOffset = 0;
    const seenDocumentKeys = new Set();
    for (const rawNode of context.rawNodes.values()) {
        const key = pisiSearchPathKey(rawNode.path);
        seenDocumentKeys.add(key);
        const signature = getPisiSearchDocumentSignature(rawNode);
        const cached = pisiSearchDocumentCache.get(key);
        let documentRecord;
        if (cached?.signature === signature) {
            documentRecord = {
                ...cached.document,
                metadata: rawNode.metadata || cached.document.metadata,
                properties: rawNode.properties || cached.document.properties,
                nodeItem: {
                    ...cached.document.nodeItem,
                    ...(rawNode.item || {})
                },
                memberships: Array.isArray(rawNode.memberships)
                    ? rawNode.memberships
                    : []
            };
            context.reusedDocuments += 1;
        } else {
            documentRecord = createPisiSearchDocumentRecord(rawNode, projectFolder);
            context.parsedDocuments += 1;
        }
        cachePisiSearchDocument(rawNode, documentRecord);
        documents.set(key, documentRecord);
        records.push(...createPisiSearchRecordsForDocument(documentRecord));
        documentOffset += 1;
        if (documentOffset % 120 === 0) await yieldPisiSearchBuild();
        if (generation !== pisiSearchIndexGeneration) return null;
    }

    if (context.complete) {
        for (const key of pisiSearchDocumentCache.keys()) {
            if (!seenDocumentKeys.has(key)) pisiSearchDocumentCache.delete(key);
        }
    }

    const accelerator = buildPisiSearchAccelerator(records);
    return {
        projectFolder,
        projectKey: pisiSearchPathKey(projectFolder),
        builtAt: Date.now(),
        updatedAt: Date.now(),
        deltaGeneration: 0,
        complete: context.complete,
        errors: context.errors,
        maps: context.maps,
        documents,
        records,
        accelerator,
        performance: {
            parsedDocuments: context.parsedDocuments,
            reusedDocuments: context.reusedDocuments,
            recordCount: records.length,
            gramCount: accelerator.gramCount,
            scopedDeltaCount: 0
        }
    };
}

async function ensurePisiSearchIndex(options = {}) {
    const projectFolder = window.currentProjectFolder;
    if (!projectFolder) return null;
    const projectKey = pisiSearchPathKey(projectFolder);

    if (!options.force && pisiSearchIndexCache?.projectKey === projectKey) {
        return pisiSearchIndexCache;
    }
    if (
        !options.force &&
        pisiSearchBuildPromise &&
        pisiSearchBuildPromise.projectKey === projectKey
    ) {
        return pisiSearchBuildPromise.promise;
    }

    const generation = ++pisiSearchIndexGeneration;
    const promise = buildPisiSearchIndex(projectFolder, generation)
        .then((index) => {
            if (index && generation === pisiSearchIndexGeneration) {
                pisiSearchIndexCache = index;
                document.dispatchEvent(new CustomEvent(
                    'pisi:search-index-ready',
                    { detail: { index, mode: 'rebuild' } }
                ));
            }
            return index;
        })
        .finally(() => {
            if (pisiSearchBuildPromise?.generation === generation) {
                pisiSearchBuildPromise = null;
            }
        });

    pisiSearchBuildPromise = { projectKey, generation, promise };
    return promise;
}

function invalidatePisiSearchIndex(reason = 'filesystem', changedPaths = []) {
    const paths = Array.isArray(changedPaths) ? changedPaths.filter(Boolean) : [];
    if (reason === 'project' || reason === 'project-change') {
        pisiSearchDocumentCache.clear();
    } else {
        for (const changedPath of paths) {
            const changedKey = pisiSearchPathKey(changedPath);
            for (const key of pisiSearchDocumentCache.keys()) {
                if (key === changedKey || key.startsWith(changedKey + '/')) {
                    pisiSearchDocumentCache.delete(key);
                }
            }
        }
    }
    pisiSearchIndexGeneration += 1;
    pisiSearchIndexCache = null;
    pisiSearchBuildPromise = null;
    document.dispatchEvent(new CustomEvent(
        'pisi:search-index-invalidated',
        { detail: { reason, changedPaths: paths } }
    ));
}

function refreshPisiSearchIndex() {
    invalidatePisiSearchIndex('refresh');
    return ensurePisiSearchIndex({ force: true });
}

async function inspectPisiSearchPath(filePath) {
    const parentPath = getPisiSearchParentPath(filePath);
    if (!parentPath) {
        return { ok: false, exists: false, error: 'Parent path is unavailable.' };
    }
    const result = await window.pisiProject?.listFolder?.(parentPath);
    if (!result?.ok || !Array.isArray(result.items)) {
        return {
            ok: false,
            exists: false,
            error: result?.error || 'Parent folder could not be listed.'
        };
    }
    const targetKey = pisiSearchPathKey(filePath);
    const fileName = getPisiSearchFileName(filePath).toLocaleLowerCase('en-US');
    const item = result.items.find((candidate) => {
        if (pisiSearchPathKey(candidate?.fullPath) === targetKey) return true;
        const candidateName = String(candidate?.name || candidate?.fileName || '')
            .toLocaleLowerCase('en-US');
        return candidateName === fileName;
    }) || null;
    return { ok: true, exists: Boolean(item), item };
}

function inferPisiSearchMemberships(maps, nodePath, nodeId) {
    const pathKey = pisiSearchPathKey(nodePath);
    const memberships = [];
    for (const map of maps || []) {
        const node = (map.nodes || []).find((candidate) => {
            return (nodeId && candidate?.id === nodeId) ||
                pisiSearchPathKey(candidate?.path) === pathKey;
        });
        if (node) memberships.push(makePisiSearchMembership(map, node));
    }
    return memberships;
}

function recachePisiSearchDocumentRecord(documentRecord) {
    if (!documentRecord?.path) return;
    cachePisiSearchDocument({
        path: documentRecord.path,
        item: documentRecord.nodeItem,
        content: documentRecord.html,
        metadata: documentRecord.metadata,
        properties: documentRecord.properties,
        memberships: documentRecord.memberships
    }, documentRecord);
}

async function applyPisiSearchMapDelta(state, mapPath) {
    const mapKey = pisiSearchPathKey(mapPath);
    const previousMap = state.maps.find((map) => {
        return pisiSearchPathKey(map?.path) === mapKey;
    }) || null;
    const probe = await inspectPisiSearchPath(mapPath);
    if (!probe.ok) return { ok: false, error: probe.error };

    const affectedNodePaths = new Set(
        (previousMap?.nodes || []).map((node) => node.path).filter(Boolean)
    );

    if (!probe.exists) {
        state.maps = state.maps.filter((map) => {
            return pisiSearchPathKey(map?.path) !== mapKey;
        });
        for (const nodePath of affectedNodePaths) {
            const nodeKey = pisiSearchPathKey(nodePath);
            const current = state.documents.get(nodeKey);
            if (!current) continue;
            const next = {
                ...current,
                memberships: removePisiSearchMapMemberships(
                    current.memberships,
                    mapPath
                )
            };
            state.documents.set(nodeKey, next);
            recachePisiSearchDocumentRecord(next);
        }
        state.changedMapPaths.add(mapPath);
        for (const nodePath of affectedNodePaths) state.affectedNodePaths.add(nodePath);
        state.removedMapPaths.add(mapPath);
        return { ok: true };
    }

    const mapResult = await window.pisiProject?.listMapNodes?.(mapPath);
    if (!mapResult?.ok) {
        return { ok: false, error: mapResult?.error || 'Map could not be read.' };
    }
    const mapItem = {
        ...(probe.item || {}),
        fullPath: mapPath,
        name: probe.item?.name || getPisiSearchFileName(mapPath),
        fileName: probe.item?.fileName || probe.item?.name || getPisiSearchFileName(mapPath)
    };
    const nextMap = makePisiSearchMapRecord(mapItem, mapResult);

    for (const node of nextMap.nodes) affectedNodePaths.add(node.path);
    for (const nodePath of affectedNodePaths) {
        const nodeKey = pisiSearchPathKey(nodePath);
        const current = state.documents.get(nodeKey);
        if (!current) continue;
        const next = {
            ...current,
            memberships: removePisiSearchMapMemberships(current.memberships, mapPath)
        };
        state.documents.set(nodeKey, next);
    }

    for (const node of mapResult.nodes || []) {
        const nodeKey = pisiSearchPathKey(node.fullPath);
        const current = state.documents.get(nodeKey) || null;
        const membership = makePisiSearchMembership(nextMap, node);
        const memberships = upsertPisiSearchMapMembership(
            current?.memberships || [],
            membership
        );
        const metadata = node.metadata || current?.metadata || {};
        const properties = node.properties || current?.properties || {};
        const rawNode = {
            path: node.fullPath,
            item: {
                ...(current?.nodeItem || {}),
                ...node,
                name: node.fileName || getPisiSearchFileName(node.fullPath),
                fileName: node.fileName || getPisiSearchFileName(node.fullPath),
                fullPath: node.fullPath,
                type: 'file',
                isFile: true,
                isDirectory: false,
                metadata,
                properties
            },
            content: node.content !== undefined
                ? String(node.content || '')
                : String(current?.html || ''),
            metadata,
            properties,
            memberships
        };
        const next = createPisiSearchDocumentRecord(rawNode, state.projectFolder);
        state.documents.set(nodeKey, next);
        cachePisiSearchDocument(rawNode, next);
    }

    for (const nodePath of affectedNodePaths) {
        const nodeKey = pisiSearchPathKey(nodePath);
        const current = state.documents.get(nodeKey);
        if (current) recachePisiSearchDocumentRecord(current);
        state.affectedNodePaths.add(nodePath);
    }

    state.maps = [
        ...state.maps.filter((map) => pisiSearchPathKey(map?.path) !== mapKey),
        nextMap
    ];
    state.changedMapPaths.add(mapPath);
    return { ok: true };
}

async function resolvePisiSearchNodeDelta(state, nodePath) {
    const result = await window.pisiProject?.getPisiDocument?.(nodePath);
    if (result?.ok) {
        return { mode: 'upsert', nodePath, result };
    }
    const probe = await inspectPisiSearchPath(nodePath);
    if (!probe.ok) return { mode: 'ambiguous', nodePath, error: probe.error };
    if (probe.exists) {
        return {
            mode: 'ambiguous',
            nodePath,
            error: result?.error || 'Node exists but could not be read.'
        };
    }
    return { mode: 'remove', nodePath };
}

function applyPisiSearchNodeUpsert(state, resolved) {
    const { nodePath, result } = resolved;
    const nodeKey = pisiSearchPathKey(nodePath);
    const current = state.documents.get(nodeKey) || null;
    const metadata = result.metadata || result.data?.pisi || current?.metadata || {};
    const properties = result.data?.properties || current?.properties || {};
    let memberships = Array.isArray(current?.memberships)
        ? current.memberships
        : [];
    if (!memberships.length) {
        memberships = inferPisiSearchMemberships(
            state.maps,
            nodePath,
            metadata?.id
        );
    }
    const fileName = getPisiSearchFileName(nodePath);
    const rawNode = {
        path: nodePath,
        item: {
            ...(current?.nodeItem || {}),
            name: fileName,
            fileName,
            fullPath: nodePath,
            type: 'file',
            isFile: true,
            isDirectory: false,
            metadata,
            properties
        },
        content: String(result.data?.content || ''),
        metadata,
        properties,
        memberships
    };
    const next = createPisiSearchDocumentRecord(rawNode, state.projectFolder);
    state.documents.set(nodeKey, next);
    cachePisiSearchDocument(rawNode, next);
    state.affectedNodePaths.add(nodePath);

    if (metadata?.id) {
        state.maps = state.maps.map((map) => ({
            ...map,
            nodes: (map.nodes || []).map((node) => {
                if (node?.id !== metadata.id) return node;
                return {
                    ...node,
                    path: nodePath,
                    title: next.title
                };
            })
        }));
    }
}

function applyPisiSearchNodeRemove(state, nodePath) {
    const nodeKey = pisiSearchPathKey(nodePath);
    state.documents.delete(nodeKey);
    pisiSearchDocumentCache.delete(nodeKey);
    state.maps = state.maps.map((map) => ({
        ...map,
        nodes: (map.nodes || []).filter((node) => {
            return pisiSearchPathKey(node?.path) !== nodeKey;
        })
    }));
    state.affectedNodePaths.add(nodePath);
    state.removedNodePaths.add(nodePath);
}

function rebuildPisiSearchDeltaRecords(baseIndex, state) {
    let records = Array.isArray(baseIndex.records) ? baseIndex.records : [];
    for (const nodePath of state.affectedNodePaths) {
        const documentRecord = state.documents.get(pisiSearchPathKey(nodePath));
        records = replacePisiSearchNodeRecords(
            records,
            nodePath,
            documentRecord ? createPisiSearchRecordsForDocument(documentRecord) : []
        );
    }
    for (const mapPath of state.changedMapPaths) {
        const map = state.maps.find((candidate) => {
            return pisiSearchPathKey(candidate?.path) === pisiSearchPathKey(mapPath);
        }) || null;
        records = replacePisiSearchMapRecord(
            records,
            mapPath,
            map ? makePisiSearchMapSearchRecord(map, state.projectFolder) : null
        );
    }
    return records;
}

async function applyPisiSearchFilesystemDelta(classification) {
    const baseIndex = pisiSearchIndexCache;
    const startGeneration = pisiSearchIndexGeneration;
    const projectFolder = window.currentProjectFolder;
    const projectKey = pisiSearchPathKey(projectFolder);
    if (
        !baseIndex ||
        baseIndex.projectKey !== projectKey ||
        pisiSearchBuildPromise
    ) {
        return { ok: false, rebuild: true, reason: 'base-index-not-ready' };
    }

    const state = {
        projectFolder,
        maps: Array.isArray(baseIndex.maps) ? baseIndex.maps.map((map) => ({
            ...map,
            nodes: Array.isArray(map.nodes) ? map.nodes.map((node) => ({ ...node })) : []
        })) : [],
        documents: new Map(baseIndex.documents || []),
        affectedNodePaths: new Set(),
        changedMapPaths: new Set(),
        removedNodePaths: new Set(),
        removedMapPaths: new Set()
    };

    for (const mapPath of classification.mapPaths) {
        const result = await applyPisiSearchMapDelta(state, mapPath);
        if (!result.ok) {
            return { ok: false, rebuild: true, reason: 'map-delta-ambiguous', error: result.error };
        }
    }

    const resolvedNodes = [];
    for (const nodePath of classification.nodePaths) {
        resolvedNodes.push(await resolvePisiSearchNodeDelta(state, nodePath));
    }
    const ambiguous = resolvedNodes.find((entry) => entry.mode === 'ambiguous');
    if (ambiguous) {
        return {
            ok: false,
            rebuild: true,
            reason: 'node-delta-ambiguous',
            error: ambiguous.error
        };
    }

    resolvedNodes.filter((entry) => entry.mode === 'upsert')
        .forEach((entry) => applyPisiSearchNodeUpsert(state, entry));
    resolvedNodes.filter((entry) => entry.mode === 'remove')
        .forEach((entry) => applyPisiSearchNodeRemove(state, entry.nodePath));

    if (
        pisiSearchIndexCache !== baseIndex ||
        pisiSearchIndexGeneration !== startGeneration ||
        pisiSearchPathKey(window.currentProjectFolder) !== projectKey
    ) {
        return { ok: false, superseded: true, reason: 'delta-superseded' };
    }

    const records = rebuildPisiSearchDeltaRecords(baseIndex, state);
    const accelerator = buildPisiSearchAccelerator(records);
    const index = {
        ...baseIndex,
        updatedAt: Date.now(),
        deltaGeneration: Number(baseIndex.deltaGeneration || 0) + 1,
        maps: state.maps,
        documents: state.documents,
        records,
        accelerator,
        performance: {
            ...(baseIndex.performance || {}),
            recordCount: records.length,
            gramCount: accelerator.gramCount,
            scopedDeltaCount: Number(baseIndex.performance?.scopedDeltaCount || 0) + 1,
            lastDeltaNodeCount: state.affectedNodePaths.size,
            lastDeltaMapCount: state.changedMapPaths.size
        }
    };
    pisiSearchIndexCache = index;

    const detail = {
        index,
        mode: 'delta',
        delta: {
            changedNodePaths: Array.from(state.affectedNodePaths),
            changedMapPaths: Array.from(state.changedMapPaths),
            removedNodePaths: Array.from(state.removedNodePaths),
            removedMapPaths: Array.from(state.removedMapPaths)
        }
    };
    document.dispatchEvent(new CustomEvent('pisi:search-index-delta-applied', { detail }));
    document.dispatchEvent(new CustomEvent('pisi:search-index-ready', { detail }));
    return { ok: true, ...detail };
}

function queuePisiSearchFilesystemDelta(classification) {
    const changedPaths = classification.uniquePaths;
    pisiSearchDeltaPromise = pisiSearchDeltaPromise
        .catch(() => null)
        .then(async () => {
            pisiSearchDeltaActive = true;
            try {
                const result = await applyPisiSearchFilesystemDelta(classification);
                if (!result?.ok && !result?.superseded) {
                    invalidatePisiSearchIndex(
                        result?.reason || 'filesystem-delta-fallback',
                        changedPaths
                    );
                }
                return result;
            } catch (error) {
                console.warn('[PISI] Scoped search delta failed; rebuilding:', error);
                invalidatePisiSearchIndex('filesystem-delta-error', changedPaths);
                return { ok: false, rebuild: true, error: error.message };
            } finally {
                pisiSearchDeltaActive = false;
            }
        });
    return pisiSearchDeltaPromise;
}

function getPisiSearchCurrentNodePath() {
    return activeModalNode?.path || activeCenterNode?.path || null;
}

function getPisiSearchLiveIndex(index, targetPath) {
    if (!index || !(index.documents instanceof Map) || !targetPath) return index;
    const targetKey = pisiSearchPathKey(targetPath);
    const previous = index.documents.get(targetKey);
    if (!previous) return index;

    let editor = null;
    if (
        activeModalNode?.path &&
        pisiSearchPathKey(activeModalNode.path) === targetKey
    ) {
        editor = document.getElementById('node-modal-content');
    } else if (
        activeCenterNode?.path &&
        pisiSearchPathKey(activeCenterNode.path) === targetKey
    ) {
        editor = document.getElementById('center-node-editor-content');
    }
    if (!editor) return index;

    const liveDocument = createPisiSearchDocumentRecord({
        path: previous.path,
        item: previous.nodeItem,
        metadata: previous.metadata,
        properties: previous.properties,
        memberships: previous.memberships,
        content: editor.innerHTML
    }, index.projectFolder);
    const documents = new Map(index.documents);
    documents.set(targetKey, liveDocument);
    const records = replacePisiSearchNodeRecords(
        index.records,
        previous.path,
        createPisiSearchRecordsForDocument(liveDocument)
    );
    return {
        ...index,
        documents,
        records,
        accelerator: buildPisiSearchAccelerator(records)
    };
}

function getPisiSearchCacheStats() {
    return {
        documents: pisiSearchDocumentCache.size,
        generation: pisiSearchIndexGeneration,
        building: Boolean(pisiSearchBuildPromise),
        applyingDelta: pisiSearchDeltaActive,
        deltaGeneration: Number(pisiSearchIndexCache?.deltaGeneration || 0)
    };
}

function bindPisiSearchIndexInvalidation() {
    if (pisiSearchFileSystemUnsubscribe) return;
    pisiSearchFileSystemUnsubscribe =
        window.pisiProject?.onFileSystemChanged?.((payload = {}) => {
            const paths = Array.isArray(payload.changedPaths)
                ? payload.changedPaths.filter(Boolean)
                : [];
            const classification = classifyPisiSearchChangedPaths(paths);
            if (classification.mode === 'ignore') return;
            if (classification.mode === 'rebuild') {
                invalidatePisiSearchIndex('filesystem', classification.uniquePaths);
                return;
            }
            if (!pisiSearchIndexCache || pisiSearchBuildPromise) {
                invalidatePisiSearchIndex('filesystem-base-not-ready', classification.uniquePaths);
                return;
            }
            void queuePisiSearchFilesystemDelta(classification);
        }) || null;
}

document.addEventListener('DOMContentLoaded', () => {
    bindPisiSearchIndexInvalidation();
});

const moduleApi = {};
Object.defineProperties(moduleApi, {
    ensurePisiSearchIndex: {
        enumerable: true,
        get() { return ensurePisiSearchIndex; }
    },
    invalidatePisiSearchIndex: {
        enumerable: true,
        get() { return invalidatePisiSearchIndex; }
    },
    refreshPisiSearchIndex: {
        enumerable: true,
        get() { return refreshPisiSearchIndex; }
    },
    applyPisiSearchFilesystemDelta: {
        enumerable: true,
        get() { return applyPisiSearchFilesystemDelta; }
    },
    createPisiSearchDocumentRecord: {
        enumerable: true,
        get() { return createPisiSearchDocumentRecord; }
    },
    getPisiSearchCurrentNodePath: {
        enumerable: true,
        get() { return getPisiSearchCurrentNodePath; }
    },
    getPisiSearchLiveIndex: {
        enumerable: true,
        get() { return getPisiSearchLiveIndex; }
    },
    getPisiSearchCacheStats: {
        enumerable: true,
        get() { return getPisiSearchCacheStats; }
    },
    getPisiSearchMetadataSignature: {
        enumerable: true,
        get() { return getPisiSearchMetadataSignature; }
    },
    getPisiSearchDocumentSignature: {
        enumerable: true,
        get() { return getPisiSearchDocumentSignature; }
    }
});
registerModule('search.index', moduleApi);

export {
    ensurePisiSearchIndex,
    invalidatePisiSearchIndex,
    refreshPisiSearchIndex,
    applyPisiSearchFilesystemDelta,
    createPisiSearchDocumentRecord,
    getPisiSearchCurrentNodePath,
    getPisiSearchLiveIndex,
    getPisiSearchCacheStats,
    getPisiSearchMetadataSignature,
    getPisiSearchDocumentSignature
};