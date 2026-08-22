import { registerModule } from '../core/module-registry.mjs';

let todoPriorityCardObserver = null;
let todoPriorityCardFrame = null;

const PISI_TODO_PRIORITY_TONE_CLASSES = Object.freeze([
    'pisi-priority-tone-0',
    'pisi-priority-tone-1',
    'pisi-priority-tone-2',
    'pisi-priority-tone-3',
    'pisi-priority-tone-4',
    'pisi-priority-tone-neutral'
]);

function getPisiTodoWorkorderPriorityValue(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(?:Order|Sıra|Priority|Öncelik)\s*:\s*(.+)$/i);
    if (!match) return null;

    const displayValue = String(match[1] || '').trim();
    const numericValue = Number(displayValue.replace(',', '.'));
    return {
        displayValue,
        numericValue: Number.isFinite(numericValue) ? numericValue : null
    };
}

function removePisiTodoCardContext(card) {
    if (!card) return false;
    let changed = false;

    card.querySelectorAll('.pisi-mission-node').forEach((location) => {
        location.remove();
        changed = true;
    });

    const meta = card.querySelector('.pisi-mission-meta');
    const firstMeta = meta?.querySelector(':scope > span:first-child');
    if (
        firstMeta &&
        !firstMeta.classList.contains('pisi-mission-priority') &&
        !firstMeta.classList.contains('pisi-mission-workorder-priority') &&
        !firstMeta.classList.contains('pisi-task-duration-badge') &&
        !getPisiTodoWorkorderPriorityValue(firstMeta.textContent)
    ) {
        firstMeta.remove();
        changed = true;
    }

    return changed;
}

function arrangePisiTodoCardLayout(card, badge, status) {
    if (!card || !badge || !status) return false;

    const content = card.querySelector('.pisi-mission-content');
    const main = card.querySelector('.pisi-mission-main');
    const check = card.querySelector('.pisi-mission-check-wrap');
    const top = card.querySelector('.pisi-mission-top');
    if (!content || !main || !check || !top) return false;

    let changed = false;
    if (!card.classList.contains('pisi-mission-compact-card')) {
        card.classList.add('pisi-mission-compact-card');
        changed = true;
    }

    status.classList.add('pisi-mission-status-icon');
    const selectedStatus = String(status.selectedOptions?.[0]?.textContent || '').trim();
    status.title = selectedStatus || String(status.getAttribute('aria-label') || 'To-Do');

    if (main.parentElement !== card) {
        card.appendChild(main);
        changed = true;
    }
    if (badge.parentElement !== card) {
        card.appendChild(badge);
        changed = true;
    }

    const desired = [badge, main, check, content];
    const current = Array.from(card.children).filter((child) => desired.includes(child));
    if (desired.some((child, index) => current[index] !== child)) {
        desired.forEach((child) => card.appendChild(child));
        changed = true;
    }

    if (top.parentElement !== content) {
        content.prepend(top);
        changed = true;
    }

    const planning = card.querySelector('.pisi-third-planning');
    const summary = planning?.querySelector(':scope > summary');
    if (planning) {
        planning.classList.add('pisi-mission-planning-icon-menu');
        if (planning.parentElement !== content) {
            content.appendChild(planning);
            changed = true;
        }
    }
    if (summary) {
        const label = String(summary.textContent || '').trim();
        summary.classList.add('pisi-mission-planning-icon');
        summary.title = label || 'Planlama';
        summary.setAttribute('aria-label', label || 'Planlama');
    }

    return changed;
}

function normalizePisiTodoPriorityCard(card) {
    if (!card) return false;

    let changed = removePisiTodoCardContext(card);

    card.querySelectorAll('.pisi-mission-priority').forEach((priority) => {
        priority.remove();
        changed = true;
    });

    const top = card.querySelector('.pisi-mission-top');
    const status = top?.querySelector('.pisi-mission-status') ||
        card.querySelector('.pisi-mission-status');
    const meta = card.querySelector('.pisi-mission-meta');
    if (!top || !status) return changed;

    let badge = card.querySelector('.pisi-mission-workorder-priority');
    if (!badge) {
        badge = Array.from(meta?.querySelectorAll?.(':scope > span') || []).find((item) => {
            return Boolean(getPisiTodoWorkorderPriorityValue(item.textContent));
        }) || null;
    }
    if (!badge) return changed;

    const parsed = getPisiTodoWorkorderPriorityValue(badge.textContent);
    if (parsed) {
        badge.textContent = parsed.displayValue;
        badge.dataset.priorityValue = parsed.numericValue === null
            ? ''
            : String(parsed.numericValue);
    }

    badge.classList.add('pisi-mission-workorder-priority');
    changed = arrangePisiTodoCardLayout(card, badge, status) || changed;
    return changed;
}

