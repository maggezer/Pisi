import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommandCenterPage } from "../shell/pisi-command-center.mjs";
import { parsePisiTodoTagValue } from "./pisi-todo-utils.mjs";

function ensurePisiTagsPanelDom() {
    const panel = document.getElementById('pisi-tags-panel');

    if (!panel) return null;

    let pickerButton = document.getElementById('pisi-tag-picker-button');
    let pickerMenu = document.getElementById('pisi-tag-picker-menu');
    let resultsEl = document.getElementById('pisi-tag-block-results');

    if (!pickerButton || !pickerMenu || !resultsEl) {
        panel.innerHTML = `
            <div class="pisi-tag-picker">
                <button id="pisi-tag-picker-button" type="button">
                    ${pisiBlockTranslateForTags('Choose tag')}
                </button>

                <div
                    id="pisi-tag-picker-menu"
                    class="pisi-tag-picker-menu"
                    hidden
                ></div>
            </div>

            <div id="pisi-tag-block-results" class="pisi-tag-block-results"></div>
        `;

        pickerButton = document.getElementById('pisi-tag-picker-button');
        pickerMenu = document.getElementById('pisi-tag-picker-menu');
        resultsEl = document.getElementById('pisi-tag-block-results');
    }

    if (!pickerButton || !pickerMenu || !resultsEl) return null;

    return {
        pickerButton,
        pickerMenu,
        resultsEl
    };
}

function renderPisiTagsPanel() {
    const dom = ensurePisiTagsPanelDom();

    if (!dom) return false;

    const {
        pickerButton,
        pickerMenu,
        resultsEl
    } = dom;

    const index = Array.isArray(pisiTagsPanelState.index)
        ? pisiTagsPanelState.index
        : [];

    const counts = new Map();

for (const block of index) {
    const blockTags = Array.isArray(block.tags) ? block.tags : [];

    for (const tag of blockTags) {
        const normalizedTag = normalizePisiUserTag(tag);

        // Missions'a özel ..todo.priority.finishdate etiketleri
        // Tags sekmesinde listelenmesin.
        if (parsePisiTodoTag(normalizedTag)) {
            continue;
        }

        counts.set(normalizedTag, (counts.get(normalizedTag) || 0) + 1);
    }
}

const tags = Array.from(counts.keys()).sort((a, b) => {
    return a.localeCompare(b, 'tr');
});

    if (!tags.length) {
        pisiTagsPanelState.selectedTag = null;
        pisiTagsPanelState.dropdownOpen = false;

        pickerButton.disabled = true;
        pickerButton.textContent = pisiBlockTranslateForTags('Choose tag');
        pickerMenu.hidden = true;
        pickerMenu.innerHTML = '';

        resultsEl.innerHTML = `
            <div class="right-panel-empty">
                ${pisiBlockTranslateForTags('Bu map veya günlük notlar içinde kullanıcı etiketi içeren blok yok.')}
            </div>
        `;

        return;
    }

    if (
        pisiTagsPanelState.selectedTag &&
        !counts.has(pisiTagsPanelState.selectedTag)
    ) {
        pisiTagsPanelState.selectedTag = null;
    }

    const selectedTag = pisiTagsPanelState.selectedTag || tags[0];

    pisiTagsPanelState.selectedTag = selectedTag;

    pickerButton.disabled = false;
    pickerButton.textContent = `#${selectedTag} (${counts.get(selectedTag)})`;
    pickerButton.setAttribute(
        'aria-expanded',
        pisiTagsPanelState.dropdownOpen ? 'true' : 'false'
    );

    pickerButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        pisiTagsPanelState.dropdownOpen = !pisiTagsPanelState.dropdownOpen;
        renderPisiTagsPanel();
    };

    pickerMenu.hidden = !pisiTagsPanelState.dropdownOpen;
    pickerMenu.innerHTML = '';

    for (const tag of tags) {
        const option = document.createElement('button');

        option.type = 'button';
        option.className = 'pisi-tag-picker-option';
        option.classList.toggle('active', tag === selectedTag);

        option.innerHTML = `
            <span class="pisi-tag-picker-name">#${escapeHtml(tag)}</span>
            <span class="pisi-tag-picker-count">${counts.get(tag)}</span>
        `;

        option.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            pisiTagsPanelState.selectedTag = tag;
            pisiTagsPanelState.dropdownOpen = false;

            renderPisiTagsPanel();
        });

        pickerMenu.appendChild(option);
    }

   const matchingBlocks = index.filter((block) => {
    return Array.isArray(block.tags) &&
        block.tags.some((tag) => {
            return normalizePisiUserTag(tag) === selectedTag;
        });
    });

    resultsEl.innerHTML = '';

    for (const block of matchingBlocks) {
        const card = document.createElement('button');

        card.type = 'button';
        card.className = 'pisi-tag-result-card';

        card.innerHTML = `
            <div class="pisi-tag-result-node">
                ${escapeHtml(block.nodeTitle || 'Node')}
            </div>

            <div class="pisi-tag-result-text">
                ${escapeHtml(block.text || '(boş blok)')}
            </div>
        `;

        card.addEventListener('click', async () => {
            await openPisiTagBlockResult(block);
        });

        resultsEl.appendChild(card);
    }

    return true;
}

