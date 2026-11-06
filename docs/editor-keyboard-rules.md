# Note editor keyboard rules

These rules apply to the center and modal note editors. Native keydown and
touch-keyboard beforeinput events share the same dispatcher. Composition,
already-cancelled events, nested controls, Sheet/Canvas editing and selections
spanning multiple blocks are excluded from single-block mutations.

| Block        | Enter                                                                    | Shift+Enter                                | Backspace at start / empty block                                                |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Paragraph    | Insert a soft line; Enter on an empty line exits into a new paragraph    | Soft line in the same block                | Join adjacent text blocks, retaining the left block identity                    |
| Heading 1–5  | Split into a paragraph; an empty heading becomes a paragraph             | Soft line in the heading                   | Empty heading becomes a paragraph; otherwise join adjacent text blocks          |
| Quote / code | Keep the existing two-Enter exit rule                                    | Soft line in the same block                | Empty block becomes a paragraph; otherwise join adjacent text blocks            |
| Bullet       | Split into a bullet; empty item outdents or becomes a paragraph          | Soft line in the item                      | Outdent; a top-level item becomes a paragraph                                   |
| Number       | Split into a numbered item; empty item becomes a paragraph               | Soft line in the item                      | Become a paragraph                                                              |
| Task         | Split the trailing text into a paragraph; empty task becomes a paragraph | Soft line without duplicating the checkbox | After the checkbox, become a paragraph; before it, join the previous text block |

Delete at the end of a text block joins the following text block. The left
identity survives; task metadata from the consumed right block is removed.
Text joins never absorb Sheet, Canvas, rollup or media blocks. Spaces and soft
line breaks are deleted normally before attempting a block join. Selecting all
task text and pressing Backspace or Delete removes the text and task marker.

The existing double-Enter behavior is intentional and is not replaced with
single-Enter paragraph splitting. Electron regression tests exercise both
keyboard events and beforeinput, block identities, caret splits, styled empty
lines, composition and task deletion. All mutations use the normal input/save
and editor undo/redo pipeline.

In a paragraph containing only `---`, Enter or Space replaces the marker with a
horizontal rule and puts the caret in a new paragraph below it. Shift+Enter
continues to insert a soft line. Code and task blocks do not use this shortcut.
Horizontal rules survive saving, pasting and Markdown source round-trips.

## Links

`Mod+Shift+K` (also the toolbar link button and `/link`) opens the link editor
for the selected text, or for the link under the caret. `Mod+K` stays with the
command palette. The URL field accepts only `http`, `https` and `mailto`; a bare
host such as `ornek.com` becomes `https://ornek.com/`, a bare e-mail address
becomes `mailto:`. In an editable note a plain click on a link only places the
caret and `Ctrl+click` (`Cmd+click` on macOS) opens it in the default browser.
In read-only surfaces a plain click opens it. The application window never
navigates: every open goes through the main-process external link guard.

## Note links

Typing `[[` opens a suggestion list of notes ranked by the search index. The
shared tag menu owns the keys while it is open: ArrowUp/ArrowDown move, Enter or
Tab pick, Escape closes; IME composition never opens or drives it. `[[Not#`
lists that note's blocks. When no note has exactly the typed title, the list
offers "Yeni not oluştur", which creates the note next to the current one.
Typing a complete `[[Başlık]]` turns it into an id link when exactly one note
has that title. As with web links, Ctrl+click (Cmd+click on macOS) follows a
note link in an editable note and a plain click follows it in read-only
surfaces; legacy `[[Başlık]]` text is followed by title, with a chooser when
several notes share it.

## Keyboard ownership: undo and redo

Mod+Z, Mod+Shift+Z and Mod+Y belong to exactly one history at a time, chosen by
where the keyboard focus is. Histories never mix: a map step is never undone
from a note editor and a text edit is never undone from the map.

| Focus                                                    | History used                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Center or modal note editor (any block, including Sheet) | Note editor history (`pisi-editor-history.mjs`)                     |
| Sheet cell editor, input, textarea, map title input      | The control's own native or Sheet history                           |
| Map canvas (no editable element focused, no modal open)  | Map history (`pisi.map.undo`, `pisi.map.redo`, `pisi.map.redo-alt`) |

The map commands are registered in the command registry with
`allowInInput: false`, so the registry never runs them for an editable target,
and their `when` check requires a visible map with no modal or dialog open.
They can be rebound in Settings → Keyboard shortcuts; the registry's conflict
check applies to them like any other command.

The map history records node create/delete (Trash), reference removal, one step
per drag (including multi-selection drags), resize, connection add/delete/type
change, hub collapse/expand and title edits. Camera movement is not recorded.
Each step is replayed with the same domain commands the action used. The
history holds up to 200 steps and is cleared when another map opens, the
project closes or the map file is changed outside Pisi.

## Map editing keys

These keys belong to the map only while a map node or the map canvas has the
focus (same ownership rule as undo and redo above); in editors and inputs they
keep their usual meaning.

| Keys                    | Action                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Mod+C                   | Copy the selected nodes and the connections among them                                  |
| Mod+V                   | Paste as map references; no note is copied. Notes already on the map are skipped        |
| Mod+Alt+V               | Paste as copied notes (new notes, "(kopya)" title, connections recreated)               |
| Mod+D                   | Duplicate the selection as copied notes, offset by 40 px                                |
| Arrow keys (on a node)  | Move focus and selection to the nearest node in that direction                          |
| Shift+arrow (on a node) | Move the selection by one grid step (20 px); presses within 700 ms are one history step |
| Tab / Shift+Tab         | Cycle through the node where Tab started and the nodes connected to it                  |
| Mod+Enter (on a node)   | Start a connection; Mod+Enter on another node finishes it                               |
| Enter / F2 / Delete     | Open the note in the modal / edit the title / delete or remove the node                 |
| Escape                  | Clear the selection                                                                     |

Connection ports are no longer in the Tab order. A focused node announces its
title (`aria-label`) and its connection count (`aria-description`); actions are
announced through a polite live region. Alignment, distribution and auto layout
are in the node context menu (long press on touch screens) and the command
palette. While dragging, guides snap to other nodes' edges and centres; with
"Snap to grid" on, positions snap to 20 px. Alt turns snapping off during a drag.
