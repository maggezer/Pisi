# Bases-lite Table/Card Hardening

Bases-lite remains a projection over the active map's node set. This hardening does not introduce a new database authority, a new property store, Formula, grouping, automation or another table model.

## Data boundary

- Node/property values continue to come from the active map's node records.
- Canonical property identity/name/type comes from the project-level `.pisi/properties.json` schema when available.
- Relation choices and the set of rows remain scoped to the active map.
- Rollups are materialized from the same in-memory map document projection used by the existing property engine.
- Saved Bases views persist only the existing `query` and `layout` (`table` or `cards`) fields.

## Shared projection

Table and Card now consume one `buildPisiBaseProjection()` result.

The projection:

1. takes the complete active-map document set;
2. derives the used canonical property columns once;
3. keeps those columns stable while a query filters rows;
4. filters with the existing property-query engine;
5. deterministically sorts rows by title, path and identity;
6. exposes the same columns to Table and the first eight of those columns to Card.

This prevents Table columns from disappearing as filters change and prevents each card from presenting an unrelated first-eight-property order.

Unused project definitions are not rendered as empty columns. Properties present in the map but missing from the canonical schema are appended deterministically so legacy/orphan data stays visible rather than disappearing.

## Display behavior

- Missing/empty values render as an em dash.
- Zero remains `0` rather than being treated as empty.
- Multi-select values use a stable comma-separated display.
- Relation values resolve to the matching node title when the target exists in the active projection; unresolved values remain visible as their stored reference.
- Rollup values use the already-materialized value and do not create a second calculation engine.

## Saved views and project changes

Malformed saved-view layouts fail closed to `table`; query text remains bounded to the existing 2000-character limit. Ephemeral query/layout state is reset when the active project changes so one project's view state cannot silently leak into another.

## Create map from results

The “create map from results” action consumes the same current projection used to render Table/Card. It does not run a second filter implementation, so the node set shown to the user is the node set sent to map creation.

## Non-goals

This change intentionally does not add:

- grouping;
- arbitrary column configuration;
- editable cells inside Bases;
- formulas;
- nested databases;
- property-schema mutation from Bases;
- another persisted Bases/table/card authority.
