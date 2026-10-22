import { monthInfo } from '../../costs.mjs';
import { numeric } from './numeric.mjs';

export function parseAws(value, period) {
  if (!Array.isArray(value.ResultsByTime) || value.ResultsByTime.length === 0 || value.NextPageToken)
    throw new Error('Billing response has missing or incomplete data.');
  let amount = 0,
    currency,
    estimated = false;
  for (const row of value.ResultsByTime) {
    const metric = row.Total?.UnblendedCost;
    if (!metric?.Unit || !/^[A-Z]{3}$/.test(metric.Unit) || (currency && metric.Unit !== currency))
      throw new Error('Billing currencies do not match.');
    currency = metric.Unit;
    amount += numeric(metric.Amount);
    estimated ||= row.Estimated === true;
  }
  return { currency, monthToDate: amount, period, estimated };
}
export async function fetchAws({ profile, env = process.env, now = new Date() }) {
  const { CostExplorerClient, GetCostAndUsageCommand } = await import('@aws-sdk/client-cost-explorer');
  const { fromIni, fromEnv } = await import('@aws-sdk/credential-providers');
  const { month } = monthInfo(now);
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    .toISOString()
    .slice(0, 10);
  const client = new CostExplorerClient({
    region: 'us-east-1',
    credentials:
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && !profile
        ? fromEnv()
        : fromIni({ profile: profile || 'default' }),
    maxAttempts: 1,
  });
  try {
    const response = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: `${month}-01`, End: tomorrow },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
      }),
      { abortSignal: AbortSignal.timeout(20000) },
    );
    return parseAws(response, month);
  } finally {
    client.destroy();
  }
}
