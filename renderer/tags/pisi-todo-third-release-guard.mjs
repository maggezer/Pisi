const pisiTodoThirdGuardState = {
    observer: null,
    panel: null,
    queued: false
};

function isPisiTodoThirdDomStable() {
    const state = window.pisiTodoThirdReleaseState;
    const panel = document.getElementById('pisi-missions-panel');
    const toolbar = panel?.querySelector('.pisi-missions-toolbar');
    const list = document.getElementById('pisi-missions-list');
    if (!state || !panel || !toolbar || !list) return true;
    if (!window.currentProjectFolder) return true;
    if (!toolbar.querySelector('.pisi-third-view-switcher')) return false;

    if (state.view !== 'list') {
        return list.dataset.pisiThirdView === state.view && Boolean(list.firstElementChild);
    }

    const cards = Array.from(list.querySelectorAll('.pisi-mission-card'));
    return cards.every((card) => card.dataset.pisiThirdEnhanced === 'true');
}

function schedulePisiTodoThirdGuardApply() {
    if (pisiTodoThirdGuardState.queued) return;
    pisiTodoThirdGuardState.queued = true;
    queueMicrotask(() => {
        pisiTodoThirdGuardState.queued = false;
        if (!isPisiTodoThirdDomStable()) {
            window.applyPisiTodoThirdRelease?.();
        }
    });
}

function bindPisiTodoThirdGuard() {
    const state = window.pisiTodoThirdReleaseState;
    const panel = document.getElementById('pisi-missions-panel');
    if (!state || !panel) return false;

    state.observer?.disconnect();
    if (pisiTodoThirdGuardState.panel === panel && pisiTodoThirdGuardState.observer) {
        schedulePisiTodoThirdGuardApply();
        return true;
    }

    pisiTodoThirdGuardState.observer?.disconnect();
    pisiTodoThirdGuardState.panel = panel;
    pisiTodoThirdGuardState.observer = new MutationObserver(() => {
        schedulePisiTodoThirdGuardApply();
    });
    pisiTodoThirdGuardState.observer.observe(panel, {
        childList: true,
        subtree: true
    });
    schedulePisiTodoThirdGuardApply();
    return true;
}

if (!bindPisiTodoThirdGuard()) {
    const timer = setInterval(() => {
        if (bindPisiTodoThirdGuard()) clearInterval(timer);
    }, 250);
}

export {};
