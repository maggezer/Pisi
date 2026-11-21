# Note editor paste rules

External HTML and Pisi block HTML have separate parsing paths. Both are sanitized
before insertion. External HTML keeps supported inline styles, links, headings,
lists, code and table structure. Page layout, event handlers, scripts, embedded
documents and application metadata are not imported from external HTML.

- Plain text keeps Unicode, indentation, empty paragraphs and trailing lines.
- Supported Markdown headings, lists, quotes, task markers and fenced code become
  editor blocks. Text pasted into an existing code block stays literal text.
- Explicit HTML blank paragraphs and soft line breaks are preserved. Formatting
  whitespace between HTML block elements does not create extra paragraphs.
- Safe font family, size, weight, style, decoration, color and alignment survive.
  External paragraph margins and padding are removed.
- Web, mail and local anchor links survive. Script, data-document and local file
  link destinations are removed. Unsupported remote images retain their alt text.
- Pisi copies get new block identities, with copied internal references remapped
  together. Native composite clipboard payloads keep their existing path.
- Task blocks (docs/task-plan.md §3.3): copying or cutting a selection with task
  blocks puts their records on the clipboard (`application/x-pisi-tasks`), the
  bare blocks in the HTML and `- [ ] Title` lines in the plain text. Cutting
  saves the note at once, so the task is in the Trash. A pasted task block keeps
  its id when it was cut in this project (the note save brings the task back,
  in its new place: a move); otherwise it is a copy with a new id and the copied
  fields (open, without its completed days). Pasting into another project always
  copies. A block whose task exists nowhere is not pasted. Duplicating a block
  copies its tasks. In a diary pasted tasks become tasks of that day's diary and
  show in its task section, not as blocks.
- `- [ ]` and `- [x]` lines (plain text, Markdown, the Markdown source view)
  become new tasks; `[x]` is completed. A task line of the Markdown source that
  carries its task id stays that task, and a changed title is written to it.
- Partial and cross-block replacements retain unselected prefix/suffix text.
  A pasted heading or code block does not absorb the trailing paragraph text.
- Table cell spans and anchor links remain present in saved editor content.
- An image-only clipboard (a screenshot, or an image copied from a browser) becomes
  image blocks stored in the note's sidecar folder. A paste that also carries text
  (for example a Word selection) keeps the ordinary HTML path. Pisi image blocks
  copied between notes keep their reference and their file is copied into the
  target note's sidecar.

Paste uses the ordinary editor input, save and undo/redo pipeline. The Electron
suite tests the real paste handler with Word/web HTML, Markdown, Pisi blocks,
plain text, unsafe markup, tables, Unicode, code whitespace, selections and
undo/redo. The pure parser and link policy also have unit tests.
