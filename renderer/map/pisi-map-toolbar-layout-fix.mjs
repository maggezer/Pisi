import { registerModule } from '../core/module-registry.mjs';

function ensurePisiMindMapToolbarLayoutFixStyle() {
    if (document.querySelector('link[data-pisi-mindmap-toolbar-layout-fix]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-toolbar-layout-fix.css';
    link.dataset.pisiMindmapToolbarLayoutFix = '1';
    document.head.appendChild(link);
}

ensurePisiMindMapToolbarLayoutFixStyle();

registerModule('map.toolbarLayoutFix', {
    ensurePisiMindMapToolbarLayoutFixStyle
});

export { ensurePisiMindMapToolbarLayoutFixStyle };
