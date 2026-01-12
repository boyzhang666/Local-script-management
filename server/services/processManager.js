import { spawn } from 'child_process';
import process from 'node:process';
import treeKill from 'tree-kill';
import { ringBuffer, sleep, isRunning } from '../lib/misc.js';
import { buildTaskEnv, safeCwd } from '../lib/env.js';
import { processCommandByCategory, isFireAndForgetCategory } from './commandConfig.js';
import { patchProject, getProjectById, readProjectsFile } from './storage.js';
import { checkPortAvailability, processesByPort, searchProcessesByName } from './portInspector.js';
import { normalizePid, normalizePort, isPidAlive, killProcessTree } from '../lib/pid.js';

const processes = new Map();
const guardianState = new Map();

function isWindows() {
  return process.platform === 'win32';
}

/**
 * Get shell executable and args for spawning commands
 * Uses interactive shell to ensure full environment initialization (conda/mamba)
 */
function getShellConfig() {
  if (isWindows()) {
    return { shell: true };
  }
  // Use interactive shell to load .zshrc/.bashrc where conda/mamba is initialized
  // -i: interactive mode (loads .zshrc/.bashrc)
  // -c: execute command
  const userShell = process.env.SHELL || '/bin/bash';
  return {
    shell: false,
    executable: userShell,
    args: ['-i', '-c']
  };
}

/**
 * Spawn a command using interactive shell to ensure proper environment initialization
 */
function spawnWithShell(command, options = {}) {
  const shellConfig = getShellConfig();

  if (shellConfig.shell) {
    // Windows: use default shell behavior
    return spawn(command, { ...options, shell: true });
  }

  // Unix-like: use interactive shell with -i -c
  return spawn(shellConfig.executable, [...shellConfig.args, command], {
    ...options,
    shell: false
  });
}

function isTaskRunning(id) {
  const entry = processes.get(id);
  if (!entry) return false;
  return entry.child && isRunning(entry.child);
}

