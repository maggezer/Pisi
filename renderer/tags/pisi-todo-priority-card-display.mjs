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

function normalizePisiTodoPriorityCard(card) {
    if (!card) return false;

    card.querySelectorAll('.pisi-mission-priority').forEach((priority) => {
        priority.remove();
    });

    const top = card.querySelector('.pisi-mission-top');
    const status = top?.querySelector('.pisi-mission-status');
    const meta = card.querySelector('.pisi-mission-meta');
    if (!top || !status || !meta) return false;

    let badge = top.querySelector('.pisi-mission-workorder-priority');
    if (!badge) {
        badge = Array.from(meta.querySelectorAll(':scope > span')).find((item) => {
            return Boolean(getPisiTodoWorkorderPriorityValue(item.textContent));
        }) || null;
    }
    if (!badge) return false;

    const parsed = getPisiTodoWorkorderPriorityValue(badge.textContent);
    if (parsed) {
        badge.textContent = parsed.displayValue;
        badge.dataset.priorityValue = parsed.numericValue === null
            ? ''
            : String(parsed.numericValue);
    }

    badge.classList.add('pisi-mission-workorder-priority');
    if (badge.parentElement !== top || badge.previousElementSibling !== status) {
        status.after(badge);
    }

    return true;
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
                        node.matches?.('.pisi-mission-card, .pisi-mission-meta, .pisi-mission-top') ||
                        node.querySelector?.('.pisi-mission-card, .pisi-mission-meta, .pisi-mission-top')
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
    bindPisiTodoPriorityCardDisplay,
    getPisiTodoWorkorderPriorityValue,
    normalizePisiTodoPriorityCard,
    normalizePisiTodoPriorityCards,
    schedulePisiTodoPriorityCardNormalization
});

export {
    PISI_TODO_PRIORITY_TONE_CLASSES,
    applyPisiTodoPriorityTones,
    bindPisiTodoPriorityCardDisplay,
    getPisiTodoWorkorderPriorityValue,
    normalizePisiTodoPriorityCard,
    normalizePisiTodoPriorityCards,
    schedulePisiTodoPriorityCardNormalization
};
