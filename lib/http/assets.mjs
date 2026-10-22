import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

/** Enumerate public files once; URL input is never used to resolve filesystem paths. */
export async function createAssets(directory) {
  const files = new Map();
  async function scan(relative = '') {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await scan(name);
      else if (entry.isFile() && mime[extname(name)])
        files.set(`/${name}`, { path: join(directory, name), type: mime[extname(name)] });
    }
  }
  await scan();
  files.set('/', files.get('/index.html'));
  return async (path, response) => {
    const file = files.get(path);
    if (!file) return false;
    const contents = await readFile(file.path);
    response.writeHead(200, { 'Content-Type': `${file.type}; charset=utf-8` });
    response.end(contents);
    return true;
  };
}
