/**
 * Utility helpers used across the application.
 */

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'info'|'error'|'success'} type
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/**
 * Show / hide the loading overlay.
 * @param {boolean} show
 * @param {string} [text]
 */
export function setLoading(show, text = 'Loading PDF...') {
  const overlay = document.getElementById('loading-overlay');
  if (show) {
    overlay.querySelector('p').textContent = text;
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

/**
 * Show a simple modal and return a promise resolving with the OK/Cancel choice.
 * @param {string} title
 * @param {string} bodyHTML  – raw HTML for the modal body
 * @returns {Promise<boolean>}
 */
export function showModal(title, bodyHTML) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    overlay.classList.remove('hidden');

    const close = (result) => {
      overlay.classList.add('hidden');
      resolve(result);
    };

    document.getElementById('btn-modal-close').onclick = () => close(false);
    document.getElementById('btn-modal-cancel').onclick = () => close(false);
    document.getElementById('btn-modal-ok').onclick = () => close(true);
  });
}

/**
 * Create a simple object URL from an ArrayBuffer.
 * @param {ArrayBuffer} buf
 * @param {string} mime
 * @returns {string}
 */
export function bufferToObjectURL(buf, mime = 'application/pdf') {
  return URL.createObjectURL(new Blob([buf], { type: mime }));
}

/**
 * Download a buffer as a file.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} filename
 * @param {string} mime
 */
export function downloadBuffer(buffer, filename, mime = 'application/pdf') {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Clamp a number between min and max.
 */
export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}
