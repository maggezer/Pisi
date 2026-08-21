import { registerModule } from '../core/module-registry.mjs';

const RETIRED_TASK_SCOPE_MODES = new Set([
    'active',
    'blocked',
    'overdue',
    'missing-next-action'
]);

const retirementState = {
    observer: null,
    persistTimer: null,
    handlersBound: false
};

function operationalModule() {
    return window.Pisi?.modules?.['map.operational'] || null;
}

function removeTaskScopeControl() {
    const control = document.getElementById('pisi-map-operational-scope');
    if (!control) return false;
    control.remove();
    return true;
}

async function persistRetiredScope() {
    const operational = operationalModule();
    const current = operational?.operationalState;
    if (!current || !window.activeMapPath || !window.pisiProject?.saveMapCamera) return;

    const result = await window.pisiProject.saveMapCamera(
        window.activeMapPath,
        {
            ...(window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
            collapsedHubs: Array.from(window.collapsedHubPorts || []),
            operationalPayload: {
                op: 'update',
                scope: current.scope,
                display: current.display
            }
        }
    );

    if (!result?.operational) return;
    current.scope = result.operational.scope || current.scope;
    current.display = result.operational.display || current.display;
    current.savedLayouts = Array.isArray(result.operational.savedLayouts)
        ? result.operational.savedLayouts
        : current.savedLayouts;
}

function scheduleRetiredScopePersistence() {
    clearTimeout(retirementState.persistTimer);
    retirementState.persistTimer = setTimeout(() => {
        retirementState.persistTimer = null;
        void persistRetiredScope();
    }, 120);
}

function retireTaskStatusScope() {
    removeTaskScopeControl();

    const operational = operationalModule();
    const current = operational?.operationalState;
    if (!current?.scope || !RETIRED_TASK_SCOPE_MODES.has(String(current.scope.mode || ''))) {
        return false;
    }

    current.scope.mode = 'all';
    operational.schedulePisiOperationalRender?.();
    scheduleRetiredScopePersistence();
    return true;
}

function scheduleRetirementSweep() {
    requestAnimationFrame(() => {
        retireTaskStatusScope();
    });
    setTimeout(retireTaskStatusScope, 120);
    setTimeout(retireTaskStatusScope, 450);
}

function bindRetirementHandlers() {
    if (retirementState.handlersBound) return;
    retirementState.handlersBound = true;

    document.addEventListener('pisi:map-customization-context-changed', scheduleRetirementSweep);
    document.addEventListener('pisi:language-changed', scheduleRetirementSweep);

    document.addEventListener('click', (event) => {
        const target = event.target?.closest?.(
            '#pisi-map-operational-restore, #pisi-map-apply-scope'
        );
        if (target) scheduleRetirementSweep();
    }, true);
}

function installTaskScopeRetirement() {
    bindRetirementHandlers();
    retireTaskStatusScope();

    const host = document.getElementById('right-panel-content') || document.body;
    if (!retirementState.observer && host) {
        retirementState.observer = new MutationObserver(() => {
            if (document.getElementById('pisi-map-operational-scope')) {
                retireTaskStatusScope();
            }
        });
        retirementState.observer.observe(host, { childList: true, subtree: true });
    }

    scheduleRetirementSweep();
}

registerModule('map.taskScopeRetirement', {
    installTaskScopeRetirement,
    removeTaskScopeControl,
    retireTaskStatusScope
});

installTaskScopeRetirement();

export {
    installTaskScopeRetirement,
    removeTaskScopeControl,
    retireTaskStatusScope
};
