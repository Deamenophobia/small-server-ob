import { spawn } from 'node:child_process';
import { defaults } from '../config.mjs';
import { LINUX_COLLECTOR } from './linux-collector.mjs';
import { DOCKER_COLLECTOR, parseDocker } from './docker.mjs';

export const sshCollector = (check) => LINUX_COLLECTOR + (check.docker === true ? DOCKER_COLLECTOR : '');

export function parseSshObservation(output, check, thresholds = defaults.thresholds, interrupted = false) {
  const lines = output.trim().split(/\r?\n/);
  const metrics = parseMetrics(lines[0]);
  const status = metricStatus(metrics, thresholds);
  return {
    status,
    metrics,
    ...(check.docker === true
      ? {
          docker: interrupted
            ? { status: interrupted === 'invalid' ? 'invalid' : 'timeout' }
            : parseDocker(lines[1]),
        }
      : {}),
    message:
      status === 'warning' ? 'Resource usage above threshold' : 'Linux metrics collected · root filesystem',
  };
}

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
export function sshCheck(check, { thresholds }, spawnSsh = spawn) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawnSsh('ssh', sshArgs(check), {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      errorOutput = '',
      failure,
      dockerFailure;
    const timer = setTimeout(() => {
      failure = new Error('SSH collection timed out; verify the host is reachable.');
      child.kill();
    }, check.timeoutMs);
    child.stdout.on('data', (data) => {
      if (failure) return;
      output += data;
      if (Buffer.byteLength(output) > (check.docker === true ? 131072 : 16384)) {
        failure = new Error('Unexpected collector output.');
        dockerFailure = 'invalid';
        output =
          check.docker === true && output.includes('\n') ? output.slice(0, output.indexOf('\n') + 1) : '';
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
      // The first flushed line is a complete host reading. Keep it if optional Docker work times out.
      const partial = check.docker === true && output.includes('\n');
      if (failure && !partial) return reject(failure);
      if (code !== 0 && !partial) {
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
        resolve({
          ...parseSshObservation(output, check, thresholds, dockerFailure || !!failure || code !== 0),
          latencyMs: Math.round(performance.now() - started),
        });
      } catch {
        reject(new Error('Could not read Linux metrics. Check Python 3 and SSH login output.'));
      }
    });
    child.stdin.end(sshCollector(check));
  });
}
