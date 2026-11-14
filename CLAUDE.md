# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Pisi** is an Electron desktop knowledge-mapping app (GitHub: `maggezer/Pisi`, formerly `maggezer/Kedi`). Notes are `.node` files and knowledge maps are `.map` files: JSON documents stored in a user-chosen project folder. There is no app database. The file formats are specified in `pisi-definition.md`. User-facing docs, `pisi-update.md` (changelog), `pisi-error.md` (known open issues) and many test names/assertion messages are in Turkish.

## Commands

Node.js 24 is used in CI (`.github/workflows/ci.yml`).

```bash
npm ci                      # full install (downloads Electron binary; needed for npm start / e2e)
npm ci --ignore-scripts     # what CI uses for validation: no Electron binary
npm start                   # run the app (electron .)
npm test                    # node --test: all unit/regression tests in tests/ (~5s)
node --test tests/domain-command-query.test.js                         # single file
node --test --test-name-pattern="fail closed" tests/domain-command-query.test.js   # single test
npm run lint                # eslint .
npm run check:types         # generates .pisi-types/runtime-globals.d.ts, then tsc checkJs
npm run check:architecture  # module ownership, file-size limits, CSS rules (see below)
npm run check:i18n          # TR/ENG locale key parity
npm run check:branding      # product naming/asset checks on production files
npm run format              # prettier --write
npm run validate            # format:check + validate:source; this is the CI gate
npm run audit               # npm audit at moderate+ for runtime AND full tree; no exceptions (CI runs this first)
npm run test:e2e            # Electron E2E (needs real Electron; CI runs under xvfb-run -a)
```

`validate:source` = `check:syntax → check:architecture → check:branding → check:i18n → check:types → lint → test`. Run `npm run validate` (and `npm run audit` after dependency changes) before considering a change done. Vulnerable transitive dev dependencies are fixed with range-scoped `overrides` in `package.json` (e.g. `"minimatch@>=7.0.0 <11.0.1"`), not `npm audit fix --force`. Additional Electron E2E scripts for the editor live in `scripts/electron-editor-*-e2e.mjs` and can be run directly with `node`.

Prettier: 4-space indent, single quotes, no trailing commas, `printWidth` 160.

Commits follow Conventional Commits with a scope, e.g. `fix(editor): …`, `test(editor): …`, `fix(ci): …`, `style(editor): …`.

## Çalışma kuralları (Definition of Done)

Bir iş ancak aşağıdakilerin hepsi sağlandığında bitmiş sayılır:

1. Her iş ayrı bir branch'te yapılır ve tek bir PR olarak açılır. PR başlığı Conventional Commits biçimindedir. Açıklamada ilgili eksik listesi maddesi (ör. `A4`) ile neyin nasıl test edildiği yazılır.
2. Bitirmeden önce `npm run validate` eksiksiz geçer. Arayüze dokunan değişikliklerde `xvfb-run -a npm run test:e2e` de geçer.
3. Yeni davranış için davranış testi eklenir:
    - Saf modüller için modülü doğrudan import eden bir `.mjs` testi yazılır.
    - Kullanıcı akışı için `scripts/` altındaki CDP kalıbıyla bir Electron E2E testi yazılır.
    - Kaynak kodu regex ile okuyan yeni test yazılmaz. Dokunulan dosyayı kapsayan eski regex testleri mümkünse davranış testine çevrilir.
4. Yeni veya değişen kullanıcı metinleri TR ve ENG locale dosyalarına eklenir. Yeni export edilen fonksiyonlar ilgili `module-manifest.json` dosyasına yazılır.
5. Birden fazla modülü etkileyen işlerde önce plan çıkarılır ve onay beklenir.
6. Yapılan değişiklik `pisi-update.md` dosyasına tarihli bir girişle yazılır. Doğrulanan ama bu PR'da çözülmeyen yeni bir hata `pisi-error.md` dosyasına eklenir.
7. Kullanıcı verisini etkileyen değişikliklerde (dosya biçimi, kayıt, silme) mevcut projelerle geriye uyumluluk korunur ya da açık bir geçiş adımı yazılır.

## Mobile

