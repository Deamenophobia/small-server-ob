import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from '../lib/config.mjs';

// Check the Git index, including staged files that bypass .gitignore.
// Never print matching secret values or private server identifiers.
const files = execFileSync('git', ['ls-files', '-z'], {
  cwd: projectRoot,
  encoding: 'utf8',
  windowsHide: true,
})
  .split('\0')
  .filter(Boolean);
if (!files.length) throw new Error('No tracked files to check; stage the intended source files first.');

const privatePath =
  /(?:^|\/)(?:data|test-results|node_modules|\.npm|coverage|\.ssh|\.aws)(?:\/|$)|(?:^|\/)\.env(?:\..+)?$|(?:^|\/)(?:lookout\.config\.json|registry(?:\.[^/]+)?\.json|junit\.xml|id_rsa[^/]*|id_ed25519[^/]*|credentials)$|\.(?:pem|key|log)$/i;
const secretPatterns = [
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bdop_v1_[a-f0-9]{64}\b/i,
];

let identifiers = [];
try {
  const registry = JSON.parse(await readFile(join(projectRoot, 'data/registry.json'), 'utf8'));
  identifiers = registry.servers
    .flatMap((server) => [
      server.name,
      server.notes,
      server.check?.alias,
      server.check?.host,
      server.check?.url,
      ...(server.links || []).map((link) => link.url),
    ])
    .filter((value) => typeof value === 'string' && value.length >= 4);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let textFiles = 0;
for (const file of files) {
  if (file !== '.env.example' && privatePath.test(file))
    throw new Error(`Private/runtime file is tracked: ${file}. Remove it from the index before sharing.`);
  const bytes = execFileSync('git', ['show', `:${file}`], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (bytes.includes(0)) continue;
  textFiles++;
  const content = bytes.toString('utf8');
  if (secretPatterns.some((pattern) => pattern.test(content)))
    throw new Error(`Possible credential detected in ${file}; review it before sharing.`);
  if (identifiers.some((value) => content.toLowerCase().includes(value.toLowerCase())))
    throw new Error(`Private server identifier detected in ${file}; remove it before sharing.`);
}
console.log(
  `Checked ${files.length} tracked paths and ${textFiles} text files for runtime data and common credential patterns.`,
);
console.log(
  identifiers.length
    ? 'Compared against local server identifiers without displaying them.'
    : 'No local registry available; local-identifier comparison skipped.',
);
