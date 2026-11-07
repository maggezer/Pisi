import { monitorEventLoopDelay } from 'node:perf_hooks';
import { app } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';

// Test-only measurement probe (PISI_TEST_PERF=1 in a development build): main
// event loop delay since the last reset, and the number of open file watchers.
// Used by scripts/electron-project-performance.mjs; not registered otherwise.

const PISI_PERF_RESOLUTION_MS = 10;
const probe = { histogram: null };

function isPisiPerfProbeEnabled() {
    return !app.isPackaged && process.env.PISI_TEST_PERF === '1';
}

function readPisiPerfProbe(reset = false) {
    const histogram = probe.histogram;
    const toMs = (value) => Math.round((Number(value) || 0) / 1e5) / 10;
    const result = {
        ok: true,
        maxMs: toMs(histogram?.max),
        p99Ms: toMs(histogram?.percentile(99)),
        meanMs: toMs(histogram?.mean),
        watchers: modules['main.runtime']?.projectWatchers?.size ?? null
    };
    if (reset) histogram?.reset();
    return result;
}

function installPisiPerfProbe() {
    if (!isPisiPerfProbeEnabled()) return false;
    probe.histogram = monitorEventLoopDelay({ resolution: PISI_PERF_RESOLUTION_MS });
    probe.histogram.enable();
    modules['main.domainCommandQuery'].registerPisiDomainQuery('perf.test.loop.v1', (payload = {}) => readPisiPerfProbe(payload.reset === true));
    return true;
}

const moduleApi = { readPisiPerfProbe, installPisiPerfProbe };

registerMainModule('main.perfProbe', moduleApi);
installPisiPerfProbe();
