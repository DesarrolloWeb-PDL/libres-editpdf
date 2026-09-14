/**
 * text-edit.js – Redact & replace PDF text.
 * When user selects text in the text layer, show a popup.
 * Clicking "Edit Text" whites out the selection and adds editable text on top.
 */
import * as state from './app.js';
import { fabric } from 'fabric';

const popup = document.getElementById('edit-text-popup');
const btnEdit = document.getElementById('btn-edit-selected');
let pendingSelection = null;

/**
 * Initialize text editing. Call once after DOM ready.
 */
export function initTextEdit() {
  const textLayer = document.getElementById('text-layer');
  if (!textLayer) return;

  // Listen for text selection on the text layer
  document.addEventListener('mouseup', checkTextSelection);
  document.addEventListener('keyup', checkTextSelection);

  // Edit button click
  btnEdit.addEventListener('click', () => {
    if (pendingSelection) {
      redactAndReplace(pendingSelection);
      hidePopup();
    }
  });
}

function checkTextSelection() {
  // Only show popup when in select mode
  if (state.activeTool !== 'select') {
    hidePopup();
    return;
  }

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
    // Don't hide immediately — user might be clicking the button
    setTimeout(() => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.toString().trim() === '') {
        hidePopup();
      }
    }, 200);
    return;
  }

  // Check if selection is inside the text layer
  const range = sel.getRangeAt(0);
  const textLayer = document.getElementById('text-layer');
  if (!textLayer.contains(range.commonAncestorContainer)) {
    hidePopup();
    return;
  }

  // Get bounding rect of the selection
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    hidePopup();
    return;
  }

  pendingSelection = {
    text: sel.toString(),
    rect: rect,
    range: range.cloneRange(),
  };

  // Position popup above the selection
  showPopup(rect);
}

function showPopup(selectionRect) {
  const viewerRect = document.getElementById('viewer-container').getBoundingClientRect();

  popup.style.left = (selectionRect.left + selectionRect.width / 2 - 60) + 'px';
  popup.style.top = (selectionRect.top - 40) + 'px';
  popup.classList.remove('hidden');
}

function hidePopup() {
  popup.classList.add('hidden');
  pendingSelection = null;
}

/**
 * Redact (white rectangle) the selected text and add editable text on top.
 */
function redactAndReplace(selection) {
  if (!state.fabricCanvas) return;

  const canvas = state.fabricCanvas;
  const viewerEl = document.getElementById('viewer-container');
  const viewerRect = viewerEl.getBoundingClientRect();

  // Convert screen coordinates to canvas coordinates
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const wrapperRect = canvasWrapper.getBoundingClientRect();

  // The selection rect is in screen coords — convert to canvas coords
  const canvasLeft = selection.rect.left - wrapperRect.left;
  const canvasTop = selection.rect.top - wrapperRect.top;
  const canvasWidth = selection.rect.width;
  const canvasHeight = selection.rect.height;

  // Scale factor: canvas internal size vs displayed size
  const scaleX = canvas.getWidth() / wrapperRect.width;
  const scaleY = canvas.getHeight() / wrapperRect.height;

  const x = canvasLeft * scaleX;
  const y = canvasTop * scaleY;
  const w = canvasWidth * scaleX;
  const h = canvasHeight * scaleY;

  // 1. Add white rectangle (redaction)
  const redaction = new fabric.Rect({
    left: x,
    top: y,
    width: w,
    height: h + 2, // slight padding
    fill: '#ffffff',
    stroke: 'transparent',
    selectable: false,
    evented: false,
  });
  canvas.add(redaction);

  // 2. Determine text properties from the selection
  // Try to detect font size from the text layer span
  let fontSize = 14;
  let fontFamily = 'Helvetica';
  const sel = window.getSelection();
  if (sel && sel.anchorNode) {
    const parentSpan = sel.anchorNode.parentElement;
    if (parentSpan && parentSpan.tagName === 'SPAN') {
      const computed = getComputedStyle(parentSpan);
      fontSize = parseFloat(computed.fontSize) || 14;
      fontFamily = computed.fontFamily || 'Helvetica';
    }
  }

  // Scale font size to canvas coordinates
  const scaledFontSize = fontSize * Math.min(scaleX, scaleY);

  // 3. Add editable text on top
  const text = new fabric.IText(selection.text, {
    left: x + 2,
    top: y + 1,
    fontFamily: fontFamily,
    fontSize: scaledFontSize,
    fill: '#000000',
    selectable: true,
    evented: true,
    editable: true,
  });
  canvas.add(text);
  canvas.setActiveObject(text);

  // Clear the browser text selection
  sel.removeAllRanges();

  state.emit('annotationChanged');
  canvas.renderAll();
}
