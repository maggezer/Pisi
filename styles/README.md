# Pisi CSS architecture

P3.7 consolidates the desktop application's global CSS into a small set of
ordered bundles. `style.css` is the only global stylesheet entry point and
must keep the bundle order stable because all global rules share the
`pisi` cascade layer.

## Global bundles

- `00-foundation.css` — reset, variables, window frame and base layout.
- `10-shell-map-panels.css` — app menu, tree, map interactions and shell panels.
- `40-editor.css` — base rich-text/editor styling.
- `50-productivity.css` — tags, missions, Todo, search and links.
- `58-workspaces-platform.css` — roadmap/workspace, customization, trash,
  integrity and sync surfaces.
- `65-shared-ui.css` — unified toolbar, document ink and shared components.
- `90-themes.css` — theme definitions and light-theme tuning.
- `92-compatibility.css` — compatibility fixes that must retain their original
  cascade order.
- `105-feature-polish.css` — late feature polish/overrides that must retain
  their original cascade order.

The source-section comments inside consolidated bundles preserve the old file
boundaries for easier blame/search while avoiding dozens of global stylesheet
requests.

## Component-owned CSS

CSS files below `renderer/` are intentionally not imported by `style.css`.
They belong to renderer modules and are loaded on demand by those modules.
Keep feature-specific, lazy styles next to their owning module rather than
moving them into the global bundles.

## Rules for future changes

1. Prefer editing the semantic global bundle that owns the affected surface.
2. Do not create numbered one-off global patch files for a single fix.
3. Preserve the import order in `style.css`; theme/compatibility precedence
   depends on it.
4. Put truly module-local lazy styles beside the renderer module.
5. Update `tests/css-consolidation.test.mjs` if the global architecture
   intentionally changes.

## Regression tests

Tests read the current bundle path, not a removed pre-consolidation file.
For checks scoped to one historical source section (especially negative
assertions), use `readCssSection` from `tests/source-bundle.js`. It reads the
real bundle and fails if the section marker is missing; it does not recreate
legacy stylesheets or change production loading. Cascade-order checks within
a bundle compare the relevant section positions, not the same import twice.

The consolidation tests also protect the global entry point, desktop package
inclusion and relative asset URLs. Run `npm run validate` after CSS changes.
