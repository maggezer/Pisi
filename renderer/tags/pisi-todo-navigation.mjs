import { registerModule } from '../core/module-registry.mjs';
import {
    getPisiTaskNavigationTaskId,
    normalizePisiNavigationText,
    selectPisiTaskNavigationCandidate,
    shouldRejectMissingPisiCanonicalTask
} from '../navigation/pisi-navigation-core.mjs';

let pisiMissionHighlightAnimation = null;
let pisiMissionHighlightRequest = 0;

function clearPisiMissionHighlightArtifacts(root = document) {
    root.querySelectorAll?.('.pisi-block-highlight, .pisi-todo-source-highlight').forEach((element) => {
        element.classList.remove('pisi-block-highlight', 'pisi-todo-source-highlight');
    });
}

function clearPisiMissionHighlight() {
    pisiMissionHighlightRequest += 1;
    pisiMissionHighlightAnimation?.cancel?.();
    pisiMissionHighlightAnimation = null;
    clearPisiMissionHighlightArtifacts(document);
}

function bindPisiMissionHighlightSanitizer(editor) {
    if (!editor || editor.dataset.pisiMissionHighlightSanitizer === '1') {
        return;
    }

    editor.dataset.pisiMissionHighlightSanitizer = '1';
    clearPisiMissionHighlightArtifacts(editor);

    const observer = new MutationObserver(() => {
        clearPisiMissionHighlightArtifacts(editor);
    });

    observer.observe(editor, {
        childList: true,
        subtree: true
    });
}

function getPisiMissionEditorCandidates(mission) {
    const candidates = [];
    const modalEditor = document.getElementById('node-modal-content');
    const centerEditor = document.getElementById('center-node-editor-content');

    if (modalEditor && samePisiPathForTags(activeModalNode?.path, mission?.nodePath)) {
        candidates.push(modalEditor);
    }

    if (centerEditor && samePisiPathForTags(activeCenterNode?.path, mission?.nodePath)) {
        candidates.push(centerEditor);
    }

    return candidates;
}

