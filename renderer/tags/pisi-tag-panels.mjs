import { registerModule } from '../core/module-registry.mjs';
import { getPisiTagPanelModel, listPisiTaggedTasks } from './pisi-tag-panel-core.mjs';
import { getPisiTaskTitleReadingText } from '../tasks/pisi-task-title-links.mjs';
import { getPisiTaskPlaceLabel } from '../tasks/pisi-task-panel-dom.mjs';

function pisiTagPanelTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

/** A tagged task in the Tags panel (G6): its title and place; a click opens where it lives. */
function makePisiTagTaskCard(task) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pisi-tag-result-card pisi-tag-result-task';
    card.dataset.pisiTaskId = task.id;
    card.classList.toggle('pisi-task-done', task.status === 'done');
    const place = document.createElement('div');
    place.className = 'pisi-tag-result-node';
    place.textContent = `${task.status === 'done' ? '☑' : '☐'} ${getPisiTaskPlaceLabel(task)}`;
    const text = document.createElement('div');
    text.className = 'pisi-tag-result-text';
    text.textContent = getPisiTaskTitleReadingText(task.title) || pisiTagPanelTranslate('Başlıksız görev');
    card.append(place, text);
    card.addEventListener('click', () => void window.openPisiTaskLocation?.(task.id));
    return card;
}

function makePisiTagResultsHeading(text) {
    const heading = document.createElement('div');
    heading.className = 'pisi-tag-results-heading';
    heading.textContent = pisiTagPanelTranslate(text);
    return heading;
}

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

    const { pickerButton, pickerMenu, resultsEl } = dom;

    const index = Array.isArray(pisiTagsPanelState.index) ? pisiTagsPanelState.index : [];
    // Tagged tasks come from the task store (tasks.json), never from notes (G6).
    const tasks = window.getPisiTasks?.() || [];
    // Old `todo.*` task tags are ordinary tags now (docs/task-plan.md §3.2.1).
    const { tags, counts } = getPisiTagPanelModel(index, tasks, normalizePisiUserTag);

    if (!tags.length) {
        pisiTagsPanelState.selectedTag = null;
        pisiTagsPanelState.dropdownOpen = false;

        pickerButton.disabled = true;
        pickerButton.textContent = 'Choose tag';
        pickerMenu.hidden = true;
        pickerMenu.innerHTML = '';

        resultsEl.innerHTML = `
            <div class="right-panel-empty">
                ${escapeHtml(pisiTagPanelTranslate('Bu map, günlük notlar veya görevler içinde kullanıcı etiketi yok.'))}
            </div>
        `;

        return;
    }

    if (pisiTagsPanelState.selectedTag && !counts.has(pisiTagsPanelState.selectedTag)) {
        pisiTagsPanelState.selectedTag = null;
    }

    const selectedTag = pisiTagsPanelState.selectedTag || tags[0];

    pisiTagsPanelState.selectedTag = selectedTag;

    pickerButton.disabled = false;
    pickerButton.textContent = `#${selectedTag} (${counts.get(selectedTag)})`;
    pickerButton.setAttribute('aria-expanded', pisiTagsPanelState.dropdownOpen ? 'true' : 'false');

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
        return (
            Array.isArray(block.tags) &&
            block.tags.some((tag) => {
                return normalizePisiUserTag(tag) === selectedTag;
            })
        );
    });

    resultsEl.innerHTML = '';
    const taggedTasks = listPisiTaggedTasks(tasks, selectedTag, normalizePisiUserTag);
    if (taggedTasks.length && matchingBlocks.length) resultsEl.appendChild(makePisiTagResultsHeading('Bloklar'));

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

    if (taggedTasks.length) {
        resultsEl.appendChild(makePisiTagResultsHeading('Görevler'));
        for (const task of taggedTasks) resultsEl.appendChild(makePisiTagTaskCard(task));
    }
}

// A task's tags change with the task store; the panel follows without reading notes.
document.addEventListener('pisi:task-store-updated', () => {
    if (document.getElementById('pisi-tags-panel')) renderPisiTagsPanel();
});

const moduleApi = {};
Object.defineProperties(moduleApi, {
    ensurePisiTagsPanelDom: {
        enumerable: true,
        get() {
            return ensurePisiTagsPanelDom;
        }
    },
    renderPisiTagsPanel: {
        enumerable: true,
        get() {
            return renderPisiTagsPanel;
        }
    }
});
registerModule('tags.panels', moduleApi);
