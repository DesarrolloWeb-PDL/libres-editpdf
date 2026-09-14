/**
 * pdf-loader.js – Load PDF files via pdf.js, extract basic metadata.
 */
import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker — use a Worker directly to avoid Vite's ?import issue
pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
  new URL('/pdf.worker.mjs', import.meta.url),
  { type: 'module' }
);

/**
 * Load a single PDF file (ArrayBuffer) and return metadata.
 * CLONES the input buffer because pdf.js transfers it to a web worker
 * via Transferable, which detaches the original ArrayBuffer.
 * @param {ArrayBuffer} data
 * @param {string} name
 * @returns {Promise<{name:string, pdfBytes:ArrayBuffer, doc:any}>}
 */
export async function loadPDF(data, name) {
  try {
    // CRITICAL: clone before pdf.js detaches the original via Transferable
    const pdfBytes = data.slice(0);

    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytes.slice(0)),
      verbosity: 0,
    }).promise;

    return { name, pdfBytes, doc };
  } catch (err) {
    console.error('pdf-loader: failed to load PDF:', err);
    throw new Error(`Cannot load "${name}": ${err.message}`);
  }
}

/**
 * Render a single page to a canvas for thumbnail / display.
 * @param {any} doc  pdf.js document
 * @param {number} pageNum  1-based page number
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale
 */
export async function renderPageToCanvas(doc, pageNum, canvas, scale = 1) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
}

/**
 * Render a page and return a data-URL PNG string.
 * @returns {Promise<string>}
 */
export async function renderPageToDataURL(doc, pageNum, scale = 0.25) {
  const canvas = document.createElement('canvas');
  await renderPageToCanvas(doc, pageNum, canvas, scale);
  return canvas.toDataURL('image/png');
}