async function waitForRunning(id, attempts = 10, intervalMs = 800) {
  for (let i = 0; i < attempts; i++) {
    if (isTaskRunning(id)) return true;
    await sleep(intervalMs);
  }
  return isTaskRunning(id);
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

export async function startTask(params = {}) {
  const { id, start_command, working_directory, environment_variables, startup_timeout_ms, category, port, script_content } = params;
  if (!id || !start_command) {
    return { ok: false, status: 400, body: { error: 'id and start_command are required' } };
  }

  const existing = processes.get(id);
  if (existing && isTaskRunning(id)) {
    const pid = existing.child?.pid || null;
    if (pid) {
      patchProject(id, { runtime_pid: pid, manual_stopped: false, restart_count: 0 }, { skipUpdatedDate: true });
    }
    return { ok: true, body: { ok: true, pid, alreadyRunning: true } };
  }

  const persisted = getProjectById(id);
  const projectPort = normalizePort(port ?? persisted?.port);
  const runtimePid = normalizePid(persisted?.runtime_pid);
  const portCheck = await checkPortAvailability(projectPort, { runtimePid });
  if (!portCheck.ok) {
    if (portCheck.alreadyRunningPid) {
      patchProject(id, {
        runtime_pid: portCheck.alreadyRunningPid,
        manual_stopped: false,
        was_running_before_shutdown: true,
        last_started: new Date().toISOString(),
      }, { skipUpdatedDate: true });
      return {
        ok: true,
        body: {
          ok: true,
          pid: portCheck.alreadyRunningPid,
          alreadyRunning: true,
          reason: 'port_in_use_by_recorded_pid',
        },
      };
    }
    const status = portCheck.conflict ? 409 : 503;
    return {
      ok: false,
      status,
      body: {
        ok: false,
        error: portCheck.error ? `端口检查失败: ${portCheck.error}` : `端口 ${projectPort} 已被占用，拒绝启动`,
        port: projectPort,
        users: portCheck.users,
      },
    };
  }

  const env = buildTaskEnv(environment_variables || persisted?.environment_variables);
  const cwd = safeCwd(working_directory || persisted?.working_directory);
  const isFireAndForget = isFireAndForgetCategory(category);
  let command;
  let child;
  if (category === 'shell' && script_content && String(script_content).trim()) {
    command = `bash -s <${start_command || 'script'}>`;
    child = spawn('bash', ['-s'], { cwd, env, shell: false });
    child.stdin.end(String(script_content));
  } else {
    command = processCommandByCategory(start_command, category);
    child = spawnWithShell(command, { cwd, env });
  }
  console.log(`[task] processing command: original="${start_command}" category="${category}" final="${command}"`);

  const stdoutBuf = ringBuffer(500);
  const stderrBuf = ringBuffer(500);

  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()));

  return await new Promise((resolve) => {
    let responded = false;
    const respondOk = (pid, alreadyRunning = false) => {
      if (responded) return;
      responded = true;
      resolve({ ok: true, body: { ok: true, pid, alreadyRunning } });
    };
    const respondFail = (message, code = null, signal = null) => {
      if (responded) return;
      responded = true;
      const stderr = stderrBuf.get();
      const stdout = stdoutBuf.get();
      resolve({ ok: false, status: 500, body: { ok: false, error: message, code, signal, logs: { stdout, stderr } } });
    };

    child.on('error', (err) => {
      const entry = processes.get(id);
      if (entry) {
        entry.status = 'stopped';
        entry.exitCode = -1;
        entry.signal = null;
      }
      clearRuntimePidIfMatches(id, child.pid);
      respondFail(`spawn error: ${String(err)}`);
    });

    child.on('exit', (code, signal) => {
      const entry = processes.get(id);
      if (entry) {
        entry.status = 'stopped';
        entry.exitCode = code;
        entry.signal = signal;
      }
      clearRuntimePidIfMatches(id, child.pid);
      if (!responded) {
        if (isFireAndForget && code === 0) {
          console.log(`[task] fire-and-forget task completed successfully: id=${id} cmd=${command}`);
          patchProject(id, { was_running_before_shutdown: false, last_started: new Date().toISOString(), runtime_pid: null }, { skipUpdatedDate: true });
          respondOk(null, false);
          return;
        }
        respondFail(`process exited with code ${code}${signal ? `, signal ${signal}` : ''}`, code, signal);
      }
    });

    processes.set(id, {
      child,
      status: 'running',
      command,
      cwd,
      env,
      startedAt: new Date().toISOString(),
      stdoutBuf,
      stderrBuf,
    });

    const timeout = typeof startup_timeout_ms === 'number' && startup_timeout_ms > 0 ? startup_timeout_ms : 2000;
    setTimeout(() => {
      if (responded) return;
      if (isRunning(child)) {
        console.log(`[task] started id=${id} pid=${child.pid} cmd=${command}`);
        patchProject(id, {
          was_running_before_shutdown: true,
          last_started: new Date().toISOString(),
          runtime_pid: child.pid,
          manual_stopped: false,
          restart_count: 0,
        }, { skipUpdatedDate: true });
        respondOk(child.pid);
      } else {
        respondFail('process not running after startup timeout');
      }
    }, timeout);
  });
}

export async function stopTask(params = {}) {
  const { id, stop_command, working_directory, environment_variables, markManualStopped = true } = params;
  if (!id) return { ok: false, status: 400, body: { error: 'id is required' } };

  const project = getProjectById(id) || {};
  const env = buildTaskEnv(environment_variables || project.environment_variables);
  const cwd = safeCwd(working_directory || project.working_directory);

  const entry = processes.get(id);
  const trackedPid = entry && isRunning(entry.child) ? entry.child.pid : null;
  const persistedPid = normalizePid(project.runtime_pid);
  const extraPid = persistedPid && persistedPid !== trackedPid ? persistedPid : null;
  const pidsToKill = [trackedPid, extraPid].filter(Boolean);
  const killed = [];
  const killErrors = [];

  const runStopCommand = () => new Promise((resolve) => {
    if (!stop_command) return resolve(null);
    const stdoutBuf = ringBuffer(200);
    const stderrBuf = ringBuffer(200);
    const child = spawnWithShell(stop_command, { cwd, env });
    child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
    child.stderr.on('data', (data) => stderrBuf.push(data.toString()));
    child.on('error', (err) => resolve({ ok: false, error: `stop_command spawn error: ${String(err)}`, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } }));
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve({ ok: true, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } });
      } else {
        resolve({ ok: false, error: `stop_command exited with code ${code}${signal ? `, signal ${signal}` : ''}`, exitCode: code, signal, logs: { stdout: stdoutBuf.get(), stderr: stderrBuf.get() } });
      }
    });
    return null;
  });

  try {
    const stopResult = await runStopCommand();

    for (const pid of pidsToKill) {
      if (!isPidAlive(pid)) {
        clearRuntimePidIfMatches(id, pid);
        continue;
      }
      try {
        await killProcessTree(pid, 'SIGTERM');
        clearRuntimePidIfMatches(id, pid);
        killed.push(pid);
      } catch (e) {
        killErrors.push({ pid, error: String(e) });
      }
    }

    if (entry) processes.delete(id);
    patchProject(id, { runtime_pid: null, manual_stopped: !!markManualStopped }, { skipUpdatedDate: true });

    const stopCommandFailed = stopResult && stopResult.ok === false;
    const killFailed = killErrors.length > 0;
    const processKilled = killed.length > 0 || pidsToKill.length === 0;

    const ok = !killFailed && (processKilled || !pidsToKill.length);
    const statusCode = ok ? 200 : 500;
    return {
      ok,
      status: statusCode,
      body: {
        ok,
        killedPids: killed,
        stopCommand: stopResult,
        errors: killErrors,
        warning: stopCommandFailed && ok ? stopResult?.error : undefined,
      },
    };
  } catch (e) {
    return { ok: false, status: 500, body: { ok: false, error: String(e) } };
  }
}

