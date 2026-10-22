import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './lib/app.mjs';
import { loadConfig, projectRoot } from './lib/config.mjs';

export { createApp } from './lib/app.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    try {
      process.loadEnvFile(join(projectRoot, '.env'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const config = await loadConfig();
    const instance = await createApp({ config });
    await instance.start();
    console.log(
      `Lookout is ready at http://127.0.0.1:${config.port}\nRegistry: ${instance.store.directory}\nPress Ctrl+C to stop.`,
    );
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, async () => {
        if (closing) return;
        closing = true;
        await instance.close();
        process.exit(0);
      });
  } catch (error) {
    console.error(
      error.code === 'EADDRINUSE'
        ? 'Port is already in use. Set PORT to a different local port.'
        : error.message,
    );
    process.exitCode = 1;
  }
}