function normalizePisiTaskNavigationTag(value = '') {
    if (typeof window.normalizePisiUserTag === 'function') {
        return window.normalizePisiUserTag(value).toLowerCase();
    }
    return String(value || '')
        .trim()
        .replace(/^(?:\.\.|\/|#)/, '')
        .toLowerCase();
}

function getPisiTaskIdFromBlock(block) {
    const direct = String(block?.dataset?.pisiTaskId || '').trim();
    if (direct.startsWith('task_')) return direct;

    const tagged = Array.from(block?.querySelectorAll?.('[data-pisi-task-id]') || [])
        .map((element) => String(element.dataset.pisiTaskId || '').trim())
        .find((value) => value.startsWith('task_'));
    return tagged || '';
}

function getPisiTodoTagFromNavigationBlock(block) {
    const element = Array.from(block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []).find((candidate) => {
        return /^todo\./i.test(normalizePisiTaskNavigationTag(candidate.dataset.pisiTag || candidate.textContent || ''));
    });
    return element ? normalizePisiTaskNavigationTag(element.dataset.pisiTag || element.textContent) : '';
}

function getPisiMissionSourceInBlock(block, mission) {
    const normalizedTodoTag = normalizePisiTaskNavigationTag(mission?.todoTag);
    const sources = Array.from(block?.querySelectorAll?.('.pisi-todo-source[data-pisi-todo-for]') || []);

    const exact = sources.find((element) => {
        return normalizePisiTaskNavigationTag(element.dataset.pisiTodoFor || '') === normalizedTodoTag;
    });
    if (exact) return exact;
    return sources.length === 1 ? sources[0] : null;
}

function makePisiNavigationCandidateFromBlock(block, nodePath = '') {
    if (!block) return null;
    const source = block.querySelector?.('.pisi-todo-source');
    return {
        taskId: getPisiTaskIdFromBlock(block),
        blockId: String(block.dataset?.pisiBlockId || '').trim(),
        nodePath,
        todoTag: getPisiTodoTagFromNavigationBlock(block),
        sourceText: normalizePisiNavigationText(source?.textContent || block.textContent || ''),
        block
    };
}

function findPisiMissionTarget(editor, mission) {
    if (!editor || !mission) return null;

    ensurePisiEditorBlocks(editor, { preserveSelection: false });

    const candidates = Array.from(editor.querySelectorAll('.pisi-editor-block[data-pisi-block-id]')).map((block) =>
        makePisiNavigationCandidateFromBlock(block, mission.nodePath || '')
    );

    const selected = selectPisiTaskNavigationCandidate(candidates, mission, {
        caseInsensitive: window.pisiEnvironment?.platform === 'win32',
        scope: 'direct'
    })?.candidate;

    if (!selected?.block) return null;
    return getPisiMissionSourceInBlock(selected.block, mission) || selected.block;
}

function animatePisiMissionTarget(target) {
    if (!target?.isConnected) return false;

    pisiMissionHighlightAnimation?.cancel?.();
    target.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
    });

    pisiMissionHighlightAnimation = target.animate(
        [
            {
                backgroundColor: 'rgba(93, 173, 226, 0.34)',
                boxShadow: '0 0 0 2px rgba(93, 173, 226, 0.88)',
                offset: 0
            },
            {
                backgroundColor: 'rgba(93, 173, 226, 0.24)',
                boxShadow: '0 0 0 2px rgba(93, 173, 226, 0.72)',
                offset: 0.72
            },
            {
                backgroundColor: 'rgba(93, 173, 226, 0)',
                boxShadow: '0 0 0 2px rgba(93, 173, 226, 0)',
                offset: 1
            }
        ],
        {
            duration: 2200,
            easing: 'ease-out'
        }
    );

    const animation = pisiMissionHighlightAnimation;
    animation.finished
        .catch(() => {})
        .finally(() => {
            if (pisiMissionHighlightAnimation === animation) {
                pisiMissionHighlightAnimation = null;
            }
        });

    return true;
}

async function highlightPisiEditorBlock(mission) {
    if (!mission?.nodePath) return false;

    clearPisiMissionHighlight();
    const requestId = pisiMissionHighlightRequest;

    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (requestId !== pisiMissionHighlightRequest) return false;

        for (const editor of getPisiMissionEditorCandidates(mission)) {
            const target = findPisiMissionTarget(editor, mission);
            if (target) return animatePisiMissionTarget(target);
        }

        await new Promise((resolve) => setTimeout(resolve, 60));
    }

    return false;
}

function getPisiCanonicalTaskForNavigation(input = {}) {
    const taskId = getPisiTaskNavigationTaskId(input);
    if (!taskId) return null;
    const taskStore = window.Pisi?.modules?.['tags.taskStore'];
    return taskStore?.getPisiFirstClassTask?.(taskId) || null;
}

function makePisiCanonicalNavigationTarget(input = {}) {
    const task = getPisiCanonicalTaskForNavigation(input);
    const source = task?.source || {};
    const taskId = task?.id || getPisiTaskNavigationTaskId(input);

    return {
        ...input,
        taskId,
        missionId: taskId || input.missionId,
        nodePath: source.nodePath || input.nodePath || null,
        blockId: source.blockId || input.blockId || null,
        mapPath: source.mapPath || input.mapPath || null,
        mapTitle: source.mapTitle || input.mapTitle || '',
        nodeTitle: source.nodeTitle || input.nodeTitle || task?.title || 'Node',
        todoTag: task?.todoTag || input.todoTag || '',
        sourceText: task?.title || input.sourceText || input.text || '',
        title: task?.title || input.title || input.sourceText || input.text || ''
    };
}

function getPisiNavigationCandidatesFromHtml(html, nodePath) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    return Array.from(template.content.querySelectorAll('.pisi-editor-block[data-pisi-block-id]'))
        .filter((block) => !block.closest('.pisi-diary-managed-block'))
        .map((block) => makePisiNavigationCandidateFromBlock(block, nodePath));
}

