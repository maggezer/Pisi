# Domain Command / Query Layer

Pisi now has an explicit domain boundary between UI/transport code and storage services.

## Boundary

The intended direction is:

`UI / view -> renderer domain client -> compatibility transport -> main domain command/query -> domain service -> storage`

The compatibility transport remains because the existing preload API is already part of the app surface. Its task/map handlers are rebound after the legacy runtime and semantic hooks, so callers keep working while storage decisions move behind the domain contracts.

## Contract rules

- Queries read domain state and do not intentionally mutate authoritative domain data.
- Commands express mutations and enforce domain/path rules before reaching storage.
- Contract names are versioned (`*.v1`).
- Unknown command/query names fail closed; there is no dynamic method-name dispatch into modules or stores.
- Paths are still validated against the active project boundary before domain services are called.

## Initial v1 queries

- `task.list.v1`
- `document.read.v1`
- `map.projection.v1`
- `map.operational.v1`

## Initial v1 commands

### Tasks

- `task.capture.v1`
- `task.upsert.v1`
- `task.update.v1`
- `task.delete.v1`
- `task.sync-projection.v1`

Task commands use the first-class task/capture services. The domain layer does not read or write `.pisi/tasks.json` itself.

### Maps / relationships

- `map.relationship.upsert.v1`
- `map.relationship.delete.v1`
- `map.relationship.reparent.v1`
- `map.layout.save.v1`
- `map.camera.save.v1`
- `map.operational.mutate.v1`
- `map.reference.detach.v1`
- `map.node.create.v1`

Semantic relationship commands go through `main.mapSemanticOperationHooks`; they do not write `.pisi/relationships.json` directly. Operational state remains map-local view state. Camera persistence and operational mutation are separate domain intentions even though the compatibility transport can carry both in one legacy call.

## Renderer client

`renderer/domain/pisi-domain-client.mjs` exposes `query(name, payload)` and `command(name, payload)` under `Pisi.modules['domain.client']`.

New feature code should prefer semantic calls such as:

```js
await domain.command('task.capture.v1', {
    projectFolder,
    task
});
```

rather than selecting a storage-shaped preload method itself.

The first migrated UI flow is Quick Add. Existing task/map callers continue to work because the main-process compatibility IPC handlers now delegate to the same domain dispatcher.

## Source-of-truth boundaries

This layer does not introduce another data store.

- first-class task authority remains `.pisi/tasks.json` behind `main.taskStore`;
- semantic relationship authority remains `.pisi/relationships.json` behind semantic relationship services;
- map membership/layout/camera/operational scope remain map state;
- queries return projections and do not become parallel persisted copies.

## Next architecture step

Mutation transaction/recovery can now sit beneath a small set of domain commands rather than being duplicated across UI handlers. That is the main reason this boundary is established before broader recovery/integrity work.
