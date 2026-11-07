import * as fs from 'node:fs';
import * as path from 'node:path';
import { isPisiWikiNodeId, normalizePisiWikiTitle, repairPisiWikiLinks, rewritePisiWikiLinksForRename } from './wiki-link-core.js';

// Project-wide link maintenance over live .node files. No Electron imports:
// callers pass `writeDocument`, so the same code runs inside the domain
// atomic mutation and inside tests that inject a crash between writes.

const PISI_WIKI_MAX_NODE_FILES = 20000;

function listPisiWikiNodeFiles(projectFolder, maxFiles = PISI_WIKI_MAX_NODE_FILES) {
    const files = [];
    const stack = [path.resolve(projectFolder)];
    while (stack.length) {
        const directory = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            // Hidden folders hold history, trash, sync and journal copies, never live notes.
            if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) stack.push(fullPath);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.node')) {
                files.push(fullPath);
                if (files.length > maxFiles) throw new Error('Projede bağlantı taraması için çok fazla not var.');
            }
        }
    }
    return files.sort();
}

function readPisiWikiNode(filePath) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data || typeof data !== 'object' || typeof data.content !== 'string') return null;
        return { filePath, data, id: data.pisi?.id || null, title: String(data.pisi?.title || '') };
    } catch {
        // Unreadable notes are left untouched; Project Integrity reports them.
        return null;
    }
}

function readPisiWikiNodes(projectFolder) {
    return listPisiWikiNodeFiles(projectFolder).map(readPisiWikiNode).filter(Boolean);
}

/** Notes from a prepared candidate list, re-read now (inside the mutation). */
function readPisiWikiCandidateNodes(candidates) {
    return [...new Set(candidates)].sort().map(readPisiWikiNode).filter(Boolean);
}

function countOtherPisiWikiTitleOwners(nodes, nodeId, title) {
    const key = normalizePisiWikiTitle(title);
    return key ? nodes.filter((node) => node.id !== nodeId && normalizePisiWikiTitle(node.title) === key).length : 0;
}

function planPisiWikiRename(nodes, { nodeId, oldTitle, newTitle }, titleNodes = nodes) {
    // Legacy [[Old]] text only follows the rename when no other note is called
    // Old. The renamed note itself is excluded, so the answer is the same before
    // the rename (impact preview) and after it (rewrite inside the transaction).
    // `titleNodes` (every note's id and title) may come from a prepared scan
    // while `nodes` holds only the notes that can contain a link.
    const rewriteLegacy = countOtherPisiWikiTitleOwners(titleNodes, nodeId, oldTitle) === 0;
    const changes = [];
    let links = 0;
    for (const node of nodes) {
        const result = rewritePisiWikiLinksForRename(node.data.content, { nodeId, oldTitle, newTitle, rewriteLegacy });
        if (!result.count) continue;
        links += result.count;
        changes.push({ node, content: result.content, count: result.count });
    }
    return { changes, links, rewriteLegacy };
}

function getPisiWikiRenameImpact(projectFolder, nodePath, newTitle) {
    const nodes = readPisiWikiNodes(projectFolder);
    const target = nodes.find((node) => path.resolve(node.filePath) === path.resolve(nodePath));
    if (!target || !isPisiWikiNodeId(target.id)) return { ok: true, notes: 0, links: 0 };
    if (normalizePisiWikiTitle(target.title) === normalizePisiWikiTitle(newTitle) && target.title === String(newTitle || '').trim()) {
        return { ok: true, notes: 0, links: 0 };
    }
    const plan = planPisiWikiRename(nodes, { nodeId: target.id, oldTitle: target.title, newTitle });
    return { ok: true, notes: plan.changes.length, links: plan.links, legacyIncluded: plan.rewriteLegacy };
}

/**
 * The same impact as getPisiWikiRenameImpact, with the project read done by
 * `scan` (async, off the main thread): every note's title plus the notes that
 * may contain a link. Notes with neither the id nor [[…]] text cannot change.
 */
