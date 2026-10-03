import { registerModule } from '../core/module-registry.mjs';
import {
    collectPisiMapPropertyDefinitions,
    getPisiActiveMapPropertyContext,
    getPisiNodePropertyMapContext
} from './pisi-structured-view-helpers.mjs';
import {
    appendPisiPropertyRow,
    collectPisiPropertyRows,
    createPisiPropertyRow,
    readPisiPropertyControlValue,
    renderPisiNodeProperties
} from './pisi-structured-view-property-ui.mjs';
import { pisiStructuredViewState } from './pisi-structured-view-state.mjs';
import { renderPisiBases } from './pisi-structured-view-ui.mjs';

const moduleApi = {
    pisiStructuredViewState,
    appendPisiPropertyRow,
    collectPisiMapPropertyDefinitions,
    createPisiPropertyRow,
    collectPisiPropertyRows,
    getPisiNodePropertyMapContext,
    getPisiActiveMapPropertyContext,
    readPisiPropertyControlValue,
    renderPisiNodeProperties,
    renderPisiBases
};

registerModule('data.structuredViews', moduleApi);

export {
    appendPisiPropertyRow,
    collectPisiMapPropertyDefinitions,
    collectPisiPropertyRows,
    createPisiPropertyRow,
    getPisiNodePropertyMapContext,
    getPisiActiveMapPropertyContext,
    pisiStructuredViewState,
    renderPisiBases,
    renderPisiNodeProperties
};
