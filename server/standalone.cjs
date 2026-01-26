const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());
app.use(cors());

function genId() { return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function dedupeProjects(items) {
  const map = new Map();
  for (const p of items) {
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || '').trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) { map.set(id, p); continue; }
    const pTime = Date.parse(p.updated_date || '') || 0;
    const prevTime = Date.parse(prev.updated_date || '') || 0;
    if (pTime > prevTime) map.set(id, p);
  }
  return Array.from(map.values());
}

function patchProject(id, patch, opts = {}) {
  const items = readProjectsFile();
  const idx = items.findIndex((p) => p && p.id === id);
  if (idx === -1) return;
  const now = new Date().toISOString();
  const updated = { ...items[idx], ...patch };
  if (!opts.skipUpdatedDate) updated.updated_date = now;
  items[idx] = updated;
  writeProjectsFile(items);
}

function isPidAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

const processes = new Map();
function isRunning(child) { return child && child.exitCode === null && !child.killed; }
const guardianState = new Map(); // id -> { nextAttemptAt: number }
function ringBuffer(limit = 200) {
  const arr = [];
  return { push(line){ arr.push(line); if (arr.length > limit) arr.shift(); }, get(){ return arr.slice(); }, clear(){ arr.length = 0; } };
}

function baseRunDir() {
  try {
    return typeof process.pkg !== 'undefined'
      ? path.dirname(process.execPath)
      : process.cwd();
  } catch {
    return process.cwd();
  }
}

function ensureTaskDir() {
  const base = baseRunDir();
  const dir = path.join(base, 'task');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {}
  return dir;
}

function taskFilePath() {
  const dir = ensureTaskDir();
  return path.join(dir, 'tasks.json');
}

function writeProjectsFile(items) {
  try {
    const sanitized = (Array.isArray(items) ? items : []).map((p) => {
      if (!p || typeof p !== 'object') return p;
      const { status, runtime_pid, ...rest } = p;
      return rest;
    });
    fs.writeFileSync(taskFilePath(), JSON.stringify(sanitized, null, 2));
  } catch {}
}

function readProjectsFile() {
  try {
    const raw = fs.readFileSync(taskFilePath(), 'utf8');
    const arr = JSON.parse(raw);
    const items = Array.isArray(arr) ? arr : [];
    return dedupeProjects(items);
  } catch {
    // 如果任务文件不存在或损坏，返回空任务列表
    return [];
  }
}
function collectOutput(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, ...options });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { resolve({ stdout: '', stderr: String(err), code: 1 }); });
    child.on('close', (code) => { resolve({ stdout, stderr, code }); });
  });
}

function isWindows() { return process.platform === 'win32'; }
async function windowsProcessList() {
  const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
  let out = await collectOutput('powershell.exe', ['-NoProfile', '-Command', script]);
  if (!out.stdout || out.code !== 0) {
    out = await collectOutput('wmic', ['process', 'get', 'ProcessId,CommandLine', '/format:list']);
    const lines = String(out.stdout || '').split(/\r?\n/);
    const items = []; let pid = null; let cmd = '';
    for (const l of lines) {
      if (!l) { if (pid) { items.push({ pid, command: cmd || '' }); pid = null; cmd = ''; } continue; }
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
  } catch { return []; }
}
async function windowsTaskImageMap() {
  const out = await collectOutput('tasklist', ['/FO', 'CSV']);
  const lines = String(out.stdout || '').split(/\r?\n/).filter(Boolean);
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]; const cols = []; let cur = ''; let inq = false;
    for (let j = 0; j < line.length; j++) { const ch = line[j]; if (ch === '"') { inq = !inq; continue; } if (ch === ',' && !inq) { cols.push(cur); cur = ''; continue; } cur += ch; }
    cols.push(cur);
    const image = cols[0]; const pid = parseInt(cols[1], 10);
    if (Number.isFinite(pid)) map.set(pid, image);
  }
  return map;
}
async function windowsProcessesByPort(portNum) {
  const out = await collectOutput('netstat', ['-ano']);
  const lines = String(out.stdout || '').split(/\r?\n/).filter(Boolean);
  const pids = new Set();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/); if (parts.length < 5) continue;
    const proto = parts[0].toUpperCase(); if (proto !== 'TCP' && proto !== 'UDP') continue;
    const local = parts[1]; const pidStr = parts[parts.length - 1]; const pid = parseInt(pidStr, 10); if (!Number.isFinite(pid)) continue;
    const m = local.match(/:(\d+)$/); if (!m) continue; const p = parseInt(m[1], 10); if (p === portNum) pids.add(pid);
  }
  const map = await windowsTaskImageMap(); const items = [];
  for (const pid of pids) { const image = map.get(pid) || ''; items.push({ pid, command: image, name: String(portNum) }); }
  return items;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTaskRunning(id) {
  const entry = processes.get(id);
  return !!entry && isRunning(entry.child);
}