async function getPisiWikiRenameImpactAsync(projectFolder, nodePath, newTitle, { scan, readCandidates }) {
    const target = readPisiWikiNode(nodePath);
    if (!target || !isPisiWikiNodeId(target.id)) return { ok: true, notes: 0, links: 0 };
    if (normalizePisiWikiTitle(target.title) === normalizePisiWikiTitle(newTitle) && target.title === String(newTitle || '').trim()) {
        return { ok: true, notes: 0, links: 0 };
    }
    const prepared = await scan(target.id);
    const nodes = await readCandidates(prepared.candidates);
    const plan = planPisiWikiRename(nodes, { nodeId: target.id, oldTitle: target.title, newTitle }, prepared.titles);
    return { ok: true, notes: plan.changes.length, links: plan.links, legacyIncluded: plan.rewriteLegacy };
}

/**
 * Rewrites links to a renamed note. With `prepared` ({ titles, candidates }
 * from an async scan before the mutation) only the candidate notes are read
 * here; without it every live note is read, as before.
 */
function applyPisiWikiRename(projectFolder, { nodeId, oldTitle, newTitle }, { writeDocument, prepared = null }) {
    if (!isPisiWikiNodeId(nodeId) || !String(newTitle || '').trim() || oldTitle === newTitle) return { ok: true, notes: 0, links: 0 };
    const plan = prepared
        ? planPisiWikiRename(readPisiWikiCandidateNodes(prepared.candidates), { nodeId, oldTitle, newTitle }, prepared.titles)
        : planPisiWikiRename(readPisiWikiNodes(projectFolder), { nodeId, oldTitle, newTitle });
    for (const change of plan.changes) {
        writeDocument(change.node.filePath, { ...change.node.data, content: change.content });
    }
    return {
        ok: true,
        notes: plan.changes.length,
        links: plan.links,
        rewriteLegacy: plan.rewriteLegacy,
        updatedPaths: plan.changes.map((change) => change.node.filePath)
    };
}

function makePisiWikiTitleResolver(nodes) {
    const owners = new Map();
    for (const node of nodes) {
        if (!isPisiWikiNodeId(node.id)) continue;
        const key = normalizePisiWikiTitle(node.title);
        if (!key) continue;
        owners.set(key, [...(owners.get(key) || []), node]);
    }
    return (titleKey) => {
        const matches = owners.get(titleKey) || [];
        if (!matches.length) return { status: 'missing' };
        if (matches.length > 1) return { status: 'ambiguous' };
        return { status: 'unique', nodeId: matches[0].id, title: matches[0].title };
    };
}

function planPisiWikiRepair(projectFolder) {
    const nodes = readPisiWikiNodes(projectFolder);
    const resolve = makePisiWikiTitleResolver(nodes);
    const totals = { notes: 0, converted: 0, ambiguous: 0, missing: 0, unsupported: 0 };
    const changes = [];
    for (const node of nodes) {
        const result = repairPisiWikiLinks(node.data.content, resolve);
        totals.ambiguous += result.ambiguous;
        totals.missing += result.missing;
        totals.unsupported += result.unsupported;
        if (!result.converted) continue;
        totals.notes += 1;
        totals.converted += result.converted;
        changes.push({ node, content: result.content });
    }
    return { totals, changes };
}

function previewPisiWikiRepair(projectFolder) {
    return { ok: true, ...planPisiWikiRepair(projectFolder).totals };
}

function applyPisiWikiRepair(projectFolder, { writeDocument }) {
    const plan = planPisiWikiRepair(projectFolder);
    for (const change of plan.changes) {
        writeDocument(change.node.filePath, { ...change.node.data, content: change.content });
    }
    return { ok: true, ...plan.totals, updatedPaths: plan.changes.map((change) => change.node.filePath) };
}

export {
    applyPisiWikiRename,
    applyPisiWikiRepair,
    getPisiWikiRenameImpact,
    getPisiWikiRenameImpactAsync,
    listPisiWikiNodeFiles,
    previewPisiWikiRepair,
    readPisiWikiNode,
    readPisiWikiNodes
};
