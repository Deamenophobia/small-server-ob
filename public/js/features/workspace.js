import { $, notify, showModal } from '../core/dom.js';

export function initializeWorkspace(context) {
  const { api, refresh } = context;
  $('#settings-button').onclick = () => {
    const interval = $('#interval');
    const value = String(context.getState().settings.intervalSeconds);
    if (![...interval.options].some((option) => option.value === value))
      interval.add(new Option(`Every ${value} seconds`, value));
    interval.value = value;
    $('#data-path').textContent = context.getState().dataDirectory || 'Backend disconnected';
    $('#settings-message').textContent = '';
    showModal('#settings-dialog');
  };
  $('#settings-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/settings', { method: 'PUT', data: { intervalSeconds: Number($('#interval').value) } });
      await refresh();
      notify('Check interval saved.');
    } catch (error) {
      notify(error.message, true);
    }
  };
  $('#mobile-guide').onclick = () => showModal('#guide-dialog');
  $('#mobile-settings').onclick = () => $('#settings-button').onclick();
  $('#export-button').onclick = async () => {
    try {
      const registry = await api('/api/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(registry, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'small-server-ob-registry.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Registry exported.');
    } catch (error) {
      notify(error.message, true);
    }
  };
  $('#import-button').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose an export under 1 MB.');
      const result = await api('/api/import', { method: 'POST', data: JSON.parse(await file.text()) });
      context.exitDemo();
      await refresh();
      $('#settings-message').textContent =
        `Added ${result.added} servers. Monitoring starts on the next scheduled check.`;
      notify(`${result.added} servers imported.`);
    } catch (error) {
      $('#settings-message').textContent = error.message;
      notify(error.message, true);
    } finally {
      event.target.value = '';
    }
  };
}
