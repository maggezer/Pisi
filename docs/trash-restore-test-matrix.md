# Trash Restore Safety Test Matrix

This matrix defines the acceptance contract for Pisi Trash restore. It is intentionally stricter than “the file came back”: a restore is safe only when the payload, canonical tasks, semantic relationships, map presentation references, and unrelated live project state all end in a coherent state.

## Canonical-only restore rule

Trash restore only reintroduces current-contract payload, canonical tasks,
canonical semantic relationships and map presentation references. Obsolete
semantic edge payloads are not a restore authority and are never written back to
`.map` documents.

## Decision rules

1. **Fail closed on identity ambiguity.** A restore must never overwrite an occupied path or silently reuse a live node, map, task, or relationship identity.
2. **Delta merge, never project rollback.** Changes made after deletion must remain intact unless they are exactly the archived references required by the restored item.
3. **Never auto-reinterpret semantics.** Restore must not silently turn hierarchy into stream, choose a new parent, or remap a relationship without an explicit deterministic rule.
4. **Atomic or unchanged.** Any failure after restore begins must leave the live project and Trash item exactly as they were immediately before the restore command.
5. **Warnings are allowed only for presentation-only state that no longer has a live owner.** Canonical task or semantic integrity problems are conflicts, not warnings.
6. **Permanent deletion is never an implicit conflict-resolution strategy.** A failed restore leaves the Trash item reviewable.

## Result vocabulary

| Result         | Meaning                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SUCCESS`      | Restore completes and the Trash item is removed.                                                                                                 |
| `SUCCESS+WARN` | Canonical restore succeeds, but non-authoritative presentation state cannot be fully reattached; warnings are returned and surfaced to the user. |
| `CONFLICT`     | Preflight rejects restore with `TRASH_RESTORE_CONFLICT`; no live or Trash state changes.                                                         |
| `INVALID`      | Manifest/payload/security validation rejects the item before semantic restore.                                                                   |
| `ROLLBACK`     | A runtime/write/crash failure occurs after mutation begins; atomic recovery returns both project and Trash to the pre-command state.             |

## Coverage vocabulary

| Coverage              | Meaning                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Existing-direct`     | Current tests execute the relevant pure behavior.                                                                    |
| `Existing-structural` | Current tests assert that the implementation contains/routs the rule, but do not execute a full restore fixture.     |
| `Needed-integration`  | Add a real temporary-project fixture and execute preflight/restore.                                                  |
| `Needed-crash`        | Add failure injection / crash-recovery coverage.                                                                     |
| `Needed-UI`           | Add DOM/UI behavior coverage.                                                                                        |
| `Decision-gap`        | Desired safety rule is not yet fully enforced by the current implementation; test should be added with the code fix. |

---

# A. Baseline safe restore

