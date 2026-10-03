import { claimRendererBoot } from './core/module-registry.mjs';

claimRendererBoot('renderer.runtime', 'renderer/runtime.mjs');

await import('./runtime-lifecycle.mjs');
await import('./calendar/pisi-calendar-runtime.mjs');
await import('./runtime-events.mjs');

export {};
