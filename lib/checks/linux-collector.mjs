// Fixed, read-only Linux program. No user input is interpolated into the command.
export const LINUX_COLLECTOR = `import json, time, shutil
def cpu():
    with open('/proc/stat') as f:
        values = list(map(int, f.readline().split()[1:9]))
    return sum(values), values[3] + values[4]
a = cpu()
time.sleep(0.4)
b = cpu()
memory = {}
with open('/proc/meminfo') as f:
    for line in f:
        key, value = line.split(':', 1)
        memory[key] = int(value.split()[0])
available = memory.get('MemAvailable', memory.get('MemFree', 0) + memory.get('Buffers', 0) + memory.get('Cached', 0))
disk = shutil.disk_usage('/')
result = {'cpu': round(100 * (1 - (b[1] - a[1]) / max(1, b[0] - a[0])), 1), 'memory': round(100 * (1 - available / memory['MemTotal']), 1), 'disk': round(100 * disk.used / disk.total, 1)}
print(json.dumps(result))
`;
