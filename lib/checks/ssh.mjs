import { spawn } from 'node:child_process';
import { defaults } from '../config.mjs';
import { LINUX_COLLECTOR } from './linux-collector.mjs';

export function sshArgs(check) {
  // Alias is validated before this boundary; shell stays disabled.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(check.alias)) throw new Error('Invalid SSH alias.');
  return [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=8',
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    check.alias,
    'python3',
    '-',
  ];
}
export function parseMetrics(output) {
  const metrics = JSON.parse(output.trim());
  if (
    !metrics ||
    !['cpu', 'memory', 'disk'].every(
      (k) =>
        typeof metrics[k] === 'number' && Number.isFinite(metrics[k]) && metrics[k] >= 0 && metrics[k] <= 100,
    )
  )
    throw new Error('Invalid metric output.');
  return Object.fromEntries(['cpu', 'memory', 'disk'].map((k) => [k, metrics[k]]));
}
export function metricStatus(metrics, thresholds = defaults.thresholds) {
  return metrics.cpu >= thresholds.cpu ||
    metrics.memory >= thresholds.memory ||
    metrics.disk >= thresholds.disk
    ? 'warning'
    : 'healthy';
}
export function sshCheck(check, { thresholds }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn('ssh', sshArgs(check), {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      errorOutput = '',
      failure;
    const timer = setTimeout(() => {
      failure = new Error('SSH collection timed out; verify the host is reachable.');
      child.kill();
    }, check.timeoutMs);
    child.stdout.on('data', (data) => {
      output += data;
      if (Buffer.byteLength(output) > 16384) {
        failure = new Error('Unexpected collector output.');
        child.kill();
      }
    });
    child.stderr.on('data', (data) => {
      errorOutput = (errorOutput + data).slice(-4000);
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT' ? new Error('OpenSSH is not installed or is not on PATH.') : error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) {
        const message = /host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
          errorOutput,
        )
          ? 'SSH host key is untrusted or changed. Verify it in your terminal.'
          : /Permission denied/i.test(errorOutput)
            ? 'SSH authentication failed. Check your alias, key, or SSH agent.'
            : /python3.*not found|python3.*command not found/i.test(errorOutput)
              ? 'Python 3 is required on the Linux server.'
              : 'SSH collection failed. Check the alias, network, and remote Python 3.';
        return reject(new Error(message));
      }
      try {
        const metrics = parseMetrics(output);
        resolve({
          status: metricStatus(metrics, thresholds),
          metrics,
          latencyMs: Math.round(performance.now() - started),
          message:
            metricStatus(metrics, thresholds) === 'warning'
              ? 'Resource usage above threshold'
              : 'Linux metrics collected · root filesystem',
        });
      } catch {
        reject(new Error('Could not read Linux metrics. Check Python 3 and SSH login output.'));
      }
    });
    child.stdin.end(LINUX_COLLECTOR);
  });
}