function applyPisiTodoPriorityTones(root = document) {
    const badges = Array.from(
        root.querySelectorAll('.pisi-mission-workorder-priority')
    );
    const finite = badges.map((badge) => Number(badge.dataset.priorityValue))
        .filter((value) => Number.isFinite(value));
    const min = finite.length ? Math.min(...finite) : null;
    const max = finite.length ? Math.max(...finite) : null;

    badges.forEach((badge) => {
        PISI_TODO_PRIORITY_TONE_CLASSES.forEach((className) => {
            badge.classList.remove(className);
        });

        const value = Number(badge.dataset.priorityValue);
        if (!Number.isFinite(value) || min === null || max === null) {
            badge.classList.add('pisi-priority-tone-neutral');
            return;
        }

        if (max === min) {
            badge.classList.add('pisi-priority-tone-2');
            return;
        }

        const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
        const tone = Math.round(ratio * 4);
        badge.classList.add(`pisi-priority-tone-${tone}`);
    });

    return badges.length;
}

function normalizePisiTodoPriorityCards(root = document) {
    const cards = [];
    if (root?.matches?.('.pisi-mission-card')) cards.push(root);
    root?.querySelectorAll?.('.pisi-mission-card').forEach((card) => cards.push(card));
    cards.forEach(normalizePisiTodoPriorityCard);
    applyPisiTodoPriorityTones(document);
    return cards.length;
}

function schedulePisiTodoPriorityCardNormalization() {
    if (todoPriorityCardFrame !== null) return;
    todoPriorityCardFrame = requestAnimationFrame(() => {
        todoPriorityCardFrame = null;
        normalizePisiTodoPriorityCards(document);
    });
}

function bindPisiTodoPriorityCardDisplay() {
    schedulePisiTodoPriorityCardNormalization();

    if (!todoPriorityCardObserver && document.body) {
        todoPriorityCardObserver = new MutationObserver((mutations) => {
            const touchesTodoCards = mutations.some((mutation) => (
                [...mutation.addedNodes].some((node) => (
                    node?.nodeType === Node.ELEMENT_NODE &&
                    (
                        node.matches?.(
                            '.pisi-mission-card, .pisi-mission-meta, .pisi-mission-top, ' +
                            '.pisi-mission-main, .pisi-mission-node, .pisi-third-planning'
                        ) ||
                        node.querySelector?.(
                            '.pisi-mission-card, .pisi-mission-meta, .pisi-mission-top, ' +
                            '.pisi-mission-main, .pisi-mission-node, .pisi-third-planning'
                        )
                    )
                ))
            ));
            if (touchesTodoCards) schedulePisiTodoPriorityCardNormalization();
        });
        todoPriorityCardObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPisiTodoPriorityCardDisplay, {
        once: true
    });
} else {
    bindPisiTodoPriorityCardDisplay();
}

registerModule('tags.todoPriorityCardDisplay', {
    PISI_TODO_PRIORITY_TONE_CLASSES,
    applyPisiTodoPriorityTones,
    arrangePisiTodoCardLayout,
    bindPisiTodoPriorityCardDisplay,
    getPisiTodoWorkorderPriorityValue,
    normalizePisiTodoPriorityCard,
    normalizePisiTodoPriorityCards,
    removePisiTodoCardContext,
    schedulePisiTodoPriorityCardNormalization
});

export {
    PISI_TODO_PRIORITY_TONE_CLASSES,
    applyPisiTodoPriorityTones,
    arrangePisiTodoCardLayout,
    bindPisiTodoPriorityCardDisplay,
    getPisiTodoWorkorderPriorityValue,
    normalizePisiTodoPriorityCard,
    normalizePisiTodoPriorityCards,
    removePisiTodoCardContext,
    schedulePisiTodoPriorityCardNormalization
};
