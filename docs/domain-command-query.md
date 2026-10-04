# Domain Command / Query Layer

Pisi uses one versioned domain boundary for semantic reads and mutations. UI code does not choose authority files or storage-shaped IPC handlers.

## Runtime boundary

The active direction is:

`UI / view -> renderer domain client or preload API facade -> pisi:domain-query / pisi:domain-command -> main domain dispatcher -> domain service -> authority store / project storage`

`main/functions/domain-command-query.js` owns the generic IPC transport and the core v1 contracts. Domain extension modules can register additional versioned contracts against the same dispatcher.

Task, map and project methods exposed through `window.pisiProject` are convenience facades in `preload.js`. Where a domain contract exists, those methods invoke the same `pisi:domain-query` or `pisi:domain-command` channel; they do not create a second semantic path.

## Contract rules

- Queries read domain state and do not intentionally mutate authoritative data.
- Commands express semantic mutations and validate project/path boundaries before reaching services.
- Contract names are explicit and versioned as `*.v1`.
- Unknown command/query names fail closed.
- The active project root and document extensions are validated in the main process.
- Multi-file semantic mutations use the atomic mutation boundary when required.

## Core v1 queries

- `task.list.v1`
- `document.read.v1`
- `map.projection.v1`
- `map.operational.v1`
- `project.folder.list.v1`

Additional domains register their own contracts. Project Integrity, for example, registers `integrity.audit.v1` through its domain module.

## Core v1 commands

### Tasks

- `task.capture.v1`
- `task.upsert.v1`
- `task.update.v1`
- `task.delete.v1`
- `task.sync-projection.v1`

Task commands use the task capture/store services. The dispatcher does not interpret `.pisi/tasks.json` records itself.

### Maps and relationships

- `map.relationship.upsert.v1`
- `map.relationship.delete.v1`
- `map.relationship.reparent.v1`
- `map.layout.save.v1`
- `map.camera.save.v1`
- `map.operational.mutate.v1`
- `map.reference.detach.v1`
- `map.node.create.v1`

Semantic relationship commands go through the semantic relationship services. They do not write `.pisi/relationships.json` directly from transport code. Map layout, camera and operational state remain map-owned presentation/working state.

### Project mutations

- `project.item.rename.v1`
- `project.item.move.v1`
- `project.item.delete.v1`
- `project.path.delete.v1`
- `project.batch.v1`

Rename/move/delete commands keep task references and related semantic state inside the same domain mutation boundary. Batch mutation accepts only an allowlisted set of versioned commands and stops on the first failed operation.

## Renderer domain client

`renderer/domain/pisi-domain-client.mjs` exposes:

- `query(name, payload)`
- `command(name, payload)`

under `Pisi.modules['domain.client']`.

Feature code should use semantic contracts instead of selecting an authority file or inventing a storage-specific operation.

Example:

```js
await domain.command('task.capture.v1', {
    projectFolder,
    task
});
```

Renderer-only compositions may combine several domain calls, but they do not become persisted authorities.

## Atomicity and recovery

Before domain reads are surfaced, unfinished project mutation journals are recovered through the atomic mutation layer. Commands marked atomic execute through the per-project transaction boundary.

A failed command returns a normalized domain error and must not leave a partially committed semantic mutation.

## Source-of-truth boundaries

The domain layer is routing and policy, not storage.

- task authority: `.pisi/tasks.json`
- semantic relationship authority: `.pisi/relationships.json`
- property definition authority: `.pisi/properties.json`
- node content/property values: `.node`
- map membership/layout/camera/presentation/operational state: `.map`
- search/diary/editor views: rebuildable or transient projections

No query result, renderer cache or transport payload becomes a parallel source of truth.