| ID      | Pri | Scenario / setup                                                                                                  | Expected                                                                                                | Must remain unchanged                                                                                                 | Coverage                                 |
| ------- | --: | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| BASE-01 |  P0 | Delete one `.node` with sidecar, no task or relationship refs; old path remains free.                             | `SUCCESS`; node + sidecar return to exact original relative paths; Trash item removed.                  | Other files, tasks, relationships, map states.                                                                        | Needed-integration                       |
| BASE-02 |  P0 | Delete one `.map` containing nodes; no post-delete conflicts.                                                     | `SUCCESS`; map payload and nested sidecar content return with original Pisi IDs.                        | Other maps and global stores unrelated to restored IDs.                                                               | Needed-integration                       |
| BASE-03 |  P0 | Delete folder subtree containing multiple maps/nodes/tasks/relationships.                                         | `SUCCESS`; entire payload returns and archived canonical refs rejoin stores.                            | Unrelated files and records created after delete.                                                                     | Needed-integration                       |
| BASE-04 |  P0 | After delete, edit an unrelated live node and add unrelated tasks/relationships; then restore.                    | `SUCCESS`; post-delete edits survive byte/record equivalent.                                            | All unrelated post-delete changes.                                                                                    | Existing-structural + Needed-integration |
| BASE-05 |  P0 | Live task `A` depended on deleted task `B`; after delete add dependency `C` to `A`; restore `B`.                  | `SUCCESS`; `A.dependencies` contains both current `C` and restored `B`, with no duplicate.              | Other current dependencies/order semantics.                                                                           | Existing-direct + Needed-integration     |
| BASE-06 |  P1 | Deleted node had presentation references in another map; that map still exists and has new unrelated nodes/views. | `SUCCESS`; archived node/view refs merge without replacing current map data.                            | New nodes/views/camera/operational state in target map.                                                               | Existing-structural + Needed-integration |
| BASE-07 |  P1 | External map that once referenced deleted node has itself been deleted after the Trash item was created.          | `SUCCESS+WARN`; canonical node/task/relationship restore succeeds; missing map presentation is skipped. | No map recreated implicitly.                                                                                          | Needed-integration                       |
| BASE-08 |  P1 | External map already contains the same node reference when restore runs.                                          | `SUCCESS`; reference is not duplicated.                                                                 | Existing live node layout/customization for that reference should be preserved unless explicit policy says otherwise. | Needed-integration                       |
| BASE-09 |  P1 | External map already contains the same `relationshipView`.                                                        | `SUCCESS`; no duplicate relationship view.                                                              | Existing unrelated relationship views.                                                                                | Needed-integration                       |
| BASE-10 |  P1 | Restored item has no archived tasks/relationships/map refs.                                                       | `SUCCESS`; stores are not rewritten unnecessarily beyond transaction bookkeeping.                       | Canonical stores semantically identical.                                                                              | Needed-integration                       |
| BASE-11 |  P1 | Restore a regular file/folder supported by `project.path.delete.v1` with no Pisi identities.                      | `SUCCESS`; payload returns to original path.                                                            | Task/relationship stores unchanged.                                                                                   | Needed-integration                       |
| BASE-12 |  P2 | Unicode names, spaces, Turkish characters, emoji in nested paths.                                                 | `SUCCESS`; names round-trip exactly.                                                                    | All identities and refs.                                                                                              | Needed-integration                       |

---

# B. Filesystem/path conflicts

| ID      | Pri | Scenario / setup                                                                                                                 | Expected                                                                                     | Critical assertion                                                             | Coverage                                               |
| ------- | --: | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| PATH-01 |  P0 | Original primary path is occupied by a new file/folder.                                                                          | `CONFLICT` with `path-exists`.                                                               | Never overwrite, rename, merge, or auto-suffix the live occupant.              | Existing-structural + Needed-integration               |
| PATH-02 |  P0 | Primary `.node` path is free but its archived managed sidecar destination is occupied.                                           | `CONFLICT` with `path-exists` for sidecar entry.                                             | Primary node must not be moved out of Trash.                                   | Needed-integration                                     |
| PATH-03 |  P0 | Primary `.map` path is free but map sidecar destination is occupied.                                                             | `CONFLICT`.                                                                                  | No partial payload restore.                                                    | Needed-integration                                     |
| PATH-04 |  P0 | Directly deleted node’s recorded `parentMapPath` no longer exists.                                                               | `CONFLICT` with `parent-missing`.                                                            | Do not restore an orphan into filesystem while semantic/map parent is missing. | Existing-structural + Needed-integration               |
| PATH-05 |  P1 | Ordinary file/folder’s old parent directory was removed after delete, but there is no semantic parent requirement.               | `SUCCESS`; missing filesystem ancestors may be recreated.                                    | Must remain inside project root.                                               | Needed-integration                                     |
| PATH-06 |  P1 | Several restore entries are free at preflight; one destination becomes occupied before mutation because of a concurrent command. | Commands serialize; second command sees current state and returns `CONFLICT`, not overwrite. | Project queue ordering deterministic.                                          | Needed-integration                                     |
| PATH-07 |  P0 | Windows: old path differs from a live occupant only by case.                                                                     | `CONFLICT`.                                                                                  | Case-insensitive filesystem semantics honored.                                 | Needed-integration-platform                            |
| PATH-08 |  P1 | Linux/macOS case-sensitive volume: case-only distinct path is legal.                                                             | Follow actual filesystem semantics; no artificial Windows collision rule.                    | Cross-platform expectation explicit.                                           | Needed-integration-platform                            |
| PATH-09 |  P0 | Manifest `originalPath` contains `../`, absolute escape, or NUL-like invalid content.                                            | `INVALID`; restore does not begin.                                                           | No write outside project.                                                      | Existing-direct for normalization + Needed-integration |
| PATH-10 |  P0 | Manifest `payloadPath` escapes `payload/` or item directory.                                                                     | `INVALID`.                                                                                   | No arbitrary filesystem read/move.                                             | Existing-structural + Needed-integration               |
| PATH-11 |  P0 | A project-relative restore destination traverses a symlink/junction created **after deletion** and points outside project.       | **Required: `INVALID/CONFLICT` fail closed before rename.**                                  | No payload may cross the real project boundary.                                | **Decision-gap: add realpath/symlink guard**           |
| PATH-12 |  P1 | Restore path uses mixed slash/backslash separators.                                                                              | Normalize deterministically and remain project-relative.                                     | Same destination identity across platform representation.                      | Existing-direct                                        |
| PATH-13 |  P2 | Very long nested path near platform limits.                                                                                      | Either `SUCCESS` or clean platform error followed by `ROLLBACK`; never partial.              | Trash remains intact on error.                                                 | Needed-integration-platform                            |
| PATH-14 |  P0 | Manifest has two entries targeting the same `originalPath`.                                                                      | **Required: `INVALID` during manifest/preflight validation.**                                | Do not rely on second rename failure for correctness.                          | **Decision-gap: add duplicate-entry validation**       |

