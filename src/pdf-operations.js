/**
 * pdf-operations.js – Structural PDF operations using pdf-lib.
 */
import { PDFDocument } from 'pdf-lib';
import * as state from './app.js';
import { showToast, setLoading } from './utils.js';
import { loadPDF } from './pdf-loader.js';
import { t } from './i18n.js';

/**
 * Get raw bytes from whatever pdf.pdfBytes currently holds.
 * Handles ArrayBuffer, Uint8Array, and detached buffers.
 * Always returns a fresh Uint8Array that pdf-lib can safely consume.
 */
function getValidBytes(source) {
  if (source instanceof Uint8Array) {
    // Uint8Array — clone to avoid pdf-lib detaching the original
    return new Uint8Array(source);
  }
  if (source instanceof ArrayBuffer) {
    if (source.byteLength === 0) throw new Error('ArrayBuffer is empty or detached');
    return new Uint8Array(source.slice(0));
  }
  throw new Error('Invalid pdfBytes type');
}

/**
 * Create a new PDFDocument from raw bytes.
 */
async function loadDoc(bytes) {
  const clone = getValidBytes(bytes);
  return PDFDocument.load(clone);
}

/**
 * After modifying a pdf-lib document, save bytes back into the pdf state
 * and reload the pdf.js document for rendering.
 */
async function saveAndReload(pdf, doc) {
  const savedBytes = await doc.save();
  // doc.save() returns Uint8Array — store it directly
  pdf.pdfBytes = savedBytes;
  // Reload pdf.js renderer with a fresh copy
  pdf.doc = (await loadPDF(savedBytes.slice(0), pdf.name)).doc;
}

/**
 * Rotate a single page by degrees (90, -90, 180).
 */
export async function rotatePage(pageGlobalIndex, degrees) {
  if (pageGlobalIndex < 0 || pageGlobalIndex >= state.pages.length) return;
  const { pdfIndex, pageIndex } = state.pages[pageGlobalIndex];
  const pdf = state.pdfs[pdfIndex];
  const doc = await loadDoc(pdf.pdfBytes);
  const page = doc.getPage(pageIndex);
  const current = page.getRotation().angle;
  page.setRotation((current + degrees + 360) % 360);
  await saveAndReload(pdf, doc);
  showToast(t('operation.rotated', { page: pageGlobalIndex + 1, degrees }), 'success');
  state.emit('pagesChanged');
}

/**
 * Delete a page by global index.
 */
export async function deletePage(pageGlobalIndex) {
  if (state.pages.length <= 1) {
    showToast(t('operation.cannotDeleteOnly'), 'error');
    return;
  }
  const { pdfIndex, pageIndex } = state.pages[pageGlobalIndex];
  const pdf = state.pdfs[pdfIndex];
  const doc = await loadDoc(pdf.pdfBytes);
  doc.removePage(pageIndex);
  await saveAndReload(pdf, doc);
  state.removePageTextEdits(pdfIndex, pageIndex);
  state.rebuildPages();
  showToast(t('operation.deleted', { page: pageGlobalIndex + 1 }), 'success');
}

/**
 * Duplicate a page by global index.
 */
export async function duplicatePage(pageGlobalIndex) {
  const { pdfIndex, pageIndex } = state.pages[pageGlobalIndex];
  const pdf = state.pdfs[pdfIndex];
  const srcDoc = await loadDoc(pdf.pdfBytes);

  // Create a single-page PDF with the duplicated page
  const singlePageDoc = await PDFDocument.create();
  const [copied] = await singlePageDoc.copyPages(srcDoc, [pageIndex]);
  singlePageDoc.addPage(copied);

  // Insert it into the original document
  const mergedDoc = await loadDoc(pdf.pdfBytes);
  const appended = await mergedDoc.copyPages(singlePageDoc, [0]);
  mergedDoc.insertPage(pageIndex + 1, appended[0]);
  await saveAndReload(pdf, mergedDoc);

  state.duplicatePageTextEdits(pdfIndex, pageIndex);
  state.rebuildPages();
  showToast(t('operation.duplicated', { page: pageGlobalIndex + 1 }), 'success');
}

