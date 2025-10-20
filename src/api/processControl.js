const BASE_URL = 'http://127.0.0.1:3001/api';

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

export async function startProject(project) {
  const res = await fetch(`${BASE_URL}/projects/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: project.id,
      start_command: project.start_command,
      working_directory: project.working_directory,
      environment_variables: project.environment_variables,
      port: project.port,
      startup_timeout_ms: 2000,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Return structured error from backend so caller can show real logs
    if (data) return data;
    throw new Error(`HTTP ${res.status}`);
  }
  return data;
}

export async function stopProject(projectOrId) {
  const payload = typeof projectOrId === 'object' && projectOrId !== null
    ? {
        id: projectOrId.id,
        stop_command: projectOrId.stop_command,
        working_directory: projectOrId.working_directory,
        environment_variables: projectOrId.environment_variables,
      }
    : { id: projectOrId };
  return jsonFetch(`${BASE_URL}/projects/stop`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getProjectStatus(id) {
  return jsonFetch(`${BASE_URL}/projects/status/${id}`);
}

export async function getProjectLogs(id) {
  return jsonFetch(`${BASE_URL}/projects/logs/${id}`);
}