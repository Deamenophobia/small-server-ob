import { $ } from './dom.js';

/** UI copy and warning bars use the same effective configuration as collection. */
export function updateGuidance(config, cacheHours = 6) {
  if (!config) return;
  const { cpu, memory, disk, latencyMs } = config.thresholds;
  $('#threshold-note').textContent =
    `CPU ≥ ${cpu}%, memory ≥ ${memory}%, or disk ≥ ${disk}% shows a warning. SSH collection time includes login and a short CPU sample; it is not network latency. Failed SSH collection means unknown health.`;
  $('#http-help').textContent =
    `A 2xx response passes. Redirects or responses at least ${latencyMs / 1000}s need attention.`;
  $('#billing-cache-help').textContent =
    `Restart Lookout and click Refresh billing. Queries run only when you request them; successful results are cached locally for ${cacheHours} hours. No cloud settings are changed by Lookout. Billing may lag behind current usage.`;
}
