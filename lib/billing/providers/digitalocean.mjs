import { numeric } from './numeric.mjs';

export function parseDigitalOcean(value) {
  if (!Number.isFinite(Date.parse(value.generated_at)))
    throw new Error('Billing response has no generation time.');
  return {
    currency: 'USD',
    monthToDate: numeric(value.month_to_date_usage),
    balance: numeric(value.month_to_date_balance),
    generatedAt: value.generated_at,
    period: value.generated_at.slice(0, 7),
    estimated: true,
  };
}
export async function fetchDigitalOcean(token) {
  const response = await fetch('https://api.digitalocean.com/v2/customers/my/balance', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) {
    const error = new Error('DigitalOcean billing request failed.');
    error.status = response.status;
    throw error;
  }
  return parseDigitalOcean(await response.json());
}
