import { createDemoApp } from '../lib/demo/app.mjs';

// Intentionally ignore .env, LOOKOUT_DATA_DIR, cloud credentials, and the user's registry.
const port = Number(process.argv[2] || 4311);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Demo port must be between 1 and 65535.');
const demo = await createDemoApp();
await demo.start(port);
console.log(
  `Fictional Small Server OB demo: http://127.0.0.1:${port}\nNo real servers, billing calls, or persistent registry. Ctrl+C to stop.`,
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await demo.close();
    process.exit(0);
  });
