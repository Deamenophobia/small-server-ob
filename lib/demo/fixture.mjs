/** Entirely fictional. Reserved example domains and invented prices are safe for documentation. */
export function createDemoRegistry(now = new Date()) {
  const records = [
    {
      name: 'Harbor API',
      provider: 'DigitalOcean',
      region: 'Amsterdam · demo',
      notes: 'Storefront API and product catalog. A fictional production service.',
      check: { type: 'ssh', alias: 'demo-harbor', timeoutMs: 10000, docker: true },
      metrics: { cpu: 18, memory: 43, disk: 31 },
      amount: 18,
    },
    {
      name: 'Atlas worker',
      provider: 'AWS',
      region: 'Oregon · demo',
      notes: 'Processes nightly reports. Disk usage is high in this example.',
      check: { type: 'ssh', alias: 'demo-atlas', timeoutMs: 10000, docker: true },
      metrics: { cpu: 44, memory: 62, disk: 89 },
      amount: 32,
    },
    {
      name: 'Preview site',
      provider: 'Hetzner',
      region: 'Helsinki · demo',
      notes: 'A staging website for reviewing the next release.',
      check: { type: 'http', url: 'https://preview.example.test/health', timeoutMs: 5000 },
      amount: 9,
    },
    {
      name: 'Cache lab',
      provider: 'Other',
      region: 'Local lab · demo',
      notes: 'A paused experiment. The last observation stays visible.',
      check: { type: 'tcp', host: 'cache.example.test', port: 6379, timeoutMs: 2000 },
      enabled: false,
      amount: 5,
    },
  ];
  return {
    version: 1,
    settings: { intervalSeconds: 30 },
    servers: records.map(({ metrics, amount, ...server }, index) => {
      const status = metrics?.disk >= 85 ? 'warning' : 'healthy';
      const history = Array.from({ length: 28 }, (_, sample) => ({
        at: new Date(now.getTime() - (27 - sample) * 30000).toISOString(),
        status: status === 'warning' && sample < 23 ? 'healthy' : status,
        latencyMs: server.check.type === 'ssh' ? 680 + index * 90 : 120,
        ...(metrics ? { metrics } : {}),
        message:
          server.check.type === 'ssh'
            ? status === 'warning'
              ? 'Example disk warning · synthetic metrics'
              : 'Example Linux metrics · synthetic data'
            : 'Example connection · no network request',
      }));
      return {
        ...server,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        enabled: server.enabled !== false,
        cost: {
          amount,
          currency: 'USD',
          period: 'monthly',
          basis: 'Illustrative budget for this fictional server; not a provider quote.',
          sourceUrl: '',
        },
        links: [{ label: 'Example console', url: `https://example.com/console/demo-${index + 1}` }],
        latest: {
          ...history.at(-1),
          ...(server.check.docker ? { docker: demoContainers(index === 1) } : {}),
        },
        history,
      };
    }),
  };
}

export function demoContainers(warning = false) {
  return {
    status: 'ok',
    truncated: false,
    containers: [
      {
        id: 'a'.repeat(64),
        name: warning ? 'report-worker' : 'storefront-api',
        image: 'example/app:1.0',
        state: 'running',
        status: warning ? 'Up 2 hours (unhealthy)' : 'Up 2 hours (healthy)',
        health: warning ? 'unhealthy' : 'healthy',
      },
      {
        id: 'b'.repeat(64),
        name: 'cache',
        image: 'redis:7-alpine',
        state: 'running',
        status: 'Up 2 hours',
        health: 'none',
      },
      {
        id: 'c'.repeat(64),
        name: 'nightly-backup',
        image: 'example/backup:1.0',
        state: 'exited',
        status: 'Exited (0) 4 hours ago',
        health: 'not_running',
      },
    ],
  };
}
