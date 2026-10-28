import { $, $$, escape, notify, showModal } from '../../core/dom.js';

export function createServerEditor(context) {
  const { api, refresh } = context;
  function updateFields() {
    const type = $('#check-type').value;
    $$('.check-fields').forEach((section) => {
      section.hidden = section.dataset.type !== type;
      section.querySelectorAll('input').forEach((input) => {
        input.disabled = section.hidden;
        input.required = !section.hidden && input.type !== 'checkbox';
      });
    });
  }
  function addLink(label = '', url = '') {
    if ($('#link-fields').children.length >= 8) return notify('You can add up to eight quick links.');
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `<input aria-label="Link label" data-link-label maxlength="40" placeholder="e.g. Console" value="${escape(label)}"><input aria-label="Link URL" data-link-url type="url" placeholder="https://…" value="${escape(url)}"><button class="icon-button" type="button" aria-label="Remove link">×</button>`;
    row.querySelector('button').onclick = () => row.remove();
    $('#link-fields').append(row);
  }
  function openEditor(server) {
    if (context.isDemo()) context.exitDemo();
    const form = $('#server-form');
    form.reset();
    $('#link-fields').replaceChildren();
    form.elements.id.value = server?.id ?? '';
    $('#form-title').textContent = server ? 'Edit server' : 'Add a server';
    for (const key of ['name', 'provider', 'region', 'notes'])
      form.elements[key].value = server?.[key] ?? (key === 'provider' ? 'DigitalOcean' : '');
    form.elements.enabled.checked = server?.enabled !== false;
    form.elements.type.value = server?.check.type ?? 'ssh';
    form.elements.docker.checked = server?.check.docker === true;
    for (const key of ['alias', 'url', 'host', 'port', 'timeoutMs'])
      form.elements[key].value =
        server?.check[key] ??
        (key === 'port' ? 22 : key === 'timeoutMs' ? (context.getState().config?.timeoutMs ?? 10000) : '');
    const timeout = form.elements.timeoutMs;
    const timeoutValue = String(server?.check.timeoutMs ?? context.getState().config?.timeoutMs ?? 10000);
    if (![...timeout.options].some((option) => option.value === timeoutValue))
      timeout.add(new Option(`${Number(timeoutValue) / 1000} seconds`, timeoutValue));
    timeout.value = timeoutValue;
    if (server?.links.length) server.links.forEach((link) => addLink(link.label, link.url));
    else addLink();
    $('#form-error').hidden = true;
    updateFields();
    showModal('#server-dialog');
  }
  $('#server-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const server = {
      name: fields.name,
      provider: fields.provider,
      region: fields.region,
      notes: fields.notes,
      enabled: form.elements.enabled.checked,
      check: {
        type: fields.type,
        timeoutMs: Number(fields.timeoutMs),
        ...(fields.type === 'ssh'
          ? { alias: fields.alias, docker: form.elements.docker.checked }
          : fields.type === 'http'
            ? { url: fields.url }
            : { host: fields.host, port: Number(fields.port) }),
      },
      links: $$('#link-fields .link-row')
        .map((row) => ({
          label: row.querySelector('[data-link-label]').value,
          url: row.querySelector('[data-link-url]').value,
        }))
        .filter((link) => link.label || link.url),
    };
    $('#save-server').disabled = true;
    $('#form-error').hidden = true;
    server.cost = context.getState().servers.find((s) => s.id === fields.id)?.cost ?? null;
    try {
      const saved = await api(fields.id ? `/api/servers/${fields.id}` : '/api/servers', {
        method: fields.id ? 'PUT' : 'POST',
        data: server,
      });
      $('#server-dialog').close();
      context.resetFilters();
      await refresh();
      notify('Server saved to your local registry.');
      if (saved.enabled) context.check(saved.id);
    } catch (error) {
      $('#form-error').textContent = error.message;
      $('#form-error').hidden = false;
    } finally {
      $('#save-server').disabled = false;
    }
  });
  $('#check-type').onchange = updateFields;
  $('#add-link').onclick = () => addLink();
  return { open: openEditor };
}
