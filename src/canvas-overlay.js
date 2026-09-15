/**
 * canvas-overlay.js – Fabric.js transparent canvas overlay for annotations.
 */
import { fabric } from 'fabric';
import * as state from './app.js';

let canvas = null;
let isDrawing = false;
let drawStart = null;
let tempShape = null;
let currentTool = 'select';
let textPlacementMode = false;

/**
 * Set text placement mode — next canvas click adds text.
 */
export function setTextPlacementMode(enabled) {
  textPlacementMode = enabled;
}

/**
 * Initialise the Fabric.js canvas on top of the PDF canvas.
 */
export function initFabricCanvas() {
  console.log('[PDF-ED] initFabricCanvas called');
  const el = document.getElementById('fabric-canvas');
  if (!el) {
    console.error('[PDF-ED] fabric-canvas element NOT found');
    return null;
  }
  console.log('[PDF-ED] fabric-canvas element found:', el.offsetWidth, 'x', el.offsetHeight);

  try {
    canvas = new fabric.Canvas(el, {
      isDrawingMode: false,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
    });
    console.log('[PDF-ED] Fabric canvas created. Size:', canvas.getWidth(), 'x', canvas.getHeight());

    // Size the Fabric canvas to match the PDF canvas
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (pdfCanvas && pdfCanvas.width > 0) {
      canvas.setWidth(pdfCanvas.width);
      canvas.setHeight(pdfCanvas.height);
      console.log('[PDF-ED] Sized to pdf-canvas:', pdfCanvas.width, 'x', pdfCanvas.height);
    } else {
      console.log('[PDF-ED] pdf-canvas not ready, using fallback size');
      const viewer = document.getElementById('viewer-container');
      if (viewer) {
        canvas.setWidth(viewer.clientWidth - 40);
        canvas.setHeight(viewer.clientHeight - 40);
      }
    }

    // Ensure the canvas-container wrapper is properly positioned
    const container = canvas.wrapperEl;
    if (container) {
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.zIndex = '10';
      container.style.width = canvas.getWidth() + 'px';
      container.style.height = canvas.getHeight() + 'px';
      console.log('[PDF-ED] Wrapper sized:', container.style.width, 'x', container.style.height);
    }

    // Debug: check upper-canvas (the one that captures events)
    const upperCanvas = canvas.upperCanvasEl;
    if (upperCanvas) {
      console.log('[PDF-ED] Upper canvas:', upperCanvas.width, 'x', upperCanvas.height);
      console.log('[PDF-ED] Upper canvas z-index:', getComputedStyle(upperCanvas).zIndex);
      console.log('[PDF-ED] Upper canvas pointer-events:', getComputedStyle(upperCanvas).pointerEvents);
    } else {
      console.log('[PDF-ED] WARNING: No upper canvas found!');
    }

    state.setFabricCanvas(canvas);

    // Track mouse events
    canvas.on('mouse:down', (opt) => {
      console.log('[PDF-ED] mouse:down fired! tool:', state.activeTool);
      onMouseDown(opt);
    });
    canvas.on('mouse:down', eraserDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    // Double-click to edit text objects
    canvas.on('mouse:dblclick', (opt) => {
      if (opt.target && opt.target.type === 'i-text') {
        canvas.setActiveObject(opt.target);
        opt.target.enterEditing();
        canvas.renderAll();
      }
    });

    canvas.on('object:modified', () => state.emit('annotationChanged'));
    canvas.on('object:added', () => state.emit('annotationChanged'));

    console.log('[PDF-ED] Fabric canvas init complete');
    return canvas;
  } catch (err) {
    console.error('[PDF-ED] FAILED to init Fabric.js canvas:', err);
    return null;
  }
}

/**
 * Load saved annotations for a given page.
 */
export function loadAnnotations(pageKey) {
  if (!canvas) return;
  canvas.clear();
  canvas.backgroundColor = 'transparent';
  const saved = state.pageAnnotations[pageKey];
  if (saved) {
    canvas.loadFromJSON(saved, () => canvas.renderAll());
  }
}

/**
 * Save current canvas state for the given page key.
 */
export function saveAnnotations(pageKey) {
  if (!canvas) return;
  state.pageAnnotations[pageKey] = JSON.stringify(canvas.toJSON());
}

/**
 * Get the page key from global page index.
 */
export function pageKey(idx) {
  const p = state.pages[idx];
  return p ? `${p.pdfIndex}_${p.pageIndex}` : `page_${idx}`;
}

// ---- Tool switching ----

export function applyTool(tool) {
  if (!canvas) return;
  currentTool = tool;
  textPlacementMode = false; // cancel text placement on any tool change
  canvas.isDrawingMode = false;
  canvas.selection = tool === 'select';
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = 'default';

  // Toggle text layer: only selectable in 'select' mode
  const textLayer = document.getElementById('text-layer');
  if (textLayer) {
    textLayer.classList.toggle('text-select-mode', tool === 'select');
  }

  // In 'select' mode, hide Fabric canvas completely so text layer receives clicks
  // In other modes, show it for drawing/adding objects
  const wrapperEl = canvas.wrapperEl;
  const isSelect = tool === 'select';
  if (wrapperEl) {
    wrapperEl.style.display = isSelect ? 'none' : '';
  }

  // Remove temp listeners
  canvas.off('path:created');

  switch (tool) {
    case 'select':
      canvas.selection = true;
      canvas.defaultCursor = 'default';
      canvas.forEachObject((o) => { o.selectable = true; o.evented = true; });
      break;
    case 'pen':
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.color = document.getElementById('opt-stroke-color').value;
      canvas.freeDrawingBrush.width = parseInt(document.getElementById('opt-stroke-width').value, 10);
      canvas.freeDrawingBrush.opacity = parseFloat(document.getElementById('opt-opacity').value);
      canvas.forEachObject((o) => { o.selectable = false; o.evented = false; });
      canvas.on('path:created', () => state.emit('annotationChanged'));
      break;
    case 'highlighter':
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.color = 'rgba(255,255,0,0.35)';
      canvas.freeDrawingBrush.width = parseInt(document.getElementById('opt-stroke-width').value, 10) * 3;
      canvas.forEachObject((o) => { o.selectable = false; o.evented = false; });
      canvas.on('path:created', () => state.emit('annotationChanged'));
      break;
    case 'eraser':
      canvas.forEachObject((o) => { o.selectable = true; o.evented = true; });
      break;
    case 'rect':
    case 'circle':
    case 'line':
      canvas.forEachObject((o) => { o.selectable = false; o.evented = false; });
      canvas.defaultCursor = 'crosshair';
      break;
    case 'text':
    case 'image':
      canvas.forEachObject((o) => { o.selectable = true; o.evented = true; });
      canvas.defaultCursor = 'default';
      break;
  }
}

// ---- Shape drawing ----

function onMouseDown(opt) {
  const tool = state.activeTool;
  const target = opt.target; // what was clicked on

  // Text tool: place text on empty space, but let existing objects be selected
  if (tool === 'text') {
    // If clicked on an existing object, let Fabric.js handle selection
    if (target) return;
    // Place new text on empty space
    const pointer = canvas.getPointer(opt.e);
    addText({
      left: pointer.x, top: pointer.y,
      font: document.getElementById('opt-font').value,
      fontSize: parseInt(document.getElementById('opt-font-size').value, 10),
      color: document.getElementById('opt-text-color').value,
      bold: document.getElementById('opt-bold').checked,
      italic: document.getElementById('opt-italic').checked,
    });
    // Switch to select mode so user can edit the text they just placed
    state.setActiveTool('select');
    return;
  }

  // Text placement mode (from keyboard shortcut)
  if (textPlacementMode) {
    textPlacementMode = false;
    const pointer = canvas.getPointer(opt.e);
    addText({
      left: pointer.x, top: pointer.y,
      font: document.getElementById('opt-font').value,
      fontSize: parseInt(document.getElementById('opt-font-size').value, 10),
      color: document.getElementById('opt-text-color').value,
      bold: document.getElementById('opt-bold').checked,
      italic: document.getElementById('opt-italic').checked,
    });
    return;
  }

  if (!['rect', 'circle', 'line'].includes(tool)) return;

  isDrawing = true;
  const pointer = canvas.getPointer(opt.e);
  drawStart = { x: pointer.x, y: pointer.y };

  const color = document.getElementById('opt-stroke-color').value;
  const sw = parseInt(document.getElementById('opt-stroke-width').value, 10);

  if (tool === 'rect') {
    tempShape = new fabric.Rect({
      left: pointer.x, top: pointer.y,
      width: 0, height: 0,
      fill: 'transparent', stroke: color, strokeWidth: sw,
      selectable: false, evented: false,
    });
  } else if (tool === 'circle') {
    tempShape = new fabric.Ellipse({
      left: pointer.x, top: pointer.y,
      rx: 0, ry: 0,
      fill: 'transparent', stroke: color, strokeWidth: sw,
      selectable: false, evented: false,
    });
  } else if (tool === 'line') {
    tempShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
      stroke: color, strokeWidth: sw,
      selectable: false, evented: false,
    });
  }

  if (tempShape) canvas.add(tempShape);
}

