import './runtime-lifecycle.mjs';
import './calendar/pisi-calendar-runtime.mjs';
import './runtime-events.mjs';
import { claimRendererBoot } from './core/module-registry.mjs';

claimRendererBoot('renderer.runtime', 'renderer/runtime.mjs');

export {};
