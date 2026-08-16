# Pisi Storage Abstraction

## Purpose

The storage abstraction gives main-process stores one project-scoped I/O contract without changing any Pisi authority or on-disk schema.

It is intentionally a technical boundary, not a new repository of truth.

The current stack is:

1. **Domain commands / services** decide what a mutation means.
2. **Atomic mutation** groups persistent mutations and provides crash recovery.
3. **Authority stores** own task, relationship, property and document semantics.
4. **Project storage** converts project-relative keys into safe I/O operations.
5. **filesystemCore / Node fs** perform the physical file operation.

Storage therefore never decides what a task, relationship, property, map or node means.

## Contract

`main/functions/storage-core.js` defines a synchronous, project-scoped contract with:

- project-relative key normalization;
- traversal rejection;
- `readText` / `readJson`;
- `writeText` / `writeJson`;
- directory creation;
- bounded recursive walk;
- stat;
- rename;
- remove;
- explicit root-delete rejection.

The contract accepts a driver. The active 1.0 driver is the filesystem driver in `main/functions/storage.js`. Tests also exercise the contract through an in-memory driver, proving that store code does not need to know the physical backend.

## Filesystem driver safety

The filesystem driver:

- canonicalizes the project root;
- refuses paths outside that root;
- refuses symlink/junction traversal;
- verifies the real path of existing targets remains inside the project;
- delegates production writes to `writeFileAtomic` when the normal Pisi bootstrap is active;
- uses a temporary-file + rename fallback only when the storage module is exercised standalone, such as unit tests;
- marks its own physical I/O with a driver guard so compatibility routing cannot recurse back into the storage port.

This does **not** replace the atomic mutation layer. Atomic mutation remains the transaction/recovery boundary for multi-file semantic operations.

## First adoption wave

The first stores moved directly to the storage port are:

- `.pisi/tasks.json` — canonical first-class task authority;
- `.pisi/relationships.json` — canonical semantic relationship authority;
- `.pisi/properties.json` — canonical project property-definition authority;
- `.pisi/task-store-migration.json` — task single-source migration marker;
- property schema migration scans and `.pisi-templates.json` access.

Their paths and JSON formats are unchanged. No data migration is required by this abstraction.

## Second adoption wave: documents, maps and sidecars

`main/functions/storage-project-fs-bridge.js` closes most remaining direct project-file I/O behind the same storage port without rewriting mature document/map semantics in one risky change.

After the runtime and all operation hooks are installed, project-scoped filesystem calls are routed as follows:

- UTF-8 `.node` / `.map` and project file reads → storage `readText`;
- directory listing used by map/node and sidecar discovery → storage `list`;
- existence and stat checks → storage `exists` / `stat`;
- recursive sidecar and project directory creation → storage `ensureDirectory`;
- project-internal rename/move → storage `rename`;
- project-internal unlink/remove → storage `remove`.

The bridge is path-scoped. App settings, paths outside the active project, project lock files, `.git`, `node_modules`, and `.pisi/mutations` remain at the infrastructure layer.

Binary reads also remain physical I/O. This is intentional because Version History gzip payloads, attachments and other binary resources do not belong to the text-document storage contract.

`writeFileAtomic`, including its temporary file, fsync and backup mechanics, also remains a physical filesystem primitive. The bridge does not replace `openSync`, `writeFileSync` or `copyFileSync`. Document/map code therefore keeps the existing crash-safe byte-write implementation while its project metadata/read/list/move/remove access is centralized through project storage.

This compatibility bridge is transitional architecture, not a second storage model. It lets mature document/map code keep its behavior while making the storage boundary observable and replaceable. Future refactors may replace individual legacy calls with direct `ProjectStorage` methods without changing the on-disk format or domain contracts.

## Authority boundaries remain unchanged

The following are not converted into a second authority:

- `.node` files remain node content/property-value authority for each node;
- `.map` files remain map membership/presentation/operational-state authority;
- `.pisi/tasks.json` remains canonical task authority;
- `.pisi/relationships.json` remains canonical semantic relationship authority;
- `.pisi/properties.json` remains canonical property-definition authority;
- `.pisi/mutations` remains temporary crash-recovery state;
- `.pisi/trash` remains reversible deletion payload state;
- `.pisi-history` remains recovery/version-history state;
- search indexes and quick-navigation MRU remain rebuildable projections.

The storage bridge never interprets task IDs, semantic relationships, property definitions, map relationship views or operational scopes. It only routes project-relative I/O.

## Backend rule

A future backend such as SQLite may only replace or supplement the storage driver when the data can still be reconstructed or mapped without redefining Pisi authority boundaries.

In particular:

- SQLite must not silently become a second task authority beside `.pisi/tasks.json`;
- semantic relationships must still have one canonical owner;
- map presentation state must not be promoted into semantic authority;
- atomic mutation and recovery guarantees must remain explicit.

If a future storage backend changes the canonical persistence format, that is a separate migration/versioning decision, not an implementation detail of this abstraction.