async function waitForRunning(id, attempts = 10, intervalMs = 800) {
  for (let i = 0; i < attempts; i++) {
    if (isTaskRunning(id)) return true;
    await sleep(intervalMs);
  }
  return isTaskRunning(id);
}

async function guardianAttemptStart(project) {
  const id = String(project.id || '').trim();
  const start_command = project.start_command;
  if (!id || !start_command || !String(start_command).trim()) return false;
  if (isTaskRunning(id)) return true;

  const env = { ...process.env, ...((project.environment_variables && typeof project.environment_variables === 'object') ? project.environment_variables : {}) };
  const command = start_command;
  const cwd = safeCwd(project.working_directory);
  const child = spawn(command, { cwd, env, shell: true });
  const stdoutBuf = ringBuffer(500); const stderrBuf = ringBuffer(500);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
  child.on('error', (err) => {
    const entry = processes.get(id);
    if (entry) { entry.status = 'stopped'; entry.exitCode = -1; entry.signal = null; }
    console.error(`[guard] failed to start task ${id}: ${String(err)}`);
  });
  child.on('exit', (code, signal) => {
    const entry = processes.get(id);
    if (entry) { entry.status = 'stopped'; entry.exitCode = code; entry.signal = signal; }
  });
  processes.set(id, { child, status: 'running', command, cwd, env, startedAt: new Date().toISOString(), stdoutBuf, stderrBuf });

  const timeoutMs = 2000;
  const attempts = Math.max(2, Math.round(timeoutMs / 800));
  const ok = await waitForRunning(id, attempts, 800);
  return ok;
}

async function shutdown(signal) {
  try {
    console.log(`Received ${signal}, shutting down tasks...`);
    const promises = [];
    for (const [id, entry] of processes.entries()) {
      if (!entry || !isRunning(entry.child)) continue;
      promises.push(new Promise((resolve) => {
        treeKill(entry.child.pid, 'SIGTERM', () => resolve(null));
      }));
    }
    await Promise.all(promises);
  } catch (e) {
    console.error('Error while shutting down tasks:', String(e));
  } finally {
    process.exit(0);
  }
}

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    shutdown(sig);
  });
});

