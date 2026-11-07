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

Uncompressed legacy `.json` snapshots are no longer supported. Only `.json.gz` snapshot files are accepted by the current history reader.

Each node history directory also receives a small `index.json` containing only:

- history ID;
- capture time;
- reason;
- content hash;
- short preview;
- stored byte size;
- compression marker.

Normal History listing reads this index plus directory names instead of opening and parsing every full snapshot. If the current index is missing or invalid, Pisi rebuilds entries from valid `.json.gz` snapshots. The next captured version writes the refreshed index. This is an index-recovery mechanism, not support for legacy uncompressed history.

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
- Restore recovers the historical document payload while preserving the current `pisi` metadata (identity, title, sidecar, parent map and system roles). Only `updatedAt` is refreshed; history cannot undo a move or rename or revive a removed role.
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

## Canonical store history

The project stores that are not notes get the same snapshot format
(`.json.gz` plus `index.json`) under `.pisi-history/stores/<key>/`:

| Store                      | Key             | Max versions | Max bytes |
| -------------------------- | --------------- | -----------: | --------: |
| `.pisi/tasks.json`         | `tasks`         |           50 |    24 MiB |
| `.pisi/relationships.json` | `relationships` |           50 |    24 MiB |
| `.pisi/properties.json`    | `properties`    |           50 |    24 MiB |
| `.pisi-views.json`         | `views`         |           30 |     4 MiB |
| `.pisi-templates.json`     | `templates`     |           30 |     4 MiB |
| each `.map`                | `map-<mapId>`   |           30 |     8 MiB |

The same newest-first rule applies: the newest version is always kept, older
ones while both the count and the byte budget allow. A map is keyed by its Pisi
id, so a renamed or moved map keeps one history.

Each snapshot stores the file's exact text, so a restore writes back exactly
what was there (maps keep their current identity, title and sidecar, like note
restores).

**When snapshots are taken.** The atomic write path (`writeFileAtomic`) tells
store history right before one of these files is overwritten. If the store has
no snapshot from the last five minutes, its current text is kept first, so the
state before a change can be restored. When the project closes or the app
quits, the latest state of every store changed since its last snapshot is kept
as well. Identical content is never stored twice. This means at most one
automatic snapshot per store per five minutes; changes made and undone within
the same five minutes may not have a version of their own.

**Worst case.** With the budgets above, store history for a project is bounded
by `3 × 24 MiB + 2 × 4 MiB + maps × 8 MiB` of compressed data (80 MiB plus
8 MiB per map); typical task and relationship stores compress to a few kilobytes
per version.

**Restore.** `history.store.restore.v1` runs inside the project atomic mutation.
It first keeps a `before-restore` snapshot of the current state, then writes the
version. For tasks, a task whose block is missing from its source note gets the
block back (appended to the note, with the task's own id, block id and tag, so
the task keeps its identity). Afterwards the renderer runs Project Integrity and
shows the result.

## External backups

Backups outside the project are separate from Version History: one ZIP of the
whole project per run (`Pisi-<proje>-YYYY-MM-DD-HHmm.zip`), once a day while the
app is open and when it quits (at most one minute on quit). `.pisi-history`,
`.pisi/mutations`, `.pisi/backups`, `*.pisi-backup`, the lock file and temporary
files are left out. Retention: every backup of the last 14 days plus the newest
of each of the last 8 weeks; only files named as this project's backups are ever
removed. The backup folder must be outside the project and must not contain it.
"Yedekten geri yükle" opens a ZIP into a new folder and switches to it; an
existing folder or the open project is never overwritten, and ZIP entries that
would leave the target are refused before anything is written.
