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
- uses a temporary-file + rename fallback only when the storage module is exercised standalone, such as unit tests.

This does **not** replace the atomic mutation layer. Atomic mutation remains the transaction/recovery boundary for multi-file semantic operations.

## First adoption wave

The first stores moved to the storage port are:

- `.pisi/tasks.json` — canonical first-class task authority;
- `.pisi/relationships.json` — canonical semantic relationship authority;
- `.pisi/property-schema.json` — canonical project property-definition authority;
- `.pisi/task-store-migration.json` — task single-source migration marker;
- property schema migration scans and `.pisi-templates.json` access.

Their paths and JSON formats are unchanged. No data migration is required by this abstraction.

## What remains intentionally unchanged

The following are not converted into a second authority:

- `.node` and `.map` document semantics remain in the document/map stores;
- `.pisi/mutations` remains temporary crash-recovery state;
- `.pisi/trash` remains reversible deletion payload state;
- `.pisi-history` remains recovery/version-history state;
- search indexes and quick-navigation MRU remain rebuildable projections.

Low-level document/file-tree operations may still use `filesystemCore` directly where they own filesystem semantics such as physical move/rename and sidecar coordination. Those operations can migrate incrementally to project storage later without changing domain contracts.

## Backend rule

A future backend such as SQLite may only replace or supplement the storage driver when the data can still be reconstructed or mapped without redefining Pisi authority boundaries.

In particular:

- SQLite must not silently become a second task authority beside `.pisi/tasks.json`;
- semantic relationships must still have one canonical owner;
- map presentation state must not be promoted into semantic authority;
- atomic mutation and recovery guarantees must remain explicit.

If a future storage backend changes the canonical persistence format, that is a separate migration/versioning decision, not an implementation detail of this abstraction.
