export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];
export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
let toastTimer;
export function notify(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      element.hidden = true;
    },
    error ? 8000 : 3500,
  );
}
export function showModal(selector) {
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
}
export function initializeDialogs() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('.close-dialog')) event.target.closest('dialog').close();
  });
  $$('dialog').forEach((dialog) =>
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dialog.close();
      }
    }),
  );
}
