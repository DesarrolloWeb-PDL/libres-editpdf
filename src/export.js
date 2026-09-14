/**
 * export.js – Export the edited PDF by flattening annotations with pdf-lib.
 */
import { PDFDocument } from 'pdf-lib';
import * as state from './app.js';
import { showToast, setLoading, downloadBuffer } from './utils.js';
import { pageKey } from './canvas-overlay.js';
import { saveCurrentPageAnnotations } from './thumbnail-panel.js';

/**
 * Build the final PDF and trigger a download.
 */
export async function exportPDF() {
  if (state.pages.length === 0) {
    showToast('No pages to export', 'error');
    return;
  }

  setLoading(true, 'Exporting PDF...');
  state.emit('exportStarted');

  try {
    // Save current page annotations before exporting
    saveCurrentPageAnnotations();

    const outDoc = await PDFDocument.create();

    // Copy pages in the current order
    for (let i = 0; i < state.pages.length; i++) {
      const { pdfIndex, pageIndex } = state.pages[i];
      const srcBytes = state.pdfs[pdfIndex].pdfBytes;

      // Load fresh copy for each source PDF
      const loadBytes = srcBytes instanceof Uint8Array
        ? new Uint8Array(srcBytes)
        : new Uint8Array(srcBytes.slice(0));

      const srcDoc = await PDFDocument.load(loadBytes);
      const [copied] = await outDoc.copyPages(srcDoc, [pageIndex]);
      outDoc.addPage(copied);
    }

    // Flatten annotations: render overlay PNG and embed on each page
    for (let i = 0; i < state.pages.length; i++) {
      const key = pageKey(i);
      const annotationJson = state.pageAnnotations[key];
      if (!annotationJson) continue;

      const parsed = JSON.parse(annotationJson);
      if (!parsed.objects || parsed.objects.length === 0) continue;

      const overlayDataUrl = await renderOverlayToPNG(i, annotationJson);
      if (!overlayDataUrl) continue;

      const pngBytes = dataURLToBytes(overlayDataUrl);
      const pngImage = await outDoc.embedPng(pngBytes);
      const page = outDoc.getPage(i);
      const { width, height } = page.getSize();

      page.drawImage(pngImage, {
        x: 0, y: 0, width, height, opacity: 1,
      });
    }

    const pdfBytes = await outDoc.save();
    downloadBuffer(pdfBytes, 'edited.pdf');
    showToast('PDF exported successfully', 'success');
  } catch (err) {
    console.error('Export error:', err);
    showToast('Export failed: ' + err.message, 'error');
  } finally {
    setLoading(false);
    state.emit('exportFinished');
  }
}

/**
 * Render fabric.js annotation JSON to a PNG data URL using a temporary canvas.
 */
async function renderOverlayToPNG(pageIdx, jsonStr) {
  const fabricModule = await import('fabric');
  const fabricNS = fabricModule.fabric || fabricModule.default || fabricModule;
  return new Promise((resolve) => {
    const tmpCanvas = document.createElement('canvas');
    const wrapper = document.getElementById('canvas-wrapper');
    tmpCanvas.width = parseInt(wrapper.style.width, 10) || 800;
    tmpCanvas.height = parseInt(wrapper.style.height, 10) || 600;

    const tmpFabric = new fabricNS.Canvas(tmpCanvas, {
      backgroundColor: 'transparent',
      width: tmpCanvas.width,
      height: tmpCanvas.height,
    });

    tmpFabric.loadFromJSON(jsonStr, () => {
      if (tmpFabric.getObjects().length === 0) {
        resolve(null);
        return;
      }
      tmpFabric.renderAll();
      const dataUrl = tmpCanvas.toDataURL({ format: 'png', multiplier: 2 });
      tmpFabric.dispose();
      resolve(dataUrl);
    });
  });
}

/**
 * Convert a data URL to a Uint8Array of the raw image bytes.
 */
function dataURLToBytes(dataURL) {
  const base64 = dataURL.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
