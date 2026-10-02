# Pisi Rebuildable Index Architecture

## Purpose

Search indexes are disposable projections. They improve query speed but never own user data and never participate in recovery of canonical data.

The current path is:

1. canonical project authorities and node/map documents;
2. search source collector (`pisi-search-index.mjs`);
3. document/map filesystem delta classifier;
4. enhanced search projection;
5. rebuildable projection-index contract;
6. active index driver (`memory-trigram-v1`);
7. query/navigation UI.

The source collector can continue to evolve independently from the physical index backend.

## Authority rule

The index is **not** an authority.

Canonical ownership remains:

- `.pisi/tasks.json` — tasks;
- `.pisi/relationships.json` — semantic relationships;
- `.pisi/properties.json` — property definitions;
- `.node` — node content and property values;
- `.map` — map membership, layout, presentation and operational state.

No canonical store may be reconstructed from a search index. If an index is missing, corrupt, stale or incompatible, Pisi discards/rebuilds the projection from the authorities above.

## Contract

`renderer/search/pisi-projection-index-core.mjs` defines versioned lifecycle semantics:

- `empty` — no usable projection;
- `stale` — known source change, rebuild required before unsafe deltas;
- `building` — replacement is being constructed;
- `ready` — queryable projection;
- `failed` — build/delta failed; caller must rebuild rather than trust partial state.

The contract exposes:

- `replaceAll(records, metadata)`;
- `applyDelta({ upsert, remove }, metadata)`;
- `invalidate(reason)`;
- `clear(reason)`;
- `snapshot()`;
- `isCompatible(manifest)`.

Every snapshot carries a small projection manifest with contract version, schema version, driver id, generation, state, deterministic source fingerprint, build timestamp and record count.

## Source fingerprint

Fingerprints are deterministic with respect to the source markers supplied by the projection producer; enumeration order does not matter.

The enhanced search projection includes stable record/task identity plus source update/state markers. The fingerprint is not an authority hash and is not used to repair canonical files. Its job is to detect whether a disposable projection describes the same source generation.

## Driver boundary

`renderer/search/pisi-search-index-adapter.mjs` owns the search-specific driver adapter.

The active driver is `memory-trigram-v1`. It preserves the existing `{ records, accelerator }` consumer shape, so query, Global Search, Search panel and navigation do not depend on a physical backend.

The current memory driver may rebuild its trigram accelerator internally after a delta. That is intentional: the contract is being stabilized before adding backend complexity. Consumers already use the incremental `upsert/remove` gateway, so a future backend can make those operations physically incremental without changing UI/query code.

## Incremental path

Canonical task-store updates use the projection delta gateway. Node and map filesystem changes now also avoid a full source scan when the watcher gives a bounded, unambiguous set of `.node` / `.map` paths.

`renderer/search/pisi-search-filesystem-delta-core.mjs` classifies watcher batches:

- `.node` and `.map` paths are eligible for scoped processing;
- unrelated extensions are ignored by search;
- extensionless/directory-like paths are ambiguous and force a rebuild;
- batches above 24 search-source paths force a rebuild rather than attempting an oversized pseudo-incremental update.

For a node change, Pisi reads only that node. If the direct read fails, the parent folder is listed before treating the path as deleted. A path that still exists but cannot be read is ambiguous and falls back to a full rebuild.

For a map change, Pisi reads only that map and updates the affected membership projections. Map deletion is likewise accepted only after parent-folder verification. Stable node identity is used during rename/move cases so a node can retain its map membership while its path changes.

The scoped source update publishes `pisi:search-index-delta-applied` and a new ready snapshot. The current in-memory trigram accelerator is still rebuilt once for that updated record set; importantly, Pisi no longer recursively scans the whole project and reparses unrelated documents for ordinary bounded node/map watcher events.

## Fail-closed rebuild cases

A full source rebuild remains the correct fallback when:

- the base index is not ready;
- a full build is already in progress;
- a watcher path is directory-like or otherwise ambiguous;
- a scoped batch is too large;
- the parent folder cannot verify a suspected deletion;
- an existing node/map cannot be read consistently;
- the active project or base generation changes while a delta is being prepared.

The delta is disposable. Failure never changes canonical data and never attempts to repair an authority from projection state.

## Live editor overlay

Unsaved editor content is a transient projection. It uses a disposable search snapshot and does not replace canonical authorities. A transient live snapshot can be discarded at any time.

## Future SQLite / FTS backend

SQLite/FTS is deliberately **not** introduced by this change.

A future persistent driver may be added only if all of these rules hold:

- it implements the same replace/delta/snapshot lifecycle;
- its files are disposable cache/projection state;
- schema or contract mismatch causes discard + rebuild;
- corruption causes discard + rebuild, not Project Integrity repair of canonical stores;
- task/relationship/property/node/map authorities remain unchanged;
- search query/navigation code does not directly import SQLite/FTS details;
- migration of canonical user data never depends on the index.

If a future cache is stored under the project, it should live in an explicitly disposable cache namespace and remain excluded from semantic authority, Trash and canonical migrations.

## Next incremental steps

The architecture now permits these optimizations without changing consumers:

1. avoid reparsing unchanged documents inside large map-only membership/layout deltas;
2. coalesce/warm indexing around project open and idle periods;
3. move the base search source projection itself behind the same physical driver contract if profiling justifies it;
4. add a persisted disposable manifest/cache only if startup profiling justifies it;
5. add a SQLite FTS driver only if representative 10k+ projects show the memory driver cannot meet release latency targets.

Performance work must be driven by profiling. The current search correctness/ranking semantics remain unchanged.
