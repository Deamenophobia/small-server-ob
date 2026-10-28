import { api } from './js/core/api.js';
import { $, notify, showModal, initializeDialogs } from './js/core/dom.js';
import { renderFleet } from './js/features/fleet/render.js';
import { createServerEditor } from './js/features/fleet/editor.js';
import { makeDemo } from './js/features/fleet/preview.js';
import { initializeWorkspace } from './js/features/workspace.js';
import { initializeCosts, renderCosts } from './js/features/costs.js';
import { updateGuidance } from './js/core/guidance.js';

let state = { servers: [], settings: { intervalSeconds: 30 }, checking: false };
let demo = false,
  demoServers = [],
  statusFilter = 'all',
  providerFilter = '',
  search = '',
  deletingId;
const context = {
  api,
  refresh,
  notify,
  check,
  resetFilters,
  getState: () => state,
  isDemo: () => demo,
  exitDemo: () => {
    demo = false;
    resetFilters();
  },
};
const editor = createServerEditor(context);
initializeDialogs();
initializeWorkspace(context);
initializeCosts(context);

function render() {
  renderFleet({
    state,
    demo,
    statusFilter,
    providerFilter,
    search,
    servers: demo ? demoServers : state.servers,
  });
  renderCosts(state, demo);
}
async function refresh() {
  try {
    state = await api('/api/state');
    updateGuidance(state.config, state.billing?.cacheHours);
    $('#connection-alert').hidden = !state.storageError;
    $('#connection-alert').textContent = state.storageError || '';
    render();
  } catch {
    $('#connection-alert').hidden = false;
    $('#connection-alert').textContent =
      'Local backend disconnected. Displayed readings are cached. Start Small Server OB again to resume monitoring.';
    state.checking = false;
    state.servers.forEach((server) => {
      if (server.enabled && server.latest) server.status = 'stale';
    });
    render();
    $('#poll-status').textContent = 'Backend disconnected';
  }
}
function resetFilters() {
  statusFilter = 'all';
  providerFilter = '';
  search = '';
  $('#search').value = '';
  render();
}
async function check(id) {
  if (demo) return notify('Example fleet uses illustrative data. Exit preview to connect your servers.');
  state.checking = true;
  render();
  try {
    await api('/api/check', { method: 'POST', data: { ...(id ? { id } : {}) } });
  } catch (error) {
    notify(error.message, true);
  }
  await refresh();
}

document.addEventListener('click', async (event) => {
  if (event.target.closest('.add-button')) editor.open();
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  if (demo) return notify('Preview mode. Exit the example fleet to manage your own servers.');
  const server = state.servers.find((s) => s.id === actionButton.closest('[data-id]').dataset.id);
  if (!server) return;
  try {
    if (actionButton.dataset.action === 'edit') editor.open(server);
    if (actionButton.dataset.action === 'check') await check(server.id);
    if (actionButton.dataset.action === 'pause') {
      await api(`/api/servers/${server.id}`, {
        method: 'PUT',
        data: { ...server, enabled: !server.enabled },
      });
      await refresh();
      notify(server.enabled ? 'Monitoring paused.' : 'Monitoring resumed.');
      if (!server.enabled) check(server.id);
    }
    if (actionButton.dataset.action === 'delete') {
      deletingId = server.id;
      $('#delete-copy').textContent = server.name;
      showModal('#delete-dialog');
    }
  } catch (error) {
    notify(error.message, true);
  }
});
$('#confirm-delete').onclick = async () => {
  try {
    await api(`/api/servers/${deletingId}`, { method: 'DELETE' });
    $('#delete-dialog').close();
    await refresh();
    notify('Server removed from the local registry.');
  } catch (error) {
    notify(error.message, true);
  }
};
$('#refresh-button').onclick = () => check();
$('#search').oninput = (event) => {
  search = event.target.value.toLowerCase().trim();
  render();
};
$('#status-filters').onclick = (event) => {
  const button = event.target.closest('[data-filter]');
  if (button) {
    statusFilter = button.dataset.filter;
    render();
  }
};
$('#provider-nav').onclick = (event) => {
  const button = event.target.closest('[data-provider]');
  if (button) {
    providerFilter = providerFilter === button.dataset.provider ? '' : button.dataset.provider;
    render();
  }
};
$('#overview-nav').onclick = resetFilters;
$('#clear-filters').onclick = resetFilters;
$('#guide-button').onclick = () => showModal('#guide-dialog');
$('#ssh-help').onclick = () => showModal('#guide-dialog');
$('#demo-button').onclick = () => {
  demo = true;
  demoServers = makeDemo();
  resetFilters();
};
$('#exit-demo').onclick = () => {
  demo = false;
  resetFilters();
};

// Schedule after completion so slow requests cannot overlap or overwrite newer views.
async function poll() {
  await refresh();
  setTimeout(poll, state.config?.refreshMs ?? 5000);
}
await poll();
