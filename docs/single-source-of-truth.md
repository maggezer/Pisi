# Pisi single source-of-truth contract

Persistent semantic authority is intentionally narrow:

- **Tasks:** `.pisi/tasks.json` is authoritative after the one-time legacy migration marker is written. Node task markup is an editable projection/reference and full background scans cannot overwrite canonical task state.
- **Calendar / diary task views:** derived from canonical tasks. Diary managed sections are regenerated projections and are excluded from task indexing.
- **Progress / statistics:** computed from the canonical task projection at render time; no separate progress state is persisted.
- **Search task records:** rebuildable records projected from the canonical task store. Search indexes are caches, never semantic authority.
- **Relationships:** `.map` `edges` are authoritative. Node `connectionTypes` are regenerated compatibility metadata.
- **Map position:** `.map` `nodes[].layout` is authoritative for x/y/width/height.

Projection-to-source writes are allowed only for explicit user editing surfaces. Full filesystem/project scans are read-only after migration.
