// Fixed Docker query: no commands, environment variables, labels, logs, or ports are exported.
export const DOCKER_COLLECTOR = String.raw`
import subprocess
try:
    template = '{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}}}'
    process = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'ps', '--all', '--no-trunc', '--last', '101', '--format', template], capture_output=True, timeout=2)
    if process.returncode:
        error = process.stderr.lower()
        result = {'status': 'permission_denied' if b'permission denied' in error else 'unavailable'}
    elif len(process.stdout) > 131072:
        result = {'status': 'invalid'}
    else:
        rows = [json.loads(line) for line in process.stdout.decode('utf-8').splitlines() if line.strip()]
        items = []
        for row in rows[:100]:
            items.append({key: str(row.get(key, ''))[:limit] for key, limit in [('id', 64), ('name', 128), ('image', 512), ('state', 16), ('status', 200)]})
        result = {'status': 'ok', 'containers': items, 'truncated': len(rows) > 100}
except FileNotFoundError:
    result = {'status': 'not_installed'}
except subprocess.TimeoutExpired:
    result = {'status': 'timeout'}
except Exception:
    result = {'status': 'invalid'}
print(json.dumps(result), flush=True)
`;

const failures = new Set(['permission_denied', 'unavailable', 'not_installed', 'timeout', 'invalid']);
const states = new Set(['created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead']);

/** Treat the remote output as untrusted and retain only the documented inventory fields. */
export function parseDocker(output) {
  try {
    const value = JSON.parse(output);
    if (failures.has(value?.status)) return { status: value.status };
    if (
      value?.status !== 'ok' ||
      !Array.isArray(value.containers) ||
      value.containers.length > 100 ||
      typeof value.truncated !== 'boolean'
    )
      throw new Error('Invalid inventory');
    const containers = value.containers.map((item) => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !/^[a-f0-9]{12,64}$/.test(item.id) ||
        !states.has(item.state)
      )
        throw new Error('Invalid container');
      for (const [key, max] of [
        ['name', 128],
        ['image', 512],
        ['status', 200],
      ]) {
        if (typeof item[key] !== 'string' || item[key].length > max || /[\x00-\x1f]/.test(item[key]))
          throw new Error('Invalid field');
      }
      const health =
        item.state === 'running'
          ? (/\((?:health(?: status)?:\s*)?(healthy|unhealthy|starting)\)$/i
              .exec(item.status)?.[1]
              .toLowerCase() ?? 'none')
          : 'not_running';
      return {
        id: item.id,
        name: item.name,
        image: item.image,
        state: item.state,
        status: item.status,
        health,
      };
    });
    if (new Set(containers.map((item) => item.id)).size !== containers.length)
      throw new Error('Duplicate container');
    return { status: 'ok', containers, truncated: value.truncated };
  } catch {
    return { status: 'invalid' };
  }
}
