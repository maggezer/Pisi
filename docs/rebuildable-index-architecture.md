# Pisi Rebuildable Index Architecture

## Purpose

Search indexes are disposable projections. They improve query speed but never own user data and never participate in recovery of canonical data.

The current path is:

1. canonical project authorities and node/map documents;
2. search source collector (`pisi-search-index.mjs`);
3. enhanced search projection;
4. rebuildable projection-index contract;
5. active index driver (`memory-trigram-v1`);
6. query/navigation UI.

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

Canonical task-store updates now use the delta gateway:

1. project document/map projection stays unchanged;
2. existing canonical task records are removed from the disposable index;
3. current canonical task records are upserted;
4. the driver atomically publishes the next snapshot from the caller's point of view.

Broad filesystem/node/map invalidation still requires a source rebuild. This is safer than attempting to infer semantic changes from filesystem events. Later work may add document-scoped source deltas behind the same contract.

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

1. document-scoped source upsert/remove events instead of broad rebuilds;
2. coalesced background indexing and project-open warmup;
3. persisted disposable manifest/cache if startup profiling justifies it;
4. SQLite FTS driver if 10k+ representative projects show the in-memory accelerator cannot meet release latency targets.

Performance work must be driven by profiling. The current search correctness/ranking semantics remain unchanged.
