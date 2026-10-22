import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { projectRoot } from '../lib/config.mjs';

const readme = await readFile(join(projectRoot, 'README.md'), 'utf8');
const imageDirectory = join(projectRoot, 'docs/images');
const manifest = JSON.parse(await readFile(join(imageDirectory, 'manifest.json'), 'utf8'));
if (manifest.source !== 'isolated-fictional-demo')
  throw new Error('Documentation images must come from the isolated fictional demo.');
const referenced = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
if (!referenced.length) throw new Error('README has no demo images.');
for (const reference of referenced) {
  if (!/^docs\/images\/[a-z-]+\.(?:png|jpg)$/.test(reference))
    throw new Error('README images must reference reviewed demo images under docs/images/.');
  const expected = manifest.images.find((image) => `docs/images/${image.file}` === reference);
  if (!expected) throw new Error(`Unregistered documentation image: ${reference}`);
  const bytes = await readFile(join(projectRoot, reference));
  const signature = bytes.subarray(0, 8).toString('hex');
  if (!(reference.endsWith('.jpg') ? signature.startsWith('ffd8ff') : signature === '89504e470d0a1a0a'))
    throw new Error(`Invalid image format: ${reference}`);
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256)
    throw new Error(`Image changed; review it before updating provenance: ${reference}`);
}
const actualImages = (await readdir(imageDirectory)).filter((name) => /\.(png|gif|jpe?g|webp)$/i.test(name));
if (actualImages.some((name) => !manifest.images.some((image) => image.file === name)))
  throw new Error('Unreviewed media exists in docs/images.');

// Never print private identifiers, even on failure. Pass a different registry path as the first argument.
const registryPath = resolve(process.argv[2] || join(projectRoot, 'data/registry.json'));
let identifiers = [];
try {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  identifiers = registry.servers
    .flatMap((server) => [
      server.name,
      server.notes,
      server.check?.alias,
      server.check?.host,
      server.check?.url,
    ])
    .filter((value) => typeof value === 'string' && value.length >= 4);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const files = ['README.md', 'lookout.config.example.json', '.env.example'];
async function scan(directory) {
  for (const entry of await readdir(join(projectRoot, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory() && name !== 'docs/images') await scan(name);
    else if (entry.isFile() && /\.(md|json|mjs|js|html|css)$/.test(name)) files.push(name);
  }
}
for (const directory of ['docs', 'lib/demo', 'public']) await scan(directory);
for (const file of files) {
  const content = (await readFile(join(projectRoot, file), 'utf8')).toLowerCase();
  if (identifiers.some((value) => content.includes(value.toLowerCase())))
    throw new Error(`Private registry identifier detected in ${file}; remove it before sharing.`);
}
console.log(
  `Verified ${referenced.length} reviewed demo images and ${files.length} documentation/demo/UI text files. ${identifiers.length ? 'Local server identifiers were checked without displaying them.' : 'No local registry was available for identifier comparison.'}`,
);
