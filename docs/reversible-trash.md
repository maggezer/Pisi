# Reversible Trash

Pisi destructive project operations are reversible by default. Deleting a node, map, folder, or supported project path moves the item into the project-local Trash instead of handing it to the operating-system recycle bin.

## Storage

Trash data is stored under:

`.pisi/trash/items/trash_<id>/`

Each item contains a `manifest.json` and a `payload/` directory. The manifest records the original project-relative paths, deletion time, Pisi node/map identities, archived canonical task records, semantic relationships, task dependency references, and map presentation references needed for a safe restore.

The `.pisi`, `.git`, and `node_modules` project-internal roots cannot be trashed. The active project root itself cannot be trashed.

## Delete

`project.item.delete.v1` and `project.path.delete.v1` are rebound to the Trash domain. The mutation:

1. discovers the node/map identities under the target;
2. archives canonical tasks whose source belongs to the target;
3. removes and archives semantic relationships that touch deleted nodes;
4. removes and archives references from live maps outside the deleted target;
5. moves the target and its managed sidecar payload into `.pisi/trash`;
6. persists the Trash manifest.

All of those writes run inside the existing atomic project mutation boundary. A failure returns the complete pre-delete state rather than a partial Trash operation.

## Restore

Restore is a **delta merge**, not a whole-project snapshot rollback. Changes made elsewhere after deletion remain intact. Pisi restores only the payload and references archived with that Trash item.

Restore fails closed when it cannot prove that the old identity can be reintroduced safely. Examples include:

- the original filesystem path is already occupied;
- a node or map identity has been reused;
- an archived task identity is already active;
- the original parent map for a directly deleted node no longer exists;
- a semantic relationship identity or hierarchy conflicts with current relationships;
- a semantic relationship endpoint no longer exists and is not part of the item being restored.

External map references that belonged to a map which has since disappeared are skipped with a warning rather than causing unrelated current project state to be overwritten.

## Permanent deletion

Permanent deletion is explicit. A user may permanently delete one Trash item or empty the entire Trash. These are separate atomic domain commands:

- `trash.delete-permanently.v1`
- `trash.empty.v1`

They cannot be confused with ordinary project delete actions.

## Bulk destructive operations

When destructive commands run inside `project.batch.v1`, each deleted target gets its own reviewable Trash item while all batch steps share the outer atomic mutation. If any batch step fails, the new Trash items and all other writes from earlier steps are rolled back together.

## UI

Pisi Workspace Center contains a **Çöp Kutusu / Trash** page. It lists the original location, deletion time, item type, and counts of linked nodes, maps, tasks, semantic relationships, and external map references. Each item provides Restore and Delete Permanently actions; Empty Trash is available at page level.
