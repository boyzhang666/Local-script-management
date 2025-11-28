// Backend JSON file-backed project store via REST API
const BASE_URL = '/api';

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

function sortByField(items, sort) {
  if (!sort) return items;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return items.slice().sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv);
      return desc ? -cmp : cmp;
    }
    if (av > bv) return desc ? -1 : 1;
    if (av < bv) return desc ? 1 : -1;
    return 0;
  });
}

export async function listProjects(sort = '-updated_date') {
  const projects = await jsonFetch(`${BASE_URL}/projects`);
  // 软迁移：修复旧数据中可能出现的类型问题，避免 UI 受控组件异常
  const normalized = projects.map(p => ({
    ...p,
    group: typeof p.group === 'string' ? p.group : '',
    category: typeof p.category === 'string' ? p.category : 'other',
    environment_variables: (p.environment_variables && typeof p.environment_variables === 'object') ? p.environment_variables : {},
    port: typeof p.port === 'number' ? p.port : '',
    max_restarts: typeof p.max_restarts === 'number' ? p.max_restarts : 5,
    restart_interval: typeof p.restart_interval === 'number' ? p.restart_interval : 15,
    restart_count: typeof p.restart_count === 'number' ? p.restart_count : 0,
    manual_stopped: typeof p.manual_stopped === 'boolean' ? p.manual_stopped : false,
    was_running_before_shutdown: typeof p.was_running_before_shutdown === 'boolean' ? p.was_running_before_shutdown : false,
    notes: typeof p.notes === 'string' ? p.notes : '',
  }));
  return sortByField(normalized, sort);
}

function generateId() {
  // Simple unique id generator
  return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export async function createProject(data) {
  return jsonFetch(`${BASE_URL}/projects`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateProject(id, data) {
  return jsonFetch(`${BASE_URL}/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteProject(id) {
  await jsonFetch(`${BASE_URL}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
