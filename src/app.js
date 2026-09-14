/**
 * Central application state and event bus.
 * Every module reads/writes through this single object.
 */

/** @type {Array<{name:string, pdfBytes:ArrayBuffer, doc:any, pageImages:string[]}>} */
export const pdfs = [];

/** @type {Array<{pdfIndex:number, pageIndex:number}>} */
export let pages = [];

export let currentPageIndex = 0;
export let zoom = 1.0;
export let selectedPages = new Set();
export let activeTool = 'select';
export let historyStack = [];
export let historyIndex = -1;

/** Fabric.js canvas instance – set once after init. */
export let fabricCanvas = null;

/** Per-page fabric JSON snapshots for undo/redo. */
export const pageAnnotations = {};

let listeners = {};

/**
 * Simple event emitter.
 */
export function on(event, fn) {
  (listeners[event] ||= []).push(fn);
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter((f) => f !== fn);
}

export function emit(event, data) {
  (listeners[event] || []).forEach((fn) => fn(data));
}

/**
 * Push a snapshot into the undo history.
 */
export function pushHistory() {
  const snapshot = {
    pages: pages.map((p) => ({ ...p })),
    currentPageIndex,
    annotations: JSON.parse(JSON.stringify(pageAnnotations)),
  };
  historyStack = historyStack.slice(0, historyIndex + 1);
  historyStack.push(snapshot);
  historyIndex = historyStack.length - 1;
  emit('historyChanged');
}

/**
 * Restore state from a history snapshot.
 */
export function restoreSnapshot(snapshot) {
  pages = snapshot.pages.map((p) => ({ ...p }));
  currentPageIndex = snapshot.currentPageIndex;
  Object.keys(pageAnnotations).forEach((k) => delete pageAnnotations[k]);
  Object.assign(pageAnnotations, JSON.parse(JSON.stringify(snapshot.annotations)));
  recalcTotal();
  emit('pagesChanged');
  emit('historyChanged');
}

export function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreSnapshot(historyStack[historyIndex]);
}

export function redo() {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  restoreSnapshot(historyStack[historyIndex]);
}

/**
 * Rebuild the flat pages list from all loaded PDFs.
 */
export function rebuildPages() {
  pages = [];
  pdfs.forEach((pdf, pi) => {
    for (let i = 0; i < pdf.doc.numPages; i++) {
      pages.push({ pdfIndex: pi, pageIndex: i });
    }
  });
  currentPageIndex = Math.min(currentPageIndex, Math.max(0, pages.length - 1));
  selectedPages.clear();
  emit('pagesChanged');
}

/**
 * Recalculate total after in-place mutations.
 */
export function recalcTotal() {
  emit('pagesChanged');
}

export function setZoom(z) {
  zoom = z;
  emit('zoomChanged');
}

export function setCurrentPage(idx) {
  currentPageIndex = clamp(idx, 0, pages.length - 1);
  emit('pageChanged');
}

export function toggleSelectPage(idx) {
  if (selectedPages.has(idx)) selectedPages.delete(idx);
  else selectedPages.add(idx);
  emit('selectionChanged');
}

export function selectPage(idx) {
  selectedPages.clear();
  selectedPages.add(idx);
  emit('selectionChanged');
}

export function deselectAll() {
  selectedPages.clear();
  emit('selectionChanged');
}

export function selectAll() {
  pages.forEach((_, i) => selectedPages.add(i));
  emit('selectionChanged');
}

export function setActiveTool(tool) {
  activeTool = tool;
  emit('toolChanged');
}

export function setFabricCanvas(c) {
  fabricCanvas = c;
}

export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
