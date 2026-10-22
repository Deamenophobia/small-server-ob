export function makeDemo() {
  const records = [
    [
      'Production API',
      'DigitalOcean',
      'Singapore · SGP1',
      'Primary API for the storefront. Deploys from the main branch.',
      [24, 42, 36],
      'healthy',
    ],
    [
      'Application server',
      'AWS',
      'Singapore · ap-southeast-1',
      'Web app and background workers. Production environment.',
      [37, 58, 49],
      'healthy',
    ],
    [
      'Analytics worker',
      'DigitalOcean',
      'Frankfurt · FRA1',
      'Nightly analytics and reports. Keep an eye on disk usage.',
      [12, 64, 89],
      'warning',
    ],
    [
      'Staging environment',
      'AWS',
      'Tokyo · ap-northeast-1',
      'A quiet place to test the next release before it goes live.',
      [8, 29, 23],
      'healthy',
    ],
    [
      'Personal services',
      'Hetzner',
      'Helsinki · HEL1',
      'Small experiments, side projects, and a few useful things.',
      [18, 35, 31],
      'healthy',
    ],
  ];
  return records.map(([name, provider, region, notes, values, status], index) => {
    const metrics = Object.fromEntries(['cpu', 'memory', 'disk'].map((key, i) => [key, values[i]]));
    const history = Array.from({ length: 28 }, (_, i) => ({
      at: new Date(Date.now() - (27 - i) * 30000).toISOString(),
      status: status === 'warning' && i > 22 ? 'warning' : 'healthy',
      latencyMs: 150 + index * 19,
      metrics,
      message:
        status === 'warning'
          ? 'Root filesystem usage above threshold'
          : 'Linux metrics collected · root filesystem',
    }));
    return {
      id: `demo-${index}`,
      name,
      provider,
      region,
      notes,
      check: { type: 'ssh', alias: `example-host-${index + 1}`, timeoutMs: 10000 },
      enabled: true,
      status,
      history,
      latest: history.at(-1),
      links: [
        {
          label: 'Provider console',
          url:
            provider === 'AWS'
              ? 'https://console.aws.amazon.com/'
              : provider === 'DigitalOcean'
                ? 'https://cloud.digitalocean.com/'
                : 'https://console.hetzner.cloud/',
        },
      ],
    };
  });
}
