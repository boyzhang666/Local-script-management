import express from 'express';
import { startTask, stopTask, restartTask, getStatus, getLogs } from '../services/processManager.js';
import { readProjectsFile, writeProjectsFile, getProjectById } from '../services/storage.js';
import { genId, dedupeProjects } from '../lib/misc.js';

const router = express.Router();

router.post('/start', async (req, res) => {
  const result = await startTask(req.body || {});
  res.status(result.status ?? (result.ok ? 200 : 500)).json(result.body);
});

router.post('/stop', async (req, res) => {
  const result = await stopTask(req.body || {});
  res.status(result.status ?? (result.ok ? 200 : 500)).json(result.body);
});

router.post('/restart', async (req, res) => {
  const result = await restartTask(req.body || {});
  res.status(result.status ?? (result.ok ? 200 : 500)).json(result.body);
});

router.get('/status/:id', (req, res) => {
  const { id } = req.params;
  res.json(getStatus(id));
});

router.get('/logs/:id', (req, res) => {
  const { id } = req.params;
  res.json(getLogs(id));
});

router.get('/', (req, res) => {
  res.json(readProjectsFile());
});

router.post('/', (req, res) => {
  const data = req.body || {};
  const now = new Date().toISOString();
  const project = {
    id: typeof data.id === 'string' && data.id ? data.id : genId(),
    name: '',
    description: '',
    group: '',
    category: 'other',
    working_directory: '',
    start_command: '',
    stop_command: '',
    port: undefined,
    environment_variables: {},
    auto_restart: false,
    max_restarts: 5,
    restart_interval: 15,
    scheduled_start: '',
    scheduled_stop: '',
    restart_count: 0,
    manual_stopped: false,
    was_running_before_shutdown: false,
    runtime_pid: null,
    notes: '',
    order_index: 0,
    created_date: now,
    updated_date: now,
    last_started: undefined,
    ...data,
  };
  const items = readProjectsFile();
  const idx = items.findIndex(p => p.id === project.id);
  if (idx !== -1) {
    return res.json(items[idx]);
  }
  items.push(project);
  writeProjectsFile(items);
  res.json(project);
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const data = req.body || {};
  const items = readProjectsFile();
  const idx = items.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const now = new Date().toISOString();
  const updated = { ...items[idx], ...data, updated_date: now };
  items[idx] = updated;
  writeProjectsFile(items);
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const project = getProjectById(id);
  try {
    if (project) {
      // 先依据记录的 PID/命令停止任务，失败则中断删除并保留配置
      const stopResult = await stopTask({
        id,
        stop_command: project.stop_command,
        working_directory: project.working_directory,
        environment_variables: project.environment_variables,
      });
      if (!stopResult.ok) {
        return res.status(stopResult.status ?? 500).json({
          ok: false,
          error: stopResult.body?.error || 'failed to stop task before delete',
          detail: stopResult.body,
        });
      }
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }

  const items = readProjectsFile();
  const idx = items.findIndex((p) => p.id === id);
  const filtered = idx !== -1 ? items.filter((p) => p.id !== id) : items;
  if (idx !== -1) writeProjectsFile(filtered);

  res.json({ ok: true });
});

router.post('/dedupe', (req, res) => {
  const items = readProjectsFile();
  const before = items.length;
  const afterItems = dedupeProjects(items);
  const after = afterItems.length;
  writeProjectsFile(afterItems);
  res.json({ ok: true, removed: before - after, total: after });
});

export default router;
