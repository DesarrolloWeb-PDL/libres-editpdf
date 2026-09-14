/**
 * thumbnail-panel.js – Sidebar thumbnails with drag-and-drop reorder.
 */
import * as state from './app.js';
import { renderPageToDataURL } from './pdf-loader.js';
import { loadAnnotations, saveAnnotations, pageKey } from './canvas-overlay.js';

const list = document.getElementById('thumbnail-list');
let dragSrcIndex = null;

/**
 * Rebuild all thumbnails from the current pages list.
 */
export async function rebuildThumbnails() {
  list.innerHTML = '';
  for (let i = 0; i < state.pages.length; i++) {
    const thumb = createThumbnailElement(i);
    list.appendChild(thumb);
    renderThumbCanvas(i, thumb.querySelector('canvas'));
  }
  highlightActive();
}

function createThumbnailElement(idx) {
  const div = document.createElement('div');
  div.className = 'thumbnail';
  div.dataset.index = idx;
  div.draggable = true;

  const cvs = document.createElement('canvas');
  div.appendChild(cvs);

  const label = document.createElement('span');
  label.className = 'thumbnail-label';
  label.textContent = idx + 1;
  div.appendChild(label);

  // Click to navigate
  div.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) {
      state.toggleSelectPage(idx);
    } else if (e.shiftKey && state.selectedPages.size > 0) {
      const last = Math.max(...state.selectedPages);
      const start = Math.min(last, idx);
      const end = Math.max(last, idx);
      for (let i = start; i <= end; i++) state.selectedPages.add(i);
      state.emit('selectionChanged');
    } else {
      // Save current page annotations
      saveCurrentPageAnnotations();
      state.selectPage(idx);
      state.setCurrentPage(idx);
    }
  });

  // Drag events
  div.addEventListener('dragstart', (e) => {
    dragSrcIndex = idx;
    e.dataTransfer.effectAllowed = 'move';
    div.style.opacity = '0.5';
  });

  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    div.classList.add('drag-over');
  });

  div.addEventListener('dragleave', () => div.classList.remove('drag-over'));

  div.addEventListener('drop', (e) => {
    e.preventDefault();
    div.classList.remove('drag-over');
    if (dragSrcIndex === null || dragSrcIndex === idx) return;
    reorderPages(dragSrcIndex, idx);
    dragSrcIndex = null;
  });

  div.addEventListener('dragend', () => {
    div.style.opacity = '1';
    dragSrcIndex = null;
  });

  return div;
}

async function renderThumbCanvas(idx, canvas) {
  const { pdfIndex, pageIndex } = state.pages[idx];
  const doc = state.pdfs[pdfIndex].doc;
  const dataUrl = await renderPageToDataURL(doc, pageIndex + 1, 0.3);
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
  };
  img.src = dataUrl;
}

export function highlightActive() {
  list.querySelectorAll('.thumbnail').forEach((el) => {
    const idx = parseInt(el.dataset.index, 10);
    el.classList.toggle('active', idx === state.currentPageIndex);
    el.classList.toggle('selected', state.selectedPages.has(idx));
  });
}

function reorderPages(fromIdx, toIdx) {
  const page = state.pages.splice(fromIdx, 1)[0];
  state.pages.splice(toIdx, 0, page);
  state.pushHistory();
  state.emit('pagesChanged');
}

/**
 * Save fabric.js annotations for the currently viewed page.
 */
export function saveCurrentPageAnnotations() {
  if (state.pages.length === 0) return;
  const key = pageKey(state.currentPageIndex);
  saveAnnotations(key);
}

/**
 * Load fabric.js annotations for a page and switch to it.
 */
export function loadPageAnnotations(idx) {
  const key = pageKey(idx);
  loadAnnotations(key);
}
