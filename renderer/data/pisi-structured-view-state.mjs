const pisiStructuredViewState = {
    query: '',
    layout: 'table',
    savedViews: []
};

async function loadPisiSavedViews() {
    const result = await window.pisiProject?.listSavedViews?.(window.currentProjectFolder);
    pisiStructuredViewState.savedViews = result?.ok ? result.views : [];
    return pisiStructuredViewState.savedViews;
}

function applyPisiSavedView(viewId) {
    const view = pisiStructuredViewState.savedViews.find((item) => item.id === viewId);
    if (!view) return false;
    pisiStructuredViewState.query = view.query;
    pisiStructuredViewState.layout = view.layout;
    return true;
}

async function savePisiSavedView(name) {
    const result = await window.pisiProject?.saveView?.(window.currentProjectFolder, {
        name,
        query: pisiStructuredViewState.query,
        layout: pisiStructuredViewState.layout
    });
    if (result?.ok) await loadPisiSavedViews();
    return result;
}

async function deletePisiSavedView(viewId) {
    if (!viewId) return { ok: false };
    const result = await window.pisiProject?.deleteView?.(window.currentProjectFolder, viewId);
    if (result?.ok) await loadPisiSavedViews();
    return result;
}

export { applyPisiSavedView, deletePisiSavedView, loadPisiSavedViews, pisiStructuredViewState, savePisiSavedView };
