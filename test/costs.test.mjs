import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCost } from '../lib/model.mjs';
import { monthInfo, estimate, summarizeCosts } from '../lib/costs.mjs';
import { parseAws, parseDigitalOcean, createBilling } from '../lib/billing.mjs';
import { createApp } from '../server.mjs';
const cost = (amount, currency = 'USD', period = 'monthly') => ({
  amount,
  currency,
  period,
  basis: 'Test rate',
  sourceUrl: '',
});
const at = new Date('2026-10-22T12:00:00Z');

test('calendar estimates distinguish unknown, zero, paused hosts, and currencies', () => {
  assert.equal(monthInfo(at).hours, 744);
  assert.equal(monthInfo(new Date('2028-02-10Z')).hours, 696);
  assert.equal(estimate(cost(0.0456, 'USD', 'hourly'), at).amount, 33.93);
  assert.equal(estimate(null, at), null);
  const result = summarizeCosts(
    [
      { provider: 'AWS', cost: cost(0.0456, 'USD', 'hourly'), enabled: false },
      { provider: 'AWS', cost: cost(0.0472, 'USD', 'hourly') },
      { provider: 'DigitalOcean', cost: cost(48) },
      { provider: 'DigitalOcean', cost: cost(12) },
      { provider: '__proto__', cost: cost(0, 'SGD') },
      { provider: 'Unknown', cost: null },
    ],
    at,
  );
  assert.equal(result.configured, 5);
  assert.equal(result.total, 6);
  assert.equal(result.groups[0].amount, 129.05);
  assert.equal(result.groups[1].amount, 0);
  assert.equal(
    result.groups[0].providers.find((p) => p.provider === 'AWS').amount,
    estimate(cost(0.0456, 'USD', 'hourly'), at).amount + estimate(cost(0.0472, 'USD', 'hourly'), at).amount,
  );
  assert.deepEqual(result.groups[1].providers, [{ provider: '__proto__', amount: 0 }]);
});

test('rate validation rejects dangerous URLs and invalid financial values', () => {
  for (const value of [-1, NaN, Infinity, '12', 1000001]) assert.throws(() => validateCost(cost(value)));
  assert.throws(() => validateCost({ ...cost(1), currency: 'INVALID' }));
  assert.throws(() => validateCost({ ...cost(1), period: 'daily' }));
  assert.throws(() => validateCost({ ...cost(1), sourceUrl: 'javascript:alert(1)' }));
  assert.equal(validateCost(undefined), null);
  assert.equal(validateCost(cost(0)).amount, 0);
});

test('provider parsers preserve credit balances and reject missing or partial totals', () => {
  const doResult = parseDigitalOcean({
    month_to_date_usage: '20.50',
    month_to_date_balance: '-10.25',
    generated_at: at.toISOString(),
  });
  assert.equal(doResult.balance, -10.25);
  assert.equal(doResult.monthToDate, 20.5);
  assert.throws(() =>
    parseDigitalOcean({
      month_to_date_usage: '',
      month_to_date_balance: '0',
      generated_at: at.toISOString(),
    }),
  );
  assert.throws(() => parseDigitalOcean({ month_to_date_usage: '12' }));
  const aws = {
    ResultsByTime: [{ Estimated: true, Total: { UnblendedCost: { Amount: '12.34', Unit: 'USD' } } }],
  };
  assert.equal(parseAws(aws, '2026-10').monthToDate, 12.34);
  assert.throws(() => parseAws({ ...aws, NextPageToken: 'partial' }, '2026-10'));
  assert.throws(() => parseAws({ ResultsByTime: [] }, '2026-10'));
  assert.throws(() => parseAws({ ResultsByTime: [{ Total: {} }] }, '2026-10'));
});

