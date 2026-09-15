/**
 * text-edit.js – Click-to-edit PDF text.
 * Listens for clicks on the document. If click is over a text layer span,
 * whites out that line and replaces with editable text.
 */
import * as state from './app.js';
import { fabric } from 'fabric';

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

    editSpanText(clickedSpan);
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
function editSpanText(span) {
  if (!state.fabricCanvas) return;
  const canvas = state.fabricCanvas;

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
  const scaledFontSize = fontSize * Math.min(scaleX, scaleY);

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
  });
  canvas.add(redaction);

  // 2. Editable text
  const text = new fabric.IText(span.textContent.trim(), {
    left: x,
    top: y,
    fontFamily: fontFamily,
    fontSize: scaledFontSize,
    fill: '#000000',
    selectable: true,
    evented: true,
    editable: true,
    width: w,
  });
  canvas.add(text);
  canvas.setActiveObject(text);

  state.emit('annotationChanged');
  canvas.renderAll();
}