Pisi Mobil (önce Android) [`docs/mobile-plan.md`](docs/mobile-plan.md) belgesindeki fazlarla (M0–M10) geliştirilir. **Mobil işlerde önce bu belgeyi oku.** Çalışma biçimi (§0), değişmez veri kuralları (§2), hedef mimari (§3) ve mobil PR'lar için ek "bitti" koşulları (§3.6) o belgededir. Yukarıdaki çalışma kuralları mobil işler için de geçerlidir.

## Architecture

### Processes and boundaries

- `main.mjs`: a thin ESM bootstrap that only imports `main/functions/*.js` and `main/runtime.js` in a fixed order. `check:architecture` fails it if it grows past 40 lines or contains CommonJS.
- `main/` is ESM (`main/package.json` has `"type": "module"`). `require`/`module.exports` are forbidden there. Electron APIs are imported via `main/electron-bridge.js`.
- `preload.js` is deliberately **CommonJS** (sandboxed preload). It exposes a narrow, validated API through `contextBridge`: `window.pisiProject`, `window.pisiDomain`, `window.electronWindow`, `window.pisiUpdates`, etc.
- `index.html` must load exactly one module script, `renderer/bootstrap.mjs`, which imports all renderer modules in order and then seals the registry.

### Module registry / global bindings (both worlds)

Code is not wired through normal ES imports between feature modules. Each module builds a `moduleApi` object and calls:

- main: `registerMainModule('main.xyz', moduleApi)` (`main/module-registry.js`)
- renderer: `registerModule('name', api)` (`renderer/core/module-registry.mjs`)

Every key is installed as a non-configurable **global getter** on `globalThis`/`window`, so other modules call these functions as bare identifiers. Collisions, double registration and late registration (renderer registry is sealed after bootstrap) throw at runtime.

Every exported binding must also be listed in `main/module-manifest.json` or `renderer/module-manifest.json`, under the correct module name and path. `check:architecture` cross-checks source registrations against the manifests in both directions. The manifests also feed ESLint globals and the generated `checkJs` type globals. **When you add, rename or remove an exported function, update the manifest.** Spreads in a module API object are rejected because they cannot be audited.

File-size limits are enforced by `check:architecture`: renderer `.mjs` ≤ 1000 lines (≤ 650 for `tags/pisi-todo-third-*`, `data/pisi-structured-view*` and `calendar/pisi-calendar-*`; ≤ 300 for `renderer/runtime*`), `main/functions` ≤ 1100 (≤ 650 for `document-store*`). Split modules instead of growing them.

### Shared core (`shared/`)

`shared/*.mjs` holds the pure rules that the desktop (main and renderer) and the mobile app both import (`docs/mobile-plan.md` §3.1): `date-parser`, `wiki-link-core`, `task-model`, `task-views`, `diary-rules`, `document-naming`, `document-model` and `ids`. The desktop files that used to own this code keep their paths, export names and registry bindings and import from `shared/`: `renderer/productivity/pisi-date-parser.mjs`, `renderer/tags/pisi-todo-utils.mjs`, both wiki-link cores, and parts of `path-security.js`, `filesystem-core.js`, `document-store-*.js` and `task-store.js`. Change a rule in `shared/`, not in the wrapper.

`check:architecture` runs `scripts/shared-purity.js` on every shared module: it may import only other shared modules (`./name.mjs`), use only the language built-ins (no DOM, Node, Electron, Capacitor or registry bindings) and run nothing at import time. The caller passes in the clock, randomness and paths. `shared/**/*` is listed in `build.files`; the tests are `tests/shared-*.test.mjs`.

### Domain command/query layer

Semantic reads and mutations go through one versioned IPC boundary (`docs/domain-command-query.md`):

`UI → renderer/domain/pisi-domain-client.mjs or preload facade → 'pisi:domain-query' / 'pisi:domain-command' → main/functions/domain-command-query.js dispatcher → domain service → authority store → project storage`

Contracts are named `*.v1` (e.g. `task.upsert.v1`, `map.relationship.upsert.v1`) and unknown names fail closed. Extension domains (trash, integrity, sync, etc.) register their own contracts from their `*-domain.js` / `*-operation-hooks.js` modules. Many `window.pisiProject.*` methods in `preload.js` are convenience facades over the same channels. Do not add parallel storage-shaped IPC paths for semantic data. The remaining direct `ipcMain.handle` channels are mostly in `main/runtime.js`.

### Single source of truth (`docs/single-source-of-truth.md`)