function findPisiExactNavigationCandidateInHtml(html, nodePath, target) {
    const candidates = getPisiNavigationCandidatesFromHtml(html, nodePath);
    return (
        selectPisiTaskNavigationCandidate(candidates, target, {
            caseInsensitive: window.pisiEnvironment?.platform === 'win32',
            scope: 'direct'
        })?.candidate || null
    );
}

async function readPisiNavigationNode(nodePath) {
    if (!nodePath || !window.pisiProject?.getPisiDocument) return null;
    const result = await window.pisiProject.getPisiDocument(nodePath);
    return result?.ok ? result : null;
}

async function recoverPisiTaskNavigationSource(target) {
    const index = await window.ensurePisiSearchIndex?.();
    if (!(index?.documents instanceof Map)) return null;

    const candidates = [];
    for (const documentRecord of index.documents.values()) {
        const nodePath = documentRecord?.path;
        if (!nodePath) continue;
        for (const candidate of getPisiNavigationCandidatesFromHtml(documentRecord.html, nodePath)) {
            candidates.push({
                ...candidate,
                nodeTitle: documentRecord.title || 'Node',
                nodeItem: documentRecord.nodeItem || null,
                mapPath: documentRecord.memberships?.[0]?.mapPath || null,
                mapTitle: documentRecord.memberships?.[0]?.mapTitle || ''
            });
        }
    }

    return (
        selectPisiTaskNavigationCandidate(candidates, target, {
            caseInsensitive: window.pisiEnvironment?.platform === 'win32',
            scope: 'recovery'
        })?.candidate || null
    );
}

async function resolvePisiTaskNavigationSource(input = {}) {
    const target = makePisiCanonicalNavigationTarget(input);
    let documentResult = await readPisiNavigationNode(target.nodePath);
    let exact = documentResult ? findPisiExactNavigationCandidateInHtml(documentResult.data?.content || '', target.nodePath, target) : null;

    if (documentResult && exact) {
        return {
            ...target,
            blockId: exact.blockId || target.blockId,
            documentResult,
            recovered: false
        };
    }

    const recovered = await recoverPisiTaskNavigationSource(target);
    if (!recovered?.nodePath) {
        return documentResult ? { ...target, documentResult, recovered: false, exactMissing: true } : null;
    }

    documentResult = await readPisiNavigationNode(recovered.nodePath);
    if (!documentResult) return null;

    return {
        ...target,
        nodePath: recovered.nodePath,
        blockId: recovered.blockId || target.blockId,
        mapPath: recovered.mapPath || target.mapPath,
        mapTitle: recovered.mapTitle || target.mapTitle,
        nodeTitle: recovered.nodeTitle || target.nodeTitle,
        nodeItem: recovered.nodeItem || null,
        documentResult,
        recovered: true
    };
}

async function repairPisiCanonicalTaskSource(target) {
    const taskId = getPisiTaskNavigationTaskId(target);
    const task = getPisiCanonicalTaskForNavigation(target);
    if (!taskId || !task || !window.currentProjectFolder) return;

    const current = task.source || {};
    const changed =
        !samePisiPathForTags(current.nodePath, target.nodePath) ||
        String(current.blockId || '') !== String(target.blockId || '') ||
        (Boolean(target.mapPath) && !samePisiPathForTags(current.mapPath, target.mapPath));
    if (!changed) return;

    await window.pisiProject?.quickAddTask?.(window.currentProjectFolder, {
        op: 'update',
        taskId,
        patch: {
            source: {
                ...current,
                nodePath: target.nodePath,
                blockId: target.blockId || current.blockId || null,
                mapPath: target.mapPath || current.mapPath || null,
                nodeTitle: target.nodeTitle || current.nodeTitle || '',
                mapTitle: target.mapTitle || current.mapTitle || ''
            }
        }
    });
}