app.post('/api/projects/start', (req, res) => {
  const { id, start_command, working_directory, environment_variables, startup_timeout_ms } = req.body || {};
  if (!id || !start_command) return res.status(400).json({ error: 'id and start_command are required' });
  const existing = processes.get(id);
  if (existing && isRunning(existing.child)) treeKill(existing.child.pid, 'SIGTERM');
  const env = { ...process.env, ...((environment_variables && typeof environment_variables === 'object') ? environment_variables : {}) };
  const command = start_command;
  const child = spawn(command, { cwd: safeCwd(working_directory), env, shell: true });
  const stdoutBuf = ringBuffer(500); const stderrBuf = ringBuffer(500);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
  let responded = false;
  const respondOk = () => { if (responded) return; responded = true; res.json({ ok: true, pid: child.pid }); };
  const respondFail = (message, code = null, signal = null) => { if (responded) return; responded = true; res.status(500).json({ ok: false, error: message, code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); };
  child.on('error', (err) => { const entry = processes.get(id); if (entry) { entry.status = 'stopped'; entry.exitCode = -1; entry.signal = null; } respondFail(`spawn error: ${String(err)}`); });
  child.on('exit', (code, signal) => {
    const entry = processes.get(id);
    if (entry) { entry.status = 'stopped'; entry.exitCode = code; entry.signal = signal; }
    if (!responded) respondFail(`process exited with code ${code}${signal ? `, signal ${signal}` : ''}`, code, signal);
  });
  processes.set(id, { child, status: 'running', command, cwd: working_directory || process.cwd(), env, startedAt: new Date().toISOString(), stdoutBuf, stderrBuf });
  patchProject(id, { was_running_before_shutdown: true });
  const timeout = typeof startup_timeout_ms === 'number' && startup_timeout_ms > 0 ? startup_timeout_ms : 2000;
  setTimeout(() => { if (responded) return; if (isRunning(child)) { console.log(`[task] started id=${id} pid=${child.pid} cmd=${command}`); respondOk(); } else respondFail('process not running after startup timeout'); }, timeout);
});

app.post('/api/projects/stop', (req, res) => {
  const { id, stop_command, working_directory, environment_variables } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const spawnStopCommand = () => {
    if (!stop_command) return res.json({ ok: true, message: 'not running' });
    const env = { ...process.env, ...((environment_variables && typeof environment_variables === 'object') ? environment_variables : {}) };
    const child = spawn(stop_command, { cwd: safeCwd(working_directory), env, shell: true });
    const stdoutBuf = ringBuffer(200); const stderrBuf = ringBuffer(200);
    child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
    child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
    child.on('error', (err) => { res.status(500).json({ ok: false, error: `stop_command spawn error: ${String(err)}`, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); });
    child.on('exit', (code, signal) => { if (code === 0) res.json({ ok: true, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); else res.status(500).json({ ok: false, error: `stop_command exited with code ${code}${signal ? `, signal ${signal}` : ''}`, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); });
  };
  const entry = processes.get(id);
  if (!entry || !isRunning(entry.child)) {
    return spawnStopCommand();
  }
  treeKill(entry.child.pid, 'SIGTERM', (err) => {
    if (err) return spawnStopCommand();
    entry.status = 'stopped';
    console.log(`[task] stopped id=${id} pid=${entry.child.pid}`);
    res.json({ ok: true });
  });
});

app.get('/api/projects/status/:id', (req, res) => {
  const { id } = req.params;
  const entry = processes.get(id);
  const running = entry ? isRunning(entry.child) : false;
  const pid = running ? (entry?.child?.pid || null) : null;
  const status = running ? 'running' : 'stopped';
  res.json({ running, status, pid });
});

app.get('/api/projects/logs/:id', (req, res) => { const { id } = req.params; const entry = processes.get(id); if (!entry) return res.json({ stdout: [], stderr: [] }); res.json({ stdout: entry.stdoutBuf.get(), stderr: entry.stderrBuf.get() }); });

app.get('/api/processes/search', async (req, res) => {
  const name = String(req.query.name || '').trim(); if (!name) return res.json([]);
  if (isWindows()) { const list = await windowsProcessList(); const needle = name.toLowerCase(); const items = list.filter((p) => String(p.command).toLowerCase().includes(needle)).map((p) => ({ pid: p.pid, command: p.command })); return res.json(items); }
  const out = await collectOutput('ps', ['-A', '-o', 'pid=,command=']);
  const lines = String(out.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const needle = name.toLowerCase(); const items = [];
  for (const l of lines) { const m = l.match(/^(\d+)\s+(.*)$/); if (!m) continue; const pid = parseInt(m[1], 10); const command = m[2]; if (String(command).toLowerCase().includes(needle)) items.push({ pid, command }); }
  res.json(items);
});

app.get('/api/processes/by-port/:port', async (req, res) => {
  const portNum = parseInt(String(req.params.port || '').trim(), 10);
  if (!Number.isFinite(portNum) || portNum <= 0) return res.status(400).json({ error: 'invalid port' });
  if (isWindows()) { const items = await windowsProcessesByPort(portNum); return res.json(items); }
  const out = await collectOutput('lsof', ['-n', '-P', '-i', `:${portNum}`]);
  const lines = String(out.stdout || '').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const l of lines) { const parts = l.split(/\s+/); if (parts.length < 2) continue; const command = parts[0]; const pid = parseInt(parts[1], 10); if (!Number.isFinite(pid)) continue; const name = parts[parts.length - 1] || ''; items.push({ pid, command, name }); }
  res.json(items);
});
// Persistent project metadata CRUD
app.get('/api/projects', (req, res) => { res.json(readProjectsFile()); });
app.post('/api/projects', (req, res) => {
  const data = req.body || {};
  const now = new Date().toISOString();
  const project = {
    id: typeof data.id === 'string' && data.id ? data.id : genId(),
    name: '', description: '', group: '', category: 'other', working_directory: '', start_command: '', stop_command: '',
    port: undefined, environment_variables: {}, auto_restart: false, max_restarts: 5, restart_interval: 15,
    scheduled_start: '', scheduled_stop: '', restart_count: 0, manual_stopped: false, was_running_before_shutdown: false,
    notes: '', order_index: 0, created_date: now, updated_date: now, last_started: undefined, ...data,
  };
  const items = readProjectsFile();
  const idx = items.findIndex(p => p.id === project.id);
  if (idx !== -1) { return res.json(items[idx]); }
  items.push(project); writeProjectsFile(items); res.json(project);
});
app.put('/api/projects/:id', (req, res) => {
  const { id } = req.params; const data = req.body || {}; const items = readProjectsFile();
  const idx = items.findIndex(p => p.id === id); if (idx === -1) return res.status(404).json({ error: 'not found' });
  const now = new Date().toISOString(); const updated = { ...items[idx], ...data, updated_date: now };
  items[idx] = updated; writeProjectsFile(items); res.json(updated);
});
app.delete('/api/projects/:id', async (req, res) => {
  const { id } = req.params;

  // 1) 尝试先停止对应的后台进程（仅基于内存中的 processes）
  try {
    const entry = processes.get(id);
    if (entry && isRunning(entry.child)) {
      await new Promise((resolve) => {
        treeKill(entry.child.pid, 'SIGTERM', () => resolve(null));
      });
    }
    processes.delete(id);
  } catch {
    // ignore cleanup error
  }

  // 2) 删除持久化的项目配置（如果存在）
  const items = readProjectsFile();
  const idx = items.findIndex((p) => p.id === id);
  const filtered = idx !== -1 ? items.filter((p) => p.id !== id) : items;
  if (idx !== -1) writeProjectsFile(filtered);

  res.json({ ok: true });
});
app.post('/api/projects/dedupe', (req, res) => {
  const items = readProjectsFile();
  const before = items.length;
  const afterItems = dedupeProjects(items);
  const after = afterItems.length;
  writeProjectsFile(afterItems);
  res.json({ ok: true, removed: before - after, total: after });
});

app.post('/api/processes/kill', (req, res) => {
  const { pid, signal } = req.body || {}; const pidNum = parseInt(pid, 10);
  if (!Number.isFinite(pidNum) || pidNum <= 0) return res.status(400).json({ error: 'pid is required' });
  const sig = typeof signal === 'string' && signal ? signal : 'SIGTERM';
  treeKill(pidNum, sig, (err) => { if (err) return res.status(500).json({ ok: false, error: String(err) }); res.json({ ok: true, pid: pidNum, signal: sig }); });
});

app.post('/api/projects/restart', async (req, res) => {
  const { id, start_command, stop_command, working_directory, environment_variables, startup_timeout_ms } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const entry = processes.get(id);
  const env = { ...process.env, ...((environment_variables && typeof environment_variables === 'object') ? environment_variables : {}) };
  const cwd = safeCwd(working_directory);
  const startCmd = start_command || entry?.command; if (!startCmd) return res.status(400).json({ error: 'start_command is required' });
  async function stopExisting() {
    if (entry && isRunning(entry.child)) {
      await new Promise((resolve) => { treeKill(entry.child.pid, 'SIGTERM', () => resolve(null)); });
    }
    if (stop_command) {
      const child = spawn(stop_command, { cwd, env, shell: true });
      const stdoutBuf = ringBuffer(200); const stderrBuf = ringBuffer(200);
      child.stdout.on('data', (d) => stdoutBuf.push(d.toString()));
      child.stderr.on('data', (d) => stderrBuf.push(d.toString()));
      await new Promise((resolve) => child.on('close', () => resolve(null)));
    }
  }
  await stopExisting();
  const child = spawn(startCmd, { cwd, env, shell: true }); const stdoutBuf = ringBuffer(500); const stderrBuf = ringBuffer(500);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString())); child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
  let responded = false;
  const respondOk = () => { if (responded) return; responded = true; res.json({ ok: true, pid: child.pid }); };
  const respondFail = (message, code = null, signal = null) => { if (responded) return; responded = true; res.status(500).json({ ok: false, error: message, code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); };
  child.on('error', (err) => { const e = processes.get(id); if (e) { e.status = 'stopped'; e.exitCode = -1; e.signal = null; } respondFail(String(err)); });
  child.on('exit', (code, signal) => {
    const e = processes.get(id); if (e) { e.status = 'stopped'; e.exitCode = code; e.signal = signal; }
    if (!responded) respondFail(`process exited with code ${code}${signal ? `, signal ${signal}` : ''}`, code, signal);
  });
  processes.set(id, { child, status: 'running', command: startCmd, cwd, env, startedAt: new Date().toISOString(), stdoutBuf, stderrBuf });
  patchProject(id, { was_running_before_shutdown: true });
  const timeout = typeof startup_timeout_ms === 'number' && startup_timeout_ms > 0 ? startup_timeout_ms : 2000;
  setTimeout(() => { if (responded) return; if (isRunning(child)) { console.log(`[task] restarted id=${id} pid=${child.pid} cmd=${startCmd}`); respondOk(); } else respondFail('process not running after startup timeout'); }, timeout);
});

const PORT = process.env.PORT || 3001;
function resolveStaticDir() {
  const execDir = path.dirname(process.execPath);
  const fromExec = path.join(execDir, 'dist');
  if (fs.existsSync(fromExec)) return fromExec;
  const fromSnapshot = path.join(__dirname, '../dist');
  if (fs.existsSync(fromSnapshot)) return fromSnapshot;
  const fromCwd = path.join(process.cwd(), 'dist');
  if (fs.existsSync(fromCwd)) return fromCwd;
  return null;
}
const staticDir = resolveStaticDir();
if (staticDir) {
  app.use(express.static(staticDir));
  app.get('*', (req, res) => { res.sendFile(path.join(staticDir, 'index.html')); });
}
function listAddresses() {
  const ifs = os.networkInterfaces();
  const addrs = ['127.0.0.1'];
  for (const name of Object.keys(ifs)) {
    for (const info of ifs[name] || []) {
      if (info.family === 'IPv4' && !info.internal) addrs.push(info.address);
    }
  }
  return Array.from(new Set(addrs));
}
function setupGuardian() {
  const TICK_MS = 5000;
  setInterval(async () => {
    let items = [];
    try { items = readProjectsFile(); } catch { return; }
    const now = Date.now();
    for (const p of items) {
      if (!p || typeof p !== 'object') continue;
      const id = String(p.id || '').trim();
      if (!id) continue;
      const autoRestart = !!p.auto_restart;
      const manualStopped = !!p.manual_stopped;
      const wasRunning = !!p.was_running_before_shutdown;
      if (!autoRestart || manualStopped || !wasRunning) {
        guardianState.delete(id);
        continue;
      }
      const maxRestarts = typeof p.max_restarts === 'number' ? p.max_restarts : 5;
      const intervalSec = typeof p.restart_interval === 'number' ? p.restart_interval : 15;
      const currentCount = typeof p.restart_count === 'number' ? p.restart_count : 0;
      if (maxRestarts > 0 && currentCount >= maxRestarts) continue;
      if (isTaskRunning(id)) {
        guardianState.delete(id);
        continue;
      }
      const state = guardianState.get(id) || { nextAttemptAt: 0 };
      if (now < state.nextAttemptAt) continue;
      const ok = await guardianAttemptStart(p);
      if (ok) {
        guardianState.delete(id);
        patchProject(id, { restart_count: 0, manual_stopped: false, last_started: new Date().toISOString(), was_running_before_shutdown: true });
        console.log(`[guard] auto-restart succeeded for task ${id}`);
      } else {
        const newCount = currentCount + 1;
        guardianState.set(id, { nextAttemptAt: now + Math.max(1, intervalSec) * 1000 });
        patchProject(id, { restart_count: newCount });
        if (maxRestarts > 0 && newCount >= maxRestarts) console.warn(`[guard] max restarts reached for task ${id}, giving up`);
        else console.warn(`[guard] auto-restart failed for task ${id}, will retry later`);
      }
    }
  }, TICK_MS);
}
function startServerWithFallback() {
  let p = parseInt(String(PORT), 10) || 3001;
  const max = p + 9;
  const tryListen = () => {
    const server = app.listen(p, () => {
      const baseDir = typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : process.cwd();
      const logDir = path.join(baseDir, 'logs');
      try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
      const backendLog = path.join(logDir, 'backend.log');
      const frontendLog = path.join(logDir, 'frontend.log');
      try { fs.appendFileSync(backendLog, `started PID ${process.pid} PORT ${p}\n`); } catch {}
      try { fs.appendFileSync(frontendLog, `static from ${staticDir || 'N/A'} PID ${process.pid} PORT ${p}\n`); } catch {}
      console.log('==================================');
      console.log(`✅ 服务已启动 (PID: ${process.pid})`);
      console.log(`📱 前端地址: http://localhost:${p}`);
      console.log('📋 日志文件: logs/frontend.log, logs/backend.log');
      console.log('');
      console.log('💡 按 Ctrl+C 停止所有服务');
      console.log('==================================');
    });
    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && p < max) { p += 1; tryListen(); }
      else { console.error(String(err)); process.exit(1); }
    });
  };
  tryListen();
}
setupGuardian();
startServerWithFallback();
function baseRunDir() {
  try { return typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : process.cwd(); } catch { return process.cwd(); }
}
function safeCwd(working_directory) {
  const base = baseRunDir();
  if (!working_directory || !String(working_directory).trim()) return base;
  const candidate = path.isAbsolute(working_directory) ? working_directory : path.join(base, working_directory);
  try { const st = fs.statSync(candidate); if (st && st.isDirectory()) return candidate; } catch {}
  return base;
}
