# Note editor keyboard rules

These rules apply to the center and modal note editors. Native keydown and
touch-keyboard beforeinput events share the same dispatcher. Composition,
already-cancelled events, nested controls, Sheet/Canvas editing and selections
spanning multiple blocks are excluded from single-block mutations.

| Block        | Enter                                                                                 | Shift+Enter                   | Backspace at start / empty block                                                                       |
| ------------ | ------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Paragraph    | Insert a soft line; Enter on an empty line exits into a new paragraph                 | Soft line in the same block   | Join adjacent text blocks, retaining the left block identity                                           |
| Heading 1–5  | Split into a paragraph; an empty heading becomes a paragraph                          | Soft line in the heading      | Empty heading becomes a paragraph; otherwise join adjacent text blocks                                 |
| Quote / code | Keep the existing two-Enter exit rule                                                 | Soft line in the same block   | Empty block becomes a paragraph; otherwise join adjacent text blocks                                   |
| Bullet       | Split into a bullet; empty item outdents or becomes a paragraph                       | Soft line in the item         | Outdent; a top-level item becomes a paragraph                                                          |
| Number       | Split into a numbered item; empty item becomes a paragraph                            | Soft line in the item         | Become a paragraph                                                                                     |
| Task title   | New task below; the text after the caret is its title; empty task becomes a paragraph | Nothing (a title is one line) | Empty task becomes a paragraph; otherwise, at the start, the caret goes to the end of the block before |

Delete at the end of a text block joins the following text block. The left
identity survives. Text joins never absorb Sheet, Canvas, rollup, media or task
blocks, nor the diary's task section. Spaces and soft line breaks are deleted
normally before attempting a block join.

## Task blocks and diary rows

A task block (docs/task-plan.md §3.2.1) is not a text block: its title is a
field of its own, one line of plain text, drawn from `.pisi/tasks.json`. The
note file holds only the block and task ids; the title is written to the task
a moment after typing and at once when the field loses focus, never during an
IME composition. A task is made with `/todo` (also `/görev`), `[ ]` or `[]`
followed by a space at the start of a block, the "task" block type and the
toolbar's task button; the block's text becomes the title.

| Key in a title            | Note task block                                           | Diary row                                                                       |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Enter                     | New task below, same note                                 | New task of the same day; in the "add a task" field, makes the task             |
| Enter on an empty title   | The task block becomes an empty paragraph                 | A task that lives in this diary goes to the Trash; a row of another note: no-op |
| Backspace / Delete, empty | As Enter on an empty title                                | As Enter on an empty title                                                      |
| Backspace at the start    | Caret to the end of the block before; nothing is joined   | Caret to the end of the row before                                              |
| Delete at the end         | Nothing                                                   | Nothing                                                                         |
| ArrowUp / ArrowDown       | The block before / after                                  | The row before / after; from the first row, the block above the section         |
| ArrowLeft / ArrowRight    | At the start / end of the title, the block before / after | The same, row by row                                                            |
| Shift+Enter               | Nothing                                                   | Nothing                                                                         |
| Escape                    | Leaves the title (the title is written)                   | The same                                                                        |

