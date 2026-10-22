import net from 'node:net';

export function tcpCheck(check, { thresholds }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = net.createConnection({ host: check.host, port: check.port });
    const timer = setTimeout(() => socket.destroy(new Error('Check timed out.')), check.timeoutMs);
    socket.once('connect', () => {
      const latencyMs = Math.round(performance.now() - started);
      resolve({
        status: latencyMs >= thresholds.latencyMs ? 'warning' : 'healthy',
        latencyMs,
        message: `Port ${check.port} reachable${latencyMs >= thresholds.latencyMs ? ' · slow connection' : ''}`,
      });
      socket.destroy();
    });
    socket.once('error', reject);
    socket.once('close', () => clearTimeout(timer));
  });
}
