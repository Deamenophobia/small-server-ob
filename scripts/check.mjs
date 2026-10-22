import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from '../lib/config.mjs';

const files = ['server.mjs'];
async function scan(directory) {
  for (const entry of await readdir(join(projectRoot, directory), { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (/\.(mjs|js)$/.test(file)) files.push(file);
  }
}
for (const directory of ['lib', 'public', 'scripts', 'test']) await scan(directory);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', join(projectRoot, file)], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