---

# C. Node / map identity conflicts

| ID    | Pri | Scenario / setup                                                                                               | Expected                                                                                          | Critical assertion                                                   | Coverage                                                         |
| ----- | --: | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ID-01 |  P0 | Restored node ID is already used by any live `.node` elsewhere in project.                                     | `CONFLICT` with `node-id`.                                                                        | Path freedom does not make identity reuse safe.                      | Existing-structural + Needed-integration                         |
| ID-02 |  P0 | Restored map ID is already used by any live `.map`.                                                            | `CONFLICT` with `map-id`.                                                                         | No map identity aliasing.                                            | Existing-structural + Needed-integration                         |
| ID-03 |  P0 | Old path is occupied **and** node ID is reused elsewhere.                                                      | `CONFLICT` reporting all detected preflight conflicts where practical.                            | No mutation occurs despite multiple conflicts.                       | Needed-integration                                               |
| ID-04 |  P1 | Same ID exists only inside another Trash item, not live project.                                               | Restore may proceed; after first restore, restoring the other item must conflict.                 | Trash items do not reserve live identities until restored.           | Needed-integration                                               |
| ID-05 |  P0 | Two nodes inside the **same Trash payload** have the same node ID because source project was corrupt.          | **Required: `INVALID/CONFLICT` before restore.**                                                  | Restore must not introduce duplicate live identity.                  | **Decision-gap: validate duplicate IDs inside manifest/payload** |
| ID-06 |  P0 | Two maps inside same Trash payload share map ID.                                                               | **Required: `INVALID/CONFLICT`.**                                                                 | Same as above.                                                       | **Decision-gap**                                                 |
| ID-07 |  P0 | Manifest says `nodeIds=[X]`, but restored payload metadata contains node ID `Y`.                               | **Required: `INVALID`.**                                                                          | Manifest cannot lie about identity set used by preflight.            | **Decision-gap: manifest↔payload verification**                  |
| ID-08 |  P0 | Manifest omits `nodeIds`/`mapIds` while payload contains Pisi documents.                                       | **Required: `INVALID` or recompute identities from payload before preflight.**                    | Cannot bypass identity collision checks through manifest corruption. | **Decision-gap**                                                 |
| ID-09 |  P1 | Live semantic store contains dangling references to restored node ID, but no live file currently owns that ID. | Restore decision must be deterministic: validate those relations before considering ID available. | No accidental attachment to stale semantic state.                    | Needed-integration + policy review                               |
| ID-10 |  P1 | Restore succeeds, then same Trash command is invoked again (double-click/retry).                               | Second invocation returns not-found/invalid cleanly; no duplicate IDs or refs.                    | First restored state remains intact.                                 | Needed-integration                                               |

