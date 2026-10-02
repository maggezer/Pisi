import { registerModule } from '../core/module-registry.mjs';

function ensurePisiMindMapToolbarLayoutFixStyle() {
    // Consolidated CSS is loaded statically through style.css.
}

ensurePisiMindMapToolbarLayoutFixStyle();

registerModule('map.toolbarLayoutFix', {
    ensurePisiMindMapToolbarLayoutFixStyle
});

export { ensurePisiMindMapToolbarLayoutFixStyle };
