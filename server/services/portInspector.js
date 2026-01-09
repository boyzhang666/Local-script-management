import { normalizePid, normalizePort } from '../lib/pid.js';
import { isWindows } from './commandConfig.js';
import { collectOutput } from '../utils/collectOutput.js';

async function windowsProcessList() {
  const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
  let out = await collectOutput('powershell.exe', ['-NoProfile', '-Command', script]);
  if (!out.stdout || out.code !== 0) {
    out = await collectOutput('wmic', ['process', 'get', 'ProcessId,CommandLine', '/format:list']);
    const lines = String(out.stdout || '').split(/\r?\n/);
    const items = [];
    let pid = null;
    let cmd = '';
    for (const l of lines) {
      if (!l) {
        if (pid) {
          items.push({ pid, command: cmd || '' });
          pid = null;
          cmd = '';
        }
        continue;
      }
      const m = l.split('=');
      if (m[0] === 'ProcessId') pid = parseInt(m[1], 10);
      else if (m[0] === 'CommandLine') cmd = m.slice(1).join('=');
    }
    if (pid) items.push({ pid, command: cmd || '' });
    return items;
  }
  try {
    const parsed = JSON.parse(out.stdout);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((p) => ({ pid: parseInt(p.ProcessId, 10), command: String(p.CommandLine || '') })).filter((x) => Number.isFinite(x.pid));
  } catch {
    return [];
  }
}

async function windowsTaskImageMap() {
  const out = await collectOutput('tasklist', ['/FO', 'CSV']);
  const lines = String(out.stdout || '').split(/\r?\n/).filter(Boolean);
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const cols = [];
    let cur = '';
    let inq = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inq = !inq; continue; }
      if (ch === ',' && !inq) { cols.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur);
    const image = cols[0];
    const pid = parseInt(cols[1], 10);
    if (Number.isFinite(pid)) map.set(pid, image);
  }
  return map;
}

async function windowsProcessesByPort(portNum) {
  const out = await collectOutput('netstat', ['-ano']);
  if (out.code !== 0) throw new Error(out.stderr || 'netstat failed');
  const lines = String(out.stdout || '').split(/\r?\n/).filter(Boolean);
  const pids = new Set();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const proto = parts[0].toUpperCase();
    if (proto !== 'TCP' && proto !== 'UDP') continue;
    const local = parts[1];
    const pidStr = parts[parts.length - 1];
    const pid = parseInt(pidStr, 10);
    if (!Number.isFinite(pid)) continue;
    const m = local.match(/:(\d+)$/);
    if (!m) continue;
    const p = parseInt(m[1], 10);
    if (p === portNum) pids.add(pid);
  }
  const map = await windowsTaskImageMap();
  const items = [];
  for (const pid of pids) {
    const image = map.get(pid) || '';
    items.push({ pid, command: image, name: String(portNum) });
  }
  return items;
}

async function unixProcessesByPort(portNum) {
  const out = await collectOutput('lsof', ['-n', '-P', '-i', `:${portNum}`]);
  if (out.code !== 0) throw new Error(out.stderr || 'lsof failed');
  const lines = String(out.stdout || '').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const l of lines) {
    const parts = l.split(/\s+/);
    if (parts.length < 2) continue;
    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    if (!Number.isFinite(pid)) continue;
    const name = parts[parts.length - 1] || '';
    const statusMatch = name.match(/\(([^)]+)\)$/);
    const status = statusMatch ? statusMatch[1] : '';
    items.push({ pid, command, name, status });
  }
  return items;
}

export async function processesByPort(portNum) {
  if (isWindows()) return windowsProcessesByPort(portNum);
  return unixProcessesByPort(portNum);
}

export async function checkPortAvailability(port, options = {}) {
  const portNum = normalizePort(port);
  if (!portNum) return { ok: true, port: null, users: [] };
  try {
    const users = await processesByPort(portNum);
    const ignorePid = normalizePid(options.ignorePid);
    const runtimePid = normalizePid(options.runtimePid);
    const conflicts = users.filter((u) => {
      const pid = normalizePid(u.pid);
      if (!pid) return false;
      if (ignorePid && pid === ignorePid) return false;
      if (runtimePid && pid === runtimePid) return false;
      return true;
    });
    if (conflicts.length > 0) {
      return { ok: false, conflict: true, port: portNum, users: conflicts };
    }
    if (runtimePid && users.some((u) => normalizePid(u.pid) === runtimePid)) {
      return { ok: false, alreadyRunningPid: runtimePid, port: portNum, users };
    }
    return { ok: true, port: portNum, users };
  } catch (e) {
    return { ok: false, port: portNum, users: [], error: String(e) };
  }
}

export async function searchProcessesByName(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return [];
  if (isWindows()) {
    const list = await windowsProcessList();
    return list.filter((p) => String(p.command).toLowerCase().includes(needle)).map((p) => ({ pid: p.pid, command: p.command }));
  }
  const out = await collectOutput('ps', ['-A', '-o', 'pid=,command=']);
  const lines = String(out.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const l of lines) {
    const m = l.match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const command = m[2];
    if (String(command).toLowerCase().includes(needle)) {
      items.push({ pid, command });
    }
  }
  return items;
}
