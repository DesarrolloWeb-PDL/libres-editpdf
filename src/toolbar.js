/**
 * toolbar.js – Wire up toolbar buttons and keyboard shortcuts.
 */
import * as state from './app.js';
import { showToast } from './utils.js';
import {
  rotatePage, deletePage, duplicatePage,
  splitSelected, splitByRange, splitEveryN, mergeAll,
} from './pdf-operations.js';
import {
  rebuildThumbnails, highlightActive, saveCurrentPageAnnotations, loadPageAnnotations,
} from './thumbnail-panel.js';
import { renderCurrentPage, fitWidth, fitPage } from './pdf-renderer.js';
import { initFabricCanvas, applyTool, addText, addImage } from './canvas-overlay.js';
import { loadPDF, renderPageToDataURL } from './pdf-loader.js';

/**
 * Attach all event listeners.
 */
export function initToolbar() {
  // File operations
  document.getElementById('btn-open-file').addEventListener('click', () => {
    document.getElementById('hidden-file-input').click();
  });

  document.getElementById('hidden-file-input').addEventListener('change', async (e) => {
    await handleFiles(e.target.files);
    e.target.value = '';
  });

  document.getElementById('btn-browse').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', async (e) => {
    await handleFiles(e.target.files);
    e.target.value = '';
  });

  // Undo / Redo
  document.getElementById('btn-undo').addEventListener('click', () => state.undo());
  document.getElementById('btn-redo').addEventListener('click', () => state.redo());

  // Export
  document.getElementById('btn-export').addEventListener('click', () => {
    // Dynamic import to avoid circular deps
    import('./export.js').then((m) => m.exportPDF());
  });

  // Navigation
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (state.currentPageIndex > 0) {
      saveCurrentPageAnnotations();
      state.setCurrentPage(state.currentPageIndex - 1);
    }
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    if (state.currentPageIndex < state.pages.length - 1) {
      saveCurrentPageAnnotations();
      state.setCurrentPage(state.currentPageIndex + 1);
    }
  });
  document.getElementById('page-number').addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10) - 1;
    if (!isNaN(n)) {
      saveCurrentPageAnnotations();
      state.setCurrentPage(n);
    }
  });

  // Zoom
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.setZoom(Math.min(state.zoom + 0.15, 5));
    renderCurrentPage();
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.setZoom(Math.max(state.zoom - 0.15, 0.2));
    renderCurrentPage();
  });
  document.getElementById('btn-fit-width').addEventListener('click', fitWidth);
  document.getElementById('btn-fit-page').addEventListener('click', fitPage);

  // Tool buttons
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      state.setActiveTool(tool);
      // For text and image tools, set up placement handler on next canvas click
      if (tool === 'text') {
        setupTextPlacement();
      }
    });
  });

  // Page operations
  document.getElementById('btn-rotate-cw').addEventListener('click', () => {
    if (state.selectedPages.size > 0) {
      [...state.selectedPages].forEach((i) => rotatePage(i, 90));
    } else {
      rotatePage(state.currentPageIndex, 90);
    }
  });
  document.getElementById('btn-rotate-ccw').addEventListener('click', () => {
    if (state.selectedPages.size > 0) {
      [...state.selectedPages].forEach((i) => rotatePage(i, -90));
    } else {
      rotatePage(state.currentPageIndex, -90);
    }
  });
  document.getElementById('btn-rotate-180').addEventListener('click', () => {
    if (state.selectedPages.size > 0) {
      [...state.selectedPages].forEach((i) => rotatePage(i, 180));
    } else {
      rotatePage(state.currentPageIndex, 180);
    }
  });
  document.getElementById('btn-delete-page').addEventListener('click', async () => {
    if (state.selectedPages.size > 0) {
      const sorted = [...state.selectedPages].sort((a, b) => b - a);
      for (const i of sorted) await deletePage(i);
    } else {
      await deletePage(state.currentPageIndex);
    }
  });
  document.getElementById('btn-duplicate-page').addEventListener('click', () => {
    duplicatePage(state.currentPageIndex);
  });

  // Split / Merge
  document.getElementById('btn-split-selected').addEventListener('click', () => {
    splitSelected([...state.selectedPages].sort((a, b) => a - b));
  });
  document.getElementById('btn-split-range').addEventListener('click', async () => {
    const range = prompt('Enter page range (e.g. 1-3,5,7-10):');
    if (range) splitByRange(range);
  });
  document.getElementById('btn-split-n').addEventListener('click', async () => {
    const n = parseInt(prompt('Split every N pages:'), 10);
    if (!isNaN(n) && n > 0) splitEveryN(n);
  });
  document.getElementById('btn-merge-all').addEventListener('click', mergeAll);

  // Selection
  document.getElementById('btn-select-all').addEventListener('click', () => state.selectAll());
  document.getElementById('btn-deselect-all').addEventListener('click', () => state.deselectAll());

  // Text tool options – live update selected text object
  ['opt-font', 'opt-font-size', 'opt-text-color'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      if (state.activeTool !== 'text') return;
      const obj = state.fabricCanvas?.getActiveObject();
      if (obj && obj.type === 'i-text') {
        obj.set({
          fontFamily: document.getElementById('opt-font').value,
          fontSize: parseInt(document.getElementById('opt-font-size').value, 10),
          fill: document.getElementById('opt-text-color').value,
          fontWeight: document.getElementById('opt-bold').checked ? 'bold' : 'normal',
          fontStyle: document.getElementById('opt-italic').checked ? 'italic' : 'normal',
        });
        state.fabricCanvas.renderAll();
      }
    });
  });
  document.getElementById('opt-bold').addEventListener('change', () => {
    if (state.activeTool !== 'text') return;
    const obj = state.fabricCanvas?.getActiveObject();
    if (obj && obj.type === 'i-text') {
      obj.set({ fontWeight: document.getElementById('opt-bold').checked ? 'bold' : 'normal' });
      state.fabricCanvas.renderAll();
    }
  });
  document.getElementById('opt-italic').addEventListener('change', () => {
    if (state.activeTool !== 'text') return;
    const obj = state.fabricCanvas?.getActiveObject();
    if (obj && obj.type === 'i-text') {
      obj.set({ fontStyle: document.getElementById('opt-italic').checked ? 'italic' : 'normal' });
      state.fabricCanvas.renderAll();
    }
  });

  // Drawing options – live update
  document.getElementById('opt-stroke-width').addEventListener('input', (e) => {
    document.getElementById('opt-stroke-width-val').textContent = e.target.value + 'px';
  });
  document.getElementById('opt-opacity').addEventListener('input', (e) => {
    document.getElementById('opt-opacity-val').textContent = Math.round(e.target.value * 100) + '%';
  });

  // Image tool
  document.getElementById('btn-add-image').addEventListener('click', () => {
    document.getElementById('image-input').click();
  });
  document.getElementById('image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // Sidebar toggle
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar-left').classList.toggle('collapsed');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);
}