/**
 * Split: extract selected pages into a new downloadable PDF.
 */
export async function splitSelected(selectedIndices) {
  if (selectedIndices.length === 0) {
    showToast(t('operation.selectPages'), 'error');
    return;
  }
  setLoading(true, t('operation.splittingPages'));
  try {
    const newDoc = await PDFDocument.create();
    const pageMap = selectedIndices.map((i) => state.pages[i]);

    // Group by pdfIndex
    const groups = {};
    pageMap.forEach(({ pdfIndex, pageIndex }) => {
      (groups[pdfIndex] ||= []).push(pageIndex);
    });

    for (const [pdfIdx, pageIndices] of Object.entries(groups)) {
      const srcDoc = await loadDoc(state.pdfs[pdfIdx].pdfBytes);
      const copied = await newDoc.copyPages(srcDoc, pageIndices);
      copied.forEach((p) => newDoc.addPage(p));
    }

    const bytes = await newDoc.save();
    downloadSplit(bytes, 'split.pdf');
    const key = selectedIndices.length === 1 ? 'operation.extractedOne' : 'operation.extracted';
    showToast(t(key, { count: selectedIndices.length }), 'success');
  } catch (err) {
    console.error('Split error:', err);
    showToast(t('operation.splitFailed', { error: err.message }), 'error');
  } finally {
    setLoading(false);
  }
}

/**
 * Split by range string, e.g. "1-3,5,7-10".
 */
export async function splitByRange(rangeStr) {
  setLoading(true, t('operation.splittingRange'));
  try {
    const indices = parseRange(rangeStr, state.pages.length);
    if (indices.length === 0) {
      showToast(t('operation.invalidRange'), 'error');
      setLoading(false);
      return;
    }
    await splitSelected(indices.map((i) => i - 1));
  } catch (err) {
    showToast(t('operation.rangeFailed', { error: err.message }), 'error');
  } finally {
    setLoading(false);
  }
}

/**
 * Split every N pages.
 */
export async function splitEveryN(n) {
  if (n < 1 || n > state.pages.length) {
    showToast(t('operation.invalidN'), 'error');
    return;
  }
  setLoading(true, t('operation.splitting'));
  try {
    for (let start = 0; start < state.pages.length; start += n) {
      const chunk = [];
      for (let i = start; i < Math.min(start + n, state.pages.length); i++) {
        chunk.push(i);
      }
      await splitSelected(chunk);
    }
    showToast(t('operation.splitComplete'), 'success');
  } catch (err) {
    showToast(t('operation.splitFailed', { error: err.message }), 'error');
  } finally {
    setLoading(false);
  }
}

/**
 * Merge all loaded PDFs in order.
 */
export async function mergeAll() {
  if (state.pdfs.length < 2) {
    showToast(t('operation.needTwoPdfs'), 'error');
    return;
  }
  setLoading(true, t('operation.merging'));
  try {
    const merged = await PDFDocument.create();
    for (const pdf of state.pdfs) {
      const srcDoc = await loadDoc(pdf.pdfBytes);
      const indices = srcDoc.getPageIndices();
      const copied = await merged.copyPages(srcDoc, indices);
      copied.forEach((p) => merged.addPage(p));
    }
    const bytes = await merged.save();
    downloadSplit(bytes, 'merged.pdf');
    showToast(t('operation.mergeSuccess'), 'success');
  } catch (err) {
    showToast(t('operation.mergeFailed', { error: err.message }), 'error');
  } finally {
    setLoading(false);
  }
}

// ---- Helpers ----

function downloadSplit(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Parse a range string like "1-3,5,7-10" into 1-based indices.
 */
function parseRange(str, max) {
  const result = new Set();
  str.split(',').forEach((part) => {
    part = part.trim();
    if (!part) return;
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) {
        if (i >= 1 && i <= max) result.add(i);
      }
    } else {
      const n = Number(part);
      if (n >= 1 && n <= max) result.add(n);
    }
  });
  return [...result].sort((a, b) => a - b);
}
