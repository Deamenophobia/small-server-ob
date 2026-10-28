import { $, $$, escape } from '../../core/dom.js';
import { card, target, providerClass } from './cards.js';

export function renderFleet({ state, demo, statusFilter, providerFilter, search, servers: all }) {
  const total = all.length;
  $('#sidebar-count').textContent = total;
  $('#summary').innerHTML = [
    [
      'Total servers',
      total,
      `${new Set(all.map((s) => s.provider)).size} provider${new Set(all.map((s) => s.provider)).size === 1 ? '' : 's'}`,
      '▦',
      '',
    ],
    ['Healthy', all.filter((s) => s.status === 'healthy').length, 'Looking good', '↗', 'healthy'],
    [
      'Needs attention',
      all.filter((s) => !['healthy', 'paused'].includes(s.status)).length,
      'Worth a look',
      '◷',
      'attention',
    ],
    ['Paused', all.filter((s) => s.status === 'paused').length, 'Taking a break', 'Ⅱ', ''],
  ]
    .map(
      ([label, value, detail, icon, cls]) =>
        `<div class="summary-item ${cls}"><div class="summary-label">${label}<span class="summary-icon">${icon}</span></div><div class="summary-value">${value}<small>${detail}</small></div></div>`,
    )
    .join('');
  const providers = [...new Set(all.map((s) => s.provider))].sort();
  $('#provider-nav').innerHTML =
    providers
      .map(
        (p) =>
          `<button class="provider-nav ${providerFilter === p ? 'selected' : ''}" data-provider="${escape(p)}"><span class="provider-dot ${providerClass(p)}"></span>${escape(p)}<span class="count">${all.filter((s) => s.provider === p).length}</span></button>`,
      )
      .join('') || '<div class="provider-nav">Your providers appear here</div>';
  const filtered = all.filter(
    (s) =>
      (!providerFilter || s.provider === providerFilter) &&
      (statusFilter === 'all' ||
        (statusFilter === 'attention'
          ? !['healthy', 'paused'].includes(s.status)
          : s.status === statusFilter)) &&
      [s.name, s.provider, s.region, s.notes, target(s)].some((value) =>
        value.toLowerCase().includes(search),
      ),
  );
  $('#fleet-count').textContent = total;
  $('#fleet-description').textContent = providerFilter
    ? `${providerFilter} · ${filtered.length} servers in view`
    : 'One place for every server.';
  const expanded = new Map(
    $$('#server-grid [data-containers][open]').map((panel) => [
      panel.closest('[data-id]').dataset.id,
      panel.querySelector('.container-list')?.scrollTop ?? 0,
    ]),
  );
  $('#server-grid').innerHTML =
    filtered.map((server) => card(server, state)).join('') +
    (total && statusFilter === 'all' && !search && !providerFilter
      ? '<button class="add-card add-button"><span class="plus">＋</span><strong>Room for another.</strong><small>Add a server to your fleet</small></button>'
      : '');
  $$('#server-grid [data-containers]').forEach((panel) => {
    const id = panel.closest('[data-id]').dataset.id;
    if (!expanded.has(id)) return;
    panel.open = true;
    panel.querySelector('.container-list').scrollTop = expanded.get(id);
  });
  $('#empty-state').hidden = total !== 0;
  $('#no-results').hidden = total === 0 || filtered.length !== 0;
  $('#demo-banner').hidden = !demo && !state.demo;
  $('#exit-demo').hidden = !!state.demo;
  $('#refresh-button').disabled = state.checking || !total || demo;
  $('#refresh-button').innerHTML = state.checking ? '<span>↻</span> Checking…' : '<span>↻</span> Check now';
  $('#poll-status').innerHTML =
    `<i></i>${demo || state.demo ? 'Example observations' : state.checking ? 'Collecting observations…' : `Checks every ${state.settings.intervalSeconds}s`}`;
  $('#last-sync').textContent =
    demo || state.demo
      ? 'Fictional demo · nothing saved'
      : state.now
        ? `Synced ${new Date(state.now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Waiting for local backend';
  $$('#status-filters button').forEach((button) => {
    button.classList.toggle('selected', button.dataset.filter === statusFilter);
    button.setAttribute('aria-pressed', button.dataset.filter === statusFilter);
  });
}
