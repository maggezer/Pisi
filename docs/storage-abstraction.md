# Pisi Storage Abstraction

## Purpose

The storage abstraction gives main-process code one project-scoped I/O contract without redefining Pisi authorities or on-disk semantics.

It is a technical boundary, not a repository of truth.

The active stack is:

1. **Domain commands / services** decide what a mutation means.
2. **Atomic mutation** groups persistent semantic mutations and provides crash recovery.
3. **Authority stores** own task, relationship, property and document semantics.
4. **Project storage** converts project-relative keys into safe I/O operations.
5. **filesystemCore / Node fs** perform physical file operations.

Storage does not decide what a task, relationship, property, map or node means.

## Contract

`main/functions/storage-core.js` defines a synchronous, project-scoped contract with:

- project-relative key normalization;
- traversal rejection;
- `readText` / `readJson`;
- `writeText` / `writeJson`;
- directory creation;
- bounded recursive walk;
- stat/existence checks;
- rename;
- remove;
- explicit root-delete rejection.

The contract accepts a driver. The production driver is implemented in `main/functions/storage.js`; tests can use an in-memory driver.

## Filesystem driver safety

The filesystem driver:

- canonicalizes the project root;
- refuses paths outside that root;
- refuses symlink/junction traversal;
- verifies existing targets remain inside the project;
- delegates production text writes to `writeFileAtomic` when the normal bootstrap is active;
- uses a temporary-file + rename fallback only when the storage module is exercised standalone;
- marks its own physical I/O with a driver guard so routed filesystem calls cannot recurse into the storage port.

Atomic mutation remains the transaction/recovery boundary for multi-file semantic operations.

## Direct authority-store usage

The canonical stores use project storage for their scoped persistence, including:

- `.pisi/tasks.json` — task authority;
- `.pisi/relationships.json` — semantic relationship authority;
- `.pisi/properties.json` — property-definition authority;
- project property-template persistence used by the property domain.

The storage layer preserves each store's schema and does not reinterpret records.

## Project filesystem bridge

`main/functions/storage-project-fs-bridge.js` routes project-scoped filesystem operations used by document, map and sidecar code through the same storage safety boundary.

After runtime hooks are installed, the bridge covers project-local:

- UTF-8 document/map reads;
- directory listing used by node/map and sidecar discovery;
- existence/stat checks;
- directory creation;
- rename/move;
- unlink/remove.

The bridge is path-scoped. App settings, paths outside the active project, project lock files, `.git`, `node_modules` and `.pisi/mutations` remain infrastructure-level paths.

Binary reads remain physical I/O. Version History gzip payloads, attachments and other binary resources are not text-document storage records.

`writeFileAtomic`, including temporary-file, fsync and backup mechanics, also remains a physical filesystem primitive. The bridge does not replace `openSync`, `writeFileSync` or `copyFileSync`.

The bridge is an active I/O adapter only. It does not own semantics and it is not a second persistence model.

## Authority boundaries

Storage routing never changes the source-of-truth contract:

- `.node` owns node content and node property values;
- `.map` owns map membership, layout, camera, presentation and operational state;
- `.pisi/tasks.json` owns tasks;
- `.pisi/relationships.json` owns semantic relationships;
- `.pisi/properties.json` owns property definitions;
- `.pisi/mutations` is temporary crash-recovery state;
- `.pisi/trash` is reversible deletion payload state;
- `.pisi-history` is recovery/version-history state;
- search indexes and quick-navigation MRU are rebuildable projections.

The storage layer never interprets task IDs, semantic relationships, property definitions, relationship views or operational scopes.

## Backend rule

A future physical backend may replace or supplement the storage driver only if the same authority boundaries remain explicit.

A backend must not silently become a second task, relationship or property authority. Any future change to a canonical persistence format must be an explicit versioned product decision rather than an implementation side effect of the storage adapter.
