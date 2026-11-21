import { registerModule } from '../core/module-registry.mjs';

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

    const counts = new Map();

    for (const block of index) {
        const blockTags = Array.isArray(block.tags) ? block.tags : [];

        for (const tag of blockTags) {
            // Old `todo.*` task tags are ordinary tags now (docs/task-plan.md §3.2.1).
            const normalizedTag = normalizePisiUserTag(tag);
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