---

# D. Task identity and dependency conflicts

| ID      | Pri | Scenario / setup                                                                                                            | Expected                                                                                                           | Critical assertion                                                            | Coverage                                                                       |
| ------- | --: | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| TASK-01 |  P0 | Archived task ID already exists in canonical live task store.                                                               | `CONFLICT` with `task-id`, regardless of text/status/source similarity.                                            | Never overwrite live task by ID.                                              | Existing-structural + Needed-integration                                       |
| TASK-02 |  P1 | Same task text/source exists live under a **different** task ID.                                                            | `SUCCESS`; both identities may exist unless another canonical invariant forbids it.                                | Collision logic is identity-based, not text-based.                            | Needed-integration                                                             |
| TASK-03 |  P0 | Multiple archived tasks; only one task ID conflicts.                                                                        | Entire restore `CONFLICT`.                                                                                         | No subset of tasks/payload restored.                                          | Needed-integration                                                             |
| TASK-04 |  P0 | Live task depends on deleted task; live task gains additional dependency after delete.                                      | `SUCCESS`; restored dependency is unioned without losing later dependency.                                         | Delta merge, no snapshot overwrite.                                           | Existing-direct + Needed-integration                                           |
| TASK-05 |  P1 | Live task that formerly depended on deleted task was itself deleted after Trash creation.                                   | `SUCCESS`; missing live dependency owner is skipped.                                                               | Do not recreate unrelated task `A` merely to restore its old dependency edge. | Needed-integration                                                             |
| TASK-06 |  P1 | Archived task depends on another archived task in same Trash item.                                                          | `SUCCESS`; both tasks return and dependency remains valid.                                                         | Dependency IDs stable.                                                        | Needed-integration                                                             |
| TASK-07 |  P1 | Archived task depends on a live task that still exists.                                                                     | `SUCCESS`; dependency remains.                                                                                     | Live task is not modified.                                                    | Needed-integration                                                             |
| TASK-08 |  P0 | Archived task depends on a task that was permanently deleted after Trash item was created and is neither live nor restored. | **Recommended: restore task but drop missing dependency and return warning, preserving current deletion.**         | Must not create dangling dependency or resurrect unrelated deleted task.      | **Decision-gap: current restored task payload may retain dangling dependency** |
| TASK-09 |  P0 | Archived task contains self-dependency or dependency cycle due to corrupt legacy data.                                      | Follow canonical task integrity rule: reject or sanitize deterministically before store write.                     | Restore must not introduce a new invalid dependency graph.                    | Decision-gap / integrity integration                                           |
| TASK-10 |  P1 | Existing live dependency list already contains restored task ID.                                                            | `SUCCESS`; no duplicate dependency entry.                                                                          | Set semantics preserved.                                                      | Existing-direct + Needed-integration                                           |
| TASK-11 |  P1 | Active task with colliding ID is completed/archived status rather than open.                                                | `CONFLICT`.                                                                                                        | Status never weakens identity collision.                                      | Needed-integration                                                             |
| TASK-12 |  P1 | Archived task source path points to the restored node; node payload returns to original path.                               | `SUCCESS`; source path remains exact and resolvable.                                                               | TaskId/blockId stable.                                                        | Needed-integration                                                             |
| TASK-13 |  P0 | Archived task source path in manifest no longer corresponds to any restored/live node due to corrupt Trash metadata.        | **Required: `INVALID/CONFLICT` or explicit stale-source quarantine; never silently claim exact navigation works.** | Canonical task source integrity.                                              | Decision-gap                                                                   |

---

# E. Semantic relationship conflicts

