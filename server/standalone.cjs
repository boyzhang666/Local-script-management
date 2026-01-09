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

const processes = new Map();
function isRunning(child) { return !!child && child.exitCode === null && child.signalCode === null; }
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

function commandConfigPath() {
  const dir = ensureTaskDir();
  return path.join(dir, 'command-config.json');
}

function getDefaultCommandConfig() {
  return {
    windows: {
      categories: [
        { value: 'frontend', label: '前端' },
        { value: 'backend', label: '后端' },
        { value: 'exe', label: 'EXE 程序' },
        { value: 'bat', label: 'BAT 批处理' },
        { value: 'powershell', label: 'PowerShell 脚本' },
        { value: 'other', label: '其他' },
      ],
      commandTemplates: {
        frontend: { pattern: '{cmd}', description: '直接执行命令' },
        backend: { pattern: '{cmd}', description: '直接执行命令' },
        exe: { pattern: '{cmd}', description: '直接执行 EXE 程序' },
        bat: { pattern: 'cmd /c {cmd}', description: '使用 cmd /c 执行批处理' },
        powershell: { pattern: 'powershell -ExecutionPolicy Bypass -File {cmd}', description: '使用 PowerShell 执行脚本' },
        other: { pattern: '{cmd}', description: '直接执行命令' },
      },
    },
    macos: {
      categories: [
        { value: 'frontend', label: '前端' },
        { value: 'backend', label: '后端' },
        { value: 'shell', label: 'Shell 脚本' },
        { value: 'executable', label: '可执行程序' },
        { value: 'app', label: '应用程序' },
        { value: 'python', label: 'Python 脚本' },
        { value: 'other', label: '其他' },
      ],
      commandTemplates: {
        frontend: { pattern: '{cmd}', description: '直接执行命令' },
        backend: { pattern: '{cmd}', description: '直接执行命令' },
        shell: { pattern: 'bash {cmd}', description: '使用 bash 执行 Shell 脚本' },
        executable: { pattern: 'chmod +x {cmd} 2>/dev/null; {cmd}', description: '添加执行权限后运行' },
        app: { pattern: 'open -a \"{cmd}\"', description: '使用 open -a 打开应用程序' },
        python: { pattern: 'python3 {cmd} 2>/dev/null || python {cmd}', description: '优先使用 python3 执行' },
        other: { pattern: '{cmd}', description: '直接执行命令' },
      },
    },
    linux: {
      categories: [
        { value: 'frontend', label: '前端' },
        { value: 'backend', label: '后端' },
        { value: 'shell', label: 'Shell 脚本' },
        { value: 'executable', label: '可执行程序' },
        { value: 'python', label: 'Python 脚本' },
        { value: 'other', label: '其他' },
      ],
      commandTemplates: {
        frontend: { pattern: '{cmd}', description: '直接执行命令' },
        backend: { pattern: '{cmd}', description: '直接执行命令' },
        shell: { pattern: 'bash {cmd}', description: '使用 bash 执行 Shell 脚本' },
        executable: { pattern: 'chmod +x {cmd} 2>/dev/null; {cmd}', description: '添加执行权限后运行' },
        python: { pattern: 'python3 {cmd} 2>/dev/null || python {cmd}', description: '优先使用 python3 执行' },
        other: { pattern: '{cmd}', description: '直接执行命令' },
      },
    },
  };
}

