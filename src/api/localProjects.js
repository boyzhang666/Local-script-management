// Simple local storage backed project store
// Provides list, create, update operations similar to the previous Base44 client

const STORAGE_KEY = 'dev_deck_projects';

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to load projects from localStorage:', e);
    return [];
  }
}

function saveProjects(projects) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.warn('Failed to save projects to localStorage:', e);
  }
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

export function listProjects(sort = '-updated_date') {
  const projects = loadProjects();
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
    status: typeof p.status === 'string' ? p.status : 'stopped',
    notes: typeof p.notes === 'string' ? p.notes : '',
  }));
  return sortByField(normalized, sort);
}

function generateId() {
  // Simple unique id generator
  return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function createProject(data) {
  const now = new Date().toISOString();
  const project = {
    id: generateId(),
    name: '',
    description: '',
    group: '',
    category: 'other',
    working_directory: '',
    start_command: '',
    stop_command: '',
    port: undefined,
    environment_variables: {},
    status: 'stopped',
    auto_restart: false,
    max_restarts: 5,
    restart_interval: 15,
    scheduled_start: '',
    scheduled_stop: '',
    restart_count: 0,
    manual_stopped: false,
    was_running_before_shutdown: false, // 记录上一次会话中是否处于运行状态，用于系统重启后的守护逻辑
    notes: '',
    // 可用于自定义排序的权重（暂未在UI暴露，保留字段以供将来使用）
    order_index: 0,
    created_date: now,
    updated_date: now,
    last_started: undefined,
    ...data,
  };
  const projects = loadProjects();
  projects.push(project);
  saveProjects(projects);
  return project;
}

export function updateProject(id, data) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) {
    throw new Error('Project not found: ' + id);
  }
  const now = new Date().toISOString();
  const updated = {
    ...projects[idx],
    ...data,
    updated_date: now,
  };
  projects[idx] = updated;
  saveProjects(projects);
  return updated;
}

export function deleteProject(id) {
  const projects = loadProjects();
  const filtered = projects.filter(p => p.id !== id);
  saveProjects(filtered);
}