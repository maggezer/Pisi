import { registerModule } from '../core/module-registry.mjs';

function getMapWorldPointFromClient(clientX, clientY) {
    const canvas = document.getElementById('map-canvas');
    const rect = canvas?.getBoundingClientRect();

    if (!rect) {
        return { x: 80, y: 80 };
    }

    const zoom = activeMapCamera?.zoom || 1;

    return {
        x: (clientX - rect.left - (activeMapCamera?.x || 0)) / zoom,
        y: (clientY - rect.top - (activeMapCamera?.y || 0)) / zoom
    };
}

function isMapBlankEventTarget(event) {
    return !(
        event.target.closest?.('.map-node-box') ||
        event.target.closest?.('.map-edge-group') ||
        event.target.closest?.('.map-edge-hit') ||
        event.target.closest?.('.map-edge-delete') ||
        event.target.closest?.('#map-zoom-controls') ||
        event.target.closest?.('.pisi-map-overlay-control') ||
        event.target.closest?.('.pisi-map-context-menu')
    );
}

async function createMapNodeBoxAtClientPoint(clientX, clientY) {
    if (!activeMapPath) return;

    const worldPoint = getMapWorldPointFromClient(clientX, clientY);

    suppressNextFileSystemRefresh(3000);

    const result = await window.pisiProject?.createNodeUnderMap?.(activeMapPath);

    if (!result || !result.ok) {
        alert(result?.error || 'Node box oluşturulamadı.');
        return;
    }

    const node = result.node;

    if (!node) {
        alert('Node oluşturuldu ama map içine eklenemedi. Map’i yeniden açmayı dene.');
        return;
    }

    node.layout = {
        x: Math.round(worldPoint.x - 110),
        y: Math.round(worldPoint.y - 46),
        width: Number(node.layout?.width || 220),
        height: Number(node.layout?.height || 92)
    };

    activeMapNodes = [...activeMapNodes.filter((item) => item.id !== node.id), node];

    appendMapNodeBox(node);
    await saveCurrentMapLayout();
    window.recordPisiMapStep?.({ kind: 'node-create', mapPath: activeMapPath, nodeId: node.id, nodePath: node.fullPath, trashId: null });

    if (typeof refreshActiveMapTreeBranch === 'function') {
        await refreshActiveMapTreeBranch();
    }

    refreshPisiTagsPanelSoon();
}

function hidePisiMapContextMenu() {
    document.getElementById('pisi-map-context-menu')?.remove();
}

function showPisiMapContextMenu(clientX, clientY) {
    hidePisiMapContextMenu();

    const menu = document.createElement('div');
    menu.id = 'pisi-map-context-menu';
    menu.className = 'pisi-map-context-menu';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'pisi-map-context-menu-item';
    createBtn.textContent = '📄 Node box oluştur';

    createBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        hidePisiMapContextMenu();
        await createMapNodeBoxAtClientPoint(clientX, clientY);
    });

    menu.appendChild(createBtn);
    // Editing actions (paste, auto layout, grid) join the menu (pisi-map-editing.mjs).
    document.dispatchEvent(new CustomEvent('pisi:map-context-menu', { detail: { menu, clientX, clientY } }));
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);

    menu.style.left = `${Math.min(clientX, maxLeft)}px`;
    menu.style.top = `${Math.min(clientY, maxTop)}px`;
}

function bindMapCreationEvents() {
    const canvas = document.getElementById('map-canvas');

    if (!canvas || canvas.dataset.creationBound === '1') return;

    canvas.dataset.creationBound = '1';

    canvas.addEventListener('dblclick', async (event) => {
        if (!activeMapPath || !isMapBlankEventTarget(event)) return;

        event.preventDefault();
        event.stopPropagation();

        hidePisiMapContextMenu();
        await createMapNodeBoxAtClientPoint(event.clientX, event.clientY);
    });

    canvas.addEventListener('contextmenu', (event) => {
        if (canvas.dataset.skipNextContextMenu === '1') {
            canvas.dataset.skipNextContextMenu = '0';
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (!activeMapPath || !isMapBlankEventTarget(event)) return;

        event.preventDefault();
        event.stopPropagation();

        showPisiMapContextMenu(event.clientX, event.clientY);
    });

    document.addEventListener('mousedown', (event) => {
        if (!event.target.closest?.('.pisi-map-context-menu')) {
            hidePisiMapContextMenu();
        }
    });

    window.addEventListener('blur', hidePisiMapContextMenu);
}

registerModule('map.creation', {
    getMapWorldPointFromClient,
    isMapBlankEventTarget,
    createMapNodeBoxAtClientPoint,
    hidePisiMapContextMenu,
    showPisiMapContextMenu,
    bindMapCreationEvents
});
