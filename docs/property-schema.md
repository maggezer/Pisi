# Stable Property Schema

Pisi uses a project-level canonical property schema. Node files remain the authority for each node's property values, while `.pisi/properties.json` is the authority for property identity, name and type.

## Current property types

Editable property types:

- `text` — Metin
- `number` — Sayı
- `multiselect` — Tags
- `relation` — Relation

`rollup` is an internal persisted property used by the Rollup block/runtime. It is not exposed as an editable property type.

Supported Rollup aggregates are `count`, `sum`, `average`, `min`, `max`, `unique` and `join`.

## Authority boundary

`.pisi/properties.json` stores project-level definitions. A definition has:

- stable `id`
- user-visible `name`
- canonical `type`
- optional `system` flag

The schema file also carries its schema version, explicit conflict records and `updatedAt` metadata.

Node files store values under the stable property ID and retain readable `name` / `type` copies. Those copies are redundant and must agree with the project schema.

The schema never stores per-node values.

## Stable identity

Creating a definition assigns one stable ID. Renaming a property changes the schema name without changing that ID, and the readable copies in nodes/templates are propagated inside the same atomic mutation.

Removing a property from one node removes only that node's value. It does not implicitly delete the project definition because other nodes or templates may still use the same ID.

A missing canonical schema is not reconstructed from node payloads. If property-bearing nodes exist while `.pisi/properties.json` is missing or unreadable, Project Integrity reports an authority problem instead of guessing definitions.

## Type changes

A type change is a project-schema operation, not a local UI decoration.

Before a type change is written, Pisi validates every node/template use of the stable ID. The operation proceeds only when existing values are empty or can be converted without semantic loss. Otherwise the command fails and the atomic mutation leaves the project unchanged.

`rollup` cannot be converted to or from an editable property type through the property menu.

Unsupported property types are not silently mapped to a current type. They are invalid current-contract data and must be resolved explicitly.

## Templates

Database/property templates use the same stable property IDs as the project schema.

Saving a template may register a genuinely new definition, but it cannot silently change the type of an existing definition. Applying a template validates property IDs, names and types against the active project schema before values are written.

## Integrity checks

Project Integrity treats `.pisi/properties.json` as canonical authority and reports, among other cases:

- missing or unreadable schema when property values exist;
- invalid or duplicate definition IDs;
- duplicate normalized names under different IDs;
- explicit unresolved schema conflicts;
- node properties whose IDs are absent from the schema;
- node/template name or type drift from the canonical definition;
- unsupported property types;
- values incompatible with the canonical type.

Ambiguous or lossy cases are review/manual repairs. Project Integrity does not invent IDs or coerce unknown types merely to make the report green.

## Atomicity

Node property save, schema definition changes, rename propagation, lossless type changes and template schema mutations run inside the project atomic mutation system where the operation spans persisted state.

A failed multi-file property operation must leave either the old complete state or the new complete state.
