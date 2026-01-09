import treeKill from 'tree-kill';

export function normalizePid(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizePort(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isPidAlive(pid) {
  const pidNum = normalizePid(pid);
  if (!pidNum) return false;
  try {
    process.kill(pidNum, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcessTree(pid, signal = 'SIGTERM') {
  return new Promise((resolve, reject) => {
    const pidNum = normalizePid(pid);
    if (!pidNum) return resolve(false);
    treeKill(pidNum, signal, (err) => {
      if (err) return reject(err);
      resolve(true);
    });
  });
}
