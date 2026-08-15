# Scoped / Filterable Maps

Pisi map scope is a view concern. It narrows the current map projection without changing map membership, canonical tasks, or semantic relationships.

## Scope strategies

- **Live scope** recalculates membership when node properties, task state, text, or focused-neighbor criteria change.
- **Snapshot scope** freezes the currently visible node IDs. Later property/task/text changes do not silently alter that snapshot.
- Editing task-state, text, or neighbor criteria after a snapshot returns the scope to live mode. Relationship-type filtering remains an edge-only projection and does not change node membership.

## Filters

The map toolbar can combine:

- task-derived modes: all, active, blocked, overdue, missing next action, missing owner;
- text search across title, file name, preview, and property values;
- semantic relationship type: hierarchy, flow, peer;
- focused neighbor views at 1–3 hops;
- node property filters using `exists`, `not-empty`, `equals`, `not-equals`, `contains`, `one-of`, `gt`, `gte`, `lt`, and `lte`.

Multiple property filters use AND semantics. Multiselect/relation values participate naturally in equality, contains, and one-of matching.

## Saved scopes

Saved scopes are independent from saved layouts. A saved scope stores the scope definition (including live/snapshot semantics, query, property filters, focused-neighbor settings, relationship filters, and snapshot node IDs). A saved layout continues to store geometry, camera, collapsed hubs, scope, and display state.

A map may keep up to 40 saved scopes and 20 saved layouts.

## Source-of-truth boundary

Scoped/filterable maps do not create parallel copies of domain data:

- `.pisi/tasks.json` remains task authority;
- `.pisi/relationships.json` remains semantic relationship authority;
- map membership, layout, operational scope, and saved scopes remain map-local state under `.map.data.map.operational`;
- filtered node/edge sets are runtime projections only.

Snapshot scopes store node IDs as view state. They do not detach nodes from the map or rewrite semantic relationships.
