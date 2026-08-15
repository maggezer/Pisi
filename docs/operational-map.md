# Pisi operational map contract

The map is an operational work surface, not only a graph overview.

## Persistent map state

Each `.map` may persist `map.operational` with:

- a scoped view (`mode`, text query, relationship-type filter, optional included node IDs),
- an optional focused root node and 1–3 hop neighborhood depth,
- display switches for task dependencies, relationship labels and work badges,
- up to 20 named saved layouts containing node positions/sizes/customization, camera/collapsed hubs, scope and display settings.

This state is visual/operational map state. It does **not** redefine semantic relationships or task records.

## Derived work state

Operational work status is projected from canonical tasks at render time:

- open work count,
- blocked tasks (an unresolved canonical task dependency exists),
- overdue work,
- missing next action,
- missing owner when no owner/assignee property is set,
- changed-since-review when a review timestamp property exists.

Task dependency lines are rendered in a separate derived SVG layer. They are not appended to `activeMapEdges`, are never persisted as semantic relationships, and disappear automatically when the dependency is completed.

## Daily operations

The map provides:

- scope filters for all, active, blocked, overdue, missing-next-action and missing-owner nodes,
- text filtering without changing map membership,
- semantic relationship-type filtering,
- focused 1/2/3-hop neighborhood views around the selected node,
- relationship labels that expose hierarchy/flow/peer semantics,
- a deterministic **Next** action that prioritizes unblocked overdue/high-priority work (`5 = very high`, `1 = very low`),
- **Create linked node**, which creates a node next to the current selection and then creates one canonical semantic hierarchy relationship,
- named layout save/restore/delete.

Existing manual placement, multi-selection, pan/zoom, keyboard node opening, node editing and port-based relationship creation remain available.

## Source-of-truth boundary

- Tasks: `.pisi/tasks.json`.
- Semantic relationships: `.pisi/relationships.json`.
- Operational map state and saved layouts: the `.map` document.
- Dependency overlays, work badges, relationship labels and next-work ranking: rebuildable projections only.