Current relationship rules treat hierarchy specially: a second parent requires confirmation and a cycle is rejected. Restore must call those rules without auto-confirming or semantic reinterpretation.

| ID     | Pri | Scenario / setup                                                                                                                                   | Expected                                                                                                                                                    | Critical assertion                                                                                   | Coverage                                                                                |
| ------ | --: | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| REL-01 |  P0 | Exact archived relationship ID is already live.                                                                                                    | `CONFLICT` with `relationship-id`.                                                                                                                          | Do not overwrite label/properties/type of live relation.                                             | Existing-structural + Needed-integration                                                |
| REL-02 |  P0 | Archived relationship endpoint node is neither live nor part of restored node set.                                                                 | `CONFLICT` with `relationship-endpoint-missing`.                                                                                                            | No dangling semantic relationship.                                                                   | Existing-structural + Needed-integration                                                |
| REL-03 |  P0 | Both relationship endpoints are restored in same Trash item.                                                                                       | `SUCCESS`.                                                                                                                                                  | Relationship added only after both identities pass preflight.                                        | Needed-integration                                                                      |
| REL-04 |  P0 | One endpoint is restored; the other is still live.                                                                                                 | `SUCCESS`.                                                                                                                                                  | Exact original semantic relation restored.                                                           | Needed-integration                                                                      |
| REL-05 |  P0 | Child acquired a different live hierarchy parent after deletion; archived parent relation is restored.                                             | `CONFLICT` with `SECOND_PARENT_CONFIRM_REQUIRED`.                                                                                                           | Restore must **not** auto-convert archived hierarchy to stream.                                      | Existing logic + Needed-integration                                                     |
| REL-06 |  P0 | Current hierarchy changes mean archived relation would now create a cycle.                                                                         | `CONFLICT` with `HIERARCHY_CYCLE`.                                                                                                                          | No migration-style automatic conversion during restore.                                              | Existing logic + Needed-integration                                                     |
| REL-07 |  P1 | Archived relation is stream/non-hierarchy and both endpoints exist.                                                                                | `SUCCESS` even if one endpoint has hierarchy parent.                                                                                                        | Stream relation does not trigger hierarchy parent rule.                                              | Needed-integration                                                                      |
| REL-08 |  P0 | Same semantic relationship already exists live under a **different relationship ID**.                                                              | **Recommended: `CONFLICT` (or explicit “already satisfied” policy that preserves live record and remaps views). Never overwrite live relation implicitly.** | Current live label/properties must not be replaced by archived values.                               | **Decision-gap: current prepare may adopt live semantic ID and replace record content** |
| REL-09 |  P0 | Same semantic relationship exists live with same endpoints/type but changed label/properties after deletion.                                       | Same policy as REL-08; preserve current live edits or conflict.                                                                                             | Delta-merge principle.                                                                               | Decision-gap                                                                            |
| REL-10 |  P0 | Trash manifest contains duplicate relationship IDs.                                                                                                | `INVALID/CONFLICT` before mutation.                                                                                                                         | No ambiguous archived record/view ownership.                                                         | Needed-integration; current preflight likely conflicts on second record                 |
| REL-11 |  P0 | Trash manifest contains same semantic key twice under different IDs.                                                                               | **Required: `INVALID/CONFLICT` or deterministic dedupe with view-ID remap.**                                                                                | Never silently drop one presentation reference.                                                      | Decision-gap                                                                            |
| REL-12 |  P1 | Relationship ID is free, but a map already contains a stale `relationshipView` with that ID.                                                       | Restore canonical relationship only if semantics are safe; merge presentation without duplicate.                                                            | Presentation cannot create semantic authority.                                                       | Needed-integration                                                                      |
| REL-13 |  P1 | External map containing archived relationship view was deleted after Trash creation.                                                               | `SUCCESS+WARN`.                                                                                                                                             | Semantic relationship can restore if endpoints are valid; missing presentation map is not recreated. | Needed-integration                                                                      |
| REL-14 |  P1 | External map was edited after delete and its relationship view for restored relation was manually recreated with different geometry/customization. | Preserve current live presentation or explicitly conflict; do not overwrite post-delete customization.                                                      | Delta merge for map presentation.                                                                    | Policy test needed                                                                      |
| REL-16 |  P0 | Archived relationship references node ID that is present in manifest but payload identity verification fails.                                      | `INVALID` before semantic preflight.                                                                                                                        | Cannot use manifest-only fake endpoint availability.                                                 | Depends on ID-07 fix                                                                    |

