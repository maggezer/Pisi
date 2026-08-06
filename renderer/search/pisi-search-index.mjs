import { registerModule } from "../core/module-registry.mjs";
import {
    PISI_SEARCH_FIELD_WEIGHTS,
    pisiSearchPathKey
} from "./pisi-search-core.mjs";

let pisiSearchIndexCache = null;
let pisiSearchBuildPromise = null;
let pisiSearchIndexGeneration = 0;
let pisiSearchFileSystemUnsubscribe = null;

function cleanPisiSearchText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getPisiSearchFileName(path = '') {
    return String(path || '').split(/[\\/]/).pop() || '';
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

function extractPisiDirectPaths(container) {
    return Array.from(container.querySelectorAll('[data-pisi-citation-source]'))
        .map((element) => String(element.dataset.pisiCitationSource || '').trim())
        .filter(Boolean);
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

    const blocks = elements.slice(0, 1000).map((element, index) => {
        const clone = element.cloneNode(true);
        clone.querySelectorAll(
            'table, canvas, .pisi-user-tag, .pisi-todo-source'
        ).forEach((child) => child.remove());
        return {
            text: cleanPisiSearchText(clone.textContent || ''),
            blockId: element.getAttribute('data-pisi-block-id') || null,
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
        directPaths: extractPisiDirectPaths(container),
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
            searchFields: [
                { kind: 'content', value: block.text }
            ]
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
            searchFields: [
                { kind: 'tag', value: tag.value }
            ]
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
            searchFields: [
                { kind: 'table', value: table.text }
            ]
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

async function scanPisiSearchFolder(folderPath, context) {
    const result = await window.pisiProject?.listFolder?.(folderPath);
    if (!result?.ok || !Array.isArray(result.items)) {
        context.complete = false;
        context.errors.push(
            result?.error || 'Klasör listelenemedi: ' + folderPath
        );
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
                {
                    ...item,
                    fileName,
                    name: fileName
                },
                null,
                item.metadata,
                null
            );
            continue;
        }

        if (!/\.map$/i.test(fileName)) continue;

        const mapTitle = getPisiSearchMapTitle(item);
        const mapResult = await window.pisiProject?.listMapNodes?.(
            item.fullPath
        );
        const mapRecord = {
            path: item.fullPath,
            title: mapTitle,
            item: {
                ...item,
                fileName,
                name: fileName,
                metadata: item.metadata || {}
            },
            nodes: [],
            edges: Array.isArray(mapResult?.edges) ? mapResult.edges : []
        };
        context.maps.push(mapRecord);

        if (!mapResult?.ok) {
            context.complete = false;
            context.errors.push(
                mapResult?.error || 'Map okunamadı: ' + item.fullPath
            );
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
            const membership = makePisiSearchMembership(
                mapRecord,
                node
            );

            mapRecord.nodes.push({
                id: node.id,
                path: node.fullPath,
                title: getPisiSearchNodeTitle(nodeItem, node.metadata),
                layout: node.layout || null
            });
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
    const pending = Array.from(rawNodes.values()).filter((node) => {
        return !node.content && !node.memberships.length;
    });

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
                context.errors.push(
                    result?.error || 'Node okunamadı: ' + node.path
                );
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
        errors: []
    };

    await scanPisiSearchFolder(projectFolder, context);
    await hydratePisiStandaloneNodes(context.rawNodes, context);

    if (generation !== pisiSearchIndexGeneration) return null;

    const documents = new Map();
    const records = [];

    for (const map of context.maps) {
        records.push({
            id: 'map:' + pisiSearchPathKey(map.path),
            kind: 'map',
            title: map.title,
            mapTitle: map.title,
            mapPath: map.path,
            mapItem: map.item,
            relativePath: getPisiSearchRelativePath(
                map.path,
                projectFolder
            ),
            preview: getPisiSearchRelativePath(map.path, projectFolder),
            searchFields: [
                { kind: 'title', value: map.title },
                {
                    kind: 'path',
                    value: getPisiSearchRelativePath(map.path, projectFolder)
                }
            ]
        });
    }

    for (const rawNode of context.rawNodes.values()) {
        const documentRecord = createPisiSearchDocumentRecord(
            rawNode,
            projectFolder
        );
        documents.set(pisiSearchPathKey(documentRecord.path), documentRecord);
        records.push(...createPisiSearchRecordsForDocument(documentRecord));
    }

    return {
        projectFolder,
        projectKey: pisiSearchPathKey(projectFolder),
        builtAt: Date.now(),
        complete: context.complete,
        errors: context.errors,
        maps: context.maps,
        documents,
        records
    };
}

async function ensurePisiSearchIndex(options = {}) {
    const projectFolder = window.currentProjectFolder;
    if (!projectFolder) return null;
    const projectKey = pisiSearchPathKey(projectFolder);

    if (
        !options.force &&
        pisiSearchIndexCache?.projectKey === projectKey
    ) {
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
                    { detail: { index } }
                ));
            }
            return index;
        })
        .finally(() => {
            if (pisiSearchBuildPromise?.generation === generation) {
                pisiSearchBuildPromise = null;
            }
        });

    pisiSearchBuildPromise = {
        projectKey,
        generation,
        promise
    };
    return promise;
}

function invalidatePisiSearchIndex(reason = 'filesystem') {
    pisiSearchIndexGeneration += 1;
    pisiSearchIndexCache = null;
    pisiSearchBuildPromise = null;
    document.dispatchEvent(new CustomEvent(
        'pisi:search-index-invalidated',
        { detail: { reason } }
    ));
}

function refreshPisiSearchIndex() {
    invalidatePisiSearchIndex('refresh');
    return ensurePisiSearchIndex({ force: true });
}

function getPisiSearchCurrentNodePath() {
    return activeModalNode?.path || activeCenterNode?.path || null;
}

function getPisiSearchLiveIndex(index, targetPath) {
    if (!index || !(index.documents instanceof Map) || !targetPath) {
        return index;
    }

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
        memberships: previous.memberships,
        content: editor.innerHTML
    }, index.projectFolder);
    const documents = new Map(index.documents);
    documents.set(targetKey, liveDocument);
    const records = [
        ...index.records.filter((record) => {
            return pisiSearchPathKey(record?.nodePath) !== targetKey;
        }),
        ...createPisiSearchRecordsForDocument(liveDocument)
    ];

    return {
        ...index,
        documents,
        records
    };
}

function bindPisiSearchIndexInvalidation() {
    if (pisiSearchFileSystemUnsubscribe) return;
    pisiSearchFileSystemUnsubscribe =
        window.pisiProject?.onFileSystemChanged?.(() => {
            invalidatePisiSearchIndex('filesystem');
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
    }
});
registerModule('search.index', moduleApi);

export {
    ensurePisiSearchIndex,
    invalidatePisiSearchIndex,
    refreshPisiSearchIndex,
    createPisiSearchDocumentRecord,
    getPisiSearchCurrentNodePath,
    getPisiSearchLiveIndex
};