/**
 * Handle dropped files on the drop zone.
 */
export async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => {
    // Accept by MIME type OR by .pdf extension (some systems don't set MIME)
    return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
  });
  if (files.length === 0) {
    showToast('Please select PDF files', 'error');
    return;
  }

  const loadingEl = document.getElementById('loading-overlay');
  loadingEl.querySelector('p').textContent = 'Loading PDF...';
  loadingEl.classList.remove('hidden');

  try {
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();

        // Quick validation: check if it starts with %PDF
        const header = new Uint8Array(buf.slice(0, 5));
        const magic = String.fromCharCode(...header);
        if (magic !== '%PDF-') {
          showToast(`"${file.name}" is not a valid PDF file`, 'error');
          continue;
        }

        const pdf = await loadPDF(buf, file.name);
        state.pdfs.push(pdf);
      } catch (loadErr) {
        console.error('Failed to load file:', file.name, loadErr);
        showToast(`Error loading "${file.name}": ${loadErr.message}`, 'error');
        // Continue with other files instead of stopping
      }
    }

    if (state.pdfs.length === 0) {
      showToast('No PDF files could be loaded', 'error');
      return;
    }

    state.rebuildPages();
    state.pushHistory();

    // Show viewer, hide drop zone
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('page-viewer').classList.remove('hidden');
    document.getElementById('btn-export').disabled = false;

    // Init Fabric.js canvas AFTER viewer is visible (it needs visible dimensions)
    if (!state.fabricCanvas) {
      try {
        initFabricCanvas();
      } catch (err) {
        console.error('Failed to init canvas:', err);
        showToast('Canvas initialization failed', 'error');
      }
    }

    // Ensure Fabric canvas matches PDF canvas dimensions
    // (first render may have happened before Fabric was initialized)
    if (state.fabricCanvas) {
      const pdfCanvas = document.getElementById('pdf-canvas');
      if (pdfCanvas && pdfCanvas.width > 0) {
        state.fabricCanvas.setWidth(pdfCanvas.width);
        state.fabricCanvas.setHeight(pdfCanvas.height);
      }
    }
  } catch (err) {
    console.error('handleFiles unexpected error:', err);
    showToast('Failed to load PDF: ' + err.message, 'error');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

/**
 * Set up one-time click handler to place text on the canvas.
 */
function setupTextPlacement() {
  const handler = (ev) => {
    const wrapper = document.getElementById('canvas-wrapper');
    const rect = wrapper.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    addText({
      left: x, top: y,
      font: document.getElementById('opt-font').value,
      fontSize: parseInt(document.getElementById('opt-font-size').value, 10),
      color: document.getElementById('opt-text-color').value,
      bold: document.getElementById('opt-bold').checked,
      italic: document.getElementById('opt-italic').checked,
    });
    document.removeEventListener('click', handler, true);
  };
  setTimeout(() => document.addEventListener('click', handler, { once: true, capture: true }), 50);
}

function handleKeyboard(e) {
  // Don't intercept if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    state.undo();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    state.redo();
  } else if (e.key === 'v' || e.key === 'V') {
    state.setActiveTool('select');
  } else if (e.key === 't' || e.key === 'T') {
    state.setActiveTool('text');
    setupTextPlacement();
  } else if (e.key === 'p' || e.key === 'P') {
    state.setActiveTool('pen');
  } else if (e.key === 'h' || e.key === 'H') {
    state.setActiveTool('highlighter');
  } else if (e.key === 'r' || e.key === 'R') {
    state.setActiveTool('rect');
  } else if (e.key === 'c' || e.key === 'C') {
    state.setActiveTool('circle');
  } else if (e.key === 'l' || e.key === 'L') {
    state.setActiveTool('line');
  } else if (e.key === 'e' || e.key === 'E') {
    state.setActiveTool('eraser');
  } else if (e.key === 'i' || e.key === 'I') {
    state.setActiveTool('image');
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (state.currentPageIndex > 0) {
      saveCurrentPageAnnotations();
      state.setCurrentPage(state.currentPageIndex - 1);
    }
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.currentPageIndex < state.pages.length - 1) {
      saveCurrentPageAnnotations();
      state.setCurrentPage(state.currentPageIndex + 1);
    }
  }
}