---

# F. Combined conflict precedence and reporting

| ID       | Pri | Scenario / setup                                                         | Expected                                                                 | Critical assertion                                                                             | Coverage           |
| -------- | --: | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------ |
| COMBO-01 |  P0 | Path occupied + node ID reused + task ID reused.                         | One `TRASH_RESTORE_CONFLICT`; return all safely detectable conflicts.    | Preflight remains read-only.                                                                   | Needed-integration |
| COMBO-02 |  P0 | Node ID reused and archived relationship endpoint missing.               | `CONFLICT`; no attempt to “fix” one by applying another archived record. | No mutation.                                                                                   | Needed-integration |
| COMBO-03 |  P0 | Task ID conflict plus hierarchy second-parent conflict.                  | `CONFLICT`; both categories reported where possible.                     | UI can explain multiple reasons.                                                               | Needed-integration |
| COMBO-04 |  P1 | Multiple archived relationships: one valid, one invalid.                 | Entire restore `CONFLICT`.                                               | No partial semantic restore.                                                                   | Needed-integration |
| COMBO-05 |  P1 | External-map presentation warning plus otherwise safe canonical restore. | `SUCCESS+WARN`, not conflict.                                            | Warning cannot roll back valid canonical restore unless presentation is required for identity. | Needed-integration |

---

# G. Manifest, payload, and security integrity

| ID     | Pri | Scenario / setup                                                                 | Expected                                                                         | Critical assertion                                                               | Coverage                                 |
| ------ | --: | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| MAN-01 |  P0 | Invalid Trash ID format.                                                         | `INVALID`.                                                                       | No arbitrary directory lookup.                                                   | Existing-structural + Needed-integration |
| MAN-02 |  P0 | Trash item directory exists but manifest is missing/unreadable JSON.             | `INVALID`.                                                                       | Payload untouched.                                                               | Needed-integration                       |
| MAN-03 |  P0 | Manifest version unsupported.                                                    | `INVALID`.                                                                       | No best-guess migration during restore unless explicit migration is implemented. | Needed-integration                       |
| MAN-04 |  P0 | Manifest entry points to payload file that is missing before restore.            | `INVALID` preferred; current runtime failure must at minimum `ROLLBACK`.         | Trash item remains reviewable.                                                   | Needed-integration                       |
| MAN-05 |  P0 | Manifest `id` differs from Trash directory/requested ID.                         | `INVALID`.                                                                       | Cross-item confusion impossible.                                                 | Existing-structural + Needed-integration |
| MAN-06 |  P0 | `originalTarget` is outside project or malformed.                                | `INVALID`.                                                                       | Returned success path cannot point outside project.                              | Needed-integration                       |
| MAN-07 |  P0 | `originalTarget` is not covered by any manifest entry.                           | **Required: `INVALID`.**                                                         | Success response must correspond to an actually restored target.                 | Decision-gap                             |
| MAN-08 |  P0 | Manifest `references` has wrong types / malformed records.                       | Validate or safely normalize; no arbitrary write shape reaches canonical stores. | Store schemas remain canonical.                                                  | Needed-integration + policy review       |
| MAN-09 |  P0 | Payload metadata identity set disagrees with manifest identity set.              | `INVALID`.                                                                       | Collision checks cannot be bypassed.                                             | Decision-gap                             |
| MAN-10 |  P1 | Another valid Trash item exists beside restored item.                            | Restore only selected item.                                                      | Other Trash item byte-identical.                                                 | Needed-integration                       |
| MAN-11 |  P1 | Unknown extra manifest fields from future version while version still supported. | Ignore only if schema permits; core identity/path fields remain strict.          | Forward compatibility must not weaken safety fields.                             | Needed-integration                       |
| MAN-12 |  P0 | User tampers manifest to point at another Trash item’s payload.                  | `INVALID` because payload must remain inside selected item directory.            | Cross-item data cannot be moved.                                                 | Existing-structural + Needed-integration |

