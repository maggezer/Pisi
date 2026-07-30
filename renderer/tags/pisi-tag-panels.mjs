import { registerModule } from "../core/module-registry.mjs";

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
                    Choose tag
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

    if (!dom) {
        console.error('[PISI] Tags panel DOM bulunamadı.');
        return;
    }

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
        pickerButton.textContent = 'Choose tag';
        pickerMenu.hidden = true;
        pickerMenu.innerHTML = '';

        resultsEl.innerHTML = `
            <div class="right-panel-empty">
                Bu map veya günlük notlar içinde kullanıcı etiketi içeren blok yok.
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
}

function parsePisiTodoTag(tag) {
    const normalized = normalizePisiUserTag(tag);

    const match = normalized.match(
        /^todo\.([1-9])\.(\d{2})-(\d{2})-(\d{2}|\d{4})$/
    );

    if (!match) return null;

    const priority = Number(match[1]);
    const day = Number(match[2]);
    const month = Number(match[3]);
    const year = match[4].length === 2
        ? 2000 + Number(match[4])
        : Number(match[4]);

    const finishDate = new Date(year, month - 1, day);

    if (
        finishDate.getFullYear() !== year ||
        finishDate.getMonth() !== month - 1 ||
        finishDate.getDate() !== day
    ) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    finishDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.floor(
        (finishDate.getTime() - today.getTime()) / 86400000
    );

    const workorder = daysLeft / priority;

    return {
        tag: normalized,
        priority,
        finishDate,
        daysLeft,
        workorder
    };
}

function formatPisiMissionDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());

    return `${day}-${month}-${year}`;
}

function getPisiMissionsFromIndex(options = {}) {
    const missions = [];
    const includeCompleted = options.includeCompleted === true;

    const sourceIndex = Array.isArray(pisiTagsPanelState.missionIndex)
        ? pisiTagsPanelState.missionIndex
        : [];

    for (const block of sourceIndex) {
        const tags = Array.isArray(block.tags) ? block.tags : [];
        const doneFor = new Set(
            Array.isArray(block.doneFor)
                ? block.doneFor.map(normalizePisiUserTag)
                : []
        );

        const hasLegacyDone = block.legacyDone === true;

        for (const tag of tags) {
            const todo = parsePisiTodoTag(tag);

            if (!todo) continue;
            const completed = hasLegacyDone || doneFor.has(todo.tag);
            if (completed && !includeCompleted) continue;

            missions.push({
                ...block,
                todoTag: todo.tag,
                priority: todo.priority,
                finishDate: todo.finishDate,
                daysLeft: todo.daysLeft,
                workorder: todo.workorder,
                completed
            });
        }
    }

    missions.sort((a, b) => {
        if (a.workorder !== b.workorder) {
            return a.workorder - b.workorder;
        }

        if (a.finishDate.getTime() !== b.finishDate.getTime()) {
            return a.finishDate.getTime() - b.finishDate.getTime();
        }

        return b.priority - a.priority;
    });

    return missions;
}

function escapePisiMissionRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPisiMissionDisplayText(mission) {
    let text = String(mission?.text || '')
        .replace(/\s+/g, ' ')
        .trim();

    const todoTag = String(mission?.todoTag || '').trim();

    if (todoTag) {
        const todoTagPattern = new RegExp(
            `(^|\\s)(?:#|\\.\\.)?${escapePisiMissionRegExp(todoTag)}(?=\\s|$)`,
            'gi'
        );

        text = text.replace(todoTagPattern, ' ');
    }

    text = text.replace(
        /(^|\s)(?:#|\.\.)?todo\.[1-9]\.\d{2}-\d{2}-(?:\d{2}|\d{4})(?=\s|$)/gi,
        ' '
    );

    return text
        .replace(/\s+/g, ' ')
        .trim();
}

