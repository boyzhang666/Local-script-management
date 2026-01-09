const BASE_URL = '/api';

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getCommandConfig() {
  return jsonFetch(`${BASE_URL}/command-config`);
}

export async function updateCommandConfig(config) {
  return jsonFetch(`${BASE_URL}/command-config`, {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}

export async function resetCommandConfig() {
  return jsonFetch(`${BASE_URL}/command-config/reset`, {
    method: 'POST',
  });
}