function onMouseMove(opt) {
  if (!isDrawing || !tempShape) return;
  const pointer = canvas.getPointer(opt.e);
  const tool = state.activeTool;

  if (tool === 'rect') {
    tempShape.set({
      left: Math.min(drawStart.x, pointer.x),
      top: Math.min(drawStart.y, pointer.y),
      width: Math.abs(pointer.x - drawStart.x),
      height: Math.abs(pointer.y - drawStart.y),
    });
  } else if (tool === 'circle') {
    tempShape.set({
      left: Math.min(drawStart.x, pointer.x),
      top: Math.min(drawStart.y, pointer.y),
      rx: Math.abs(pointer.x - drawStart.x) / 2,
      ry: Math.abs(pointer.y - drawStart.y) / 2,
    });
  } else if (tool === 'line') {
    tempShape.set({ x2: pointer.x, y2: pointer.y });
  }
  canvas.renderAll();
}

function onMouseUp() {
  if (isDrawing && tempShape) {
    tempShape.set({ selectable: true, evented: true });
    canvas.setActiveObject(tempShape);
    state.emit('annotationChanged');
  }
  isDrawing = false;
  drawStart = null;
  tempShape = null;
}

// ---- Eraser ----

function eraserDown(opt) {
  if (currentTool !== 'eraser') return;
  if (opt.target) {
    canvas.remove(opt.target);
    canvas.renderAll();
    state.emit('annotationChanged');
  }
}