async function renderPisiTagExplorerPage(container) {
    const page = document.createElement('section');
    page.className = 'pisi-tag-explorer-page';

    const heading = document.createElement('div');
    heading.className = 'pisi-command-section-heading';
    const title = document.createElement('h2');
    title.textContent = pisiBlockTranslateForTags('Etiket gezgini');
    const description = document.createElement('p');
    description.textContent = pisiBlockTranslateForTags(
        'Map ve günlük notlarındaki blok etiketlerini keşfedin.'
    );
    heading.append(title, description);

    const panel = document.createElement('div');
    panel.id = 'pisi-tags-panel';
    page.append(heading, panel);
    container.appendChild(page);

    await window.refreshPisiTagsPanel?.();
    renderPisiTagsPanel();
}

function pisiBlockTranslateForTags(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function openPisiTagExplorer(tag = '') {
    const normalized = typeof window.normalizePisiUserTag === 'function'
        ? window.normalizePisiUserTag(tag)
        : String(tag || '').replace(/^(?:#|\.\.|\/)/, '').trim().toLowerCase();
    if (normalized) pisiTagsPanelState.selectedTag = normalized;
    pisiTagsPanelState.dropdownOpen = false;
    return window.openPisiCommandCenter?.('tags') || false;
}

function parsePisiTodoTag(tag) {
    return parsePisiTodoTagValue(normalizePisiUserTag(tag));
}

function formatPisiMissionDate(date) {
    return formatPisiMissionDateFirstRelease(date);
}

function getPisiMissionsFromIndex(options = {}) {
    return getPisiMissionsFromIndexFirstRelease(options);
}

function escapePisiMissionRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPisiMissionDisplayText(mission) {
    return getPisiMissionDisplayTextFirstRelease(mission);
}

function renderPisiMissionsPanel() {
    return renderPisiMissionsPanelFirstRelease();
}

function normalizePisiBlockText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function createPisiDoneTagElement(todoTag) {
    const tagEl = document.createElement('span');
    const normalizedTodoTag = normalizePisiUserTag(todoTag);

    tagEl.className = 'pisi-user-tag pisi-task-metadata';
    tagEl.dataset.pisiTag = 'done';
    if (normalizedTodoTag) {
        tagEl.dataset.pisiDoneFor = normalizedTodoTag;
    }
    tagEl.contentEditable = 'false';
    tagEl.setAttribute('aria-hidden', 'true');
    tagEl.textContent = 'done';

    return tagEl;
}

function blockHasPisiDoneTag(block, todoTag = null) {
    const normalizedTodoTag = normalizePisiUserTag(todoTag);

    return Array.from(block.querySelectorAll('.pisi-user-tag[data-pisi-tag]'))
        .some((tagEl) => {
            const isDone = normalizePisiUserTag(
                tagEl.dataset.pisiTag || tagEl.textContent || ''
            ) === 'done';

            if (!isDone) return false;
            if (!normalizedTodoTag) return true;

            const doneFor = normalizePisiUserTag(
                tagEl.dataset.pisiDoneFor || ''
            );

            return !doneFor || doneFor === normalizedTodoTag;
        });
}

function blockHasPisiTag(block, targetTag) {
    const normalizedTarget = normalizePisiUserTag(targetTag);

    return Array.from(block.querySelectorAll('.pisi-user-tag[data-pisi-tag]'))
        .some((tagEl) => {
            return normalizePisiUserTag(
                tagEl.dataset.pisiTag || tagEl.textContent || ''
            ) === normalizedTarget;
        });
}

function appendPisiDoneTagToBlock(block, todoTag) {
    if (!block || blockHasPisiDoneTag(block, todoTag)) return false;

    decoratePisiEditorBlock(block);

    block.appendChild(document.createTextNode(' '));
    block.appendChild(createPisiDoneTagElement(todoTag));
    block.appendChild(document.createTextNode(' '));

    return true;
}

function removePisiDoneTagFromBlock(block, todoTag) {
    if (!block) return false;

    const normalizedTodoTag = normalizePisiUserTag(todoTag);
    let removed = false;

    Array.from(
        block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')
    ).forEach((tagEl) => {
        const isDone = normalizePisiUserTag(
            tagEl.dataset.pisiTag || tagEl.textContent || ''
        ) === 'done';
        const doneFor = normalizePisiUserTag(
            tagEl.dataset.pisiDoneFor || ''
        );

        if (
            isDone &&
            (!doneFor || !normalizedTodoTag || doneFor === normalizedTodoTag)
        ) {
            tagEl.remove();
            removed = true;
        }
    });

    return removed;
}

function findPisiMissionBlockInContainer(container, mission) {
    if (!container || !mission) return null;

    ensurePisiEditorBlocks(container);

    const blocks = getPisiBlockElementsFromContainer(container);
    const targetTodoTag = normalizePisiUserTag(mission.todoTag);
    const targetText = normalizePisiBlockText(mission.text);

    let textFallback = null;
    let tagFallback = null;

    for (const block of blocks) {
        decoratePisiEditorBlock(block);

        const hasTodo = blockHasPisiTag(block, targetTodoTag);

        if (!hasTodo) continue;

        if (
            mission.blockId &&
            block.dataset.pisiBlockId === mission.blockId
        ) {
            return block;
        }

        if (
            !textFallback &&
            normalizePisiBlockText(block.textContent) === targetText
        ) {
            textFallback = block;
        }

        if (!tagFallback) {
            tagFallback = block;
        }
    }

    return textFallback || tagFallback;
}

function setPisiMissionCompletionInBlock(block, mission, completed) {
    if (!block) {
        return {
            changed: false,
            previousHtml: ''
        };
    }

    const previousHtml = block.innerHTML;
    const changed = completed
        ? appendPisiDoneTagToBlock(block, mission.todoTag)
        : removePisiDoneTagFromBlock(block, mission.todoTag);

    window.syncPisiTodoBlockMarkers?.(block);

    return {
        changed,
        previousHtml
    };
}

function rollbackPisiMissionBlock(block, previousHtml) {
    if (!block) return;

    block.innerHTML = previousHtml;

    if (typeof initializePisiAdvancedEditorContent === 'function') {
        initializePisiAdvancedEditorContent(block);
    }
    window.syncPisiTodoBlockMarkers?.(block);
}

async function setPisiMissionCompletion(mission, completed) {
    if (!mission?.nodePath) {
        return {
            ok: false,
            error: 'Görev node yolu bulunamadı.'
        };
    }

    try {
        // 1) Görev şu an center editor içindeyse DOM ve disk birlikte güncellenir.
        if (samePisiPathForTags(activeCenterNode?.path, mission.nodePath)) {
            const editor = document.getElementById('center-node-editor-content');

            const block = findPisiMissionBlockInContainer(editor, mission);

            if (!block) {
                return {
                    ok: false,
                    error: 'Görev bloğu center editor içinde bulunamadı.'
                };
            }

            const change = setPisiMissionCompletionInBlock(
                block,
                mission,
                completed
            );

            if (!change.changed) {
                return {
                    ok: true,
                    unchanged: true
                };
            }

            editor.dispatchEvent(new Event('input', {
                bubbles: true
            }));

            let saveSucceeded = false;
            let saveError = 'Node kaydedilemedi.';

            if (typeof saveCurrentCenterNodeEditor === 'function') {
                saveSucceeded = await saveCurrentCenterNodeEditor();
            } else {
                const saveResult = await window.pisiProject?.saveNodeContent?.(
                    mission.nodePath,
                    getPisiEditorContent(editor)
                );

                saveSucceeded = saveResult?.ok === true;
                saveError = saveResult?.error || saveError;
            }

            if (!saveSucceeded) {
                rollbackPisiMissionBlock(block, change.previousHtml);
                refreshPisiTagsPanelSoon();
                return {
                    ok: false,
                    error: saveError
                };
            }

            return { ok: true };
        }

        // 2) Görev modal içindeyse başarısız kayıtta DOM geri alınır.
        if (samePisiPathForTags(activeModalNode?.path, mission.nodePath)) {
            const editor = document.getElementById('node-modal-content');

            const block = findPisiMissionBlockInContainer(editor, mission);

            if (!block) {
                return {
                    ok: false,
                    error: 'Görev bloğu modal içinde bulunamadı.'
                };
            }

            const change = setPisiMissionCompletionInBlock(
                block,
                mission,
                completed
            );

            if (!change.changed) {
                return {
                    ok: true,
                    unchanged: true
                };
            }

            editor.dispatchEvent(new Event('input', {
                bubbles: true
            }));

            const saveResult = await window.pisiProject?.saveNodeContent?.(
                mission.nodePath,
                getPisiEditorContent(editor)
            );

            if (!saveResult?.ok) {
                rollbackPisiMissionBlock(block, change.previousHtml);
                refreshPisiTagsPanelSoon();
                return {
                    ok: false,
                    error: saveResult?.error || 'Node kaydedilemedi.'
                };
            }

            if (activeModalNode) {
                activeModalNode.dirty = false;
            }
            return { ok: true };
        }

        // 3) Görev kapalı node içindeyse dosyayı oku, HTML içinde bul, kaydet.
        const doc = await window.pisiProject?.getPisiDocument?.(mission.nodePath);

        if (!doc?.ok) {
            return {
                ok: false,
                error: doc?.error || 'Node okunamadı.'
            };
        }

        const template = createPisiInertHtmlTemplate(doc.data?.content || '');

        const block = findPisiMissionBlockInContainer(
            template.content,
            mission
        );

        if (!block) {
            return {
                ok: false,
                error: 'Görev bloğu node HTML içinde bulunamadı.'
            };
        }

        const change = setPisiMissionCompletionInBlock(
            block,
            mission,
            completed
        );

        if (!change.changed) {
            return {
                ok: true,
                unchanged: true
            };
        }

        const saveResult = await window.pisiProject?.saveNodeContent?.(
            mission.nodePath,
            template.innerHTML
        );

        if (!saveResult?.ok) {
            return {
                ok: false,
                error: saveResult?.error || 'Node kaydedilemedi.'
            };
        }

        return { ok: true };
    } catch (error) {
        console.error('[PISI] Mission durum işaretleme hatası:', error);

        return {
            ok: false,
            error:
                error.message ||
                (completed
                    ? 'Görev tamamlandı olarak işaretlenemedi.'
                    : 'Görev yeniden açılamadı.')
        };
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "ensurePisiTagsPanelDom": {
        enumerable: true,
        get() { return ensurePisiTagsPanelDom; }
    },
    "renderPisiTagsPanel": {
        enumerable: true,
        get() { return renderPisiTagsPanel; }
    },
    "renderPisiTagExplorerPage": {
        enumerable: true,
        get() { return renderPisiTagExplorerPage; }
    },
    "openPisiTagExplorer": {
        enumerable: true,
        get() { return openPisiTagExplorer; }
    },
    "parsePisiTodoTag": {
        enumerable: true,
        get() { return parsePisiTodoTag; }
    },
    "formatPisiMissionDate": {
        enumerable: true,
        get() { return formatPisiMissionDate; }
    },
    "getPisiMissionsFromIndex": {
        enumerable: true,
        get() { return getPisiMissionsFromIndex; }
    },
    "escapePisiMissionRegExp": {
        enumerable: true,
        get() { return escapePisiMissionRegExp; }
    },
    "getPisiMissionDisplayText": {
        enumerable: true,
        get() { return getPisiMissionDisplayText; }
    },
    "renderPisiMissionsPanel": {
        enumerable: true,
        get() { return renderPisiMissionsPanel; }
    },
    "normalizePisiBlockText": {
        enumerable: true,
        get() { return normalizePisiBlockText; }
    },
    "createPisiDoneTagElement": {
        enumerable: true,
        get() { return createPisiDoneTagElement; }
    },
    "blockHasPisiDoneTag": {
        enumerable: true,
        get() { return blockHasPisiDoneTag; }
    },
    "blockHasPisiTag": {
        enumerable: true,
        get() { return blockHasPisiTag; }
    },
    "appendPisiDoneTagToBlock": {
        enumerable: true,
        get() { return appendPisiDoneTagToBlock; }
    },
    "removePisiDoneTagFromBlock": {
        enumerable: true,
        get() { return removePisiDoneTagFromBlock; }
    },
    "findPisiMissionBlockInContainer": {
        enumerable: true,
        get() { return findPisiMissionBlockInContainer; }
    },
    "setPisiMissionCompletionInBlock": {
        enumerable: true,
        get() { return setPisiMissionCompletionInBlock; }
    },
    "rollbackPisiMissionBlock": {
        enumerable: true,
        get() { return rollbackPisiMissionBlock; }
    },
    "setPisiMissionCompletion": {
        enumerable: true,
        get() { return setPisiMissionCompletion; }
    }
});
registerPisiCommandCenterPage({
    id: 'tags',
    label: 'Etiketler',
    order: 20,
    render: renderPisiTagExplorerPage
});
registerModule("tags.panels", moduleApi);
