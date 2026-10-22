let token;
export async function api(path, { method = 'GET', data } = {}) {
  if (!token && method !== 'GET') token = (await api('/api/session')).token;
  const response = await fetch(path, {
    method,
    headers: {
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-Lookout-Token': token } : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('The local backend is unavailable. Restart Lookout and reload this page.');
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 403) token = null;
    throw new Error(body.error || 'Request failed.');
  }
  return body;
}
