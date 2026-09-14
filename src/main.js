/**
 * main.js – Entry point. Wires everything together.
 */
import * as state from './app.js';
import { initToolbar, handleFiles } from './toolbar.js';
import { initFabricCanvas, applyTool, saveAnnotations, loadAnnotations, pageKey } from './canvas-overlay.js';
import { renderCurrentPage } from './pdf-renderer.js';
import { rebuildThumbnails, highlightActive, saveCurrentPageAnnotations, loadPageAnnotations } from './thumbnail-panel.js';
import { initTextEdit } from './text-edit.js';
import { showToast } from './utils.js';

// ---- Global error handlers ----

window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error || e.message);
  e.preventDefault(); // prevent server crash
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  e.preventDefault(); // prevent server crash
});

// ---- Bootstrap ----

document.addEventListener('DOMContentLoaded', () => {
  // Init toolbar
  initToolbar();

  // Init text editing (redact & replace)
  initTextEdit();

  // ---- Wire up state events ----

  state.on('pagesChanged', () => {
    rebuildThumbnails();
    updateUI();
    renderCurrentPage();
  });

  state.on('pageChanged', () => {
    highlightActive();
    renderCurrentPage();
    loadPageAnnotations(state.currentPageIndex);
    updateUI();
  });

  state.on('selectionChanged', () => {
    highlightActive();
    updateSelectionCount();
  });

  state.on('toolChanged', () => {
    highlightToolButton();
    showToolOptions();
    applyTool(state.activeTool);
  });

  state.on('zoomChanged', () => {
    document.getElementById('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
  });

  state.on('historyChanged', () => {
    document.getElementById('btn-undo').disabled = state.historyIndex <= 0;
    document.getElementById('btn-redo').disabled = state.historyIndex >= state.historyStack.length - 1;
  });

  // ---- Drag & Drop on viewer ----

  const viewer = document.getElementById('viewer-container');
  const dropZoneContent = document.querySelector('.drop-zone-content');

  viewer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropZoneContent?.classList.add('drag-over');
  });

  viewer.addEventListener('dragleave', () => {
    dropZoneContent?.classList.remove('drag-over');
  });

  viewer.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZoneContent?.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  // ---- Initial state ----
  updateUI();
});

// ---- UI update helpers ----

function updateUI() {
  const total = state.pages.length;
  const current = state.currentPageIndex + 1;

  document.getElementById('page-number').value = total > 0 ? current : 0;
  document.getElementById('page-number').max = total;
  document.getElementById('page-count').textContent = `/ ${total}`;
  document.getElementById('btn-prev-page').disabled = state.currentPageIndex <= 0;
  document.getElementById('btn-next-page').disabled = state.currentPageIndex >= total - 1;
  document.getElementById('btn-export').disabled = total === 0;
  updateSelectionCount();
}

function updateSelectionCount() {
  document.getElementById('selection-count').textContent =
    `${state.selectedPages.size} page${state.selectedPages.size !== 1 ? 's' : ''} selected`;
}

function highlightToolButton() {
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === state.activeTool);
  });
}

function showToolOptions() {
  const textPanel = document.getElementById('opt-text');
  const drawPanel = document.getElementById('opt-draw');
  const imagePanel = document.getElementById('opt-image');

  textPanel.classList.add('hidden');
  drawPanel.classList.add('hidden');
  imagePanel.classList.add('hidden');

  if (state.activeTool === 'text') textPanel.classList.remove('hidden');
  else if (['pen', 'highlighter', 'rect', 'circle', 'line'].includes(state.activeTool)) drawPanel.classList.remove('hidden');
  else if (state.activeTool === 'image') imagePanel.classList.remove('hidden');
}