test('billing requires opt-in, deduplicates refresh, caches across restarts, and separates secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-billing-'));
  let calls = 0,
    current = at;
  const fetcher = async () => {
    calls++;
    return { currency: 'USD', monthToDate: 20, period: monthInfo(current).month, estimated: true };
  };
  try {
    const off = await createBilling(directory, { env: {}, awsFetcher: fetcher, doFetcher: fetcher });
    await off.refresh();
    assert.equal(calls, 0);
    assert.equal(off.view().providers.aws.status, 'not_configured');
    const options = {
      env: { LOOKOUT_AWS_BILLING: '1', LOOKOUT_AWS_PROFILE: 'test' },
      awsFetcher: fetcher,
      now: () => current,
    };
    const billing = await createBilling(directory, options);
    const results = await Promise.all([billing.refresh(), billing.refresh()]);
    assert.equal(results[0].providers.aws.data.monthToDate, 20);
    assert.equal(results[1].providers.aws.data.monthToDate, 20);
    assert.equal(calls, 1);
    await billing.refresh();
    assert.equal(calls, 1);
    const reopened = await createBilling(directory, options);
    await reopened.refresh();
    assert.equal(calls, 1);
    current = new Date(at.getTime() + 7 * 3600000);
    assert.equal(reopened.view().providers.aws.status, 'stale');
    await reopened.refresh();
    assert.equal(calls, 2);
    const other = await createBilling(directory, {
      ...options,
      env: { LOOKOUT_AWS_BILLING: '1', LOOKOUT_AWS_PROFILE: 'different' },
    });
    assert.equal(other.view().providers.aws.data, null);
    const doBilling = await createBilling(directory, {
      env: { DIGITALOCEAN_TOKEN: 'secret-test-token' },
      doFetcher: fetcher,
      now: () => current,
    });
    await doBilling.refresh();
    assert.ok(!(await readFile(join(directory, 'billing-cache.json'), 'utf8')).includes('secret-test-token'));
    assert.ok(!JSON.stringify(doBilling.view()).includes('secret-test-token'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('billing failures never masquerade as a zero balance and are throttled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-billing-error-'));
  let calls = 0;
  try {
    const billing = await createBilling(directory, {
      env: { LOOKOUT_AWS_BILLING: '1' },
      now: () => at,
      awsFetcher: async () => {
        calls++;
        const error = new Error('credential-detail-that-must-not-leak');
        error.name = 'AccessDeniedException';
        throw error;
      },
    });
    await billing.refresh();
    await billing.refresh();
    const view = billing.view();
    assert.equal(calls, 1);
    assert.equal(view.providers.aws.status, 'error');
    assert.equal(view.providers.aws.data, null);
    assert.ok(!JSON.stringify(view).includes('credential-detail-that-must-not-leak'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('health collection and dashboard reads never fetch billing, even when AWS is enabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-billing-isolation-'));
  let billingCalls = 0,
    healthCalls = 0;
  const app = await createApp({
    dataDirectory: directory,
    schedule: false,
    checker: async () => {
      healthCalls++;
      return { at: at.toISOString(), status: 'healthy', message: 'Test observation' };
    },
    billingOptions: {
      env: { LOOKOUT_AWS_BILLING: '1' },
      now: () => at,
      awsFetcher: async () => {
        billingCalls++;
        return { currency: 'USD', monthToDate: 20, period: '2026-10', estimated: true };
      },
    },
  });
  try {
    const port = await app.start(0),
      base = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(`${base}/api/session`)).json()).token;
    const request = (path, method = 'GET', data) =>
      fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Lookout-Token': token },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    await request('/api/servers', 'POST', {
      name: 'Billing isolation',
      provider: 'AWS',
      check: { type: 'ssh', alias: 'test-server' },
      cost: cost(12),
    });
    await app.collect(); // The same collector used by the polling timer.
    await request('/api/check', 'POST', {});
    for (let i = 0; i < 3; i++) await request('/api/state');
    await request('/');
    assert.equal(healthCalls, 2);
    assert.equal(billingCalls, 0);
    assert.equal((await fetch(base + '/api/billing/refresh', { method: 'POST' })).status, 403);
    assert.equal(billingCalls, 0);
    await request('/api/billing/refresh', 'POST', {});
    assert.equal(billingCalls, 1);
    await request('/api/check', 'POST', {});
    await request('/api/state');
    await request('/api/billing/refresh', 'POST', {});
    assert.equal(healthCalls, 3);
    assert.equal(billingCalls, 1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('cost updates preserve health history, persist, export, clear and reject unauthenticated writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-cost-api-'));
  const observation = { at: at.toISOString(), status: 'healthy', message: 'Test observation' };
  const app = await createApp({
    dataDirectory: directory,
    schedule: false,
    billingOptions: { env: {} },
    checker: async () => observation,
  });
  try {
    const port = await app.start(0),
      base = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(`${base}/api/session`)).json()).token;
    const request = (path, method, data) =>
      fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Lookout-Token': token },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    const added = await (
      await request('/api/servers', 'POST', {
        name: 'Cost test',
        provider: 'Other',
        check: { type: 'tcp', host: 'localhost', port: 22 },
      })
    ).json();
    await request('/api/check', 'POST', { id: added.id });
    const path = `/api/servers/${added.id}/cost`;
    assert.equal((await fetch(base + path, { method: 'PUT' })).status, 403);
    assert.equal((await request(path, 'PUT', { cost: cost(-1) })).status, 400);
    assert.equal((await request(path, 'PUT', { cost: cost(12) })).status, 200);
    const updated = (await (await request('/api/state', 'GET')).json()).servers[0];
    assert.deepEqual(updated.latest, observation);
    assert.deepEqual(updated.history, [observation]);
    assert.equal(
      JSON.parse(await readFile(join(directory, 'registry.json'), 'utf8')).servers[0].cost.amount,
      12,
    );
    assert.equal((await (await request('/api/export', 'GET')).json()).servers[0].cost.amount, 12);
    await request(path, 'PUT', { cost: null });
    assert.equal((await (await request('/api/state', 'GET')).json()).costs.configured, 0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
