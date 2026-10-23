# Note editor keyboard rules

These rules apply to the center and modal note editors. Native keydown and
touch-keyboard beforeinput events share the same dispatcher. Composition,
already-cancelled events, nested controls, Sheet/Canvas editing and selections
spanning multiple blocks are excluded from single-block mutations.

| Block | Enter | Shift+Enter | Backspace at start / empty block |
| --- | --- | --- | --- |
| Paragraph | Insert a soft line; Enter on an empty line exits into a new paragraph | Soft line in the same block | Join adjacent text blocks, retaining the left block identity |
| Heading 1–5 | Split into a paragraph; an empty heading becomes a paragraph | Soft line in the heading | Empty heading becomes a paragraph; otherwise join adjacent text blocks |
| Quote / code | Keep the existing two-Enter exit rule | Soft line in the same block | Empty block becomes a paragraph; otherwise join adjacent text blocks |
| Bullet | Split into a bullet; empty item outdents or becomes a paragraph | Soft line in the item | Outdent; a top-level item becomes a paragraph |
| Number | Split into a numbered item; empty item becomes a paragraph | Soft line in the item | Become a paragraph |
| Task | Split the trailing text into a paragraph; empty task becomes a paragraph | Soft line without duplicating the checkbox | After the checkbox, become a paragraph; before it, join the previous text block |

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
