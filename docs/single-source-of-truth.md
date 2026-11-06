# Pisi single source-of-truth contract

Persistent semantic authority is intentionally narrow:

- **Tasks:** `.pisi/tasks.json` is the authoritative task store. Node task markup is an editable projection/reference and full background scans cannot overwrite canonical task state.
- **Calendar / diary task views:** derived from canonical tasks. Diary managed sections are regenerated projections and are excluded from task indexing.
- **Progress / statistics:** computed from the canonical task projection at render time; no separate progress state is persisted.
- **Reminders:** the reminder instant is derived from the canonical task (`reminderAt`, or `reminderMode` + `dueDate` + the user's default time) on every plan and is never written back. `.pisi/reminder-state.json` holds presentation state only (shown, pending, snoozed) and is not a task authority.
- **Search task records:** rebuildable records projected from the canonical task store. Search indexes are caches, never semantic authority.
- **Semantic relationships:** `.pisi/relationships.json` is authoritative project-wide. A relationship owns `sourceId`, `targetId`, type, direction/roles, optional label/properties and lifecycle metadata. Node `connectionTypes` are derived at query time and are never persisted as semantic state.
- **Map state:** each `.map` document owns membership/reference state, `nodes[]` layout/customization, camera/collapsed state and `relationshipViews`. A `relationshipView` may contain only `relationshipId`, source/target ports and visual customization. It cannot redefine relationship endpoints or semantics.
- **Map position:** `.map` `nodes[].layout` is authoritative for x/y/width/height. The same node may therefore have different placement in different maps without changing the node or its relationships.

Legacy semantic `map.edges` / `.map.data.map.edges` storage is not part of the current persistence contract and is not migrated on access. Semantic relationships must exist in `.pisi/relationships.json`; maps retain only `relationshipViews` for per-map presentation. A canonical relationship is projected into any map containing both endpoint nodes, while each map can retain independent ports and visual customization for that relationship.

Projection-to-source writes are allowed only through explicit user editing surfaces and canonical domain operations. Full filesystem/project scans are read-only with respect to semantic authorities.
