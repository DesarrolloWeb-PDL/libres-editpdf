/**
 * pdf-renderer.js – Render the current page into the main viewer canvas.
 */
import * as pdfjsLib from 'pdfjs-dist';
import * as state from './app.js';

const pdfCanvas = document.getElementById('pdf-canvas');
const canvasWrapper = document.getElementById('canvas-wrapper');

let rendering = false;

/**
 * Render the page at `state.currentPageIndex` at the current zoom.
 */
export async function renderCurrentPage() {
  if (rendering) return;
  if (state.pages.length === 0) return;

  rendering = true;
  try {
    const { pdfIndex, pageIndex } = state.pages[state.currentPageIndex];
    const pdf = state.pdfs[pdfIndex];
    if (!pdf || !pdf.doc) {
      console.warn('renderCurrentPage: pdf doc not available');
      return;
    }
    const pageNum = pageIndex + 1; // pdf.js uses 1-based
    const doc = pdf.doc;
    const page = await doc.getPage(pageNum);

    const baseViewport = page.getViewport({ scale: 1 });
    const scale = state.zoom * getScaleFactor(baseViewport.width, baseViewport.height);
    const viewport = page.getViewport({ scale });

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    canvasWrapper.style.width = viewport.width + 'px';
    canvasWrapper.style.height = viewport.height + 'px';

    const ctx = pdfCanvas.getContext('2d');
    ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Sync fabric canvas size
    if (state.fabricCanvas) {
      state.fabricCanvas.setWidth(viewport.width);
      state.fabricCanvas.setHeight(viewport.height);
      state.fabricCanvas.renderAll();
    }
  } catch (err) {
    console.error('renderCurrentPage error:', err);
  } finally {
    rendering = false;
  }
}

/**
 * Calculate a scale so the page fits the viewer area nicely.
 */
function getScaleFactor(w, h) {
  const container = document.getElementById('viewer-container');
  const cw = container.clientWidth - 40;
  const ch = container.clientHeight - 40;
  const ratioW = cw / w;
  const ratioH = ch / h;
  return Math.min(ratioW, ratioH);
}

/**
 * Fit to width.
 */
export function fitWidth() {
  if (state.pages.length === 0) return;
  const { pdfIndex, pageIndex } = state.pages[state.currentPageIndex];
  const doc = state.pdfs[pdfIndex]?.doc;
  if (!doc) return;
  doc.getPage(pageIndex + 1).then((page) => {
    const vp = page.getViewport({ scale: 1 });
    const container = document.getElementById('viewer-container');
    state.setZoom((container.clientWidth - 40) / vp.width);
    renderCurrentPage();
  }).catch(err => console.error('fitWidth error:', err));
}

/**
 * Fit entire page in view.
 */
export function fitPage() {
  if (state.pages.length === 0) return;
  const { pdfIndex, pageIndex } = state.pages[state.currentPageIndex];
  const doc = state.pdfs[pdfIndex]?.doc;
  if (!doc) return;
  doc.getPage(pageIndex + 1).then((page) => {
    const vp = page.getViewport({ scale: 1 });
    const container = document.getElementById('viewer-container');
    const cw = container.clientWidth - 40;
    const ch = container.clientHeight - 40;
    state.setZoom(Math.min(cw / vp.width, ch / vp.height));
    renderCurrentPage();
  }).catch(err => console.error('fitPage error:', err));
}