export async function restartTask(params = {}) {
  const { id, start_command, stop_command, working_directory, environment_variables, startup_timeout_ms, category, port, script_content } = params;
  if (!id) return { ok: false, status: 400, body: { error: 'id is required' } };
  const entry = processes.get(id);
  const project = getProjectById(id);
  const env = buildTaskEnv(environment_variables || project?.environment_variables);
  const cwd = safeCwd(working_directory || project?.working_directory);
  const rawStartCmd = start_command || project?.start_command || entry?.command;
  if (!rawStartCmd) return { ok: false, status: 400, body: { error: 'start_command is required' } };

  let startCmd;
  console.log(`[task] restart processing command: original="${rawStartCmd}" category="${category}"`);
  const isFireAndForget = isFireAndForgetCategory(category);

  const projectPort = normalizePort(port ?? project?.port);
  const runtimePid = normalizePid(project?.runtime_pid);
  const portCheck = await checkPortAvailability(projectPort, { runtimePid });
  if (!portCheck.ok) {
    if (portCheck.alreadyRunningPid) {
      patchProject(id, {
        runtime_pid: portCheck.alreadyRunningPid,
        manual_stopped: false,
        was_running_before_shutdown: true,
        last_started: new Date().toISOString(),
      }, { skipUpdatedDate: true });
      return {
        ok: true,
        body: {
          ok: true,
          pid: portCheck.alreadyRunningPid,
          alreadyRunning: true,
          reason: 'port_in_use_by_recorded_pid',
        },
      };
    }
    const status = portCheck.conflict ? 409 : 503;
    return {
      ok: false,
      status,
      body: {
        ok: false,
        error: portCheck.error ? `端口检查失败: ${portCheck.error}` : `端口 ${projectPort} 已被占用，拒绝启动`,
        port: projectPort,
        users: portCheck.users,
      },
    };
  }

  async function stopExisting() {
    if (entry && isRunning(entry.child)) {
      await new Promise((resolve) => {
        treeKill(entry.child.pid, 'SIGTERM', () => resolve(null));
      });
      clearRuntimePidIfMatches(id, entry.child.pid);
    }
    if (stop_command) {
      const child = spawnWithShell(stop_command, { cwd, env });
      const stdoutBuf = ringBuffer(200);
      const stderrBuf = ringBuffer(200);
      child.stdout.on('data', (d) => stdoutBuf.push(d.toString()));
      child.stderr.on('data', (d) => stderrBuf.push(d.toString()));
      await new Promise((resolve) => child.on('close', () => resolve(null)));
    }
  }

  await stopExisting();

  const stdoutBuf = ringBuffer(500);
  const stderrBuf = ringBuffer(500);
  let child;
  if (category === 'shell' && script_content && String(script_content).trim()) {
    startCmd = `bash -s <${rawStartCmd || 'script'}>`;
    child = spawn('bash', ['-s'], { cwd, env, shell: false });
    child.stdin.end(String(script_content));
  } else {
    startCmd = processCommandByCategory(rawStartCmd, category);
    child = spawnWithShell(startCmd, { cwd, env });
  }
  console.log(`[task] restart final command: "${startCmd}"`);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()));

  return await new Promise((resolve) => {
    let responded = false;
    const respondOk = (pid, alreadyRunning = false) => {
      if (responded) return;
      responded = true;
      resolve({ ok: true, body: { ok: true, pid, alreadyRunning } });
    };
    const respondFail = (message, code = null, signal = null) => {
      if (responded) return;
      responded = true;
      const stderr = stderrBuf.get();
      const stdout = stdoutBuf.get();
      resolve({ ok: false, status: 500, body: { ok: false, error: message, code, signal, logs: { stdout, stderr } } });
    };

    child.on('error', (err) => {
      const e = processes.get(id);
      if (e) {
        e.status = 'stopped';
        e.exitCode = -1;
        e.signal = null;
      }
      clearRuntimePidIfMatches(id, child.pid);
      respondFail(String(err));
    });
    child.on('exit', (code, signal) => {
      const e = processes.get(id);
      if (e) {
        e.status = 'stopped';
        e.exitCode = code;
        e.signal = signal;
      }
      clearRuntimePidIfMatches(id, child.pid);
      if (!responded) {
        if (isFireAndForget && code === 0) {
          console.log(`[task] restart fire-and-forget task completed successfully: id=${id} cmd=${startCmd}`);
          patchProject(id, { was_running_before_shutdown: false, last_started: new Date().toISOString(), runtime_pid: null }, { skipUpdatedDate: true });
          respondOk(null, false);
          return;
        }
        respondFail(`process exited with code ${code}${signal ? `, signal ${signal}` : ''}`, code, signal);
      }
    });

    processes.set(id, {
      child,
      status: 'running',
      command: startCmd,
      cwd,
      env,
      startedAt: new Date().toISOString(),
      stdoutBuf,
      stderrBuf,
    });
    patchProject(id, {
      was_running_before_shutdown: true,
      runtime_pid: child.pid,
      manual_stopped: false,
      restart_count: 0,
      last_started: new Date().toISOString(),
    }, { skipUpdatedDate: true });
    const timeout = typeof startup_timeout_ms === 'number' && startup_timeout_ms > 0 ? startup_timeout_ms : 2000;
    setTimeout(() => {
      if (responded) return;
      if (isRunning(child)) {
        console.log(`[task] restarted id=${id} pid=${child.pid} cmd=${startCmd}`);
        respondOk(child.pid);
      } else {
        respondFail('process not running after startup timeout');
      }
    }, timeout);
  });
}

