/**
 * text-edit.js – Click-to-edit PDF text.
 * Listens for clicks on the document. If click is over a text layer span,
 * whites out that line and replaces with editable text.
 */
import * as state from './app.js';
import { fabric } from 'fabric';
import { showModal, showToast } from './utils.js';
import { saveCurrentPageAnnotations } from './thumbnail-panel.js';
import { pageKey } from './canvas-overlay.js';
import { t } from './i18n.js';

/**
 * Initialize text editing. Call once after DOM ready.
 */
export function initTextEdit() {
  // Use document-level click to bypass z-index stacking issues
  document.addEventListener('click', (e) => {
    if (state.activeTool !== 'select') return;
    if (!state.fabricCanvas) return;

    // Check if click is over the text layer
    const textLayer = document.getElementById('text-layer');
    if (!textLayer) return;

    // Find if there's a text layer span under the click
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;

    // Walk up from target to find a span inside text-layer
    let span = target;
    while (span && span !== textLayer && span !== document.body) {
      span = span.parentElement;
    }
    if (span !== textLayer) return; // click was not on text layer

    // The actual span clicked is the one under the cursor
    const clickedSpan = getSpanAtPoint(e.clientX, e.clientY, textLayer);
    if (!clickedSpan || !clickedSpan.textContent.trim()) return;

    e.preventDefault();
    e.stopPropagation();

    editSpanText(clickedSpan).catch((err) => {
      console.error('Text edit error:', err);
      showToast(t('text.editFailed', { error: err.message }), 'error');
    });
  }, true); // capture phase to run before Fabric.js
}

/**
 * Find the text layer span at given screen coordinates.
 */
function getSpanAtPoint(x, y, textLayer) {
  // Temporarily make the text layer pointer-events:auto to use elementFromPoint
  const prev = textLayer.style.pointerEvents;
  textLayer.style.pointerEvents = 'auto';

  // Hide upper canvas temporarily
  const upperCanvas = document.querySelector('.upper-canvas');
  const wrapper = document.querySelector('.canvas-container');
  const pdfCanvas = document.getElementById('pdf-canvas');
  if (upperCanvas) upperCanvas.style.pointerEvents = 'none';
  if (wrapper) wrapper.style.pointerEvents = 'none';
  if (pdfCanvas) pdfCanvas.style.pointerEvents = 'none';

  const el = document.elementFromPoint(x, y);

  // Restore
  textLayer.style.pointerEvents = prev;
  if (upperCanvas) upperCanvas.style.pointerEvents = '';
  if (wrapper) wrapper.style.pointerEvents = '';
  if (pdfCanvas) pdfCanvas.style.pointerEvents = '';

  if (el && el.tagName === 'SPAN' && textLayer.contains(el)) {
    return el;
  }
  return null;
}

/**
 * Redact a single text span and replace with editable Fabric.js text.
 */
async function editSpanText(span) {
  if (!state.fabricCanvas) return;
  const canvas = state.fabricCanvas;
  const originalText = span.textContent.trim();
  if (!/^[\x20-\x7e]+$/.test(originalText)) {
    showToast(t('text.asciiOnly'), 'error');
    return;
  }

  const editDialog = showModal(
    t('text.editTitle'),
    `<label for="pdf-text-replacement">${t('text.replacement')}</label><input id="pdf-text-replacement" type="text" />`
  );
  const replacementInput = document.getElementById('pdf-text-replacement');
  replacementInput.value = originalText;
  replacementInput.focus();
  replacementInput.select();
  const accepted = await editDialog;
  if (!accepted) return;

  const replacementText = replacementInput.value;
  if (replacementText === originalText) return;
  if (!/^[\x20-\x7e]+$/.test(replacementText)) {
    showToast(t('text.replacementAsciiOnly'), 'error');
    return;
  }

  // Get the span's position relative to the canvas wrapper
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const wrapperRect = canvasWrapper.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();

  // Convert screen coords to canvas coords
  const scaleX = canvas.getWidth() / wrapperRect.width;
  const scaleY = canvas.getHeight() / wrapperRect.height;

  const x = (spanRect.left - wrapperRect.left) * scaleX;
  const y = (spanRect.top - wrapperRect.top) * scaleY;
  const w = spanRect.width * scaleX;
  const h = spanRect.height * scaleY;

  // Get font info from the span
  const computed = getComputedStyle(span);
  const fontSize = parseFloat(computed.fontSize) || 12;
  const fontFamily = computed.fontFamily || 'Helvetica';
  const color = computed.color || '#000000';
  const scaledFontSize = fontSize * Math.min(scaleX, scaleY);

  const key = pageKey(state.currentPageIndex);
  const edits = state.pageTextEdits[key] || [];
  if (edits.some((edit) => edit.originalText === originalText)) {
    showToast(t('text.alreadyEdited'), 'error');
    return;
  }

  saveCurrentPageAnnotations();
  state.pushHistory();

  // 1. White rectangle (redaction)
  const redaction = new fabric.Rect({
    left: x - 1,
    top: y - 1,
    width: w + 2,
    height: h + 2,
    fill: '#ffffff',
    stroke: 'transparent',
    selectable: false,
    evented: false,
    pdfTextEdit: true,
  });
  canvas.add(redaction);

  // 2. Preview the text that will replace the original content on export.
  const text = new fabric.IText(replacementText, {
    left: x,
    top: y,
    fontFamily: fontFamily,
    fontSize: scaledFontSize,
    fill: color,
    selectable: false,
    evented: false,
    width: w,
    pdfTextEdit: true,
  });
  canvas.add(text);

  state.pageTextEdits[key] = [
    ...edits,
    { originalText, replacementText },
  ];
  saveCurrentPageAnnotations();
  state.emit('annotationChanged');
  state.pushHistory();
  canvas.renderAll();
}
