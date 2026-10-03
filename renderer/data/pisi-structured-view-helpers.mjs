import { getPisiSearchCurrentNodePath } from '../search/pisi-search-index.mjs';
import { PISI_NODE_PROPERTY_TYPES, normalizePisiPropertyCollection } from './pisi-properties-core.mjs';

function pisiStructuredTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function dispatchPisiNodePropertiesChanged(path, reason, options = {}) {
    document.dispatchEvent(
        new CustomEvent('pisi:node-properties-changed', {
            detail: {
                path,
                reason,
                properties: options.properties || null,
                refreshEditor: options.refreshEditor === true
            }
        })
    );
}

function makePisiStructuredButton(label, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiStructuredTranslate(label);
    return button;
}

function makePisiRollupField(labelText, control) {
    const field = document.createElement('label');
    field.className = 'pisi-rollup-field';
    const label = document.createElement('span');
    label.textContent = pisiStructuredTranslate(labelText);
    field.append(label, control);
    return field;
}

function pisiPropertyPathKey(value = '') {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '')
        .toLocaleLowerCase('en-US');
}

function pisiPropertyNameKey(value = '') {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('tr-TR');
}

function getPisiActivePropertyMapPath(nodePath = '') {
    const targetKey = pisiPropertyPathKey(nodePath);
    for (const activeNode of [window.activeModalNode, window.activeCenterNode]) {
        if (activeNode?.mapPath && (!targetKey || pisiPropertyPathKey(activeNode.path) === targetKey)) {
            return activeNode.mapPath;
        }
    }
    return window.activeMapPath || null;
}

function collectPisiMapPropertyDefinitions(nodes = []) {
    const definitions = new Map();
    for (const node of nodes) {
        for (const property of normalizePisiPropertyCollection(node?.properties)) {
            const key = pisiPropertyNameKey(property.name);
            if (!key || definitions.has(key)) continue;
            definitions.set(key, {
                id: property.id,
                name: property.name,
                type: property.type,
                system: property.system === true
            });
        }
    }
    return Array.from(definitions.values()).sort((a, b) => {
        return a.name.localeCompare(b.name, 'tr');
    });
}

async function getPisiNodePropertyMapContext(nodePath) {
    const preferredMapPath = getPisiActivePropertyMapPath(nodePath);
    const result =
        typeof window.pisiProject?.getNodePropertyContext === 'function'
            ? await window.pisiProject.getNodePropertyContext(nodePath, preferredMapPath)
            : preferredMapPath
              ? await window.pisiProject?.listMapNodes?.(preferredMapPath)
              : { ok: true, nodes: [] };
    if (!result?.ok) {
        throw new Error(result?.error || 'Map özellikleri yüklenemedi.');
    }
    const nodes = Array.isArray(result.nodes) ? result.nodes : [];
    return {
        mapPath: result.mapPath || preferredMapPath || null,
        nodes,
        propertyDefinitions: collectPisiMapPropertyDefinitions(nodes),
        nodePath
    };
}

async function getPisiActiveMapPropertyContext() {
    const nodePath = getPisiSearchCurrentNodePath();
    if (nodePath) return getPisiNodePropertyMapContext(nodePath);
    const mapPath = window.activeMapPath || null;
    if (!mapPath) {
        return {
            mapPath: null,
            nodes: [],
            propertyDefinitions: [],
            nodePath: null
        };
    }
    const result = await window.pisiProject?.listMapNodes?.(mapPath);
    if (!result?.ok) {
        throw new Error(result?.error || 'Map özellikleri yüklenemedi.');
    }
    const nodes = Array.isArray(result.nodes) ? result.nodes : [];
    return {
        mapPath,
        nodes,
        propertyDefinitions: collectPisiMapPropertyDefinitions(nodes),
        nodePath: null
    };
}

function getPisiPropertyTypeLabel(type) {
    return PISI_NODE_PROPERTY_TYPES.find((item) => item.value === type)?.label || type;
}

function getPisiMapNodeLabel(node) {
    return node?.metadata?.title || String(node?.fileName || '').replace(/\.node$/i, '') || node?.fullPath || pisiStructuredTranslate('Node');
}

function pisiMapNodeMatchesValue(node, value) {
    const text = String(value || '').trim();
    if (!text) return false;
    const pathKey = pisiPropertyPathKey(text);
    return (
        [node?.fullPath, node?.fileName, node?.id, node?.metadata?.id].some((candidate) => pisiPropertyPathKey(candidate) === pathKey) ||
        pisiPropertyNameKey(getPisiMapNodeLabel(node)) === pisiPropertyNameKey(text)
    );
}

function formatPisiPropertyValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? '✓' : '—';
    return String(value ?? '');
}

export {
    collectPisiMapPropertyDefinitions,
    dispatchPisiNodePropertiesChanged,
    formatPisiPropertyValue,
    getPisiActiveMapPropertyContext,
    getPisiMapNodeLabel,
    getPisiNodePropertyMapContext,
    getPisiPropertyTypeLabel,
    makePisiRollupField,
    makePisiStructuredButton,
    pisiMapNodeMatchesValue,
    pisiPropertyNameKey,
    pisiStructuredTranslate
};
