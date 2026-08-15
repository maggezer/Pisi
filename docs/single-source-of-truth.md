# Pisi single source-of-truth contract

Persistent semantic authority is intentionally narrow:

- **Tasks:** `.pisi/tasks.json` is authoritative after the one-time legacy migration marker is written. Node task markup is an editable projection/reference and full background scans cannot overwrite canonical task state.
- **Calendar / diary task views:** derived from canonical tasks. Diary managed sections are regenerated projections and are excluded from task indexing.
- **Progress / statistics:** computed from the canonical task projection at render time; no separate progress state is persisted.
- **Search task records:** rebuildable records projected from the canonical task store. Search indexes are caches, never semantic authority.
- **Semantic relationships:** `.pisi/relationships.json` is authoritative project-wide. A relationship owns `sourceId`, `targetId`, type, direction/roles, optional label/properties and lifecycle metadata. Node `connectionTypes` are query-time compatibility projections and are not semantic authority.
- **Map state:** each `.map` document owns membership/reference state, `nodes[]` layout/customization, camera/collapsed state and `relationshipViews`. A `relationshipView` may contain only `relationshipId`, source/target ports and visual customization. It cannot redefine relationship endpoints or semantics.
- **Map position:** `.map` `nodes[].layout` is authoritative for x/y/width/height. The same node may therefore have different placement in different maps without changing the node or its relationships.

Legacy `.map.data.map.edges` values are migrated on map access into `.pisi/relationships.json`; only presentation information is retained in the map as `relationshipViews`, and the legacy `edges` field is removed. A semantic relationship is projected into any map containing both endpoint nodes, while each map can retain independent ports/colors for that relationship.

Projection-to-source writes are allowed only for explicit user editing surfaces. Full filesystem/project scans are read-only after migration.