- Tasks: `.pisi/tasks.json` is authoritative (`task-store.js`). Task markup inside nodes, diary/calendar views, progress stats and search records are **projections** and must never overwrite canonical state. Full project scans are read-only with respect to authorities.
- Relationships: `.pisi/relationships.json` is authoritative project-wide. A `.map` stores only membership, `nodes[].layout` (authoritative per-map x/y/size), camera/collapse state and `relationshipViews` (ports and visual customization only). Legacy `map.edges` is not part of the contract.
- Node properties/schema: `property-schema-*` modules. Saved views go in `.pisi-views.json`.

### Persistence stack (`docs/storage-abstraction.md`, `docs/atomic-mutations.md`)

Domain services → atomic mutation (`atomic-mutation*.js`; journal in `.pisi/mutations/mut_<id>/`; an interrupted mutation must recover to either the full before or full after state) → authority stores → project storage (`storage-core.js`, project-relative keys, traversal rejected) → `filesystem-core.js`. JSON writes are atomic (temp file + rename, optional `.pisi-backup`). Corrupt JSON is never silently replaced with empty content. Path access outside the active project is blocked (`path-security.js`).

Other project-local sidecars: `.pisi-history/<node-id>/` (gzip snapshots, max 50 per node; `version-history-*`), `.pisi/trash/items/` (reversible trash that archives task/relationship/map references for restore; `trash-*`), `.pisi-sync` (sync metadata only; `sync-*`).

### Renderer layout

Feature folders under `renderer/`: `core` (registry, i18n, `window.Pisi.state` shared state, command registry), `shell` (window, tabs, dialogs, command center), `tree` (Explorer), `map`, `editor` (block editor, Sheet/formula, Paint/ink, toolbar, history), `tags` (blocks, tags, todo/task system), `search`, `data` (properties, Bases, structured views, rollups), `calendar`, `productivity` (Quick Add, Turkish natural-date parsing), `portability`, `sync`. Editor behavior specs: `docs/editor-keyboard-rules.md` and `docs/editor-paste-rules.md`.

### CSS

`style.css` is the only global entry. It imports `styles/NN-*.css` bundles into one `pisi` cascade layer, and the import order is significant. Rules (enforced by `check:architecture`; see `styles/README.md`): no `!important` in `styles/`, and no duplicate root selectors across bundles. Edit the bundle that owns the surface instead of adding one-off patch files. Module-local lazy CSS lives next to its renderer module (not imported by `style.css`). Section markers `/* ===== Source: styles/<name> ===== */` inside bundles are read by tests via `readCssSection`.

### i18n

UI strings live in `locales/lang-tr.json`, `locales/lang-eng.json` and `locales/ui-translations.json` (`tr`/`eng` patch maps). Keys must match across TR and ENG (`check:i18n`).

### Branding

`check:branding` fails if the old project name `Kedi` (case-insensitive) appears in any production file (`main/`, `renderer/`, `shared/`, `styles/`, `locales/`, `main.mjs`, `preload.js`, `index.html`, `style.css`, `package*.json`), other than the GitHub repo URL. It also pins `package.json` `name: pisi`, `appId: com.mumin.pisi`, `productName: Pisi` and the icons.

## Tests

Tests use `node:test` with `node:assert/strict` (`.test.js` CJS or `.test.mjs` ESM), flat in `tests/`. Many are **source-invariant tests**: they read source files and assert with regexes (`tests/source-bundle.js` provides `readMainSource`/`readRendererSource`/`readCssSection`), or they pull a single function out of source with `extractFunction` (`tests/source-helper.js`) and run it in `vm`. Renaming functions, contract names or CSS sections can therefore break tests that look unrelated. Grep `tests/` for the identifier when refactoring. Pure renderer modules can also be imported directly from `.mjs` tests. Tests that need Electron stub the `electron` module.

## Release/packaging

`electron-builder` config is in `package.json` (`dist:*` scripts). Tagged `v*.*.*` pushes run `release.yml`, which builds Windows NSIS/Portable, macOS DMG/ZIP and Linux AppImage/DEB. MSIX/Store is a separate workflow. See `docs/macos-linux-release.md`, `docs/microsoft-store.md`, `docs/auto-update.md` and `docs/windows-code-signing.md`. Release notes are in `docs/releases/`.
