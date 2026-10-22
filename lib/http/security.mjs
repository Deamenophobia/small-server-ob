import { randomBytes, timingSafeEqual } from 'node:crypto';
import { RequestError } from './errors.mjs';

export function createLocalSecurity() {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    verify(request, response, port) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
      const origins = new Set([...hosts].map((host) => `http://${host}`));
      if (
        !hosts.has(request.headers.host) ||
        (request.headers.origin && !origins.has(request.headers.origin)) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new RequestError(403, 'Only this local dashboard can access the registry.');
      if (request.method !== 'GET') {
        const supplied = request.headers['x-lookout-token'];
        if (
          typeof supplied !== 'string' ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        )
          throw new RequestError(403, 'Reload the dashboard to reconnect securely.');
      }
    },
  };
}
