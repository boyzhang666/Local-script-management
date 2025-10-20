import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import treeKill from 'tree-kill';
import process from 'node:process';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

// Allow requests from localhost/127.0.0.1 on any port (Vite dev server and preview)
// In dev, allow all origins to simplify local testing across ports
app.use(cors());

// Persistent pid storage to survive server restarts
const DATA_DIR = path.join(process.cwd(), '.task-runner');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const pidFilePath = (id) => path.join(DATA_DIR, `${id}.pid`);
function isPidAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    // ignore
    return false;
  }
}

// In-memory registry of running processes keyed by project id
const processes = new Map();

function isRunning(child) {
  return child && child.exitCode === null && !child.killed;
}

function ringBuffer(limit = 200) {
  const arr = [];
  return {
    push(line) {
      arr.push(line);
      if (arr.length > limit) arr.shift();
    },
    get() {
      return arr.slice();
    },
    clear() {
      arr.length = 0;
    }
  };
}

app.post('/api/projects/start', (req, res) => {
  const { id, start_command, working_directory, environment_variables, startup_timeout_ms } = req.body || {};
  if (!id || !start_command) {
    return res.status(400).json({ error: 'id and start_command are required' });
  }

  // If already running, stop first
  const existing = processes.get(id);
  if (existing && isRunning(existing.child)) {
    treeKill(existing.child.pid, 'SIGTERM');
  }

  const env = { ...process.env, ...((environment_variables && typeof environment_variables === 'object') ? environment_variables : {}) };

  // Use shell to allow composite commands like `cd dir && VAR=1 npm start`
  const command = start_command;
  const child = spawn(command, { cwd: working_directory || process.cwd(), env, shell: true });

  const stdoutBuf = ringBuffer(500);
  const stderrBuf = ringBuffer(500);

  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()))

  let responded = false;
  const respondOk = () => {
    if (responded) return;
    responded = true;
    res.json({ ok: true, pid: child.pid });
  };
  const respondFail = (message, code = null, signal = null) => {
    if (responded) return;
    responded = true;
    const stderr = stderrBuf.get();
    const stdout = stdoutBuf.get();
    res.status(500).json({ ok: false, error: message, code, signal, logs: { stdout, stderr } });
  };

  child.on('error', (err) => {
    const entry = processes.get(id);
    if (entry) {
      entry.status = 'stopped';
      entry.exitCode = -1;
      entry.signal = null;
    }
    respondFail(`spawn error: ${String(err)}`);
  });

  child.on('exit', (code, signal) => {
    const entry = processes.get(id);
    if (entry) {
      entry.status = 'stopped';
      entry.exitCode = code;
      entry.signal = signal;
    }
    // Clean pid file on exit
    try { fs.rmSync(pidFilePath(id), { force: true }); } catch { /* ignore */ }
    // If the process exits during startup window, treat as startup failure and return actual logs
    if (!responded) {
      respondFail(`process exited with code ${code}${signal ? `, signal ${signal}` : ''}`, code, signal);
    }
  });

  processes.set(id, {
    child,
    status: 'running',
    command,
    cwd: working_directory || process.cwd(),
    env,
    startedAt: new Date().toISOString(),
    stdoutBuf,
    stderrBuf,
  });
  // Write pid file to persist across server restarts
  try { fs.writeFileSync(pidFilePath(id), String(child.pid)); } catch { /* ignore */ }
  // Early startup validation: wait a short period to ensure the command didn't fail immediately.
  const timeout = typeof startup_timeout_ms === 'number' && startup_timeout_ms > 0 ? startup_timeout_ms : 2000;
  setTimeout(() => {
    if (responded) return;
    if (isRunning(child)) {
      respondOk();
    } else {
      respondFail('process not running after startup timeout');
    }
  }, timeout);
});

app.post('/api/projects/stop', (req, res) => {
  const { id, stop_command, working_directory, environment_variables } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  const spawnStopCommand = () => {
    if (!stop_command) {
      return res.json({ ok: true, message: 'not running' });
    }
    const env = { ...process.env, ...((environment_variables && typeof environment_variables === 'object') ? environment_variables : {}) };
    const child = spawn(stop_command, { cwd: working_directory || process.cwd(), env, shell: true });
    const stdoutBuf = ringBuffer(200);
    const stderrBuf = ringBuffer(200);
    child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
    child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
    child.on('error', (err) => {
      res.status(500).json({ ok: false, error: `stop_command spawn error: ${String(err)}`, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } });
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        res.json({ ok: true, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } });
      } else {
        res.status(500).json({ ok: false, error: `stop_command exited with code ${code}${signal ? `, signal ${signal}` : ''}`, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } });
      }
    });
  };

  const entry = processes.get(id);
  if (!entry || !isRunning(entry.child)) {
    // Fallback: try killing by persisted pid file
    try {
      const pidStr = fs.readFileSync(pidFilePath(id), 'utf8');
      const pidNum = parseInt(pidStr, 10);
      if (isPidAlive(pidNum)) {
        return treeKill(pidNum, 'SIGTERM', (err) => {
          if (err) return spawnStopCommand();
          try { fs.rmSync(pidFilePath(id), { force: true }); } catch { /* ignore */ }
          return res.json({ ok: true, killed_pid: pidNum, via: 'pidfile' });
        });
      }
    } catch { /* ignore */ }
    return spawnStopCommand();
  }

  treeKill(entry.child.pid, 'SIGTERM', (err) => {
    if (err) {
      // If kill failed, try fallback stop_command when provided
      return spawnStopCommand();
    }
    // Clean pid file on manual stop
    try { fs.rmSync(pidFilePath(id), { force: true }); } catch { /* ignore */ }
    entry.status = 'stopped';
    res.json({ ok: true });
  });
});

app.get('/api/projects/status/:id', (req, res) => {
  const { id } = req.params;
  const entry = processes.get(id);
  let running = entry ? isRunning(entry.child) : false;
  let pidFromFile = null;
  if (!running) {
    try {
      const pidStr = fs.readFileSync(pidFilePath(id), 'utf8');
      const pidNum = parseInt(pidStr, 10);
      pidFromFile = pidNum;
      running = isPidAlive(pidNum);
    } catch { /* ignore */ }
  }
  res.json({ running, status: entry?.status || (running ? 'running' : 'stopped'), pid: entry?.child?.pid || (running ? pidFromFile : null) });
});

app.get('/api/projects/logs/:id', (req, res) => {
  const { id } = req.params;
  const entry = processes.get(id);
  if (!entry) return res.json({ stdout: [], stderr: [] });
  res.json({ stdout: entry.stdoutBuf.get(), stderr: entry.stderrBuf.get() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Local process server running at http://127.0.0.1:${PORT}`);
  console.log('Allowed origin: localhost/127.0.0.1 (any port)');
});