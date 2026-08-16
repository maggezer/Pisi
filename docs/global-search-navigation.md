# Global Search and Quick Navigation

Pisi Global Search is a rebuildable navigation projection. It is not a new storage authority.

## Search sources

The base index continues to derive node, map, content, tag and table records from project files. The enhanced projection adds:

- canonical tasks from the first-class task store, carrying stable `taskId`, source `nodePath`, `blockId` and map context;
- bounded node property names and values as additional node search fields;
- all known map memberships for a node instead of treating the first map as the only navigation context;
- project-scoped recent-navigation metadata stored locally for quick switching.

Canonical task search results replace the old HTML-derived task records in the enhanced projection. Search never writes task authority.

## Query grammar

Free text remains Turkish-character insensitive. The advanced query layer also supports:

- `type:node`, `type:task`, `type:map`, `type:content`, `type:tag`, `type:table`
- `kind:` as an alias for `type:`
- `map:<name>`
- `path:<fragment>`
- `tag:<tag>` or `#tag`
- `status:<task-status>`
- `priority:1` through `priority:5`
- quoted phrases such as `"final abstract"`

Filter chips in the Global Search dialog intersect with query filters; they never broaden a constrained query.

## Ranking

Ranking favors stable navigation signals before broad content matches:

1. exact and prefix title matches;
2. task title and tag matches;
3. node property matches;
4. table/content matches;
5. map/path matches.

Small typos are tolerated on navigation-oriented fields through bounded word-level edit distance. Exact matches always outrank fuzzy matches. Fuzzy fallback is bounded: navigation records are considered first, with content/table fallback capped to avoid an unbounded typo scan.

The ranking layer also adds small contextual boosts for the currently open node/map and a larger, decaying boost for recently opened results. Recency metadata is scoped by project and is never persisted into project files.

## Quick switch behavior

`Ctrl/Cmd+P` opens Global Search. An empty query acts as a quick switcher: recent nodes/maps/tasks rise to the top, followed by contextually relevant navigation records.

Keyboard navigation:

- `ArrowUp` / `ArrowDown`: previous/next result
- `PageUp` / `PageDown`: jump through results
- `Home` / `End`: first/last result
- `Enter`: open the source directly
- `Alt+Enter`: show the result on a map
- `Escape`: close

The right Search panel uses the same query parser, ranking, canonical task projection and recent-navigation model.

## Exact task navigation

A canonical task result carries its stable `taskId`. Opening it delegates to the existing task navigation pipeline, which resolves canonical source identity, verifies the exact block, recovers stale source references when possible and highlights the target block.

This means search no longer relies on similar task text as the primary identity for task navigation.

## Multiple map memberships

Search records retain all known map memberships. `Alt+Enter` prefers the currently open map when it contains the result; otherwise it uses the canonical/source map or the first known membership. The map camera then centers and highlights the exact node box.

## Performance model

The in-memory trigram accelerator remains a rebuildable projection. Enhanced records rebuild an accelerator after canonical task/property enrichment. Search can show the last valid project snapshot immediately while a fresh live projection is prepared.

Release performance target for a 10,000-node representative project remains:

- median search response below 500 ms;
- p95 below 1.5 s;
- p95 above 3 s is a release blocker.

Deterministic tests additionally guard a 10,000-record accelerator build below 1.5 s and repeated exact-query p95 below 500 ms on CI hardware. These are regression guardrails, not substitutes for representative desktop profiling.

A future SQLite/FTS implementation may replace the in-memory projection if scale requires it, but it must remain rebuildable from project authorities and must never become the source of truth.