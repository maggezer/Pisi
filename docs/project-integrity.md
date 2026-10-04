# Project Integrity

Project Integrity is Pisi's project-wide consistency audit and bounded repair surface. It lives in **Settings** and evaluates canonical authorities, document/map state and recovery layers together.

## Authorities

Project Integrity follows the same ownership boundaries as the runtime:

- tasks: `.pisi/tasks.json`
- semantic relationships: `.pisi/relationships.json`
- property definitions: `.pisi/properties.json`
- node content/property values: `.node`
- map membership, references, layout, camera, relationship presentation and operational state: `.map`
- reversible deleted state: `.pisi/trash/items`
- crash recovery journals: `.pisi/mutations`

Derived caches and projections are never promoted to authority.

## Audit domains

The audit covers:

1. **Documents and identities** — invalid JSON, missing/unsafe metadata, duplicate node/map IDs, type mismatches and missing managed sidecars.
2. **Tasks** — invalid/duplicate task IDs, unsupported status/priority, missing source node/map paths and invalid dependencies.
3. **Semantic relationships** — invalid/duplicate relationship IDs, missing endpoints, duplicate semantic keys, second parents and hierarchy cycles.
4. **Map state** — broken/duplicate references, orphan/duplicate layout records, malformed/orphan relationship views, endpoints outside map membership and stale operational state.
5. **Property schema and node values** — missing/unreadable schema authority, invalid/duplicate definitions, orphan property IDs, name/type drift, unsupported types and invalid values.
6. **Attachments** — missing local `src` / `href` targets referenced from node content.
7. **Trash** — invalid manifests, duplicate restore destinations, invalid identities and missing/escaping payload paths.
8. **Atomic recovery** — invalid journals, unfinished mutations, committed cleanup residue and rollback failures.

Unsupported current-contract data is reported as an integrity problem. The audit does not convert it into canonical state.

## Severity

- `critical`: data identity or recovery ambiguity that can make state unsafe.
- `error`: authoritative references or invariants are broken.
- `warning`: the project remains usable but state is stale, orphaned, incomplete or needs review.
- `info`: non-blocking cleanup or diagnostic information.

A project is `healthy` when it has no `critical` or `error` findings. `clean` additionally requires zero warnings/info findings.

## Repair safety

Every repairable issue is classified before any mutation occurs.

### Safe

Safe repairs are deterministic and cannot choose between competing user meanings. Current examples include normalizing valid document metadata, recreating a missing managed sidecar and normalizing map-local operational state.

The Settings UI shows the exact safe repair descriptions before confirmation. Selected safe repairs run through `integrity.repair.v1` inside the existing per-project atomic mutation queue.

Atomic recovery is deliberately not run from inside this repair transaction. Residual mutation journals are reported for review; actual recovery remains in the startup/domain recovery gate.

### Review

Review repairs have a plausible mechanical fix but can change user-visible meaning. Examples include dangling task dependencies, duplicate map layout/reference records, property schema/value drift and orphan presentation records.

They are reported but are not included in **Apply safe repairs**.

### Manual

Manual issues contain identity or semantic ambiguity and must never be auto-fixed. Examples include duplicate identities, missing semantic endpoints, second parents, hierarchy cycles, damaged authority stores, damaged Trash payloads and invalid recovery journals.

## Rebuild derived state

**Rebuild derived state** is separate from issue-level safe repair. It currently normalizes only map-owned derived/presentation state:

- `relationshipViews`
- map-local operational state

It does not reconstruct tasks, semantic relationships or property definitions from projections. The result keeps canonical authority files unchanged.

## Transport and domain boundary

Project Integrity registers versioned contracts with the main domain dispatcher:

- `integrity.audit.v1` — query, read-only
- `integrity.repair.v1` — atomic command
- `integrity.rebuild-derived.v1` — atomic command

The Settings UI reaches these contracts through the narrow `window.pisiProject.auditIntegrity` preload surface and the `project:audit-integrity` IPC adapter. The adapter only normalizes the request shape and dispatches one of the three explicit contracts; it does not contain a separate repair/storage implementation.

Unknown actions resolve to the audit action rather than dynamically dispatching arbitrary commands.

## Fail-closed rules

Project Integrity does not:

- generate replacement stable IDs for ambiguous identities and pretend references stayed correct;
- reconstruct task authority from diary/Todo/search projections;
- reconstruct semantic authority from map presentation state;
- reconstruct property schema authority from node values;
- silently choose which of two hierarchy parents is correct;
- automatically reinterpret a hierarchy relationship as another semantic type;
- delete damaged Trash or atomic recovery records merely to make the audit green;
- run atomic recovery from inside its own atomic repair transaction;
- treat permanent deletion as a repair strategy.

The audit exposes uncertainty instead of hiding it.
