# PDF Editor

100% frontend PDF editor — no backend, no database. Runs entirely in the browser.

## Features

- **View** — Render PDF pages with zoom, fit-to-width, fit-to-page
- **Navigate** — Page thumbnails, prev/next, direct page jump, arrow keys
- **Edit annotations** — Text, pen, highlighter, rectangles, circles, lines, images
- **Eraser** — Remove annotations
- **Page operations** — Rotate (90°/180°), delete, duplicate
- **Reorder** — Drag & drop thumbnails to reorder pages
- **Split** — Extract selected pages, split by range, split every N pages
- **Merge** — Combine multiple PDFs into one
- **Export** — Download edited PDF with flattened annotations
- **Undo/Redo** — Full history with Ctrl+Z / Ctrl+Y

## Stack

- [Vite](https://vitejs.dev/) — build tool
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF rendering
- [pdf-lib](https://pdf-lib.org/) — PDF manipulation (rotate, split, merge, export)
- [Fabric.js](http://fabricjs.com/) — annotation canvas overlay

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
