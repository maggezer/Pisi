# Stable Property Schema

Pisi 1.0 treats property definitions as project-level schema entities. Node files remain the readable authority for a node's property values, while `.pisi/properties.json` is the authority for property identity, name and type.

## Scope

The editable 1.0 property types remain deliberately small:

- `text` — Metin
- `number` — Sayı
- `multiselect` — Tags
- `relation` — Relation

`rollup` remains an internal persisted property used by the existing Rollup block/runtime. It is not added back to the property type menu. Pisi 1.0 does not add Formula, nested databases, automation, date/select/checkbox/node property types or a new expression language.

## Authority boundary

`.pisi/properties.json` contains only schema definitions and migration metadata. It never stores per-node values.

A definition has a stable `id`, a user-visible `name`, and a canonical `type`. Node files store values under that stable ID and retain `name`/`type` as redundant readable copies. Those copies must match the project schema and are audited by Project Integrity.

Relation target choices may still be scoped to the active map as a UI decision. That does not change the project-level identity of the Relation definition itself.

## Stable identity

Property rename changes the schema name, not the property ID. The redundant name copy is propagated to every node/template using the ID in the same atomic mutation.

Removing a property from one node removes only that node's value. It does not implicitly delete the project definition, because another node/template may still use the stable ID and because silent schema deletion would make restore/import ambiguous.

New definitions receive a stable ID once and persist it. Legacy properties that do not carry a usable ID receive a deterministic migration ID. Compatible legacy definitions with the same normalized name and type are migrated to one canonical ID.

## Type changes

A type change is a project-schema operation, not a local row decoration. Pisi inspects every node/template use of the stable ID before the change is written. The change proceeds only when all existing values are empty or can be converted without semantic loss. Otherwise the entire command returns `PROPERTY_TYPE_CHANGE_CONFLICT` and the atomic mutation leaves the project unchanged.

Rollup cannot be converted to or from an editable property type through the property menu.

## Legacy migration

The supported legacy aliases are:

- `date` → `text`
- `select` → `multiselect`
- `node` → `relation`
- `checkbox` → `multiselect`

Migration is versioned at schema version 1. Unknown property types are not silently converted to text. Duplicate IDs, ambiguous same-name/different-type definitions, invalid values and carrier-local duplicate results are recorded as explicit migration conflicts and surfaced by Project Integrity.

The old `checked-percent` Rollup aggregate is recognized as legacy data but is not a current aggregate. It requires explicit review rather than a silent behavior change.

## Templates

Database/property templates use the same stable property IDs. Saving a template can register a genuinely new project definition, but it cannot silently change the type of an existing definition. Applying a template validates its property IDs/names/types against the current project schema before the existing template application path runs.

## Integrity checks

Project Integrity includes `.pisi/properties.json` as a canonical authority and reports, among other cases:

- missing or unreadable schema when property values exist;
- invalid/duplicate definition IDs;
- duplicate normalized names under different IDs;
- unresolved migration conflicts;
- node properties whose IDs are absent from the schema;
- node/template name or type drift from the canonical definition;
- unsupported property types;
- values incompatible with the canonical type;
- legacy property types that still require migration.

Ambiguous or lossy cases are review/manual repairs. They are never automatically coerced just to make the integrity report green.

## Atomicity

Schema migration, node property save, rename propagation, type migration and template schema mutation run inside the existing project atomic mutation system. A failure before commit must leave either the old complete state or the new complete state; a half-renamed/half-converted project is not an acceptable outcome.
