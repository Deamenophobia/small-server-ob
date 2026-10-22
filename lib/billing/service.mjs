import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { monthInfo } from '../costs.mjs';
import { fetchAws } from './providers/aws.mjs';
import { fetchDigitalOcean } from './providers/digitalocean.mjs';

function safeError(error) {
  if (/AccessDenied|Unauthorized|Forbidden/i.test(error.name) || error.status === 401 || error.status === 403)
    return 'Billing permission denied. Check the read-only credentials and account access.';
  if (/Credentials|Token|SSO/i.test(error.name))
    return 'AWS credentials are unavailable or expired. Check your profile and sign in again.';
  if (error.name === 'DataUnavailableException')
    return 'AWS cost data is not available yet. Enable Cost Explorer in the provider console and retry later.';
  return 'Billing data could not be retrieved. Check the local credentials, network, and provider setup.';
}
// Billing is opt-in and fetched only on explicit refresh. Health polling never calls cloud billing APIs.
export async function createBilling(
  directory,
  {
    env = process.env,
    awsFetcher = fetchAws,
    doFetcher = fetchDigitalOcean,
    now = () => new Date(),
    cacheHours = 6,
    retrySeconds = 60,
  } = {},
) {
  const TTL = cacheHours * 60 * 60 * 1000;
  const file = join(directory, 'billing-cache.json');
  let cache = {},
    pending;
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) cache = data;
  } catch (error) {
    if (error.code !== 'ENOENT') cache = {};
  }
  const enabled = {
    aws: env.LOOKOUT_AWS_BILLING === '1',
    digitalocean: !!(env.DIGITALOCEAN_TOKEN || env.LOOKOUT_DO_TOKEN_FILE),
  };
  const profile = env.LOOKOUT_AWS_PROFILE || env.AWS_PROFILE || '';
  let doToken = env.DIGITALOCEAN_TOKEN || '',
    tokenError = false;
  if (!doToken && env.LOOKOUT_DO_TOKEN_FILE) {
    try {
      doToken = (await readFile(env.LOOKOUT_DO_TOKEN_FILE, 'utf8')).trim();
    } catch {
      tokenError = true;
    }
  }
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const identities = {
    aws: digest(profile || env.AWS_ACCESS_KEY_ID || 'default'),
    digitalocean: digest(doToken),
  };
  const cached = (provider) => {
    const entry = cache[provider];
    if (
      !entry ||
      entry.identity !== identities[provider] ||
      !Number.isFinite(Date.parse(entry.fetchedAt)) ||
      !Number.isFinite(entry.monthToDate) ||
      !/^[A-Z]{3}$/.test(entry.currency) ||
      !/^\d{4}-\d{2}$/.test(entry.period)
    )
      return null;
    return {
      currency: entry.currency,
      monthToDate: entry.monthToDate,
      ...(Number.isFinite(entry.balance) ? { balance: entry.balance } : {}),
      ...(Number.isFinite(Date.parse(entry.generatedAt)) ? { generatedAt: entry.generatedAt } : {}),
      period: entry.period,
      fetchedAt: entry.fetchedAt,
      estimated: !!entry.estimated,
    };
  };
  const errors = {};
  const view = () => ({
    checking: !!pending,
    cacheHours,
    providers: Object.fromEntries(
      ['aws', 'digitalocean'].map((provider) => {
        const result = enabled[provider] ? cached(provider) : null;
        const stale =
          !!result &&
          (now().getTime() - Date.parse(result.fetchedAt) > TTL ||
            result.period !== monthInfo(now()).month ||
            errors[provider]);
        return [
          provider,
          {
            enabled: enabled[provider],
            status: !enabled[provider]
              ? 'not_configured'
              : errors[provider]
                ? 'error'
                : result
                  ? stale
                    ? 'stale'
                    : 'ready'
                  : 'not_fetched',
            error: errors[provider] || null,
            data: result,
          },
        ];
      }),
    ),
  });
  async function refresh() {
    if (pending) {
      await pending;
      return view();
    }
    pending = (async () => {
      await Promise.all(
        ['aws', 'digitalocean'].map(async (provider) => {
          if (!enabled[provider]) return;
          const result = cached(provider);
          if (
            result &&
            now().getTime() - Date.parse(result.fetchedAt) < TTL &&
            result.period === monthInfo(now()).month
          )
            return;
          if (
            cache[provider]?.identity === identities[provider] &&
            cache[provider]?.attemptedAt &&
            now().getTime() - Date.parse(cache[provider].attemptedAt) < retrySeconds * 1000
          )
            return;
          cache[provider] = {
            ...(cache[provider]?.identity === identities[provider] ? cache[provider] : {}),
            identity: identities[provider],
            attemptedAt: now().toISOString(),
          };
          try {
            if (provider === 'digitalocean' && (!doToken || tokenError))
              throw new Error('Token file unavailable.');
            const data =
              provider === 'aws' ? await awsFetcher({ profile, env, now: now() }) : await doFetcher(doToken);
            cache[provider] = {
              ...data,
              identity: identities[provider],
              fetchedAt: now().toISOString(),
              attemptedAt: now().toISOString(),
            };
            errors[provider] = null;
          } catch (error) {
            errors[provider] = safeError(error);
          }
        }),
      );
      await writeFile(`${file}.tmp`, JSON.stringify(cache, null, 2), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    })().finally(() => {
      pending = null;
    });
    await pending;
    return view();
  }
  return {
    view,
    refresh,
    async close() {
      if (pending) await pending.catch(() => {});
    },
  };
}
