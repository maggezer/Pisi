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
- Pisi copies get new block and task identities, with copied internal references
  remapped together. Native composite clipboard payloads keep their existing path.
- Partial and cross-block replacements retain unselected prefix/suffix text.
  A pasted heading or code block does not absorb the trailing paragraph text.
- Table cell spans and anchor links remain present in saved editor content.

Paste uses the ordinary editor input, save and undo/redo pipeline. The Electron
suite tests the real paste handler with Word/web HTML, Markdown, Pisi blocks,
plain text, unsafe markup, tables, Unicode, code whitespace, selections and
undo/redo. The pure parser and link policy also have unit tests.