export function getStatus(id) {
  const entry = processes.get(id);

  let running = entry ? isRunning(entry.child) : false;
  let pid = running ? (entry?.child?.pid || null) : null;

  if (!running) {
    const project = getProjectById(id);
    const persistedPid = normalizePid(project?.runtime_pid);
    if (persistedPid && isPidAlive(persistedPid)) {
      running = true;
      pid = persistedPid;
    }
  }

  const status = running ? 'running' : 'stopped';
  return { running, status, pid };
}

export function getLogs(id) {
  const entry = processes.get(id);
  if (!entry) return { stdout: [], stderr: [] };
  return { stdout: entry.stdoutBuf.get(), stderr: entry.stderrBuf.get() };
}

export async function killProcessByPid(pid, signal = 'SIGTERM') {
  const pidNum = parseInt(pid, 10);
  if (!Number.isFinite(pidNum) || pidNum <= 0) {
    return { ok: false, status: 400, body: { error: 'pid is required' } };
  }
  const sig = typeof signal === 'string' && signal ? signal : 'SIGTERM';
  try {
    await killProcessTree(pidNum, sig);
    return { ok: true, body: { ok: true, pid: pidNum, signal: sig } };
  } catch (err) {
    return { ok: false, status: 500, body: { ok: false, error: String(err) } };
  }
}

export async function listProcessesByPort(port) {
  const portNum = normalizePort(port);
  if (!Number.isFinite(portNum) || portNum <= 0) {
    return { ok: false, status: 400, body: { error: 'invalid port' } };
  }
  const items = await processesByPort(portNum);
  return { ok: true, body: items };
}

export async function searchProcesses(name) {
  const items = await searchProcessesByName(name);
  return { ok: true, body: items };
}

