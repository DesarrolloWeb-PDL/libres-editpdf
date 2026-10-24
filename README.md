# PDF Editor

100% frontend PDF editor — no backend, no database. Runs entirely in the browser.

## Features

- **Interface languages** — Spanish (default), Portuguese, and English, with the selection saved in the browser
- **View** — Render PDF pages with zoom, fit-to-width, fit-to-page
- **Navigate** — Page thumbnails, prev/next, direct page jump, arrow keys
- **Edit annotations** — Text, pen, highlighter, rectangles, circles, lines, images
- **Text replacement** — Replace supported native PDF text, or cover an area and write over image-based or unsupported text
- **Eraser** — Remove annotations
- **Page operations** — Rotate (90°/180°), delete, duplicate
- **Reorder** — Drag & drop thumbnails to reorder pages
- **Split** — Extract selected pages, split by range or page count, or detect and review document sections
- **Merge** — Combine multiple PDFs into one
- **Export** — Download edited PDF with flattened annotations
- **Undo/Redo** — Full history with Ctrl+Z / Ctrl+Y

## Stack

- [Vite](https://vitejs.dev/) — build tool
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF rendering
- [pdf-lib](https://pdf-lib.org/) — PDF manipulation (rotate, split, merge, export)
- [Fabric.js](http://fabricjs.com/) — annotation canvas overlay

### Splitting a long document by section

Use **Detect sections** to analyze a single PDF locally. The editor checks PDF bookmarks and
prominent headings, then lets you review section names and start pages before preparing separate
PDFs. Each section is prepared on demand and downloaded individually.

If local detection needs help, **Review with online AI** is optional. It requires an OpenAI
Chat Completions-compatible endpoint, model, API key, and explicit consent. The key is not saved;
the first 1,200 extracted characters of each page are sent in batches to that endpoint. The key is
accessible to the browser while in use; for a public deployment, use a protected backend proxy
instead of entering a personal key. Scanned documents need OCR before AI can analyze their text.
AI suggestions must be reviewed before export.

### Replacing text

To edit native PDF text, stay in Select mode and click a selectable text span. Supported content is
rewritten in the PDF; unsupported or ambiguous content is rejected. Some embedded fonts only allow
replacement glyphs with matching widths.

For image-based text or unsupported content, use **Cover and write** and drag a rectangle over the
area. Choose a solid cover color and enter the new text. This is a visual overlay, not a native text
edit; it may not blend into textured backgrounds and is not a secure-redaction feature. **Add text**
continues to place text without covering the original.

## Run locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`.

## Build

```bash
npm run build
```

Output in `dist/`.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USER/pdf-editor)
