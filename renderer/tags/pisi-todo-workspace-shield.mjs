const PISI_TODO_BLOCKED_EVENTS = Object.freeze([
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'contextmenu',
    'wheel',
    'touchstart',
    'touchmove',
    'touchend',
    'dragstart',
    'dragover',
    'drop'
]);

function bindPisiTodoWorkspaceShield() {
    const workspace = document.getElementById('pisi-todo-workspace');
    const host = document.getElementById('workspace');
    if (!workspace || !host || workspace.dataset.eventShieldBound === '1') {
        return;
    }

    workspace.dataset.eventShieldBound = '1';

    const syncActiveState = () => {
        host.classList.toggle(
            'pisi-todo-workspace-active',
            workspace.hidden !== true
        );
    };

    for (const eventName of PISI_TODO_BLOCKED_EVENTS) {
        workspace.addEventListener(eventName, (event) => {
            if (workspace.hidden) return;
            event.stopPropagation();
        });
    }

    new MutationObserver(syncActiveState).observe(workspace, {
        attributes: true,
        attributeFilter: ['hidden']
    });

    syncActiveState();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPisiTodoWorkspaceShield);
} else {
    bindPisiTodoWorkspaceShield();
}

export {
    PISI_TODO_BLOCKED_EVENTS,
    bindPisiTodoWorkspaceShield
};
