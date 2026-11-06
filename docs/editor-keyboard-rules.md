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
