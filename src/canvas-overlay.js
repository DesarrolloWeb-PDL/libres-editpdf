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
  const el = document.getElementById('fabric-canvas');
  if (!el) {
    console.error('canvas-overlay: fabric-canvas element not found');
    return null;
  }

  try {
    canvas = new fabric.Canvas(el, {
      isDrawingMode: false,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
    });

    // Ensure the canvas-container wrapper also has z-index
    const container = canvas.wrapperEl;
    if (container) {
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.zIndex = '10';
    }

    state.setFabricCanvas(canvas);

    // Track mouse events for shape tools and eraser
    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:down', eraserDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    // When an object is modified, mark dirty for export
    canvas.on('object:modified', () => state.emit('annotationChanged'));
    canvas.on('object:added', () => state.emit('annotationChanged'));

    return canvas;
  } catch (err) {
    console.error('canvas-overlay: failed to init Fabric.js canvas:', err);
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

  // Text placement mode
  if (textPlacementMode || tool === 'text') {
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