function renderPisiMissionsPanel() {
    const panelEl = document.getElementById('pisi-missions-panel');
    const listEl = document.getElementById('pisi-missions-list');

    if (!panelEl || !listEl) return;

    let toolbarEl = panelEl.querySelector('.pisi-missions-toolbar');
    if (!toolbarEl) {
        toolbarEl = document.createElement('div');
        toolbarEl.className = 'pisi-missions-toolbar';
        panelEl.insertBefore(toolbarEl, listEl);
    }

    if (!window.currentProjectFolder) {
    toolbarEl.innerHTML = '';
    listEl.innerHTML = `
        <div class="right-panel-empty">
            Missions için önce bir proje klasörü seç.
        </div>
    `;
    return;
}

    const allMissions = getPisiMissionsFromIndex({
        includeCompleted: true
    });
    const completedCount = allMissions.filter((mission) => {
        return mission.completed;
    }).length;
    const showCompleted = pisiTagsPanelState.showCompletedMissions === true;
    const missions = showCompleted
        ? allMissions
        : allMissions.filter((mission) => !mission.completed);

    toolbarEl.innerHTML = '';
    const completedToggle = document.createElement('button');
    completedToggle.type = 'button';
    completedToggle.className = 'pisi-missions-completed-toggle';
    completedToggle.setAttribute('aria-pressed', showCompleted ? 'true' : 'false');
    completedToggle.textContent = showCompleted
        ? `Tamamlananları gizle (${completedCount})`
        : `Tamamlananları göster (${completedCount})`;
    completedToggle.disabled = completedCount === 0;
    completedToggle.addEventListener('click', () => {
        pisiTagsPanelState.showCompletedMissions = !showCompleted;
        renderPisiMissionsPanel();
    });
    toolbarEl.appendChild(completedToggle);

    if (!missions.length) {
        listEl.innerHTML = `
            <div class="right-panel-empty">
                ${showCompleted
                    ? 'Bu projede görev yok.'
                    : 'Bu projede açık görev yok.'}
            </div>
        `;
        return;
    }

    listEl.innerHTML = '';

    for (const mission of missions) {
        const item = document.createElement('div');
        item.className = 'pisi-mission-card';
        item.classList.toggle('completed', mission.completed === true);

        const isLate = mission.daysLeft < 0;

        item.innerHTML = `
            <label class="pisi-mission-check-wrap" title="Tamamlandı olarak işaretle">
                <input class="pisi-mission-check" type="checkbox">
            </label>

            <button class="pisi-mission-main" type="button">
                <div class="pisi-mission-top">
                </div>

                <div class="pisi-mission-text">
                    ${escapeHtml(getPisiMissionDisplayText(mission) || '(boş blok)')}
                </div>

                <div class="pisi-mission-meta">
                    <span class="${isLate ? 'late' : ''}">
                        ${formatPisiMissionDate(mission.finishDate)}
                    </span>
                    <span>workorder: ${mission.workorder.toFixed(2)}</span>
                </div>

                <div class="pisi-mission-node">
                    ${escapeHtml(mission.nodeTitle)}
                </div>
            </button>
        `;

        const checkbox = item.querySelector('.pisi-mission-check');
        const mainButton = item.querySelector('.pisi-mission-main');

        if (checkbox) {
            checkbox.checked = mission.completed === true;
            checkbox.title = mission.completed
                ? 'Görevi yeniden aç'
                : 'Tamamlandı olarak işaretle';
        }

        checkbox?.addEventListener('click', async (event) => {
    event.stopPropagation();

    checkbox.disabled = true;

    const result = checkbox.checked
        ? await markPisiMissionDone(mission)
        : await reopenPisiMission(mission);

    if (!result?.ok) {
        checkbox.checked = mission.completed === true;
        checkbox.disabled = false;
        alert(
            result?.error ||
            (mission.completed
                ? 'Görev yeniden açılamadı.'
                : 'Görev tamamlandı olarak işaretlenemedi.')
        );
        return;
    }

    refreshPisiTagsPanelSoon();
    });

        mainButton?.addEventListener('click', async () => {
            await openPisiTagBlockResult(mission);
        });

        listEl.appendChild(item);
    }
}

function normalizePisiBlockText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function createPisiDoneTagElement(todoTag) {
    const tagEl = document.createElement('span');
    const normalizedTodoTag = normalizePisiUserTag(todoTag);

    tagEl.className = 'pisi-user-tag';
    tagEl.dataset.pisiTag = 'done';
    if (normalizedTodoTag) {
        tagEl.dataset.pisiDoneFor = normalizedTodoTag;
    }
    tagEl.contentEditable = 'false';
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
registerModule("tags.panels", moduleApi);
