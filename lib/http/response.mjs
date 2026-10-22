import { ValidationError } from '../model.mjs';

export function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

export async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new ValidationError('JSON request required.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new ValidationError('Request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ValidationError('Invalid JSON.');
  }
}
