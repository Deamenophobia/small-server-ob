import http from 'node:http';
import https from 'node:https';

export function httpCheck(check, { thresholds }) {
  return new Promise((resolve, reject) => {
    const client = check.url.startsWith('https:') ? https : http;
    const started = performance.now();
    const request = client.get(
      check.url,
      { agent: false, headers: { 'User-Agent': 'Lookout-Local/0.1', Accept: '*/*' } },
      (response) => {
        const code = response.statusCode;
        response.destroy();
        const latencyMs = Math.round(performance.now() - started);
        const status =
          code >= 200 && code < 300
            ? latencyMs >= thresholds.latencyMs
              ? 'warning'
              : 'healthy'
            : code >= 300 && code < 400
              ? 'warning'
              : 'down';
        resolve({
          status,
          latencyMs,
          message: `HTTP ${code}${code >= 300 && code < 400 ? ' · redirect; use the final health URL' : latencyMs >= thresholds.latencyMs ? ' · slow response' : ''}`,
        });
      },
    );
    const timer = setTimeout(() => request.destroy(new Error('Check timed out.')), check.timeoutMs);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}
