// Domain extensions that register their contracts after the domain dispatcher
// (main/functions/domain-command-query.js). Kept in one loader so main.mjs stays
// a thin bootstrap; the order here is the load order.
import './editor-asset-domain.js';
import './wiki-link-domain.js';
import './reminder-service.js';
import './map-node-copy.js';
import './window-shell.js';
import './crash-handling.js';
import './perf-probe.js';