---

# H. Atomicity, concurrency, and crash recovery

| ID      | Pri | Failure point / concurrency                                           | Expected                                                                                                                                                   | Critical assertion                                       | Coverage                                                        |
| ------- | --: | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| ATOM-01 |  P0 | Failure after first payload entry moved, before second entry.         | `ROLLBACK`.                                                                                                                                                | First entry returns to Trash; no live partial restore.   | Needed-crash                                                    |
| ATOM-02 |  P0 | Failure after payload move, before canonical task write completes.    | `ROLLBACK`.                                                                                                                                                | Payload and task store both return to pre-command state. | Needed-crash                                                    |
| ATOM-03 |  P0 | Failure after task write, during relationship write.                  | `ROLLBACK`.                                                                                                                                                | Tasks do not remain restored alone.                      | Needed-crash                                                    |
| ATOM-04 |  P0 | Failure during external map reference transaction.                    | `ROLLBACK`.                                                                                                                                                | Payload/tasks/relationships/map refs all revert.         | Needed-crash                                                    |
| ATOM-05 |  P0 | Process crash before atomic commit marker.                            | Startup recovery restores exact pre-restore state.                                                                                                         | Trash item remains.                                      | Existing atomic-core crash coverage; add Trash-specific fixture |
| ATOM-06 |  P0 | Process crash after durable commit marker but before journal cleanup. | Restored state remains committed on restart.                                                                                                               | Trash item stays removed.                                | Existing atomic-core crash coverage; add Trash-specific fixture |
| ATOM-07 |  P0 | Two restore commands for same item submitted concurrently.            | Project queue serializes; first succeeds, second cleanly fails not-found/invalid.                                                                          | No duplicate payload or refs.                            | Needed-integration                                              |
| ATOM-08 |  P0 | Restore and delete command run concurrently in same project.          | Serialized deterministic order.                                                                                                                            | No interleaving state.                                   | Needed-integration                                              |
| ATOM-09 |  P1 | Restore and permanent-delete same item concurrently.                  | Serialized: one wins; second fails safely based on new state.                                                                                              | Never both partially execute.                            | Needed-integration                                              |
| ATOM-10 |  P1 | Restore items from two different projects concurrently.               | Independent project queues may proceed without cross-project state bleed.                                                                                  | Active-project guards remain correct.                    | Needed-integration                                              |
| ATOM-11 |  P0 | Restore throws while removing Trash item at final step.               | Transaction policy must produce either committed restore + item removed, or full rollback; never restored live state plus still-restorable duplicate item. | Exactly-once semantics.                                  | Needed-crash                                                    |

---

# I. UI decision and feedback tests

| ID    | Pri | UI scenario                                                            | Expected                                                                                                      | Coverage                                                                |
| ----- | --: | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| UI-01 |  P0 | Restore returns `path-exists`.                                         | Card remains; clear “previous location occupied” conflict shown; buttons re-enabled.                          | Existing-structural + Needed-UI                                         |
| UI-02 |  P0 | Restore returns node/map/task ID conflict.                             | Card remains; identity-specific explanation shown.                                                            | **Decision-gap: current conflict copy groups some IDs too generically** |
| UI-03 |  P0 | Restore returns `SECOND_PARENT_CONFIRM_REQUIRED` or `HIERARCHY_CYCLE`. | Card remains; semantic relationship conflict explanation shown; no auto-confirm option hidden behind restore. | Needed-UI                                                               |
| UI-04 |  P0 | Restore succeeds.                                                      | Card disappears, project tree refreshes, restored item becomes navigable.                                     | Existing-structural + Needed-UI                                         |
| UI-05 |  P1 | Restore succeeds with warnings because external map vanished.          | **Warnings must be surfaced after success**, not silently discarded by rerender.                              | **Decision-gap: current UI does not visibly surface success warnings**  |
| UI-06 |  P1 | User double-clicks Restore rapidly.                                    | First click disables actions; one command sent.                                                               | Existing code behavior + Needed-UI                                      |
| UI-07 |  P1 | Restore fails network/IPC/runtime error.                               | Card remains, error visible, buttons re-enabled.                                                              | Existing-structural + Needed-UI                                         |
| UI-08 |  P0 | Permanent Delete clicked.                                              | Explicit confirmation required; restore is not attempted.                                                     | Existing-structural + Needed-UI                                         |
| UI-09 |  P0 | Empty Trash clicked.                                                   | Explicit confirmation required; cancellation leaves every item intact.                                        | Existing-structural + Needed-UI                                         |
| UI-10 |  P1 | Language switches while Trash page open.                               | Conflict/action copy rerenders correctly in TR/EN.                                                            | Needed-UI                                                               |

