import { isIP } from 'node:net';
import { defaults } from './config.mjs';

export class ValidationError extends Error {}
function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new ValidationError(`${name} must be ${required ? '1–' : '0–'}${max} characters.`);
  return value.trim();
}
function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new ValidationError(`${name} must be between ${min} and ${max}.`);
  return value;
}
export function webUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('Enter a complete HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new ValidationError('Use HTTP or HTTPS URLs without embedded credentials.');
  return url.href;
}
export function validateServer(input, config = defaults) {
  if (!input || typeof input !== 'object') throw new ValidationError('A server configuration is required.');
  const result = {
    name: text(input.name, 'Name', 80, true),
    provider: text(input.provider ?? 'Other', 'Provider', 40, true),
    region: text(input.region ?? '', 'Region', 60),
    notes: text(input.notes ?? '', 'Notes', 2000),
    enabled: input.enabled !== false,
    cost: validateCost(input.cost),
  };
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    throw new ValidationError('Enabled must be true or false.');
  const c = input.check;
  if (!c || !['http', 'tcp', 'ssh'].includes(c.type))
    throw new ValidationError('Choose HTTP, TCP, or SSH monitoring.');
  result.check = {
    type: c.type,
    timeoutMs: integer(c.timeoutMs ?? config.monitoring.timeoutMs, 'Timeout', 2000, 30000),
  };
  if (c.type === 'http') result.check.url = webUrl(text(c.url, 'Health URL', 2048, true));
  if (c.type === 'tcp') {
    const host = text(c.host, 'Hostname', 253, true);
    if (!isIP(host) && (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host) || host.includes('..')))
      throw new ValidationError('Enter a hostname or IP address without a protocol.');
    result.check.host = host;
    result.check.port = integer(c.port, 'Port', 1, 65535);
  }
  if (c.type === 'ssh') {
    const alias = text(c.alias, 'SSH alias', 100, true);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(alias))
      throw new ValidationError(
        'Use an existing SSH config alias (letters, numbers, dots, underscores, hyphens).',
      );
    result.check.alias = alias;
  }
  const links = input.links ?? [];
  if (!Array.isArray(links) || links.length > 8) throw new ValidationError('Use up to eight quick links.');
  result.links = links.map((link) => ({
    label: text(link.label, 'Link label', 40, true),
    url: webUrl(text(link.url, 'Link URL', 2048, true)),
  }));
  return result;
}
export function validateSettings(input) {
  return { intervalSeconds: integer(input?.intervalSeconds, 'Check interval', 10, 3600) };
}
export function validateCost(input) {
  if (input == null) return null;
  if (
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Number.isFinite(input.amount) ||
    input.amount < 0 ||
    input.amount > 1000000
  )
    throw new ValidationError('Cost must be a number between 0 and 1,000,000.');
  if (!['hourly', 'monthly'].includes(input.period))
    throw new ValidationError('Choose an hourly or monthly rate.');
  if (!['USD', 'SGD', 'EUR', 'GBP', 'CNY', 'JPY', 'AUD', 'CAD'].includes(input.currency))
    throw new ValidationError('Choose a supported currency.');
  return {
    amount: Math.round(input.amount * 1000000) / 1000000,
    period: input.period,
    currency: input.currency,
    basis: text(input.basis ?? '', 'Price basis', 500),
    sourceUrl: input.sourceUrl ? webUrl(text(input.sourceUrl, 'Price source URL', 2048, true)) : '',
  };
}
export function effectiveStatus(server, intervalSeconds, now = Date.now(), thresholds = defaults.thresholds) {
  if (!server.enabled) return 'paused';
  if (!server.latest) return 'unknown';
  if (
    now - Date.parse(server.latest.at) >
    Math.max(intervalSeconds * 1000 * thresholds.staleMultiplier, thresholds.staleMinimumMs)
  )
    return 'stale';
  return server.latest.status;
}
