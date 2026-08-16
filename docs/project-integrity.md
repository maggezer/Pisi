# Project Integrity

Project Integrity is Pisi's project-wide consistency audit and bounded repair surface. It lives in **Settings** and treats the canonical stores and recovery layers as first-class project state rather than auditing only `.node` and `.map` JSON files.

## Authorities

Project Integrity follows the same ownership boundaries as the runtime:

- canonical tasks: `.pisi/tasks.json`
- canonical semantic relationships: `.pisi/relationships.json`
- map membership, references, layout, camera, relationship presentation, operational scopes/layouts: `.map` documents
- reversible deleted state: `.pisi/trash/items`
- crash recovery journals: `.pisi/mutations`

Derived caches and projections are never promoted to authority.

## Audit domains

The audit covers:

1. **Documents and identities** — invalid JSON, missing/unsafe metadata, duplicate node/map IDs, type mismatches, missing sidecars, incomplete legacy metadata migration.
2. **Tasks** — invalid/duplicate task IDs, unsupported status/priority, missing source node/map paths, self/missing/duplicate dependencies.
3. **Semantic relationships** — invalid/duplicate relationship IDs, missing endpoints, duplicate semantic keys, second parents, hierarchy cycles.
4. **Map state** — broken/duplicate references, orphan/duplicate layout records, orphan relationship views, views whose endpoints are outside map membership, legacy `map.edges`, stale operational state.
5. **Node consistency** — invalid property payloads, parent-map mismatches and stale `connectionTypes` derived cache.
6. **Attachments** — missing local `src` / `href` targets referenced from node content.
7. **Trash** — invalid manifests, duplicate restore destinations, invalid identities, missing or escaping payload paths.
8. **Atomic recovery** — invalid journals, unfinished mutations, committed cleanup residue and rollback failures.

## Severity

- `critical`: data identity or recovery ambiguity that can make state unsafe.
- `error`: authoritative references or invariants are broken.
- `warning`: project remains usable but state is stale, orphaned, incomplete or needs review.
- `info`: migration/cleanup information that does not make the project unhealthy.

A project is `healthy` when it has no `critical` or `error` findings. `clean` additionally requires zero warnings/info findings.

## Repair safety

Every repairable issue is classified before any mutation occurs:

### Safe

Safe repairs are deterministic and cannot choose between competing user meanings. Examples include recreating a missing managed sidecar for a document with a valid stable ID, normalizing map-local operational state, completing unambiguous metadata normalization, and retrying atomic recovery/cleanup.

The Settings UI shows the exact safe repair descriptions before the user confirms. Selected safe repairs run through `integrity.repair.v1`, which joins the existing per-project atomic mutation queue. If one repair fails, the transaction fails and the atomic layer restores the pre-command state.

### Review

Review repairs have a plausible mechanical fix but can change user-visible meaning. Examples include removing a dangling task dependency, deduplicating a map layout/reference, normalizing property payloads, or deciding whether an orphan presentation record should be removed. Project Integrity reports these but does not include them in **Apply safe repairs**.

### Manual

Manual issues contain identity or semantic ambiguity and must never be auto-fixed. Duplicate node/map/task/relationship IDs, task source identity loss, missing semantic endpoints, second parents, hierarchy cycles, invalid authority stores, and damaged Trash/recovery payloads fall in this class.

## Rebuild derived state

**Rebuild derived state** is separate from issue-level safe repair because graph-wide caches must be computed with the whole canonical graph, not a partial node view. It currently rebuilds:

- node `connectionTypes` from canonical `.pisi/relationships.json`;
- normalized map `relationshipViews` presentation state;
- normalized map-local operational state.

The rebuild explicitly does **not** write `.pisi/tasks.json` or `.pisi/relationships.json`. The result reports `authorityChanged: false` and names the preserved authority files.

## Transport and domain boundary

The existing renderer `auditIntegrity` preload bridge remains the only exposed integrity transport. Plain string input is the backward-compatible audit form. Explicit envelopes select `audit`, `repair`, or `rebuild-derived`; the main process maps those to versioned domain contracts:

- `integrity.audit.v1` — query, read-only
- `integrity.repair.v1` — atomic command
- `integrity.rebuild-derived.v1` — atomic command

Unknown actions fall back to audit rather than dynamically dispatching arbitrary commands.

## Fail-closed rules

Project Integrity does not:

- generate a replacement stable ID for a duplicate or missing identity and pretend references stayed correct;
- reconstruct task authority from diary/Todo/search projections;
- reconstruct semantic authority from map presentation state;
- silently choose which of two hierarchy parents is correct;
- automatically convert a hierarchy relationship to stream;
- delete damaged Trash or atomic recovery records merely to make the audit green;
- treat permanent deletion as a repair strategy.

The audit is intended to expose uncertainty instead of hiding it.