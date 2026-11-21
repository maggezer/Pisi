let workspaceGeneration = 0;
let modalGeneration = 0;

/** Starts a navigation of the center workspace; the task workspace closes on its event. */
export function beginPisiWorkspaceNavigation() {
    modalGeneration += 1;
    globalThis.document?.dispatchEvent(new CustomEvent('pisi:workspace-navigation'));
    return ++workspaceGeneration;
}

export function isPisiWorkspaceNavigationCurrent(request) {
    return request === workspaceGeneration;
}

export function beginPisiModalNavigation() {
    return ++modalGeneration;
}

export function isPisiModalNavigationCurrent(request) {
    return request === modalGeneration;
}
