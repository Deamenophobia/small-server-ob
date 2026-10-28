import { escape } from '../../core/dom.js';
import { containerMarkup } from './containers.js';

const labels = {
  healthy: 'Healthy',
  warning: 'Warning',
  down: 'Unreachable',
  unknown: 'Unknown',
  stale: 'Stale',
  paused: 'Paused',
};
export const providerClass = (provider) =>
  provider.toLowerCase().includes('digitalocean') ? 'do' : provider.toLowerCase() === 'aws' ? 'aws' : '';
const providerIcon = (provider) =>
  providerClass(provider) === 'do'
    ? '◕'
    : providerClass(provider) === 'aws'
      ? 'aws'
      : escape(provider.slice(0, 2).toUpperCase());

export function target(server) {
  const check = server.check;
  return check.type === 'ssh'
    ? `ssh ${check.alias}`
    : check.type === 'http'
      ? check.url
      : `${check.host}:${check.port}`;
}

function age(at) {
  if (!at) return 'Not checked yet';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  return seconds < 5
    ? 'Just now'
    : seconds < 60
      ? `${seconds}s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ago`
        : `${Math.floor(seconds / 3600)}h ago`;
}

function metricMarkup(key, metrics, thresholds) {
  const value = metrics?.[key];
  const label = { cpu: 'CPU', memory: 'Memory', disk: 'Disk /' }[key];
  return `<div>
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value == null ? '—' : Math.round(value)}<small>${value == null ? '' : '%'}</small></div>
    <progress class="metric-bar${value >= thresholds[key] ? ' hot' : ''}" max="100" value="${value ?? 0}"
      aria-label="${key} ${value == null ? 'unavailable' : `${value}%`}"></progress>
  </div>`;
}

function observationMarkup(server, thresholds) {
  const latest = server.latest;
  if (server.check.type === 'ssh') {
    const cached = ['paused', 'stale'].includes(server.status);
    return `<div class="metrics" title="${cached ? 'Last collected metrics' : 'Latest observation'}">
      ${['cpu', 'memory', 'disk'].map((key) => metricMarkup(key, latest?.metrics, thresholds)).join('')}
    </div>`;
  }
  return `<div class="reachability">
    <div><div class="metric-label">RESPONSE TIME</div>
      <strong>${latest?.latencyMs ?? '—'}<small>${latest?.latencyMs == null ? '' : 'ms'}</small></strong>
    </div>
    <div><div class="method-name">${server.check.type.toUpperCase()} check</div>
      ${server.check.type === 'http' ? 'Application endpoint' : 'Connection only'}
    </div>
  </div>`;
}

function historyMarkup(server, visible) {
  const history = server.history.slice(-visible);
  const observed = history.filter((item) => ['healthy', 'warning', 'down'].includes(item.status));
  const successes = observed.filter((item) => item.status !== 'down').length;
  const passes = observed.length
    ? `${Math.round((successes / observed.length) * 100)}% reachable`
    : 'No observations';
  const missing = '<span class="history-segment" title="No observation"></span>'.repeat(
    visible - history.length,
  );
  const segments = history
    .map(
      (item) =>
        `<span class="history-segment ${item.status}" title="${escape(`${new Date(item.at).toLocaleString()} · ${labels[item.status]}`)}"></span>`,
    )
    .join('');
  return `<div class="history" aria-label="Recent check history">${missing}${segments}</div>
    <div class="history-caption"><span>${history.length ? `Last ${history.length} checks` : 'History appears after checking'}</span><span>${passes}</span></div>`;
}

function actionsMarkup(server, checking) {
  const name = escape(server.name);
  return `<div class="card-actions">
    <button class="icon-button" data-action="check" title="Check ${name}" aria-label="Check ${name}" ${checking || !server.enabled ? 'disabled' : ''}>↻</button>
    <button class="icon-button" data-action="pause" title="${server.enabled ? 'Pause' : 'Resume'} monitoring" aria-label="${server.enabled ? 'Pause' : 'Resume'} ${name}">${server.enabled ? 'Ⅱ' : '▷'}</button>
    <button class="icon-button" data-action="edit" title="Edit server" aria-label="Edit ${name}">✎</button>
    <button class="icon-button" data-action="delete" title="Remove server" aria-label="Remove ${name}">×</button>
  </div>`;
}

export function card(server, state) {
  const visible = state.config?.historyVisible ?? 28;
  const thresholds = state.config?.thresholds ?? { cpu: 90, memory: 85, disk: 85 };
  const latest = server.latest;
  const message =
    server.status === 'paused'
      ? 'Monitoring paused · showing last observation'
      : server.status === 'stale'
        ? 'Cached observation · waiting for a fresh check'
        : latest?.message || 'Waiting for the first check';
  const duration =
    server.check.type === 'ssh' && latest?.latencyMs != null ? ` · ${latest.latencyMs}ms collection` : '';
  const links = server.links.length
    ? server.links
        .map(
          (link) =>
            `<a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`,
        )
        .join('')
    : '<span class="no-link">Add a quick link</span>';
  return `<article class="server-card" data-id="${server.id}">
    <div class="card-main">
      <div class="card-top">
        <div class="provider-icon ${providerClass(server.provider)}" title="${escape(server.provider)}">${providerIcon(server.provider)}</div>
        <span class="card-status ${server.status}"><i></i>${labels[server.status]}</span>
      </div>
      <h3>${escape(server.name)}</h3>
      <div class="server-meta"><span>${escape(server.provider)}</span>${server.region ? `<span class="separator">/</span><span>${escape(server.region)}</span>` : ''}</div>
      <div class="card-target" title="${escape(target(server))}">${escape(target(server))}</div>
      <p class="card-note">${escape(server.notes || 'No notes yet. Add a little context for future-you.')}</p>
      ${observationMarkup(server, thresholds)}
      ${containerMarkup(server)}
      ${historyMarkup(server, visible)}
      <div class="check-message ${server.status}">${escape(message)}<br><span>${age(latest?.at)}${duration}</span></div>
    </div>
    <div class="card-footer"><div class="quick-links">${links}</div>${actionsMarkup(server, state.checking)}</div>
  </article>`;
}
