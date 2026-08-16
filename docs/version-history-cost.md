# Version History cost controls

Pisi Version History is a node-level recovery projection. It is not a project authority and it does not replace the canonical node, task, relationship or property stores.

## Previous cost model

Before this hardening, every content-changing editor save captured the complete current node JSON into `.pisi-history/<nodeId>/` as an uncompressed `.json` file. Exact raw-file duplicates were skipped and each node retained at most 50 files.

That count limit prevented unbounded version counts, but storage was still approximately:

`sum(full node JSON size for the newest 50 distinct saves)`

A 5 MiB node could therefore approach 250 MiB of local history before filesystem/JSON overhead. Nodes containing embedded image data were the main risk. Listing history also parsed every retained full snapshot to build previews.

Atomic `.pisi-backup` files are separate from Version History. `writeFileAtomic()` keeps at most one sibling backup for a target because the same `.pisi-backup` path is overwritten. The History dialog previously performed a project-wide backup scan when no node was open.

## New snapshot format

New versions are stored as `.json.gz` files. The payload remains the complete node document so restore semantics do not depend on a delta chain. This deliberately favors recovery simplicity over a more fragile incremental history format.

Legacy `.json` history remains readable. No destructive migration is required.

Each node history directory also receives a small `index.json` containing only:

- history ID;
- capture time;
- reason;
- content hash;
- short preview;
- stored byte size;
- compression marker.

Normal History listing reads this index plus directory names instead of opening and parsing every full snapshot. If an old history directory has no valid index, Pisi can still fall back to the legacy scan. The next captured version rebuilds and writes the index.

## Retention policy

Two limits apply per node:

- maximum versions: **50**;
- maximum stored history bytes: **24 MiB**.

Retention is newest-first. The newest version is always preserved even when that single compressed snapshot is larger than the byte budget. Older versions are retained only while both the count and byte budget permit them.

This means the ordinary upper bound for a node is 24 MiB of compressed history rather than 50 times the uncompressed node size. A single unusually large newest version may exceed the budget because retaining one recoverable version is safer than silently having no history.

The budget applies to Version History only. The single sibling `.pisi-backup` maintained by atomic file writes is a separate recovery cost.

## Save and restore behavior

- Content-identical saves still do not create a new history version.
- New snapshots are written atomically with backup generation disabled for the snapshot and its index; history does not create backups of its own backups.
- Editor saves remain on the normal lightweight save path; they are not wrapped in a full project mutation journal merely to create history.
- Explicit Version History restore is rare and now runs inside the existing atomic mutation layer.
- Existing history ownership check remains: a version cannot be restored into a different node identity.

## Backup listing cost

The toolbar History view is node-scoped. If no node is open, the backend now returns an empty scoped backup result instead of recursively walking the project for up to thousands of `.pisi-backup` files.

When a node is open, backup lookup is O(1) with respect to project size because it checks only `<nodePath>.pisi-backup`.

## Authority boundary

Version History remains recovery data only:

- `.node` remains the document authority;
- `.pisi/tasks.json` remains task authority;
- `.pisi/relationships.json` remains semantic relationship authority;
- `.pisi/properties.json` remains property-schema authority;
- `.pisi-history` is never used to reconstruct those authorities merely to make current state appear valid.