In a paragraph right after a task block, Backspace at the start moves the
caret to the end of the task title (an empty paragraph is removed); Delete at
the end of a paragraph before a task block does nothing. A task that leaves a
note through the keyboard goes to the Trash with the note's save; undo brings
it back. A row whose task lives in another note is never deleted from the
keyboard: its "…" menu opens the note, changes the date or takes the task off
that day. A completion that is not the latest is locked (☑ without a
keyboard action, docs/task-plan.md §3.2.3).

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
| A task title in a note or diary                          | The note editor history (the title and the task's fields)           |
| Sheet cell editor, input, textarea, map title input      | The control's own native or Sheet history                           |
| Map canvas (no editable element focused, no modal open)  | Map history (`pisi.map.undo`, `pisi.map.redo`, `pisi.map.redo-alt`) |

A note's history step also keeps the fields of the tasks the note shows. Undo
and redo bring them back with task commands: field changes in one
`task.batch.v1`, a completion with `task.reopen.v1` / `task.complete.v1`, a
diary task this editor sent to the Trash with `trash.restore.v1`; a task block
that comes back into a note brings its task back from the Trash with the save.
Changes made elsewhere (the panel, sync, the other window) join every step, so
undo never takes them back.

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

## Find and replace

| Focus                                        | Mod+F                                 | Replace (Mod+H; Cmd+Alt+F on macOS) |
| -------------------------------------------- | ------------------------------------- | ----------------------------------- |
| Center or modal note editor, or the find bar | Opens the note's find bar             | Opens it with the replace row       |
| Sheet cell or a control inside a Sheet       | Focuses that Sheet's own search field | No effect                           |
| Map, tree or anything else                   | No effect                             | No effect                           |

In the find bar Enter and Shift+Enter (or F3 / Shift+F3) go to the next and
previous match and Esc closes the bar, leaving the current match selected in the
note. In the replace field Enter replaces the current match and Mod+Enter
replaces all. Matching folds case with Turkish rules (İ↔i, I↔ı) unless "Match
case" is on; "Whole word" treats Unicode letters, digits and `_` as word
characters. A match may span formatted text inside one block but never two
blocks.

Only editable text is searched and replaced: task checkboxes and chips, tags,
`[[links]]`, Paint, Sheet, rollup, image and file blocks and anything
`contenteditable="false"` are skipped, and attributes such as block and task ids
are never touched. Task titles are searched (each title is a match group of its
own); a replaced title is written to `tasks.json` with one `task.batch.v1`. Highlights use the CSS Custom Highlight API, so the saved
HTML never contains find markers. "Replace all" is one undo step.

## Interface zoom, print and the context menu

| Keys                              | Everywhere, also while a map is focused       |
| --------------------------------- | --------------------------------------------- |
| Mod+= (also Mod++, Ctrl+Numpad +) | Zooms the interface in by 10 %, up to 200 %   |
| Mod+- (also Ctrl+Numpad −)        | Zooms the interface out by 10 %, down to 80 % |
| Mod+0 (also Ctrl+Numpad 0)        | Resets the interface zoom to 100 %            |
| Mod+Alt+P                         | Prints the open note (system print dialog)    |
| Mod+P                             | Project search (unchanged)                    |

Rule: Mod+= / Mod+- / Mod+0 always zoom the interface, never the map. Map zoom
uses the wheel, pinch and the map's own +/− buttons; there is no keyboard map
zoom to collide with. The zoom keys and Print are commands in the command
registry, so the shortcut editor reports conflicts with them like any other
command. The alternative keys (Mod++, numpad) only apply while the zoom
shortcuts are the defaults; on a Turkish Q keyboard "=" is Shift+0 and works as
Mod+Shift+0. The zoom level is stored in the app settings and can also be
chosen in Settings → View.

Print uses the same HTML template as the PDF export and the system print
dialog; it is also in the command palette and in the note's Export panel.

The right-click menu comes from the main process (Electron `context-menu`):
cut, copy, paste, paste without formatting and select all in editable fields;
open and copy for links the external URL policy allows; up to five spelling
suggestions and "Add to dictionary" on a misspelled word. Spell checking uses
Turkish and US English (interface language first) and can be turned off in
Settings. Surfaces with their own menu (map, Sheet, task priority menu) call
`preventDefault` on `contextmenu`, and then no native menu appears.

## Task panel and task workspace

The task list (the right panel's Tasks tab and the workspace's list,
`renderer/tasks/pisi-task-panel.mjs`, `docs/task-plan.md` G4):

| Key           | In a card                     | Result                                                                       |
| ------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| ↑ / ↓         | any control                   | The same control (checkbox, title, status, Open) of the card above or below. |
| Enter         | title                         | Opens the task's detail window.                                              |
| Space         | title                         | Completes the task, or reopens it (the checkbox's own Space does the same).  |
| Alt+↑ / Alt+↓ | any control, "Elle sıra" only | Moves the card one place; one `task.batch.v1` write.                         |

In the kanban, Alt+← / Alt+→ on a card moves it to the column on that side (one
`task.update.v1`, the status). The detail window and Quick Add keep the focus
inside while they are open (Tab and Shift+Tab cycle), and Escape closes them.
