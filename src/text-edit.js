/**
 * text-edit.js – Click-to-edit PDF text.
 * When user clicks on a text span in the text layer,
 * whites out that line and replaces with editable text.
 */
import * as state from './app.js';
import { fabric } from 'fabric';

/**
 * Initialize text editing. Call once after DOM ready.
 */
export function initTextEdit() {
  const textLayer = document.getElementById('text-layer');
  if (!textLayer) return;

  // Click on a text span → edit that line
  textLayer.addEventListener('click', (e) => {
    if (state.activeTool !== 'select') return;

    const span = e.target;
    if (!span || span.tagName !== 'SPAN' || !span.textContent.trim()) return;
    e.preventDefault();
    e.stopPropagation();

    editSpanText(span);
  });

  // Prevent double-click from selecting text (we handle it ourselves)
  textLayer.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
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