// ---- Public helpers for adding objects ----

/**
 * Add a text box.
 */
export function addText(opts = {}) {
  const text = new fabric.IText(opts.text || 'Double-click to edit', {
    left: opts.left || 50,
    top: opts.top || 50,
    fontFamily: opts.font || 'Helvetica',
    fontSize: opts.fontSize || 16,
    fill: opts.color || '#000000',
    fontWeight: opts.bold ? 'bold' : 'normal',
    fontStyle: opts.italic ? 'italic' : 'normal',
    editable: true,
  });
  canvas.add(text);
  canvas.setActiveObject(text);
  state.emit('annotationChanged');
}

/**
 * Add an image from a data URL.
 */
export function addImage(dataUrl, opts = {}) {
  fabric.Image.fromURL(dataUrl, (img) => {
    const maxW = canvas.width * 0.5;
    const maxH = canvas.height * 0.5;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    img.set({
      left: opts.left || 50,
      top: opts.top || 50,
      scaleX: scale,
      scaleY: scale,
      opacity: opts.opacity || 1,
    });
    canvas.add(img);
    canvas.setActiveObject(img);
    state.emit('annotationChanged');
  }, { crossOrigin: 'anonymous' });
}

/**
 * Export the canvas to a PNG data URL.
 */
export function toDataURL() {
  if (!canvas) return null;
  return canvas.toDataURL({ format: 'png', multiplier: 2 });
}

/**
 * Clear the canvas.
 */
export function clearCanvas() {
  if (!canvas) return;
  canvas.clear();
  canvas.backgroundColor = 'transparent';
  canvas.renderAll();
}