function readCommandConfig() {
  try {
    const raw = fs.readFileSync(commandConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    const defaults = getDefaultCommandConfig();
    return {
      windows: { ...defaults.windows, ...config.windows },
      macos: { ...defaults.macos, ...config.macos },
      linux: { ...defaults.linux, ...config.linux },
    };
  } catch {
    return getDefaultCommandConfig();
  }
}

function writeCommandConfig(config) {
  try {
    fs.writeFileSync(commandConfigPath(), JSON.stringify(config, null, 2));
  } catch {}
}

function writeProjectsFile(items) {
  try {
    const sanitized = (Array.isArray(items) ? items : []).map((p) => {
      if (!p || typeof p !== 'object') return p;
      const { status, ...rest } = p;
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

function getProjectById(id) {
  if (!id) return null;
  const items = readProjectsFile();
  return items.find((p) => p && p.id === id) || null;
}

function normalizePid(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clearRuntimePidIfMatches(id, pid) {
  const current = getProjectById(id);
  if (!current) return;
  const curPid = normalizePid(current.runtime_pid);
  const targetPid = normalizePid(pid);
  if (!curPid || !targetPid) return;
  if (curPid !== targetPid) return;
  patchProject(id, { runtime_pid: null }, { skipUpdatedDate: true });
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
function isMac() { return process.platform === 'darwin'; }
function isLinux() { return process.platform === 'linux'; }

// 检测端口是否被占用，返回占用进程的 PID 列表
async function getProcessesByPort(portNum) {
  if (!portNum || !Number.isFinite(portNum) || portNum <= 0) return [];
  if (isWindows()) {
    const out = await collectOutput('netstat', ['-ano']);
    const lines = String(out.stdout || '').split('\n').filter(l => l.includes(`:${portNum}`));
    const pids = new Set();
    for (const l of lines) {
      const parts = l.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
    return Array.from(pids);
  }
  const out = await collectOutput('lsof', ['-n', '-P', '-i', `:${portNum}`, '-t']);
  const pids = String(out.stdout || '').split('\n').map(l => parseInt(l.trim(), 10)).filter(p => Number.isFinite(p) && p > 0);
  return [...new Set(pids)];
}

// 杀掉占用端口的进程
async function killProcessesByPort(portNum) {
  const pids = await getProcessesByPort(portNum);
  if (pids.length === 0) return { killed: [], failed: [] };
  const killed = [];
  const failed = [];
  for (const pid of pids) {
    try {
      await new Promise((resolve) => {
        treeKill(pid, 'SIGTERM', (err) => {
          if (err) failed.push({ pid, error: String(err) });
          else killed.push(pid);
          resolve();
        });
      });
    } catch (e) {
      failed.push({ pid, error: String(e) });
    }
  }
  return { killed, failed };
}

function getCurrentPlatform() {
  if (isWindows()) return 'windows';
  if (isMac()) return 'macos';
  if (isLinux()) return 'linux';
  return 'linux';
}

function processCommandByCategory(command, category) {
  const raw = String(command || '').trim();
  if (!raw || !category) return raw;

  const config = readCommandConfig();
  const platform = getCurrentPlatform();
  const platformConfig = config[platform];
  if (!platformConfig || !platformConfig.commandTemplates) return raw;

  const template = platformConfig.commandTemplates[category];
  if (!template || !template.pattern) return raw;

  const pattern = String(template.pattern || '').trim();
  if (!pattern || pattern === '{cmd}') return raw;

  if (!pattern.includes('{cmd}')) return pattern;

  const startsWithInterpreter = /^(bash|sh|zsh|python|python3|node|powershell|pwsh|cmd)\b/i.test(raw);
  if (startsWithInterpreter) return raw;

  const hasShellOps = /&&|\|\||[;&|<>`]/.test(raw);
  if (hasShellOps) return raw;

  const firstToken = raw.split(/\s+/)[0] || raw;
  const hasArgs = firstToken.length < raw.length;

  const isPathLikeToken = /^(\.\/|\.\.\/|\/|~\/|[A-Za-z]:[\\/])/.test(firstToken) || /[\\/]/.test(firstToken);
  const effectivePattern = (pattern.includes('./{cmd}') && isPathLikeToken)
    ? pattern.replace(/\.\/\{cmd\}/g, '{cmd}')
    : pattern;

  const expandedRegex = (() => {
    const escaped = effectivePattern.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const withGroups = escaped.replace(/\\\{cmd\\\}/g, '(.+?)');
    return new RegExp(`^${withGroups}$`);
  })();
  const match = raw.match(expandedRegex);
  if (match) {
    if (raw.includes('{cmd}')) {
      const captures = match.slice(1).map((s) => String(s || '').trim()).filter(Boolean);
      const inferred = captures.find((s) => s !== '{cmd}');
      if (inferred) return effectivePattern.replace(/\{cmd\}/g, inferred);
    }
    return raw;
  }

  const placeholderCount = (effectivePattern.match(/\{cmd\}/g) || []).length;
  if (placeholderCount <= 1) {
    return effectivePattern.replace(/\{cmd\}/g, raw);
  }

  if (!hasArgs) {
    return effectivePattern.replace(/\{cmd\}/g, raw);
  }

  let replaced = effectivePattern;
  replaced = replaced.replace(/\{cmd\}/, firstToken);
  replaced = replaced.replace(/\{cmd\}/g, raw);
  return replaced;
}

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
  if (!entry) return false;
  return entry.child && isRunning(entry.child);
}

function resetPersistedRuntimeStateOnBoot() {
  const items = readProjectsFile();
  if (!items || items.length === 0) return;
  let changed = false;
  const next = items.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const hadPid = p.runtime_pid != null;
    const hadWasRunning = !!p.was_running_before_shutdown;
    if (!hadPid && !hadWasRunning) return p;
    changed = true;
    return { ...p, runtime_pid: null, was_running_before_shutdown: false };
  });
  if (changed) writeProjectsFile(next);
}

function isFireAndForgetCategory(category) {
  return category === 'app';
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

  const env = buildTaskEnv(project.environment_variables);
  const cwd = safeCwd(project.working_directory);
  let command;
  let child;
  if (project.category === 'shell' && project.script_content && String(project.script_content).trim()) {
    command = `bash -s <${start_command || 'script'}>`;
    child = spawn('bash', ['-s'], { cwd, env, shell: false });
    child.stdin.end(String(project.script_content));
  } else {
    command = processCommandByCategory(start_command, project.category);
    child = spawn(command, { cwd, env, shell: true });
  }
  const stdoutBuf = ringBuffer(500); const stderrBuf = ringBuffer(500);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
  child.on('error', (err) => {
    const entry = processes.get(id);
    if (entry) { entry.status = 'stopped'; entry.exitCode = -1; entry.signal = null; }
    clearRuntimePidIfMatches(id, child.pid);
    console.error(`[guard] failed to start task ${id}: ${String(err)}`);
  });
  child.on('exit', (code, signal) => {
    const entry = processes.get(id);
    if (entry) { entry.status = 'stopped'; entry.exitCode = code; entry.signal = signal; }
    clearRuntimePidIfMatches(id, child.pid);
  });
  processes.set(id, { child, status: 'running', command, cwd, env, startedAt: new Date().toISOString(), stdoutBuf, stderrBuf });
  patchProject(id, { was_running_before_shutdown: true, runtime_pid: child.pid }, { skipUpdatedDate: true });

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
      if (!entry) continue;
      if (!isRunning(entry.child)) continue;
      promises.push(new Promise((resolve) => {
        treeKill(entry.child.pid, 'SIGTERM', () => { clearRuntimePidIfMatches(id, entry.child.pid); resolve(null); });
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

app.get('/api/command-config', (req, res) => {
  const config = readCommandConfig();
  const platform = getCurrentPlatform();
  res.json({ config, currentPlatform: platform });
});

app.put('/api/command-config', (req, res) => {
  const data = req.body || {};
  if (!data.config) return res.status(400).json({ error: 'config is required' });
  writeCommandConfig(data.config);
  res.json({ ok: true });
});

app.post('/api/command-config/reset', (req, res) => {
  const defaults = getDefaultCommandConfig();
  writeCommandConfig(defaults);
  res.json({ ok: true, config: defaults });
});

app.post('/api/projects/start', (req, res) => {
  const { id, start_command, working_directory, environment_variables, startup_timeout_ms, category, script_content } = req.body || {};
  if (!id || !start_command) return res.status(400).json({ error: 'id and start_command are required' });
  const existing = processes.get(id);
  if (existing && isTaskRunning(id)) {
    const pid = existing.child ? existing.child.pid : null;
    return res.json({ ok: true, pid, alreadyRunning: true });
  }

  const env = buildTaskEnv(environment_variables);
  const cwd = safeCwd(working_directory);
  const isFireAndForget = isFireAndForgetCategory(category);
  let command;
  let child;
  if (category === 'shell' && script_content && String(script_content).trim()) {
    command = `bash -s <${start_command || 'script'}>`;
    child = spawn('bash', ['-s'], { cwd, env, shell: false });
    child.stdin.end(String(script_content));
  } else {
    command = processCommandByCategory(start_command, category);
    child = spawn(command, { cwd, env, shell: true });
  }
  const stdoutBuf = ringBuffer(500); const stderrBuf = ringBuffer(500);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
  let responded = false;
  const respondOk = (pid, alreadyRunning = false) => { if (responded) return; responded = true; res.json({ ok: true, pid, alreadyRunning }); };
  const respondFail = (message, code = null, signal = null) => { if (responded) return; responded = true; res.status(500).json({ ok: false, error: message, code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); };
  child.on('error', (err) => {
    const entry = processes.get(id);
    if (entry) { entry.status = 'stopped'; entry.exitCode = -1; entry.signal = null; }
    clearRuntimePidIfMatches(id, child.pid);
    respondFail(`spawn error: ${String(err)}`);
  });
  child.on('exit', (code, signal) => {
    const entry = processes.get(id);
    if (entry) { entry.status = 'stopped'; entry.exitCode = code; entry.signal = signal; }
    clearRuntimePidIfMatches(id, child.pid);
    if (!responded) {
      if (isFireAndForget && code === 0) {
        patchProject(id, { was_running_before_shutdown: false, last_started: new Date().toISOString(), runtime_pid: null }, { skipUpdatedDate: true });
        respondOk(null, false);
        return;
      }
      respondFail(`process exited with code ${code}${signal ? `, signal ${signal}` : ''}`, code, signal);
    }
  });
  processes.set(id, { child, status: 'running', command, cwd, env, startedAt: new Date().toISOString(), stdoutBuf, stderrBuf });
  const timeout = typeof startup_timeout_ms === 'number' && startup_timeout_ms > 0 ? startup_timeout_ms : 2000;
  setTimeout(() => {
    if (responded) return;
    if (isRunning(child)) {
      console.log(`[task] started id=${id} pid=${child.pid} cmd=${command}`);
      patchProject(id, { was_running_before_shutdown: true, last_started: new Date().toISOString(), runtime_pid: child.pid }, { skipUpdatedDate: true });
      respondOk(child.pid, false);
    } else {
      respondFail('process not running after startup timeout');
    }
  }, timeout);
});

app.post('/api/projects/stop', (req, res) => {
  const { id, stop_command, working_directory, environment_variables } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const spawnStopCommand = () => {
    if (!stop_command) return res.json({ ok: true, message: 'not running' });
    const env = buildTaskEnv(environment_variables);
    const child = spawn(stop_command, { cwd: safeCwd(working_directory), env, shell: true });
    const stdoutBuf = ringBuffer(200); const stderrBuf = ringBuffer(200);
    child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
    child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
    child.on('error', (err) => { res.status(500).json({ ok: false, error: `stop_command spawn error: ${String(err)}`, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); });
    child.on('exit', (code, signal) => { if (code === 0) { patchProject(id, { runtime_pid: null }, { skipUpdatedDate: true }); res.json({ ok: true, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); } else res.status(500).json({ ok: false, error: `stop_command exited with code ${code}${signal ? `, signal ${signal}` : ''}`, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); });
  };
  const entry = processes.get(id);
  if (!entry || !isRunning(entry.child)) {
    patchProject(id, { runtime_pid: null }, { skipUpdatedDate: true });
    return spawnStopCommand();
  }
  treeKill(entry.child.pid, 'SIGTERM', (err) => {
    if (err) return spawnStopCommand();
    entry.status = 'stopped';
    clearRuntimePidIfMatches(id, entry.child.pid);
    processes.delete(id);
    console.log(`[task] stopped id=${id} pid=${entry.child.pid}`);
    res.json({ ok: true });
  });
});

app.get('/api/projects/status/:id', (req, res) => {
  const { id } = req.params;
  const entry = processes.get(id);
  const running = entry ? isRunning(entry.child) : false;
  const pid = running ? (entry.child.pid || null) : null;
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
  for (const l of lines) {
    const parts = l.split(/\s+/);
    if (parts.length < 9) continue;
    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    if (!Number.isFinite(pid)) continue;
    const name = parts.slice(8).join(' ');
    const statusMatch = name.match(/\((\w+)\)$/);
    const status = statusMatch ? statusMatch[1] : '';
    items.push({ pid, command, name, status });
  }
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
	    runtime_pid: null,
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
      clearRuntimePidIfMatches(id, entry.child.pid);
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
  const { id, start_command, stop_command, working_directory, environment_variables, startup_timeout_ms, category, script_content } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const entry = processes.get(id);
  const env = buildTaskEnv(environment_variables);
  const cwd = safeCwd(working_directory);
  const rawStartCmd = start_command || entry?.command;
  if (!rawStartCmd) return res.status(400).json({ error: 'start_command is required' });
  let startCmd;
  let startProcessMode = 'shell';
  if (category === 'shell' && script_content && String(script_content).trim()) {
    startCmd = `bash -s <${rawStartCmd || 'script'}>`;
    startProcessMode = 'stdin';
  } else {
    startCmd = processCommandByCategory(rawStartCmd, category);
  }
  const isFireAndForget = isFireAndForgetCategory(category);
  async function stopExisting() {
    if (entry && isRunning(entry.child)) {
      await new Promise((resolve) => { treeKill(entry.child.pid, 'SIGTERM', () => resolve(null)); });
      clearRuntimePidIfMatches(id, entry.child.pid);
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
  const child = startProcessMode === 'stdin'
    ? spawn('bash', ['-s'], { cwd, env, shell: false })
    : spawn(startCmd, { cwd, env, shell: true });
  if (startProcessMode === 'stdin') child.stdin.end(String(script_content));
  const stdoutBuf = ringBuffer(500); const stderrBuf = ringBuffer(500);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString())); child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
  let responded = false;
  const respondOk = (pid, alreadyRunning = false) => { if (responded) return; responded = true; res.json({ ok: true, pid, alreadyRunning }); };
  const respondFail = (message, code = null, signal = null) => { if (responded) return; responded = true; res.status(500).json({ ok: false, error: message, code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }); };
  child.on('error', (err) => {
    const e = processes.get(id); if (e) { e.status = 'stopped'; e.exitCode = -1; e.signal = null; }
    clearRuntimePidIfMatches(id, child.pid);
    respondFail(String(err));
  });
  child.on('exit', (code, signal) => {
    const e = processes.get(id); if (e) { e.status = 'stopped'; e.exitCode = code; e.signal = signal; }
    clearRuntimePidIfMatches(id, child.pid);
    if (!responded) {
      if (isFireAndForget && code === 0) {
        patchProject(id, { was_running_before_shutdown: false, last_started: new Date().toISOString(), runtime_pid: null }, { skipUpdatedDate: true });
        respondOk(null, false);
        return;
      }
      respondFail(`process exited with code ${code}${signal ? `, signal ${signal}` : ''}`, code, signal);
    }
  });
  processes.set(id, { child, status: 'running', command: startCmd, cwd, env, startedAt: new Date().toISOString(), stdoutBuf, stderrBuf });
  const timeout = typeof startup_timeout_ms === 'number' && startup_timeout_ms > 0 ? startup_timeout_ms : 2000;
  setTimeout(() => { if (responded) return; if (isRunning(child)) { console.log(`[task] restarted id=${id} pid=${child.pid} cmd=${startCmd}`); patchProject(id, { was_running_before_shutdown: true, last_started: new Date().toISOString(), runtime_pid: child.pid }, { skipUpdatedDate: true }); respondOk(child.pid, false); } else respondFail('process not running after startup timeout'); }, timeout);
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
resetPersistedRuntimeStateOnBoot();
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

function buildTaskEnv(environment_variables) {
  const custom = (environment_variables && typeof environment_variables === 'object') ? environment_variables : {};
  const env = { ...process.env, ...custom };
  if (!Object.prototype.hasOwnProperty.call(custom, 'PORT')) {
    delete env.PORT;
  }
  return env;
}
