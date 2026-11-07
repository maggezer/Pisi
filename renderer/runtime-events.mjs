// From app.js:1426
setupWindowControls.closeUnsubscribe = null;

// From renderer/pisi-tree.js:1429
document.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
        event.preventDefault();
        startRenameSelectedTreeFile();
    }
});

// From renderer/pisi-node-modal.js:365
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bindNodeModalControls();
        setupPisiNodePreviews();
    });
} else {
    bindNodeModalControls();
    setupPisiNodePreviews();
}

// From renderer/pisi-map-connections.js:873
window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    let cancelled = false;

    if (pisiKeyboardConnectionSource) {
        pisiKeyboardConnectionSource.portEl?.classList.remove('connecting-source');
        pisiKeyboardConnectionSource.portEl?.setAttribute('aria-label', `${pisiKeyboardConnectionSource.sourcePort} bağlantı portu`);
        pisiKeyboardConnectionSource = null;
        cancelled = true;
    }

    if (currentConnectionDrag) {
        const sourcePortEl = currentConnectionDrag.sourceBox?.querySelector(`.map-port.${currentConnectionDrag.sourcePort}`);
        sourcePortEl?.classList.remove('connecting-source');
        currentConnectionDrag = null;
        clearTempEdgePath();
        cancelled = true;
    }

    if (cancelled) {
        event.preventDefault();
        event.stopPropagation();
    }
});

// From renderer/pisi-map-connections.js:906
window.addEventListener('mousemove', (event) => {
    if (!currentConnectionDrag) return;

    const mouse = getMousePointInCanvas(event);
    const temp = ensureTempEdgePath();

    if (temp) {
        temp.setAttribute('d', makeTempConnectionPath(currentConnectionDrag.sourceBox, currentConnectionDrag.sourcePort, mouse));
    }
});

// From renderer/pisi-map-connections.js:924
window.addEventListener('mouseup', async (event) => {
    if (!currentConnectionDrag) return;

    const targetPortEl = event.target.closest?.('.map-port');
    const sourcePortEl = currentConnectionDrag.sourceBox.querySelector(`.map-port.${currentConnectionDrag.sourcePort}`);

    sourcePortEl?.classList.remove('connecting-source');

    const clickDistance =
        Math.abs(event.clientX - (currentConnectionDrag.startClientX || event.clientX)) +
        Math.abs(event.clientY - (currentConnectionDrag.startClientY || event.clientY));

    if (targetPortEl === sourcePortEl && clickDistance <= 4 && currentConnectionDrag.type === 'down-hub') {
        toggleHubConnectionsFromPort(currentConnectionDrag.sourceId, currentConnectionDrag.sourcePort);

        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    if (!targetPortEl) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    const targetBox = targetPortEl.closest('.map-node-box');

    if (!targetBox) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    const targetId = targetBox.dataset.nodeId;
    const targetPort = targetPortEl.dataset.port;

    if (targetId === currentConnectionDrag.sourceId) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    let edgePayload = {
        sourceId: currentConnectionDrag.sourceId,
        targetId,
        sourcePort: currentConnectionDrag.sourcePort,
        targetPort,

        type: currentConnectionDrag.type,
        sourceRole: currentConnectionDrag.sourceRole,
        targetRole: currentConnectionDrag.targetRole
    };

    const result = await persistPisiMapConnection(edgePayload);

    if (!result || !result.ok) {
        if (!result?.cancelled) {
            pisiNotifyError(result?.error || 'Bağlantı kaydedilemedi.');
        }
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    currentConnectionDrag = null;
    clearTempEdgePath();
});

export {};
