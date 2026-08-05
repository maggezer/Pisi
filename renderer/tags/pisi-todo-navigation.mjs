import { registerModule } from "../core/module-registry.mjs";

let pisiMissionHighlightAnimation = null;
let pisiMissionHighlightRequest = 0;

function clearPisiMissionHighlightArtifacts(root = document) {
    root.querySelectorAll?.(
        '.pisi-block-highlight, .pisi-todo-source-highlight'
    ).forEach((element) => {
        element.classList.remove(
            'pisi-block-highlight',
            'pisi-todo-source-highlight'
        );
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

    if (
        modalEditor &&
        samePisiPathForTags(activeModalNode?.path, mission?.nodePath)
    ) {
        candidates.push(modalEditor);
    }

    if (
        centerEditor &&
        samePisiPathForTags(activeCenterNode?.path, mission?.nodePath)
    ) {
        candidates.push(centerEditor);
    }

    return candidates;
}

function pisiMissionBlockContainsTodo(block, todoTag) {
    const normalizedTodoTag = normalizePisiUserTag(todoTag).toLowerCase();
    if (!normalizedTodoTag) return true;

    return Array.from(
        block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')
    ).some((tagElement) => {
        return normalizePisiUserTag(
            tagElement.dataset.pisiTag || tagElement.textContent || ''
        ).toLowerCase() === normalizedTodoTag;
    });
}

function getPisiMissionSourceInBlock(block, mission) {
    const normalizedTodoTag = normalizePisiUserTag(
        mission?.todoTag
    ).toLowerCase();

    return Array.from(
        block.querySelectorAll('.pisi-todo-source[data-pisi-todo-for]')
    ).find((element) => {
        return normalizePisiUserTag(
            element.dataset.pisiTodoFor || ''
        ).toLowerCase() === normalizedTodoTag;
    }) || null;
}

function findPisiMissionTarget(editor, mission) {
    if (!editor || !mission) return null;

    ensurePisiEditorBlocks(editor, { preserveSelection: false });

    const blocks = Array.from(
        editor.querySelectorAll('.pisi-editor-block[data-pisi-block-id]')
    );
    const escapedBlockId = mission.blockId
        ? CSS.escape(String(mission.blockId))
        : '';
    const idMatches = escapedBlockId
        ? Array.from(editor.querySelectorAll(
            '.pisi-editor-block[data-pisi-block-id="' + escapedBlockId + '"]'
        ))
        : [];

    const exactBlock = idMatches.find((block) => {
        return pisiMissionBlockContainsTodo(block, mission.todoTag);
    });

    if (exactBlock) {
        return getPisiMissionSourceInBlock(exactBlock, mission) || exactBlock;
    }

    const sourceText = String(mission.sourceText || '')
        .replace(/\s+/g, ' ')
        .trim();
    const todoBlocks = blocks.filter((block) => {
        return pisiMissionBlockContainsTodo(block, mission.todoTag);
    });

    if (sourceText) {
        for (const block of todoBlocks) {
            const source = getPisiMissionSourceInBlock(block, mission);
            const currentText = String(source?.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();

            if (source && currentText === sourceText) {
                return source;
            }
        }
    }

    return todoBlocks.length === 1 ? todoBlocks[0] : null;
}

function animatePisiMissionTarget(target) {
    if (!target?.isConnected) return false;

    pisiMissionHighlightAnimation?.cancel?.();
    target.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
    });

    pisiMissionHighlightAnimation = target.animate([
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
    ], {
        duration: 2200,
        easing: 'ease-out'
    });

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

async function openPisiTagBlockResult(block) {
    if (!block?.nodePath) return;

    clearPisiMissionHighlight();

    const escapedPath = CSS.escape(block.nodePath);
    const box = document.querySelector(
        '.map-node-box[data-node-path="' + escapedPath + '"]'
    );

    if (box) {
        await openNodeModalFromBox(box);
    } else if (typeof openPisiFileTab === 'function') {
        await openPisiFileTab({
            name: block.fileName ||                 `${block.nodeTitle || 'Node'}.node`,
            fileName: block.fileName ||                 `${block.nodeTitle || 'Node'}.node`,
            fullPath: block.nodePath,
            type: 'file',
            isDirectory: false,
            isFile: true,
            metadata: {
                type: 'node',
                title: block.nodeTitle || 'Node'
            }
        });
    }

    const highlighted = await highlightPisiEditorBlock(block);
    if (!highlighted) {
        console.warn(
            '[PISI] Görevin kaynak bloğu açık editörde bulunamadı:',
            block.blockId,
            block.nodePath
        );
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "openPisiTagBlockResult": {
        enumerable: true,
        get() { return openPisiTagBlockResult; }
    },
    "highlightPisiEditorBlock": {
        enumerable: true,
        get() { return highlightPisiEditorBlock; }
    },
    "bindPisiMissionHighlightSanitizer": {
        enumerable: true,
        get() { return bindPisiMissionHighlightSanitizer; }
    }
});

registerModule("tags.todoNavigation", moduleApi);

export {
    openPisiTagBlockResult,
    highlightPisiEditorBlock,
    bindPisiMissionHighlightSanitizer
};