---

# J. Recommended executable fixture model

Every integration case should build a temporary project with only public/canonical storage shapes:

```text
project/
  Work.map
  Work.nodes/
    A.node
    B.node
  Other.map
  Other.nodes/
  .pisi/
    tasks.json
    relationships.json
    trash/items/trash_<fixture>/...
```

For every test, capture these snapshots **before restore** and compare them after success/failure:

1. recursive project file tree excluding volatile atomic journal timestamps;
2. content hash of all unrelated live files;
3. canonical `tasks.json` normalized task records;
4. canonical `relationships.json` normalized relationship records;
5. every live map’s `nodes`, `relationshipViews`, camera, operational scope and saved scopes/layouts;
6. selected Trash item manifest + payload tree;
7. all other Trash items.

## Failure invariant helper

All `CONFLICT`, `INVALID`, and injected runtime failures before commit should use one shared assertion:

```js
assertProjectEquivalent(after, before, {
    includeTrash: true,
    ignoreAtomicJournalCleanup: true
});
```

That helper is more important than checking only `result.ok === false`: a safe restore test must prove **nothing changed**.

## Success invariant helper

For `SUCCESS` tests, compare current state against a constructed expected delta rather than against the original pre-delete snapshot. This proves post-delete edits were preserved.

```js
assertProjectEquivalent(after, expectedDeltaMerge, {
    excludeTrashItem: restoredTrashId
});
```

---

# K. Release gates

## P0 — block release if any fail

- PATH-01/02/03/04/09/10/11/14
- ID-01/02/05/06/07/08
- TASK-01/03/04/08/09/13
- REL-01/02/03/04/05/06/08/09/10/11/16
- COMBO-01/02/03
- MAN-01..10 except explicitly P1 cases
- ATOM-01..08 and ATOM-11
- UI-01..05, UI-08, UI-09

## P1 — required before Pisi 1.0 stabilization

- post-delete presentation merge cases;
- cross-platform case/path behavior;
- independent multi-project concurrency;
- warning visibility and language switching;
- stale/orphan relationship-view presentation combinations.

## P2 — hardening

- extreme path lengths;
- unusual Unicode names;
- forward-compatible unknown manifest fields.

---

# L. Current suite vs matrix

Current tests already provide useful foundations:

- `tests/trash-core.test.js` directly checks project-relative path coverage/normalization, task archive/dependency merge, relationship archive, and summary behavior.
- `tests/trash-domain-contract.test.js` structurally checks node/map identity rejection, missing relationship endpoint checks, view schema version, and separation from OS Trash.
- `tests/trash-reversible.test.js` structurally checks project-local Trash routing, reference archiving, delta-merge intent, conflict hooks, atomic command routing, renderer exposure, and Workspace Center wiring.

The next testing increment should therefore **not** add more regex/source-presence assertions first. The priority is a temporary-project integration harness around `preflightPisiTrashRestore()` / `restorePisiTrashItem()` plus Trash-specific crash injection. That is what turns the safety policy above into an executable release gate.
