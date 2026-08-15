# Atomic Mutation System

Pisi treats persistent project changes as recoverable mutation boundaries.

## Release rule

For a mutation that is interrupted at any point, reopening the project must produce one of only two valid states:

1. the complete state before the mutation; or
2. the complete committed state after the mutation.

A partial 50/50 project state is not accepted.

## Durable journal

Transactions live under:

`.pisi/mutations/mut_<id>/`

Each transaction contains a durable `manifest.json` plus pre-change snapshots. Before an authoritative project path is modified, its previous state is captured and the manifest is fsynced. The commit marker is also persisted before the command reports success.

The phases are:

- `prepared`
- `running`
- `rolling-back`
- `rolled-back`
- `rollback-failed`
- `committed`

Any restart-visible transaction that is not durably `committed` is rolled back to its pre-mutation snapshots. A transaction already marked `committed` keeps the new state. Journal cleanup after that marker is best effort; cleanup failure never changes a committed mutation back into a rollback candidate.

## Filesystem coverage

The runtime adapter captures project changes made through synchronous filesystem primitives used by Pisi:

- rename/move
- file writes
- directory creation
- unlink/remove

Atomic journal paths and generated temporary `.tmp` sources are excluded from recursive capture. New paths are recorded as previously missing so rollback removes them. Existing files or directories are snapshotted recursively. Symlink snapshots and project-boundary escapes are rejected.

## Domain integration

Every persistent v1 domain mutation joins the project atomic queue, including:

- task capture/upsert/update/delete/index projection sync;
- semantic relationship upsert/delete/reparent;
- map layout, operational state, camera, reference detach and node creation;
- project item rename/move/delete and path delete;
- `project.batch.v1`.

This means a nominally single-file mutation cannot interleave with a destructive or bulk transaction and invalidate its rollback snapshot. Nested commands inherit the current transaction.

## Rename and move integrity

Rename and move still update canonical task source paths. If that reference rewrite fails, the domain command now returns failure. The enclosing atomic transaction restores the file/sidecar movement and every captured metadata write instead of committing a renamed item with stale task references.

## Bulk mutation

`project.batch.v1` accepts 1–100 allowed mutation commands. All steps share one transaction. If any step fails, every earlier step in that batch rolls back.

## Concurrency

Transaction context uses Node `AsyncLocalStorage` rather than one process-global mutable transaction variable. Nested operations in the same async command chain share a transaction.

Top-level mutations are serialized **per project**. If a persistent command is already running for a project, a second top-level mutation for that same project is queued until the first command has committed or rolled back. This prevents two valid but overlapping journals from concurrently writing the same authoritative files. Different project contexts remain isolated.

## Recovery gate

Before project content is surfaced through the domain query/listing path, Pisi checks for unfinished journals. Successful recovery is cached for that project session. A recovery failure is fail-closed and leaves the journal in place for later inspection rather than guessing or deleting evidence.

## Fault-injection acceptance tests

The deterministic regression suite cuts mutations at several points:

- after the first write of a multi-file operation;
- in the middle of a multi-file operation;
- after a rename but before commit;
- after creation of new paths;
- after the durable committed marker but before journal cleanup.

The expected result is always complete old state before commit, or complete new state after commit.