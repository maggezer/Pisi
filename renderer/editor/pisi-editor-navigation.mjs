let workspaceGeneration = 0;
let modalGeneration = 0;

export function beginPisiWorkspaceNavigation() {
    modalGeneration += 1;
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