async function guardianAttemptStart(project) {
  const id = String(project.id || '').trim();
  const start_command = project.start_command;
  if (!id || !start_command || !String(start_command).trim()) return false;

  if (isTaskRunning(id)) return true;

  const projectPort = normalizePort(project.port);
  const runtimePid = normalizePid(project.runtime_pid);
  const portCheck = await checkPortAvailability(projectPort, { runtimePid });
  if (!portCheck.ok) {
    if (portCheck.alreadyRunningPid) {
      patchProject(id, {
        runtime_pid: portCheck.alreadyRunningPid,
        manual_stopped: false,
        was_running_before_shutdown: true,
        last_started: new Date().toISOString(),
      }, { skipUpdatedDate: true });
      return true;
    }
    if (portCheck.error) {
      console.warn(`[guard] skip start task ${id}: port check failed - ${portCheck.error}`);
    } else {
      console.warn(`[guard] skip start task ${id}: port ${projectPort} occupied by pid ${portCheck.users.map((u) => u.pid).join(',')}`);
    }
    return false;
  }

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
    child = spawnWithShell(command, { cwd, env });
  }
  const stdoutBuf = ringBuffer(500);
  const stderrBuf = ringBuffer(500);
  child.stdout.on('data', (data) => stdoutBuf.push(data.toString()));
  child.stderr.on('data', (data) => stderrBuf.push(data.toString()));

  child.on('error', (err) => {
    const entry = processes.get(id);
    if (entry) {
      entry.status = 'stopped';
      entry.exitCode = -1;
      entry.signal = null;
    }
    clearRuntimePidIfMatches(id, child.pid);
    console.error(`[guard] failed to start task ${id}: ${String(err)}`);
  });

  child.on('exit', (code, signal) => {
    const entry = processes.get(id);
    if (entry) {
      entry.status = 'stopped';
      entry.exitCode = code;
      entry.signal = signal;
    }
    clearRuntimePidIfMatches(id, child.pid);
  });

  processes.set(id, {
    child,
    status: 'running',
    command,
    cwd,
    env,
    startedAt: new Date().toISOString(),
    stdoutBuf,
    stderrBuf,
  });
  patchProject(id, { was_running_before_shutdown: true, runtime_pid: child.pid, manual_stopped: false, restart_count: 0 }, { skipUpdatedDate: true });

  const timeoutMs = 2000;
  const attempts = Math.max(2, Math.round(timeoutMs / 800));
  const ok = await waitForRunning(id, attempts, 800);
  return ok;
}

export function setupGuardian() {
  const TICK_MS = 5000;
  setInterval(async () => {
    let items = [];
    try {
      items = readProjectsFile();
    } catch {
      return;
    }
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

      if (maxRestarts > 0 && currentCount >= maxRestarts) {
        continue;
      }

      if (isTaskRunning(id)) {
        guardianState.delete(id);
        continue;
      }

      const state = guardianState.get(id) || { nextAttemptAt: 0 };
      if (now < state.nextAttemptAt) continue;

      const ok = await guardianAttemptStart(p);
      if (ok) {
        guardianState.delete(id);
        patchProject(id, {
          restart_count: 0,
          manual_stopped: false,
          last_started: new Date().toISOString(),
          was_running_before_shutdown: true,
        });
        console.log(`[guard] auto-restart succeeded for task ${id}`);
      } else {
        const newCount = currentCount + 1;
        guardianState.set(id, { nextAttemptAt: now + Math.max(1, intervalSec) * 1000 });
        patchProject(id, { restart_count: newCount });
        if (maxRestarts > 0 && newCount >= maxRestarts) {
          console.warn(`[guard] max restarts reached for task ${id}, giving up`);
        } else {
          console.warn(`[guard] auto-restart failed for task ${id}, will retry later`);
        }
      }
    }
  }, TICK_MS);
}

export async function shutdown(signal) {
  try {
    console.log(`Received ${signal}, shutting down tasks...`);
    const promises = [];
    for (const [id, entry] of processes.entries()) {
      if (!entry) continue;
      if (!isRunning(entry.child)) continue;
      promises.push(
        killProcessTree(entry.child.pid, 'SIGTERM')
          .then(() => clearRuntimePidIfMatches(id, entry.child.pid))
          .catch(() => null),
      );
    }
    await Promise.all(promises);
  } catch (e) {
    console.error('Error while shutting down tasks:', String(e));
  } finally {
    process.exit(0);
  }
}