function makePisiNavigationNodeItem(target) {
    if (target.nodeItem?.fullPath) {
        return {
            ...target.nodeItem,
            fullPath: target.nodePath,
            mapPath: target.mapPath || target.nodeItem.mapPath || null
        };
    }

    const fileName =
        String(target.nodePath || '')
            .split(/[\\/]/)
            .pop() || 'Node.node';
    return {
        name: fileName,
        fileName,
        fullPath: target.nodePath,
        mapPath: target.mapPath || null,
        type: 'file',
        isFile: true,
        isDirectory: false,
        displayName: target.nodeTitle || fileName.replace(/\.node$/i, ''),
        metadata: target.documentResult?.metadata || {
            type: 'node',
            title: target.nodeTitle || fileName.replace(/\.node$/i, '')
        }
    };
}

function dispatchPisiTaskNavigationComplete(result) {
    document.dispatchEvent(
        new CustomEvent('pisi:task-navigation-complete', {
            detail: result
        })
    );
    return result;
}

async function navigatePisiTaskToSource(input = {}) {
    clearPisiMissionHighlight();

    const canonicalTask = getPisiCanonicalTaskForNavigation(input);
    if (shouldRejectMissingPisiCanonicalTask(input, canonicalTask)) {
        return dispatchPisiTaskNavigationComplete({
            ok: false,
            code: 'TASK_NOT_FOUND',
            taskId: getPisiTaskNavigationTaskId(input) || null
        });
    }

    const target = await resolvePisiTaskNavigationSource(input);

    if (!target?.nodePath) {
        return dispatchPisiTaskNavigationComplete({
            ok: false,
            code: 'TASK_SOURCE_NOT_FOUND',
            taskId: getPisiTaskNavigationTaskId(input) || null
        });
    }

    const modalAlreadyOnTarget = samePisiPathForTags(activeModalNode?.path, target.nodePath);
    const centerAlreadyOnTarget = samePisiPathForTags(activeCenterNode?.path, target.nodePath);

    if (!modalAlreadyOnTarget && activeModalNode) {
        const saved = await window.closeNodeModalAndSave?.();
        if (saved === false) {
            return dispatchPisiTaskNavigationComplete({
                ok: false,
                code: 'CURRENT_NODE_SAVE_FAILED',
                taskId: getPisiTaskNavigationTaskId(target) || null,
                nodePath: target.nodePath
            });
        }
    }

    if (!modalAlreadyOnTarget && !centerAlreadyOnTarget) {
        const opened = await window.openPisiFileTab?.(makePisiNavigationNodeItem(target));
        if (!opened) {
            return dispatchPisiTaskNavigationComplete({
                ok: false,
                code: 'NODE_OPEN_FAILED',
                taskId: getPisiTaskNavigationTaskId(target) || null,
                nodePath: target.nodePath
            });
        }
    }

    const highlighted = await highlightPisiEditorBlock(target);
    if (target.recovered) {
        void repairPisiCanonicalTaskSource(target);
    }

    return dispatchPisiTaskNavigationComplete({
        ok: highlighted,
        exact: highlighted,
        nodeOpened: true,
        recovered: target.recovered === true,
        code: highlighted ? 'OK' : 'BLOCK_NOT_FOUND',
        taskId: getPisiTaskNavigationTaskId(target) || null,
        nodePath: target.nodePath,
        blockId: target.blockId || null,
        mapPath: target.mapPath || null
    });
}

async function openPisiTagBlockResult(block) {
    return navigatePisiTaskToSource(block);
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    openPisiTagBlockResult: {
        enumerable: true,
        get() {
            return openPisiTagBlockResult;
        }
    },
    highlightPisiEditorBlock: {
        enumerable: true,
        get() {
            return highlightPisiEditorBlock;
        }
    },
    bindPisiMissionHighlightSanitizer: {
        enumerable: true,
        get() {
            return bindPisiMissionHighlightSanitizer;
        }
    }
});

registerModule('tags.todoNavigation', moduleApi);

export { openPisiTagBlockResult, highlightPisiEditorBlock, bindPisiMissionHighlightSanitizer };
