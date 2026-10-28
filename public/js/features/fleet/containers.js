import { escape } from '../../core/dom.js';

const errors = {
  not_installed: 'Docker CLI is not installed.',
  permission_denied: 'Permission denied. The SSH user needs configured Docker access.',
  unavailable: 'Docker is unavailable. Check the local daemon and socket.',
  timeout: 'Docker collection timed out. Host metrics remain available.',
  invalid: 'Docker inventory could not be read.',
};

export function containerMarkup(server) {
  if (server.check.type !== 'ssh' || !server.check.docker) return '';
  const docker = server.latest?.docker;
  const cached = ['paused', 'stale'].includes(server.status);
  if (!docker || docker.status !== 'ok')
    return `<section class="container-panel"><strong>Containers</strong><p>${escape(errors[docker?.status] || 'Waiting for a Docker observation.')}</p>${cached ? '<p>Last observation · monitoring paused or stale</p>' : ''}</section>`;
  const items = docker.containers;
  const running = items.filter((item) => item.state === 'running').length;
  const stopped = items.filter((item) => ['exited', 'dead'].includes(item.state)).length;
  const unhealthy = items.filter((item) => item.health === 'unhealthy').length;
  const other = items.length - running - stopped;
  const summary = `${running} running · ${stopped} stopped${other ? ` · ${other} other` : ''} · ${unhealthy} unhealthy`;
  return `<details class="container-panel${cached ? ' cached' : ''}" data-containers>
    <summary><strong>Containers · ${items.length}${docker.truncated ? '+' : ''}</strong><span class="${unhealthy && !cached ? 'container-warning' : ''}">${cached ? 'Last observed · ' : ''}${summary}</span></summary>
    ${cached ? '<p>Last observation · monitoring paused or stale</p>' : '<p>Latest Docker observation · host health is separate</p>'}
    ${docker.truncated ? '<p>Showing the 100 most recently created containers; counts cover this subset.</p>' : ''}
    <ul class="container-list">${items
      .map((item) => {
        const health =
          item.health === 'none'
            ? 'No health check configured'
            : item.health === 'not_running'
              ? 'Health not evaluated while stopped/paused'
              : `Health: ${item.health}`;
        return `<li><div class="container-title"><strong>${escape(item.name)}</strong><span>${escape(item.state)}</span></div>
        <div class="container-image" title="${escape(item.image)}">${escape(item.image)}</div>
        <div>${escape(item.status || 'No status reported')}</div>
        <div class="${item.health === 'unhealthy' && !cached ? 'container-warning' : ''}">${escape(health)}</div></li>`;
      })
      .join('')}</ul>
    ${items.length ? '' : '<p>No containers found.</p>'}
  </details>`;
}
