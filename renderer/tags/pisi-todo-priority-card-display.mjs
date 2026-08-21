import { registerModule } from '../core/module-registry.mjs';

let todoPriorityCardObserver = null;
let todoPriorityCardFrame = null;

function getPisiTodoWorkorderPriorityText(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(Order|Sıra)\s*:\s*(.+)$/i);
    if (!match) return null;

    const label = match[1].toLowerCase() === 'sıra'
        ? 'Öncelik'
        : 'Priority';
    return `${label}: ${match[2]}`;
}

function normalizePisiTodoPriorityCard(card) {
    if (!card) return false;

    card.querySelectorAll('.pisi-mission-priority').forEach((priority) => {
        priority.remove();
    });

    let changed = false;
    card.querySelectorAll('.pisi-mission-meta > span').forEach((meta) => {
        const replacement = getPisiTodoWorkorderPriorityText(meta.textContent);
        if (!replacement || meta.textContent === replacement) return;
        meta.textContent = replacement;
        meta.classList.add('pisi-mission-workorder-priority');
        changed = true;
    });

    return changed;
}

function normalizePisiTodoPriorityCards(root = document) {
    const cards = [];
    if (root?.matches?.('.pisi-mission-card')) cards.push(root);
    root?.querySelectorAll?.('.pisi-mission-card').forEach((card) => cards.push(card));
    cards.forEach(normalizePisiTodoPriorityCard);
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
                        node.matches?.('.pisi-mission-card, .pisi-mission-meta') ||
                        node.querySelector?.('.pisi-mission-card, .pisi-mission-meta')
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
    bindPisiTodoPriorityCardDisplay,
    getPisiTodoWorkorderPriorityText,
    normalizePisiTodoPriorityCard,
    normalizePisiTodoPriorityCards,
    schedulePisiTodoPriorityCardNormalization
});

export {
    bindPisiTodoPriorityCardDisplay,
    getPisiTodoWorkorderPriorityText,
    normalizePisiTodoPriorityCard,
    normalizePisiTodoPriorityCards,
    schedulePisiTodoPriorityCardNormalization
};
