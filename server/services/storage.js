import fs from 'fs';
import { taskFilePath } from '../lib/paths.js';
import { dedupeProjects } from '../lib/misc.js';
import { normalizePid, isPidAlive } from '../lib/pid.js';

export function writeProjectsFile(items) {
  try {
    const sanitized = (Array.isArray(items) ? items : []).map((p) => {
      if (!p || typeof p !== 'object') return p;
      const { status, ...rest } = p;
      return rest;
    });
    fs.writeFileSync(taskFilePath(), JSON.stringify(sanitized, null, 2));
  } catch (err) {
    console.error('[storage] Failed to write tasks.json:', String(err));
  }
}

export function readProjectsFile() {
  try {
    const raw = fs.readFileSync(taskFilePath(), 'utf8');
    const arr = JSON.parse(raw);
    const items = Array.isArray(arr) ? arr : [];
    return dedupeProjects(items);
  } catch (err) {
    // 第一次运行或任务文件损坏时，返回空任务列表
    if (err.code !== 'ENOENT') {
      console.error('[storage] Failed to read tasks.json:', String(err));
    }
    return [];
  }
}

export function getProjectById(id) {
  if (!id) return null;
  const items = readProjectsFile();
  return items.find((p) => p && p.id === id) || null;
}

export function patchProject(id, patch, opts = {}) {
  const items = readProjectsFile();
  const idx = items.findIndex((p) => p && p.id === id);
  if (idx === -1) return;
  const now = new Date().toISOString();
  const updated = { ...items[idx], ...patch };
  if (!opts.skipUpdatedDate) {
    updated.updated_date = now;
  }
  items[idx] = updated;
  writeProjectsFile(items);
}

export function resetPersistedRuntimeStateOnBoot() {
  const items = readProjectsFile();
  if (!items || items.length === 0) return;
  let changed = false;
  const next = items.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const pid = normalizePid(p.runtime_pid);
    const alive = pid ? isPidAlive(pid) : false;
    const hadWasRunning = !!p.was_running_before_shutdown;
    if (alive) {
      if (hadWasRunning) {
        changed = true;
        return { ...p, was_running_before_shutdown: false };
      }
      return p;
    }
    if (!pid && !hadWasRunning) return p;
    changed = true;
    return { ...p, runtime_pid: null, was_running_before_shutdown: false };
  });
  if (changed) writeProjectsFile(next);
}
