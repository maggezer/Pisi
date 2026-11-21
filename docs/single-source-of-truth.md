# Pisi single source-of-truth contract

Persistent semantic authority is intentionally narrow:

- **Tasks:** `.pisi/tasks.json` (version 2, `docs/task-plan.md` §3.1) is the authoritative task store and holds every task field. A note holds only a task block with the task id (`data-pisi-task-id`); the editor draws it from the record and saves it empty. Task changes are written only by the main-process task service (`task.*.v1`); a field change reads and writes no `.node` file, and no task operation scans the project.
- **Calendar / diary task views:** derived from canonical tasks. A diary's task section (its last block, task ids only) is generated from `tasks.json` by `shared/task-diary.mjs`, byte for byte the same on every device, and is never read back as tasks. It is written only when a task's days change (place, due day, completion days).
- **Progress / statistics:** computed from the canonical task projection at render time; no separate progress state is persisted.
- **Reminders:** the reminder instant is derived from the canonical task (`reminderAt`, or `reminderMode` + `dueDate` + the user's default time) on every plan and is never written back. `.pisi/reminder-state.json` holds presentation state only (shown, pending, snoozed) and is not a task authority.
- **Search task records:** rebuildable records projected from the canonical task store. Search indexes are caches, never semantic authority.
- **Semantic relationships:** `.pisi/relationships.json` is authoritative project-wide. A relationship owns `sourceId`, `targetId`, type, direction/roles, optional label/properties and lifecycle metadata. Node `connectionTypes` are derived at query time and are never persisted as semantic state.
- **Map state:** each `.map` document owns membership/reference state, `nodes[]` layout/customization, camera/collapsed state and `relationshipViews`. A `relationshipView` may contain only `relationshipId`, source/target ports and visual customization. It cannot redefine relationship endpoints or semantics.
- **Map position:** `.map` `nodes[].layout` is authoritative for x/y/width/height. The same node may therefore have different placement in different maps without changing the node or its relationships.

Legacy semantic `map.edges` / `.map.data.map.edges` storage is not part of the current persistence contract and is not migrated on access. Semantic relationships must exist in `.pisi/relationships.json`; maps retain only `relationshipViews` for per-map presentation. A canonical relationship is projected into any map containing both endpoint nodes, while each map can retain independent ports and visual customization for that relationship.

Projection-to-source writes do not exist for tasks: the old note markup is not read as tasks. Other projections write to their source only through explicit user editing surfaces and canonical domain operations. Full filesystem/project scans are read-only with respect to semantic authorities.
